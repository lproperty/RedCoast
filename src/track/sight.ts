/**
 * What the observer on the balcony actually sees: direction, height above the horizon,
 * whether it's inside the view, and practical "where do I look" guidance.
 */
import {
  compassPoint,
  DEG,
  elevationDeg,
  M_PER_FT,
  normDeg,
  signedDeg,
  slantKm,
  SPEED_OF_SOUND_MPS,
} from '../geo/geo.ts';
import type { WeatherReport } from '../data/feed.ts';
import { ceilingFt, parseMetar, weatherWord } from '../data/metar.ts';
import { KT_TO_KMS, type Track } from './track.ts';

export interface Observer {
  lat: number;
  lon: number;
  /** Eye height above sea level, metres. */
  heightM: number;
  /** Direction the balcony faces, degrees true. */
  facing: number;
  /** Width of the unobstructed view, degrees. */
  fov: number;
}

/** Aircraft beyond this slant range are specks at best, even in clear air. */
export const MAX_VISUAL_KM = 45;
/** Below this elevation, buildings and haze hide aircraft. */
export const MIN_VISIBLE_ELEVATION = 1;
/** Haze, mist and smog sit in the lowest couple of kilometres; above that the air is much clearer. */
export const HAZE_TOP_KM = 2;
/** When a report says "10 km or more", assume this much. */
const OPEN_VIS_KM = 20;
/** Reports older than this say little about the air now. */
const REPORT_MAX_AGE_MS = 3 * 3600_000;

/** How far you can pick out an aircraft today. */
export interface Air {
  /** How far you can see through the hazy low air, km. */
  rangeKm: number;
  /** Base of the lowest broken or overcast cloud, ft: aircraft above it are hidden. */
  ceilingFt?: number;
}

export const CLEAR_AIR: Air = { rangeKm: MAX_VISUAL_KM };

/**
 * Visual range from visibility and light. Visibility is how far you can make out a large dark
 * object by day, which is about right for an airliner; at night its lights carry further.
 */
export function airFor(visKm: number, sunEl: number, ceiling?: number): Air {
  const light = sunEl > 0 ? 1 : sunEl > -6 ? 1.2 : 1.5;
  return { rangeKm: Math.min(MAX_VISUAL_KM, visKm * light), ...(ceiling !== undefined && ceiling < 12_000 ? { ceilingFt: ceiling } : {}) };
}

/** Today's seeing conditions, and where they came from. */
export interface Conditions {
  air: Air;
  /** Visibility, km (10 = 10 km or more when reported). Absent: unknown, clear air assumed. */
  visKm?: number;
  /** What's in the air, in a word: "haze", "rain"… */
  what?: string;
  source: 'report' | 'setting' | 'none';
}

/**
 * Seeing conditions from Changi's weather report, or from the visibility set by hand
 * (setKm > 0), which overrides the report entirely.
 */
export function conditionsFor(report: WeatherReport | undefined, setKm: number, sunEl: number, now: number): Conditions {
  if (setKm > 0) return { air: airFor(setKm, sunEl), visKm: setKm, source: 'setting' };
  const m = report && now - report.t < REPORT_MAX_AGE_MS ? parseMetar(report.raw) : undefined;
  if (!m) return { air: CLEAR_AIR, source: 'none' };
  const ceiling = ceilingFt(m);
  const what = weatherWord(m.weather);
  if (m.visKm === undefined) return { air: airFor(OPEN_VIS_KM, sunEl, ceiling), what, source: 'report' };
  return { air: airFor(m.visKm >= 10 ? OPEN_VIS_KM : m.visKm, sunEl, ceiling), visKm: m.visKm, what, source: 'report' };
}

export interface Sight {
  /** Direction from the observer, degrees true. */
  az: number;
  /** Height above the horizon, degrees. */
  el: number;
  groundKm: number;
  slantKm: number;
  /** Relative to the facing direction: negative = to your left. */
  rel: number;
  inFov: boolean;
  /** In the view, above the rooftops, close enough and not lost in haze or cloud. */
  visible: boolean;
  /** Why an aircraft that's in the view and close enough still can't be seen. */
  obscured?: 'haze' | 'cloud';
  /** How long sound takes to reach you, seconds. */
  soundDelayS: number;
}

export function sightAt(obs: Observer, x: number, y: number, altFt: number, air: Air = CLEAR_AIR): Sight {
  const groundKm = Math.hypot(x, y);
  const az = normDeg(Math.atan2(x, y) / DEG);
  const dh = altFt * M_PER_FT - obs.heightM;
  const el = elevationDeg(groundKm, dh);
  const slant = slantKm(groundKm, dh);
  const rel = signedDeg(az - obs.facing);
  const inFov = Math.abs(rel) <= obs.fov / 2;
  const inSight = inFov && el >= MIN_VISIBLE_ELEVATION && slant <= MAX_VISUAL_KM;
  // Only the stretch of the sight line inside the hazy low air counts against the visibility.
  const hazyKm = el > 0 ? Math.min(slant, HAZE_TOP_KM / Math.sin(el * DEG)) : slant;
  const obscured = !inSight
    ? undefined
    : air.ceilingFt !== undefined && altFt > air.ceilingFt
      ? 'cloud'
      : hazyKm > air.rangeKm
        ? 'haze'
        : undefined;
  return {
    az,
    el,
    groundKm,
    slantKm: slant,
    rel,
    inFov,
    visible: inSight && !obscured,
    ...(obscured ? { obscured } : {}),
    soundDelayS: (slant * 1000) / SPEED_OF_SOUND_MPS,
  };
}

export function trackSight(track: Track, obs: Observer, now: number, air: Air = CLEAR_AIR): Sight {
  const p = track.display(now);
  return sightAt(obs, p.x, p.y, track.trueAltitude(now), air);
}

/** Seconds until the contact is predicted to be visible from the balcony (0 = now). */
export function viewEntryS(track: Track, obs: Observer, now: number, air: Air = CLEAR_AIR, horizonS = 300, stepS = 5): number | undefined {
  if (track.a.gnd || !track.a.gs) return track.sight?.visible ? 0 : undefined;
  for (let s = 0; s <= horizonS; s += stepS) {
    const p = track.future(now, s);
    if (sightAt(obs, p.x, p.y, track.futureAltitude(now, s), air).visible) return s;
  }
  return undefined;
}

/** Closest point of approach to the observer if the aircraft holds its current track. */
export function closestApproach(track: Track, now: number, horizonS = 900): { tS: number; distKm: number } | undefined {
  const a = track.a;
  if (a.gnd || !a.gs || a.trk === undefined) return undefined;
  const p = track.display(now);
  const v = a.gs * KT_TO_KMS;
  const vx = v * Math.sin(a.trk * DEG);
  const vy = v * Math.cos(a.trk * DEG);
  const tS = Math.min(horizonS, Math.max(0, -(p.x * vx + p.y * vy) / (v * v)));
  return { tS, distKm: Math.hypot(p.x + vx * tS, p.y + vy * tS) };
}

/** One fist at arm's length covers about 10° of sky. */
export const FIST_DEG = 10;

/** "1½ fists" for 15°. */
export function fists(deg: number): string {
  const f = Math.max(0.5, Math.round((Math.abs(deg) / FIST_DEG) * 2) / 2);
  const whole = Math.floor(f);
  const n = `${whole || ''}${f - whole >= 0.5 ? '½' : ''}`;
  return `${n} fist${f > 1 ? 's' : ''}`;
}

/** "2½ fists left · 1 fist up": pointing directions you can use without instruments. */
export function lookGuide(s: Sight): { side: string; up: string; text: string } {
  const r = Math.abs(s.rel);
  const dir = s.rel < 0 ? 'left' : 'right';
  let side: string;
  if (r < 3) side = 'straight ahead';
  else if (r <= 60) side = `${fists(r)} ${dir}`;
  else if (r <= 120) side = `far ${dir} (${Math.round(r)}°)`;
  else side = `behind you (${compassPoint(s.az)})`;
  let up: string;
  if (s.el < -0.3) up = 'below the horizon';
  else if (s.el < 3) up = 'on the horizon';
  else if (s.el <= 45) up = `${fists(s.el)} up`;
  else if (s.el < 75) up = `high up (${Math.round(s.el)}°)`;
  else up = 'nearly overhead';
  return { side, up, text: `${side} · ${up}` };
}

/** Apparent size compared with the full Moon (0.52° across). */
export function moonCompare(spanM: number | undefined, slantKmVal: number): string | undefined {
  if (!spanM || slantKmVal <= 0) return undefined;
  const deg = Math.atan2(spanM, slantKmVal * 1000) / DEG;
  const ratio = deg / 0.52;
  if (ratio >= 1.15) return `${ratio.toFixed(1)}× the width of the full Moon`;
  if (ratio >= 0.85) return 'about as wide as the full Moon';
  return `${Math.round(ratio * 100)}% of the full Moon's width`;
}
