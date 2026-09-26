/**
 * RedCoast home station.
 *
 * The free ADS-B feeds refuse cloud servers, but happily answer a home internet connection.
 * This loop runs on an always-on computer at home, fetches and merges the feeds, and pushes
 * the picture to the relay, which serves it to your phone wherever you are.
 *
 * It only works while someone is watching: when idle it just asks the relay every 10 s
 * whether anyone has the site open, which spares the free feeds and OpenSky's daily credits.
 */
import { fetchTraffic, type TrafficQuery } from '../relay/src/upstream.ts';

export interface StationConfig {
  /** e.g. https://redcoast-relay.example.workers.dev */
  relayUrl: string;
  /** Shared secret, also stored as the relay's STATION_TOKEN secret. */
  token: string;
  /** Centre of the area to fetch. Rounded to 0.1° before use. */
  lat: number;
  lon: number;
  /** Radius in nautical miles; 50 covers the app's largest range. */
  radiusNm?: number;
  openskyClientId?: string;
  openskyClientSecret?: string;
}

export const WATCHING_EVERY_MS = 4000;
export const IDLE_EVERY_MS = 10_000;

export function validateConfig(raw: unknown): StationConfig {
  const c = raw as Partial<StationConfig>;
  if (!c || typeof c !== 'object') throw new Error('config must be a JSON object');
  if (typeof c.relayUrl !== 'string' || !/^https?:\/\//.test(c.relayUrl)) throw new Error('config.relayUrl must be a URL');
  if (typeof c.token !== 'string' || c.token.length < 32) throw new Error('config.token must be at least 32 characters');
  if (typeof c.lat !== 'number' || typeof c.lon !== 'number') throw new Error('config.lat and config.lon must be numbers');
  return c as StationConfig;
}

export function areaOf(cfg: StationConfig): TrafficQuery {
  return { lat: Math.round(cfg.lat * 10) / 10, lon: Math.round(cfg.lon * 10) / 10, r: cfg.radiusNm ?? 50 };
}

/** How long to wait before the next round. */
export function nextDelayMs(watching: boolean, failures: number, elapsedMs: number): number {
  if (failures > 0) return Math.min(60_000, 2000 * 2 ** Math.min(failures, 5));
  return Math.max(watching ? 500 : 1000, (watching ? WATCHING_EVERY_MS : IDLE_EVERY_MS) - elapsedMs);
}

type Log = (msg: string) => void;

async function callRelay(cfg: StationConfig, path: string, body?: unknown): Promise<{ watching: boolean }> {
  const res = await fetch(`${cfg.relayUrl.replace(/\/+$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`relay ${path}: HTTP ${res.status}`);
  const out = (await res.json()) as { watching?: unknown };
  return { watching: out.watching === true };
}

export interface StationState {
  watching: boolean;
  failures: number;
  pushes: number;
}

/** One round: if someone is watching, fetch and push the picture; otherwise just ask. */
export async function stationRound(cfg: StationConfig, state: StationState, log: Log): Promise<void> {
  const area = areaOf(cfg);
  try {
    let watching: boolean;
    if (state.watching) {
      const picture = await fetchTraffic(
        area,
        { OPENSKY_CLIENT_ID: cfg.openskyClientId, OPENSKY_CLIENT_SECRET: cfg.openskyClientSecret },
        { waitUntil: (p) => void p.catch(() => undefined) },
        { rotate: true },
      );
      watching = (await callRelay(cfg, '/v1/push', picture)).watching;
      state.pushes++;
      if (state.pushes % 150 === 1) {
        const src = picture.sources.map((x) => `${x.id} ${x.ok ? x.count : `ERR ${x.error ?? ''}`}`).join(', ');
        log(`streaming: ${picture.ac.length} aircraft (${src})`);
      }
    } else {
      watching = (await callRelay(cfg, '/v1/station')).watching;
    }
    if (state.failures) log('relay reachable again');
    if (watching !== state.watching) log(watching ? 'someone is watching: streaming' : 'nobody watching: idle');
    state.watching = watching;
    state.failures = 0;
  } catch (err) {
    state.failures++;
    if (state.failures === 1 || state.failures % 10 === 0) log(`error (${state.failures}x): ${(err as Error).message}`);
  }
}

export async function runStation(cfg: StationConfig, log: Log): Promise<never> {
  const area = areaOf(cfg);
  log(`RedCoast station up · area ${area.lat},${area.lon} r=${area.r} nm · relay ${cfg.relayUrl}`);
  const state: StationState = { watching: false, failures: 0, pushes: 0 };
  for (;;) {
    const started = Date.now();
    const wasWatching = state.watching;
    await stationRound(cfg, state, log);
    // Someone just arrived: start streaming immediately.
    const delay = !wasWatching && state.watching ? 0 : nextDelayMs(state.watching, state.failures, Date.now() - started);
    await new Promise((r) => setTimeout(r, delay));
  }
}
