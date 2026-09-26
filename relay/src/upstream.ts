/**
 * Fetches live positions from the free ADS-B feeds and merges them into one picture:
 * adsb.lol and adsb.fi (same readsb format, used as alternates) plus the OpenSky Network.
 *
 * Used by the home station (station/station.ts), by `npm run dev` (vite.config.ts), and by
 * the relay as a direct fallback. The feeds refuse cloud servers (OpenSky blocks all hosting
 * providers; adsb.lol/adsb.fi throttle or block Cloudflare Workers), which is why production
 * fetching happens on a home connection.
 *
 * Standard fetch only: runs in Node and in Workers.
 */
import {
  MAX_POSITION_AGE_MS,
  mergeFeeds,
  parseOpenSky,
  parseReadsb,
  type FeedAircraft,
  type FeedId,
  type FeedResponse,
  type SourceStatus,
} from '../../src/data/feed.ts';

export interface UpstreamEnv {
  /** Optional OpenSky API client (free account): raises the daily budget from 400 to 4000 requests. */
  OPENSKY_CLIENT_ID?: string;
  OPENSKY_CLIENT_SECRET?: string;
}

export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface TrafficQuery {
  lat: number;
  lon: number;
  /** Radius, nautical miles. */
  r: number;
}

export interface FetchOptions {
  /** Include OpenSky (costs daily credits). Default true. */
  opensky?: boolean;
  /** Alternate between adsb.lol and adsb.fi on each call, halving the load on each. */
  rotate?: boolean;
}

const USER_AGENT = 'RedCoast/1.0 (+https://github.com/lproperty/RedCoast)';
const UPSTREAM_TIMEOUT_MS = 6000;
/** adsb.lol updates about once a second; sharing a result for 2 s coalesces bursts. */
const READSB_TTL_MS = 2000;
const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ body: unknown; ms: number; res: Response }> {
  const started = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { res?: Response };
    err.res = res;
    throw err;
  }
  return { body: await res.json(), ms: Date.now() - started, res };
}

// ---------------------------------------------------------------- adsb.lol / adsb.fi

interface Result {
  ac: FeedAircraft[];
  status: SourceStatus;
}

const readsbCache = new Map<string, { at: number; value: Result }>();
const readsbInflight = new Map<string, Promise<Result>>();

/** Both feeds are free community services with rate limits; after a 429 we leave them alone for a while. */
const READSB_UPSTREAMS: { id: FeedId; url: (q: TrafficQuery) => string; coolUntil: number }[] = [
  { id: 'adsblol', url: (q) => `https://api.adsb.lol/v2/lat/${q.lat}/lon/${q.lon}/dist/${q.r}`, coolUntil: 0 },
  { id: 'adsbfi', url: (q) => `https://opendata.adsb.fi/api/v2/lat/${q.lat}/lon/${q.lon}/dist/${q.r}`, coolUntil: 0 },
];
const COOL_DOWN_MS = 60_000;
let rotation = 0;

async function getReadsb(q: TrafficQuery, rotate: boolean): Promise<Result> {
  const key = `${q.lat},${q.lon},${q.r}`;
  const hit = readsbCache.get(key);
  if (hit && Date.now() - hit.at < READSB_TTL_MS) return hit.value;
  const pending = readsbInflight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<Result> => {
    const errors: string[] = [];
    const now = Date.now();
    const start = rotate ? rotation++ % READSB_UPSTREAMS.length : 0;
    const rotated = [...READSB_UPSTREAMS.slice(start), ...READSB_UPSTREAMS.slice(0, start)];
    // Prefer upstreams that aren't cooling down; if all are, try them anyway.
    const order = rotated.sort((a, b) => Number(a.coolUntil > now) - Number(b.coolUntil > now));
    for (const upstream of order) {
      if (upstream.coolUntil > now && order.some((u) => u.coolUntil <= now && u !== upstream)) continue;
      try {
        const { body, ms } = await fetchJson(upstream.url(q));
        const ac = parseReadsb(body, upstream.id, Date.now());
        upstream.coolUntil = 0;
        const note = errors.length ? `fallback (${errors.join('; ')})` : undefined;
        const value: Result = { ac, status: { id: upstream.id, ok: true, count: ac.length, ms, ...(note ? { note } : {}) } };
        readsbCache.set(key, { at: Date.now(), value });
        return value;
      } catch (err) {
        const res = (err as Error & { res?: Response }).res;
        if (res?.status === 429) {
          const retry = Number(res.headers.get('Retry-After'));
          upstream.coolUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : COOL_DOWN_MS);
        }
        errors.push(`${upstream.id}: ${(err as Error).message}`);
      }
    }
    const skipped = READSB_UPSTREAMS.filter((u) => u.coolUntil > Date.now()).map((u) => `${u.id} cooling down`);
    return { ac: [], status: { id: 'adsblol', ok: false, count: 0, error: [...errors, ...skipped].join('; ') } };
  })().finally(() => readsbInflight.delete(key));

  readsbInflight.set(key, task);
  return task;
}

// ---------------------------------------------------------------- OpenSky Network

/**
 * OpenSky meters use in "credits": 400/day anonymous, 4000/day with a free API client.
 * A query this size costs 1 credit, so we refresh at most every 6 s (with an account)
 * or 12 s (anonymous) and slow down as the day's remaining credits run low.
 */
const opensky = {
  token: undefined as string | undefined,
  tokenExp: 0,
  snapshots: new Map<string, { at: number; ms: number; ac: FeedAircraft[] }>(),
  lastAttempt: new Map<string, number>(),
  inflight: new Map<string, Promise<void>>(),
  backoffUntil: 0,
  remaining: undefined as number | undefined,
  lastError: undefined as string | undefined,
};

function openskyIntervalMs(authed: boolean): number {
  const base = authed ? 6000 : 12_000;
  const left = opensky.remaining;
  if (left === undefined) return base;
  if (left < 20) return 300_000;
  if (left < 100) return 60_000;
  return base;
}

async function openskyToken(env: UpstreamEnv): Promise<string> {
  if (opensky.token && Date.now() < opensky.tokenExp) return opensky.token;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.OPENSKY_CLIENT_ID ?? '',
    client_secret: env.OPENSKY_CLIENT_SECRET ?? '',
  });
  const { body } = await fetchJson(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tok = body as { access_token?: string; expires_in?: number };
  if (!tok.access_token) throw new Error('no access_token in OpenSky response');
  opensky.token = tok.access_token;
  opensky.tokenExp = Date.now() + Math.max(60, (tok.expires_in ?? 1800) - 60) * 1000;
  return opensky.token;
}

async function refreshOpenSky(q: TrafficQuery, key: string, env: UpstreamEnv, authed: boolean): Promise<void> {
  opensky.lastAttempt.set(key, Date.now());
  const dLat = q.r / 60;
  const dLon = dLat / Math.cos((q.lat * Math.PI) / 180);
  const url =
    `${OPENSKY_STATES_URL}?extended=1` +
    `&lamin=${(q.lat - dLat).toFixed(3)}&lomin=${(q.lon - dLon).toFixed(3)}` +
    `&lamax=${(q.lat + dLat).toFixed(3)}&lomax=${(q.lon + dLon).toFixed(3)}`;
  try {
    const headers: Record<string, string> = authed ? { Authorization: `Bearer ${await openskyToken(env)}` } : {};
    const { body, ms, res } = await fetchJson(url, { headers });
    const left = Number(res.headers.get('X-Rate-Limit-Remaining'));
    if (Number.isFinite(left) && res.headers.has('X-Rate-Limit-Remaining')) opensky.remaining = left;
    opensky.snapshots.set(key, { at: Date.now(), ms, ac: parseOpenSky(body, Date.now()) });
    opensky.lastError = undefined;
  } catch (err) {
    const res = (err as Error & { res?: Response }).res;
    if (res?.status === 429) {
      const wait = Number(res.headers.get('X-Rate-Limit-Retry-After-Seconds'));
      opensky.backoffUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 600_000);
      opensky.remaining = 0;
    }
    if (res?.status === 401) opensky.token = undefined;
    opensky.lastError = (err as Error).message;
  }
}

async function getOpenSky(q: TrafficQuery, env: UpstreamEnv, ctx: Ctx): Promise<Result> {
  const authed = Boolean(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET);
  const key = `${q.lat},${q.lon},${q.r}`;
  const now = Date.now();
  const due =
    now >= opensky.backoffUntil && now - (opensky.lastAttempt.get(key) ?? 0) >= openskyIntervalMs(authed);
  if (due && !opensky.inflight.has(key)) {
    const task = refreshOpenSky(q, key, env, authed).finally(() => opensky.inflight.delete(key));
    opensky.inflight.set(key, task);
    // With nothing recent cached, wait for it; otherwise answer now and refresh in the background.
    const cached = opensky.snapshots.get(key);
    if (!cached || now - cached.at > 20_000) await task;
    else ctx.waitUntil(task);
  }

  const snap = opensky.snapshots.get(key);
  const note = `${authed ? 'account' : 'anonymous'}${opensky.remaining !== undefined ? `, ${opensky.remaining} credits left` : ''}`;
  if (!snap || Date.now() - snap.at > 120_000) {
    return {
      ac: [],
      status: { id: 'opensky', ok: false, count: 0, note, error: opensky.lastError ?? (now < opensky.backoffUntil ? 'daily limit reached' : 'no data yet') },
    };
  }
  return {
    ac: snap.ac,
    status: {
      id: 'opensky',
      ok: true,
      count: snap.ac.length,
      ms: snap.ms,
      ageMs: Date.now() - snap.at,
      note,
      ...(opensky.lastError ? { error: opensky.lastError } : {}),
    },
  };
}

// ---------------------------------------------------------------- merged picture

/** Fetches every feed for the area and merges them per aircraft, freshest position first. */
export async function fetchTraffic(
  q: TrafficQuery,
  env: UpstreamEnv,
  ctx: Ctx,
  opts: FetchOptions = {},
): Promise<FeedResponse> {
  const [readsb, os] = await Promise.all([
    getReadsb(q, opts.rotate ?? false),
    opts.opensky === false ? undefined : getOpenSky(q, env, ctx),
  ]);
  const now = Date.now();
  const ac = mergeFeeds([readsb.ac, os?.ac ?? []]).filter((a) => now - a.t <= MAX_POSITION_AGE_MS);
  return { v: 1, now, sources: os ? [readsb.status, os.status] : [readsb.status], ac };
}
