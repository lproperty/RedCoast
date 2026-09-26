/**
 * Low-precision Sun and Moon positions (about 0.3° for the Sun and 1° for the Moon),
 * plenty to draw them in the sky view as orientation references.
 * Formulas after Meeus, "Astronomical Algorithms", simplified.
 */
import { DEG, normDeg } from './geo.ts';

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const OBLIQUITY = 23.4397 * DEG;

const daysSinceJ2000 = (ms: number) => (ms - J2000_MS) / 86_400_000;

interface Equatorial {
  ra: number;
  dec: number;
}

function eclipticToEquatorial(lon: number, lat: number): Equatorial {
  return {
    ra: Math.atan2(Math.sin(lon) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY), Math.cos(lon)),
    dec: Math.asin(Math.sin(lat) * Math.cos(OBLIQUITY) + Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lon)),
  };
}

function sunEquatorial(d: number): Equatorial & { lon: number } {
  const g = normDeg(357.529 + 0.98560028 * d) * DEG;
  const q = normDeg(280.459 + 0.98564736 * d);
  const lon = normDeg(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  return { ...eclipticToEquatorial(lon, 0), lon };
}

function moonEquatorial(d: number): Equatorial & { distKm: number } {
  const L = normDeg(218.316 + 13.176396 * d) * DEG;
  const M = normDeg(134.963 + 13.064993 * d) * DEG;
  const F = normDeg(93.272 + 13.22935 * d) * DEG;
  const lon = L + 6.289 * DEG * Math.sin(M);
  const lat = 5.128 * DEG * Math.sin(F);
  return { ...eclipticToEquatorial(lon, lat), distKm: 385001 - 20905 * Math.cos(M) };
}

/** Converts to azimuth (from north, clockwise) and elevation for an observer. */
function toHorizontal(eq: Equatorial, d: number, lat: number, lon: number): { az: number; el: number } {
  const gmst = normDeg(280.46061837 + 360.98564736629 * d) * DEG;
  const H = gmst + lon * DEG - eq.ra;
  const φ = lat * DEG;
  const el = Math.asin(Math.sin(φ) * Math.sin(eq.dec) + Math.cos(φ) * Math.cos(eq.dec) * Math.cos(H));
  const az = Math.atan2(
    -Math.cos(eq.dec) * Math.sin(H),
    Math.sin(eq.dec) * Math.cos(φ) - Math.cos(eq.dec) * Math.cos(H) * Math.sin(φ),
  );
  return { az: normDeg(az / DEG), el: el / DEG };
}

/** Atmospheric refraction lifts objects near the horizon by up to about half a degree. */
function refract(elDeg: number): number {
  if (elDeg < -1) return elDeg;
  const r = 1.02 / Math.tan((elDeg + 10.3 / (elDeg + 5.11)) * DEG) / 60;
  return elDeg + r;
}

export interface SkyBody {
  az: number;
  el: number;
}

export function sunPosition(ms: number, lat: number, lon: number): SkyBody {
  const d = daysSinceJ2000(ms);
  const h = toHorizontal(sunEquatorial(d), d, lat, lon);
  return { az: h.az, el: refract(h.el) };
}

export interface MoonInfo extends SkyBody {
  /** Illuminated fraction, 0 (new) … 1 (full). */
  fraction: number;
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  phase: number;
}

export function moonPosition(ms: number, lat: number, lon: number): MoonInfo {
  const d = daysSinceJ2000(ms);
  const m = moonEquatorial(d);
  const s = sunEquatorial(d);
  const h = toHorizontal(m, d, lat, lon);
  // The Moon is close enough that your position on Earth shifts it by up to ~1°.
  const parallax = Math.asin(6378.14 / m.distKm) / DEG;
  const el = refract(h.el - parallax * Math.cos(h.el * DEG));

  const sunDistKm = 149_598_000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(sunDistKm * Math.sin(phi), m.distKm - sunDistKm * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return {
    az: h.az,
    el,
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
  };
}

export type Daylight = 'day' | 'twilight' | 'night';

export function daylight(sunEl: number): Daylight {
  if (sunEl > 0) return 'day';
  if (sunEl > -6) return 'twilight';
  return 'night';
}
