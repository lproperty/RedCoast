/**
 * RedCoast relay: the public endpoint the web app polls, plus a private mailbox for the
 * home station.
 *
 *   GET  /v1/traffic?lat=1.3&lon=103.9&r=40   aircraft around a point (browsers on ALLOWED_ORIGINS only)
 *   POST /v1/push                             home station uploads its merged picture (bearer token)
 *   GET  /v1/station                          home station asks whether anyone is watching (bearer token)
 *
 * Why this shape: the free feeds don't send CORS headers, so a page on github.io can't
 * read them, and they also refuse cloud servers. So a computer at home fetches them
 * (station/) and pushes the picture here, and browsers read it from here. Without a station
 * (local development) the relay fetches the feeds itself.
 *
 * Standard fetch/Request/Response only: runs as a Cloudflare Worker (worker.ts) and in the
 * Vite dev server (vite.config.ts).
 */
import { MAX_POSITION_AGE_MS, type FeedAircraft, type FeedResponse, type WeatherReport } from '../../src/data/feed.ts';
import { fetchTraffic, type Ctx, type TrafficQuery, type UpstreamEnv } from './upstream.ts';

export type { Ctx, TrafficQuery } from './upstream.ts';

export interface Env extends UpstreamEnv {
  /** Comma-separated origins. "http://localhost:*" allows any port. */
  ALLOWED_ORIGINS?: string;
  /** "1" when running inside the local dev server: any origin is allowed. */
  DEV?: string;
  /** Shared secret the home station authenticates with. */
  STATION_TOKEN?: string;
  /** "1": when the home station is offline, fetch the feeds directly instead (they refuse Cloudflare). */
  DIRECT_FALLBACK?: string;
}

/** Keeps the home station's latest picture (a Durable Object in production). */
export interface StationStore {
  /** The latest picture, and a note that someone is watching. */
  read(): Promise<{ at: number | null; resp: FeedResponse | null }>;
  push(resp: FeedResponse): Promise<{ watching: boolean }>;
  status(): Promise<{ watching: boolean; ageMs: number | null }>;
}

/** The station counts as online if it pushed this recently. */
export const STATION_ONLINE_MS = 60_000;
const MAX_PUSH_BYTES = 2_000_000;

/**
 * Validates the query and coarsens it: 0.1° (~11 km) for the centre, 5 nm steps for the
 * radius. That makes cache hits likely, and upstream services never learn a precise location.
 */
export function parseQuery(url: URL): TrafficQuery | string {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const r = Number(url.searchParams.get('r') ?? 40);
  if (!url.searchParams.has('lat') || !Number.isFinite(lat) || Math.abs(lat) > 85) return 'lat must be between -85 and 85';
  if (!url.searchParams.has('lon') || !Number.isFinite(lon) || Math.abs(lon) > 180) return 'lon must be between -180 and 180';
  if (!Number.isFinite(r) || r <= 0) return 'r must be a positive number of nautical miles';
  return {
    lat: Math.round(lat * 10) / 10,
    lon: Math.round(lon * 10) / 10,
    r: Math.min(100, Math.max(10, Math.ceil(r / 5) * 5)),
  };
}

export function originAllowed(origin: string | null, env: Env): boolean {
  if (env.DEV === '1') return true;
  if (!origin) return false;
  for (const raw of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    const allowed = raw.trim();
    if (!allowed) continue;
    if (allowed === origin) return true;
    if (allowed.endsWith(':*')) {
      const base = allowed.slice(0, -2);
      const rest = origin.startsWith(`${base}:`) ? origin.slice(base.length + 1) : '';
      if (origin === base || /^\d{1,5}$/.test(rest)) return true;
    }
  }
  return false;
}

/** Constant-time check of the station's bearer token. */
export function stationAuthorized(request: Request, env: Env): boolean {
  const expected = env.STATION_TOKEN ?? '';
  const got = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (expected.length < 32 || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** Aircraft within the query radius (the station covers a wider area than any one view needs). */
export function withinRadius(ac: FeedAircraft[], q: TrafficQuery): FeedAircraft[] {
  const rKm = q.r * 1.852;
  const kx = 111.32 * Math.cos((q.lat * Math.PI) / 180);
  return ac.filter((a) => Math.hypot((a.lat - q.lat) * 110.57, (a.lon - q.lon) * kx) <= rKm);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!originAllowed(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** The station's weather report, if it looks like one. */
function weatherReport(v: unknown): WeatherReport | undefined {
  const w = v as Partial<WeatherReport> | undefined;
  if (!w || typeof w.id !== 'string' || typeof w.raw !== 'string' || typeof w.t !== 'number') return undefined;
  return { id: w.id.slice(0, 8), raw: w.raw.slice(0, 400), t: w.t };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function stationRoute(request: Request, url: URL, env: Env, station: StationStore | undefined): Promise<Response> {
  if (!station) return json({ error: 'this relay has no station mailbox' }, 404);
  if (!stationAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
  if (url.pathname === '/v1/station') return json(await station.status(), 200);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const text = await request.text();
  if (text.length > MAX_PUSH_BYTES) return json({ error: 'picture too large' }, 413);
  let body: Partial<FeedResponse>;
  try {
    body = JSON.parse(text) as Partial<FeedResponse>;
  } catch {
    return json({ error: 'body is not JSON' }, 400);
  }
  if (body?.v !== 1 || !Array.isArray(body.ac) || !Array.isArray(body.sources)) return json({ error: 'not a RedCoast picture' }, 400);
  const wx = weatherReport(body.wx);
  const clean: FeedResponse = {
    v: 1,
    now: Number(body.now) || Date.now(),
    sources: body.sources.slice(0, 8),
    ac: body.ac.filter((a) => a && typeof a.lat === 'number' && typeof a.lon === 'number' && typeof a.t === 'number').slice(0, 3000),
    ...(wx ? { wx } : {}),
  };
  return json(await station.push(clean), 200);
}

export async function handleRequest(request: Request, env: Env, ctx: Ctx, station?: StationStore): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);

  if (url.pathname === '/v1/push' || url.pathname === '/v1/station') return stationRoute(request, url, env, station);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed(origin, env) ? 204 : 403, headers: cors });
  }
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);

  if (url.pathname === '/' || url.pathname === '/health') {
    return json({ ok: true, service: 'redcoast-relay', usage: 'GET /v1/traffic?lat=1.3&lon=103.9&r=40' }, 200, cors);
  }
  if (url.pathname !== '/v1/traffic') return json({ error: 'not found' }, 404, cors);
  if (!originAllowed(origin, env)) return json({ error: 'origin not allowed' }, 403, cors);

  const q = parseQuery(url);
  if (typeof q === 'string') return json({ error: q }, 400, cors);

  const now = Date.now();
  if (station) {
    const snap = await station.read();
    const ageMs = snap.at === null ? null : now - snap.at;
    const online = ageMs !== null && ageMs < STATION_ONLINE_MS;
    if (online || env.DIRECT_FALLBACK !== '1') {
      const ac = snap.resp ? withinRadius(snap.resp.ac, q).filter((a) => now - a.t <= MAX_POSITION_AGE_MS) : [];
      const wx = snap.resp?.wx;
      const body: FeedResponse = { v: 1, now, sources: snap.resp?.sources ?? [], ac, station: { online, ageMs }, ...(wx ? { wx } : {}) };
      return json(body, 200, cors);
    }
  }

  const body = await fetchTraffic(q, env, ctx);
  return json(body, body.sources.some((x) => x.ok) ? 200 : 502, cors);
}
