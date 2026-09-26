/**
 * The RedCoast wire format, plus parsers for the upstream feeds.
 *
 * Shared by the browser app and the Cloudflare relay (relay/src), so it must only
 * use standard JavaScript — no DOM, no Node APIs.
 *
 * Units: altitude ft, speed kt, vertical rate ft/min, angles degrees true,
 * times epoch milliseconds.
 */

export type FeedId = 'adsblol' | 'adsbfi' | 'opensky' | 'custom' | 'sim';
export type PosSource = 'adsb' | 'mlat' | 'tisb' | 'other';

export interface FeedAircraft {
  /** ICAO 24-bit address, lower-case hex. Non-ICAO (TIS-B) addresses start with "~". */
  hex: string;
  /** Callsign as transmitted, trimmed, e.g. "SIA321". */
  cs?: string;
  reg?: string;
  /** ICAO type designator, e.g. "B77W". */
  type?: string;
  /** Long type description from the aggregator's database, e.g. "BOEING 777-300ER". */
  desc?: string;
  /** Owner / operator from the aggregator's database. */
  op?: string;
  year?: number;
  /** ADS-B emitter category, e.g. "A5" (heavy), "A7" (rotorcraft). */
  cat?: string;
  mil?: boolean;

  lat: number;
  lon: number;
  /** When the position was measured (epoch ms, relay clock). */
  t: number;
  /** Barometric (pressure) altitude, ft. Absent on the ground. */
  alt?: number;
  /** Geometric (GNSS) altitude, ft. */
  galt?: number;
  gnd?: boolean;
  /** Ground speed, kt. */
  gs?: number;
  /** Track over ground, degrees true. */
  trk?: number;
  /** Rate of turn, degrees per second (positive = right). */
  trate?: number;
  /** Vertical rate, ft/min. */
  vr?: number;
  /** True heading, degrees. */
  hdg?: number;
  ias?: number;
  tas?: number;
  mach?: number;
  roll?: number;
  sq?: string;
  /** Emergency state when not "none": general, lifeguard, minfuel, nordo, unlawful, downed. */
  em?: string;
  /** Altitude selected on the autopilot (MCP/FCU), ft. */
  navAlt?: number;
  navHdg?: number;
  qnh?: number;
  /** Wind at the aircraft (direction from, speed kt) and outside air temperature °C. */
  wd?: number;
  ws?: number;
  oat?: number;

  src: PosSource;
  via: FeedId;
  /** Simulator only: route hint (ICAO airport codes). */
  sim?: { from: string; to: string };
}

export interface SourceStatus {
  id: FeedId;
  ok: boolean;
  count: number;
  /** Upstream round-trip time. */
  ms?: number;
  /** How old the upstream snapshot is (cached OpenSky data can be a few seconds old). */
  ageMs?: number;
  error?: string;
  note?: string;
}

export interface FeedResponse {
  v: 1;
  /** Relay clock at response time (epoch ms). */
  now: number;
  sources: SourceStatus[];
  ac: FeedAircraft[];
}

/** Positions older than this are dropped: they are more misleading than useful. */
export const MAX_POSITION_AGE_MS = 60_000;

const M_TO_FT = 3.28084;
const MPS_TO_KT = 1.943844;
const MPS_TO_FPM = 196.8504;

type Json = Record<string, unknown>;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
};

/** Upstream `now` may be epoch seconds (adsb.fi, tar1090) or milliseconds (adsb.lol). */
export function epochMs(v: unknown, fallback: number): number {
  const n = num(v);
  if (n === undefined) return fallback;
  return n < 1e11 ? n * 1000 : n;
}

function readsbSource(type: unknown): PosSource {
  if (typeof type !== 'string') return 'other';
  if (type === 'mlat') return 'mlat';
  if (type.startsWith('tisb')) return 'tisb';
  if (type.startsWith('adsb') || type.startsWith('adsr') || type === 'adsc') return 'adsb';
  return 'other';
}

/** Parses readsb / tar1090 JSON (adsb.lol, adsb.fi, a home receiver's aircraft.json). */
export function parseReadsb(json: unknown, via: FeedId, receivedAt: number): FeedAircraft[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Json;
  const list = (Array.isArray(root.ac) ? root.ac : Array.isArray(root.aircraft) ? root.aircraft : []) as Json[];
  const now = epochMs(root.now, receivedAt);
  const out: FeedAircraft[] = [];
  for (const a of list) {
    const lat = num(a.lat);
    const lon = num(a.lon);
    const hex = str(a.hex)?.toLowerCase();
    const seenPos = num(a.seen_pos) ?? num(a.seen) ?? 0;
    if (lat === undefined || lon === undefined || !hex) continue;
    if (seenPos * 1000 > MAX_POSITION_AGE_MS) continue;
    const onGround = a.alt_baro === 'ground';
    const dbFlags = num(a.dbFlags) ?? 0;
    const em = str(a.emergency);
    const rec: FeedAircraft = {
      hex,
      lat,
      lon,
      t: Math.round(now - seenPos * 1000),
      src: readsbSource(a.type),
      via,
    };
    assign(rec, {
      cs: str(a.flight),
      reg: str(a.r),
      type: str(a.t),
      desc: str(a.desc),
      op: str(a.ownOp),
      year: num(typeof a.year === 'string' ? Number.parseInt(a.year, 10) : a.year),
      cat: str(a.category),
      mil: (dbFlags & 1) === 1 ? true : undefined,
      alt: onGround ? undefined : num(a.alt_baro),
      galt: num(a.alt_geom),
      gnd: onGround ? true : undefined,
      gs: num(a.gs),
      trk: num(a.track),
      trate: num(a.track_rate),
      vr: num(a.baro_rate) ?? num(a.geom_rate),
      hdg: num(a.true_heading),
      ias: num(a.ias),
      tas: num(a.tas),
      mach: num(a.mach),
      roll: num(a.roll),
      sq: str(a.squawk),
      em: em && em !== 'none' ? em : undefined,
      navAlt: num(a.nav_altitude_fms) ?? num(a.nav_altitude_mcp),
      navHdg: num(a.nav_heading),
      qnh: num(a.nav_qnh),
      wd: num(a.wd),
      ws: num(a.ws),
      oat: num(a.oat),
    });
    out.push(rec);
  }
  return out;
}

/** OpenSky `category` (with extended=1) to the ADS-B emitter category letters readsb uses. */
const OPENSKY_CATEGORY: Record<number, string> = {
  2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7',
  9: 'B1', 10: 'B2', 11: 'B3', 12: 'B4', 14: 'B6', 15: 'B7',
  16: 'C1', 17: 'C2', 18: 'C3', 19: 'C4', 20: 'C5',
};

const SQUAWK_EMERGENCY: Record<string, string> = { '7500': 'unlawful', '7600': 'nordo', '7700': 'general' };

/** Parses an OpenSky Network `/states/all` response (state vectors are positional arrays). */
export function parseOpenSky(json: unknown, receivedAt: number): FeedAircraft[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Json;
  const states = Array.isArray(root.states) ? (root.states as unknown[][]) : [];
  const now = epochMs(root.time, receivedAt);
  const out: FeedAircraft[] = [];
  for (const s of states) {
    if (!Array.isArray(s)) continue;
    const hex = str(s[0])?.toLowerCase();
    const tPos = num(s[3]);
    const lon = num(s[5]);
    const lat = num(s[6]);
    if (!hex || tPos === undefined || lat === undefined || lon === undefined) continue;
    const t = tPos * 1000;
    if (now - t > MAX_POSITION_AGE_MS) continue;
    const onGround = s[8] === true;
    const baro = num(s[7]);
    const vel = num(s[9]);
    const vr = num(s[11]);
    const geo = num(s[13]);
    const sq = str(s[14]);
    const rec: FeedAircraft = { hex, lat, lon, t, src: s[16] === 2 ? 'mlat' : 'adsb', via: 'opensky' };
    assign(rec, {
      cs: str(s[1]),
      alt: onGround || baro === undefined ? undefined : Math.round(baro * M_TO_FT),
      galt: geo === undefined ? undefined : Math.round(geo * M_TO_FT),
      gnd: onGround ? true : undefined,
      gs: vel === undefined ? undefined : Math.round(vel * MPS_TO_KT * 10) / 10,
      trk: num(s[10]),
      vr: vr === undefined ? undefined : Math.round(vr * MPS_TO_FPM),
      sq,
      em: sq ? SQUAWK_EMERGENCY[sq] : undefined,
      cat: OPENSKY_CATEGORY[num(s[17]) ?? -1],
    });
    out.push(rec);
  }
  return out;
}

/** Copies only defined values, keeping records small on the wire. */
function assign(target: FeedAircraft, values: Partial<FeedAircraft>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) (target as unknown as Json)[k] = v;
  }
}

/** Fields that describe one position fix; they are only taken together, from one source. */
const KINEMATIC_KEYS = ['lat', 'lon', 't', 'alt', 'galt', 'gnd', 'gs', 'trk', 'trate', 'vr', 'src', 'via'] as const;

/**
 * Merges several feeds by ICAO address. The freshest position wins; everything else
 * (registration, type, autopilot and weather data) is filled from whichever feed has it.
 */
export function mergeFeeds(lists: FeedAircraft[][]): FeedAircraft[] {
  const byHex = new Map<string, FeedAircraft>();
  for (const list of lists) {
    for (const rec of list) {
      const prev = byHex.get(rec.hex);
      if (!prev) {
        byHex.set(rec.hex, { ...rec });
        continue;
      }
      const [fresh, stale] = rec.t > prev.t ? [{ ...rec }, prev] : [prev, rec];
      const merged = fresh as unknown as Json;
      const other = stale as unknown as Json;
      const kinematic = new Set<string>(KINEMATIC_KEYS);
      for (const [k, v] of Object.entries(other)) {
        if (v === undefined || merged[k] !== undefined) continue;
        // Speed/track from an older fix is fine to borrow if it is recent; lat/lon/alt are not.
        if (kinematic.has(k) && !(k === 'gs' || k === 'trk' || k === 'vr')) continue;
        if (kinematic.has(k) && fresh.t - stale.t > 10_000) continue;
        merged[k] = v;
      }
      byHex.set(rec.hex, fresh);
    }
  }
  return [...byHex.values()];
}
