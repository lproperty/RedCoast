/**
 * Geodesy for a ~100 km observation area: great-circle bearings and distances,
 * a local east/north frame in kilometres, and what an observer actually sees
 * (azimuth, elevation above the horizon with Earth curvature and refraction).
 */

export const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371.0088;
export const M_PER_FT = 0.3048;
export const KM_PER_NM = 1.852;
export const SPEED_OF_SOUND_MPS = 343;

/** Standard terrestrial refraction coefficient: light bends and lets you see a bit past the geometric horizon. */
const REFRACTION_K = 0.13;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Normalise to [0, 360). */
export function normDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Normalise to (-180, 180]. */
export function signedDeg(d: number): number {
  const r = normDeg(d);
  return r > 180 ? r - 360 : r;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial great-circle bearing from a to b, degrees true. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normDeg(Math.atan2(y, x) / DEG);
}

/** Point reached from `from` after `distKm` along initial bearing `brg`. */
export function destination(from: LatLon, brg: number, distKm: number): LatLon {
  const δ = distKm / EARTH_RADIUS_KM;
  const θ = brg * DEG;
  const φ1 = from.lat * DEG;
  const λ1 = from.lon * DEG;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / DEG, lon: signedDeg(λ2 / DEG) };
}

/** Signed distance of p from the great circle a→b (positive = right of track). */
export function crossTrackKm(p: LatLon, a: LatLon, b: LatLon): number {
  const δ13 = haversineKm(a, p) / EARTH_RADIUS_KM;
  const θ13 = bearingDeg(a, p) * DEG;
  const θ12 = bearingDeg(a, b) * DEG;
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_KM;
}

/** Distance from a to the point on great circle a→b closest to p (negative if behind a). */
export function alongTrackKm(p: LatLon, a: LatLon, b: LatLon): number {
  const δ13 = haversineKm(a, p) / EARTH_RADIUS_KM;
  const δxt = crossTrackKm(p, a, b) / EARTH_RADIUS_KM;
  const θ13 = bearingDeg(a, p) * DEG;
  const θ12 = bearingDeg(a, b) * DEG;
  const sign = Math.cos(θ13 - θ12) >= 0 ? 1 : -1;
  return sign * Math.acos(Math.min(1, Math.cos(δ13) / Math.cos(δxt))) * EARTH_RADIUS_KM;
}

/**
 * Flat east/north frame around an origin, in kilometres. Uses the WGS-84 radii of
 * curvature at the origin, so it is accurate to a few metres across 100 km.
 */
export class LocalFrame {
  readonly origin: LatLon;
  private readonly kmPerDegLat: number;
  private readonly kmPerDegLon: number;

  constructor(origin: LatLon) {
    this.origin = { ...origin };
    const a = 6378.137;
    const e2 = 0.00669437999014;
    const sinφ = Math.sin(origin.lat * DEG);
    const w = 1 - e2 * sinφ * sinφ;
    const meridional = (a * (1 - e2)) / w ** 1.5;
    const primeVertical = a / Math.sqrt(w);
    this.kmPerDegLat = meridional * DEG;
    this.kmPerDegLon = primeVertical * Math.cos(origin.lat * DEG) * DEG;
  }

  toXY(lat: number, lon: number): [number, number] {
    return [(lon - this.origin.lon) * this.kmPerDegLon, (lat - this.origin.lat) * this.kmPerDegLat];
  }

  toLatLon(x: number, y: number): LatLon {
    return { lat: this.origin.lat + y / this.kmPerDegLat, lon: this.origin.lon + x / this.kmPerDegLon };
  }
}

/**
 * Apparent elevation angle (degrees) of a target `groundKm` away and `heightDiffM` above
 * the observer's eye, including the drop from Earth curvature, softened by refraction.
 */
export function elevationDeg(groundKm: number, heightDiffM: number): number {
  const d = Math.max(groundKm * 1000, 1);
  const effectiveRadius = (EARTH_RADIUS_KM * 1000) / (1 - REFRACTION_K);
  const drop = (d * d) / (2 * effectiveRadius);
  return Math.atan2(heightDiffM - drop, d) / DEG;
}

export function slantKm(groundKm: number, heightDiffM: number): number {
  return Math.hypot(groundKm, heightDiffM / 1000);
}

const POINTS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

export function compassPoint(deg: number): string {
  return POINTS_16[Math.round(normDeg(deg) / 22.5) % 16]!;
}

const POINT_NAMES: Record<string, string> = {
  N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast',
  E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast',
  S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest',
  W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest',
};

export function compassName(deg: number): string {
  return POINT_NAMES[compassPoint(deg)] ?? '';
}

/** Linear interpolation of angles along the shorter arc. */
export function lerpDeg(a: number, b: number, t: number): number {
  return normDeg(a + signedDeg(b - a) * t);
}
