/**
 * Estimated take-off and landing times for the leg an aircraft is flying. There are no
 * schedules behind these: just the distance, the speed, and a slower, less direct path near
 * each airport.
 */
import type { LegProgress } from '../enrich/lookup.ts';
import { bearingDeg, haversineKm, signedDeg, type LatLon } from '../geo/geo.ts';
import type { Track } from './track.ts';

/** Roughly how far out the climb-out and the approach reach from each airport. */
const TERMINAL_KM = 40;
const KMH_PER_KT = 1.852;
const HOUR_MS = 3_600_000;

export interface LegTimes {
  /** Take-off (epoch ms); `seen` when it was watched leaving the ground or climbing out. */
  departed?: { at: number; seen: boolean };
  /** Touchdown (epoch ms). */
  arrives?: number;
}

/** Hours to fly `km` of a leg: at cruise speed, then the terminal part slower and less direct. */
function hoursFor(km: number, cruiseKt: number, terminalKt: number, stretch: number): number {
  const far = Math.max(0, km - TERMINAL_KM);
  const near = Math.min(km, TERMINAL_KM);
  return far / (cruiseKt * KMH_PER_KT) + (near * stretch) / (terminalKt * KMH_PER_KT);
}

/**
 * Distance flown and still to go. Near an airport, aircraft come and go by the runway, not
 * along the great circle: an arrival lining up from the far side is "past" the airport on the
 * route line but still kilometres away, so the direct distance is the least it can be.
 */
export function legDistances(pos: LatLon, leg: LegProgress): { flownKm: number; toGoKm: number } {
  const floor = (km: number, direct: number) => Math.min(leg.totalKm, Math.max(km, direct));
  return { flownKm: floor(leg.flownKm, haversineKm(pos, leg.from)), toGoKm: floor(leg.remainingKm, haversineKm(pos, leg.to)) };
}

export function legTimes(t: Track, leg: LegProgress, now: number): LegTimes {
  const a = t.a;
  if (!leg.plausible || a.gnd || !a.gs) return {};
  const gs = a.gs;
  const out: LegTimes = {};
  const { flownKm, toGoKm } = legDistances(a, leg);

  if (toGoKm > 1) {
    // Near the ends the current speed is a poor guide, so the long part uses a typical cruise.
    const cruiseKt = toGoKm > 200 ? Math.max(gs, 450) : Math.max(gs, 180);
    const approachKt = Math.min(Math.max(gs, 140), 230);
    // Already pointing at the airport (e.g. on final): little extra distance to fly.
    const inbound = a.trk !== undefined && Math.abs(signedDeg(a.trk - bearingDeg(a, leg.to))) < 30;
    out.arrives = now + hoursFor(toGoKm, cruiseKt, approachKt, inbound ? 1.1 : 1.4) * HOUR_MS;
  }

  if (t.liftoff !== undefined) {
    out.departed = { at: t.liftoff, seen: true };
  } else if (t.first.alt !== undefined && t.first.alt < 5000 && haversineKm(t.first, leg.from) < 25) {
    // First seen low on the climb-out: back off the climb at about 2,000 ft a minute.
    out.departed = { at: t.first.t - (t.first.alt / 2000) * 60_000, seen: true };
  } else if (flownKm > 1) {
    const cruiseKt = flownKm > 200 ? Math.max(gs, 450) : Math.max(gs, 200);
    out.departed = { at: now - hoursFor(flownKm, cruiseKt, 220, 1.2) * HOUR_MS, seen: false };
  }
  return out;
}
