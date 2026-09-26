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
  /** In the view, above the rooftops and close enough to see. */
  visible: boolean;
  /** How long sound takes to reach you, seconds. */
  soundDelayS: number;
}

export function sightAt(obs: Observer, x: number, y: number, altFt: number): Sight {
  const groundKm = Math.hypot(x, y);
  const az = normDeg(Math.atan2(x, y) / DEG);
  const dh = altFt * M_PER_FT - obs.heightM;
  const el = elevationDeg(groundKm, dh);
  const slant = slantKm(groundKm, dh);
  const rel = signedDeg(az - obs.facing);
  const inFov = Math.abs(rel) <= obs.fov / 2;
  return {
    az,
    el,
    groundKm,
    slantKm: slant,
    rel,
    inFov,
    visible: inFov && el >= MIN_VISIBLE_ELEVATION && slant <= MAX_VISUAL_KM,
    soundDelayS: (slant * 1000) / SPEED_OF_SOUND_MPS,
  };
}

export function trackSight(track: Track, obs: Observer, now: number): Sight {
  const p = track.display(now);
  return sightAt(obs, p.x, p.y, track.trueAltitude(now));
}

/** Seconds until the contact is predicted to be visible from the balcony (0 = now). */
export function viewEntryS(track: Track, obs: Observer, now: number, horizonS = 300, stepS = 5): number | undefined {
  if (track.a.gnd || !track.a.gs) return track.sight?.visible ? 0 : undefined;
  for (let s = 0; s <= horizonS; s += stepS) {
    const p = track.future(now, s);
    if (sightAt(obs, p.x, p.y, track.futureAltitude(now, s)).visible) return s;
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
