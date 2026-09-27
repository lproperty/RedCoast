/**
 * User settings, persisted in this browser only (localStorage). The observation post
 * (your balcony) is never sent anywhere: the relay only receives a position rounded to ~11 km.
 *
 * A setup link can pre-fill settings via the URL hash, which browsers never send to servers:
 *   https://…/RedCoast/#lat=1.3018&lon=103.9128&facing=180&fov=150&h=30
 */
import { normDeg } from '../geo/geo.ts';
import type { Observer } from '../track/sight.ts';

export type Units = 'metric' | 'aviation';
export type ThemeName = 'phosphor' | 'graphite';
export type ScopeMode = 'ppi' | 'sector';
export type Orientation = 'facing' | 'north';
export type SourceKind = 'live' | 'sim' | 'custom';
export type LabelLevel = 'full' | 'compact' | 'off';

export interface Settings {
  v: 1;
  observer: Observer & { name: string };
  /** False until the user sets their own post (first-run setup). */
  configured: boolean;
  rangeKm: number;
  mode: ScopeMode;
  orientation: Orientation;
  theme: ThemeName;
  units: Units;
  labels: LabelLevel;
  showGround: boolean;
  /** Minutes of history dots behind each contact. */
  trailMin: number;
  /** Seconds of travel shown by each contact's leader line. */
  leaderS: number;
  crt: boolean;
  /** Random echoes the sweep leaves near the centre, like the waves a real radar sees. */
  clutter: boolean;
  /** Seconds per antenna revolution. */
  sweepS: number;
  sound: boolean;
  volume: number;
  alertNew: boolean;
  alertView: boolean;
  alertSpecial: boolean;
  source: SourceKind;
  customUrl: string;
  /** Overrides the built-in relay URL when set. */
  relayUrl: string;
  pollS: number;
  /** Hide contacts above this altitude (ft); 0 = show all. */
  maxAltFt: number;
  /** How far you can see, km, for what counts as in view; 0 = from Changi's weather report. */
  visKm: number;
  /** Compass correction for point mode, degrees. */
  compassOffset: number;
  keepAwake: boolean;
}

/** Public default: a spot in East Coast Park, facing the sea. Your own post is set on first run. */
export const DEFAULT_POST = { name: 'Marine Cove, East Coast Park', lat: 1.3018, lon: 103.9128, heightM: 6, facing: 180, fov: 150 };

export const RANGES_KM = [3, 5, 10, 15, 25, 40, 60] as const;

export const DEFAULTS: Settings = {
  v: 1,
  observer: { ...DEFAULT_POST },
  configured: false,
  rangeKm: 25,
  mode: 'ppi',
  orientation: 'facing',
  theme: 'phosphor',
  units: 'metric',
  labels: 'full',
  showGround: false,
  trailMin: 2,
  leaderS: 60,
  crt: true,
  clutter: true,
  sweepS: 4,
  sound: false,
  volume: 0.6,
  alertNew: false,
  alertView: true,
  alertSpecial: true,
  source: 'live',
  customUrl: '',
  relayUrl: '',
  pollS: 3,
  maxAltFt: 0,
  visKm: 0,
  compassOffset: 0,
  keepAwake: false,
};

const KEY = 'rc.settings.v1';

type Listener = (s: Settings, prev: Settings) => void;

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** Makes any stored or hand-edited object safe to use. */
export function sanitize(raw: unknown): Settings {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {}) } as Settings;
  const o = { ...DEFAULTS.observer, ...(s.observer ?? {}) };
  s.observer = {
    name: String(o.name ?? 'Balcony').slice(0, 60),
    lat: clampNum(o.lat, -85, 85, DEFAULT_POST.lat),
    lon: clampNum(o.lon, -180, 180, DEFAULT_POST.lon),
    heightM: clampNum(o.heightM, -50, 1000, DEFAULT_POST.heightM),
    facing: normDeg(clampNum(o.facing, -360, 720, DEFAULT_POST.facing)),
    fov: clampNum(o.fov, 20, 360, DEFAULT_POST.fov),
  };
  s.rangeKm = (RANGES_KM as readonly number[]).includes(s.rangeKm) ? s.rangeKm : DEFAULTS.rangeKm;
  s.sweepS = clampNum(s.sweepS, 1.5, 12, DEFAULTS.sweepS);
  s.pollS = clampNum(s.pollS, 2, 30, DEFAULTS.pollS);
  s.volume = clampNum(s.volume, 0, 1, DEFAULTS.volume);
  s.trailMin = clampNum(s.trailMin, 0, 10, DEFAULTS.trailMin);
  s.leaderS = clampNum(s.leaderS, 0, 300, DEFAULTS.leaderS);
  s.maxAltFt = clampNum(s.maxAltFt, 0, 60000, 0);
  s.visKm = clampNum(s.visKm, 0, 45, 0);
  // Saved before sea clutter had its own switch, it went with the CRT effects.
  if (!(raw && typeof raw === 'object' && 'clutter' in raw)) s.clutter = s.crt;
  s.compassOffset = clampNum(s.compassOffset, -180, 180, 0);
  if (!['ppi', 'sector'].includes(s.mode)) s.mode = DEFAULTS.mode;
  if (!['facing', 'north'].includes(s.orientation)) s.orientation = DEFAULTS.orientation;
  if (!['phosphor', 'graphite'].includes(s.theme)) s.theme = DEFAULTS.theme;
  if (!['metric', 'aviation'].includes(s.units)) s.units = DEFAULTS.units;
  if (!['full', 'compact', 'off'].includes(s.labels)) s.labels = DEFAULTS.labels;
  if (!['live', 'sim', 'custom'].includes(s.source)) s.source = DEFAULTS.source;
  s.v = 1;
  return s;
}

/** Parses "#lat=..&lon=..&facing=.." (also accepts "#post=1.30,103.91"). */
export function parseHash(hash: string): Partial<Settings> | undefined {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<Settings> = {};
  let lat = Number(p.get('lat'));
  let lon = Number(p.get('lon'));
  const post = p.get('post')?.split(',');
  if (post?.length === 2) [lat, lon] = post.map(Number) as [number, number];
  const hasPos = p.has('lat') || p.has('post');
  if (hasPos && Number.isFinite(lat) && Number.isFinite(lon)) {
    out.observer = {
      ...DEFAULTS.observer,
      name: p.get('name') ?? 'Balcony',
      lat,
      lon,
      heightM: p.has('h') ? Number(p.get('h')) : DEFAULTS.observer.heightM,
      facing: p.has('facing') ? Number(p.get('facing')) : DEFAULTS.observer.facing,
      fov: p.has('fov') ? Number(p.get('fov')) : DEFAULTS.observer.fov,
    };
    out.configured = true;
  }
  const src = p.get('src');
  if (src === 'sim' || src === 'live') out.source = src;
  return Object.keys(out).length ? out : undefined;
}

export function setupLink(s: Settings, base = location.href.split('#')[0]!): string {
  const o = s.observer;
  const q = new URLSearchParams({
    lat: o.lat.toFixed(6),
    lon: o.lon.toFixed(6),
    facing: String(Math.round(o.facing)),
    fov: String(Math.round(o.fov)),
    h: String(Math.round(o.heightM)),
  });
  return `${base}#${q.toString()}`;
}

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<Listener>();

  constructor() {
    let stored: unknown;
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      stored = null;
    }
    this.current = sanitize(stored);
    const fromHash = parseHash(location.hash);
    if (fromHash) {
      this.current = sanitize({ ...this.current, ...fromHash });
      this.save();
      // Keep the location out of the address bar (and out of screenshots and shared links).
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void {
    const prev = this.current;
    const p = typeof patch === 'function' ? patch(prev) : patch;
    this.current = sanitize({ ...prev, ...p, observer: { ...prev.observer, ...(p.observer ?? {}) } });
    this.save();
    for (const l of this.listeners) l(this.current, prev);
  }

  reset(): void {
    this.update({ ...DEFAULTS, observer: { ...DEFAULTS.observer } });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.current));
    } catch {
      /* private mode: settings last for this session only */
    }
  }
}
