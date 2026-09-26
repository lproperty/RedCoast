/**
 * Works out what each contact is doing: arriving or departing (and where), overflying,
 * which runway it's lined up with, its flight phase, and whether it's worth an alert.
 */
import { bearingDeg, haversineKm, signedDeg, DEG, type LatLon } from '../geo/geo.ts';
import { lookupType } from '../data/static/aircraftTypes.ts';
import { AIRPORTS, LOCAL_AERODROMES } from '../data/static/airports.ts';
import { RUNWAY_ENDS, type RunwayEnd } from '../map/map.ts';
import type { Track } from './track.ts';

export type Kind = 'ARR' | 'DEP' | 'OVF' | 'LOCAL' | 'GND' | 'UNK';
export type Phase = 'GROUND' | 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCENT' | 'APPROACH' | 'FINAL' | 'LEVEL';

export interface Classification {
  kind: Kind;
  /** ICAO code of the local airport for ARR/DEP. */
  airport?: string;
  /** Runway it is lined up with, e.g. "02C". */
  runway?: string;
  phase: Phase;
  mil: boolean;
  heli: boolean;
  emergency?: string;
  /** Why this contact is special ("A380", "Military", …), if it is. */
  special?: string;
}

const EMERGENCY_TEXT: Record<string, string> = {
  general: 'EMERGENCY',
  lifeguard: 'MEDICAL',
  minfuel: 'MIN FUEL',
  nordo: 'RADIO FAILURE',
  unlawful: 'HIJACK',
  downed: 'DOWNED',
};

export function emergencyText(code: string | undefined): string | undefined {
  return code ? (EMERGENCY_TEXT[code] ?? code.toUpperCase()) : undefined;
}

/** Runways worth checking alignment against (the big ones near the East Coast). */
const ALIGN_ENDS = RUNWAY_ENDS.filter((e) => ['WSSS', 'WSAP', 'WSSL', 'WIDD'].includes(e.ap));

export interface Alignment {
  end: RunwayEnd;
  mode: 'arr' | 'dep';
  /** Distance to the threshold (arrivals) or from it (departures), km. */
  distKm: number;
}

/** Lined up on final for, or climbing out from, a runway? */
export function runwayAlignment(pos: LatLon, trk: number | undefined, altFt: number, vr: number): Alignment | undefined {
  if (trk === undefined || altFt > 6500) return undefined;
  let best: Alignment | undefined;
  let bestOff = Infinity;
  for (const end of ALIGN_ENDS) {
    const d = haversineKm(end.thr, pos);
    if (d > 30) continue;
    const b = bearingDeg(end.thr, pos);
    const heading = Math.abs(signedDeg(trk - end.course));
    // Final approach: behind the threshold on the extended centreline, heading the landing way.
    const back = (b - (end.course + 180)) * DEG;
    const along = d * Math.cos(back);
    const off = Math.abs(d * Math.sin(back));
    const glideFt = 500 + along * 1000 * Math.tan(3 * DEG) * 3.28 * 2;
    if (along > -0.3 && along < 28 && off < 1 + along * 0.04 && heading < 20 && altFt < glideFt && vr < 800) {
      if (off < bestOff) {
        bestOff = off;
        best = { end, mode: 'arr', distKm: Math.max(0, along) };
      }
      continue;
    }
    // Climb-out: past the threshold along the runway course, climbing.
    const fwd = (b - end.course) * DEG;
    const ahead = d * Math.cos(fwd);
    const offDep = Math.abs(d * Math.sin(fwd));
    if (ahead > end.lengthKm * 0.3 && ahead < 22 && offDep < 1.5 && heading < 25 && (vr > 200 || altFt < 1500) && altFt > 100) {
      if (offDep < bestOff) {
        bestOff = offDep;
        best = { end, mode: 'dep', distKm: ahead };
      }
    }
  }
  return best;
}

function phaseOf(altFt: number, vr: number, kind: Kind, aligned: Alignment | undefined): Phase {
  if (aligned?.mode === 'arr' && aligned.distKm < 20) return 'FINAL';
  if (aligned?.mode === 'dep' && altFt < 3000) return 'TAKEOFF';
  if (vr > 400) return 'CLIMB';
  if (vr < -400) return kind === 'ARR' && altFt < 10000 ? 'APPROACH' : 'DESCENT';
  if (altFt > 24000) return 'CRUISE';
  if (kind === 'ARR' && altFt < 8000) return 'APPROACH';
  return 'LEVEL';
}

/** Classifies a contact. Uses its route when known and plausible, otherwise geometry and vertical rate. */
export function classify(track: Track): Classification {
  const a = track.a;
  const type = lookupType(a.type ?? track.aircraft?.typeCode);
  const heli = a.cat === 'A7' || type?.cat === 'helicopter';
  const mil = Boolean(a.mil) || type?.cat === 'military';
  const emergency = a.em;
  let special: string | undefined;
  if (emergency) special = emergencyText(emergency);
  else if (mil) special = 'Military';
  else if (type?.special) special = type.name;

  if (a.gnd) return { kind: 'GND', phase: 'GROUND', mil, heli, emergency, special };

  const alt = a.alt ?? a.galt ?? 0;
  const vr = a.vr ?? 0;
  const pos = { lat: a.lat, lon: a.lon };
  let kind: Kind = 'UNK';
  let airport: string | undefined;

  const leg = track.leg;
  if (leg?.plausible) {
    const toLocal = (LOCAL_AERODROMES as readonly string[]).includes(leg.to.icao);
    const fromLocal = (LOCAL_AERODROMES as readonly string[]).includes(leg.from.icao);
    if (toLocal && haversineKm(pos, leg.to) < 400) {
      kind = 'ARR';
      airport = leg.to.icao;
    } else if (fromLocal && haversineKm(pos, leg.from) < 400) {
      kind = 'DEP';
      airport = leg.from.icao;
    } else {
      kind = 'OVF';
    }
  }

  const aligned = runwayAlignment(pos, a.trk, alt, vr);
  if (aligned && (kind === 'UNK' || kind === 'OVF' || airport === aligned.end.ap)) {
    kind = aligned.mode === 'arr' ? 'ARR' : 'DEP';
    airport = aligned.end.ap;
  }

  if (kind === 'UNK') {
    // No route: guess from where it's heading relative to the nearest local airport.
    let nearest: { icao: string; d: number; brg: number } | undefined;
    for (const icao of LOCAL_AERODROMES) {
      const apt = AIRPORTS[icao];
      if (!apt) continue;
      const d = haversineKm(pos, apt);
      if (!nearest || d < nearest.d) nearest = { icao, d, brg: bearingDeg(pos, apt) };
    }
    const towards = nearest && a.trk !== undefined ? Math.abs(signedDeg(a.trk - nearest.brg)) < 60 : false;
    if (nearest && nearest.d < 60 && alt < 12000) {
      if (vr < -300 && towards) {
        kind = 'ARR';
        airport = nearest.icao;
      } else if (vr > 300 && !towards) {
        kind = 'DEP';
        airport = nearest.icao;
      } else kind = alt < 3000 ? 'LOCAL' : 'UNK';
    } else if (alt > 20000) kind = 'OVF';
  }

  return {
    kind,
    airport,
    runway: aligned && aligned.end.ap === airport ? aligned.end.id : undefined,
    phase: phaseOf(alt, vr, kind, aligned),
    mil,
    heli,
    emergency,
    special,
  };
}

/**
 * Changi's runway direction, inferred from recent finals and climb-outs: "02" means landing
 * and taking off towards the north-northeast (arrivals come in over the sea from the SSW).
 */
export class FlowMonitor {
  private events: { t: number; ap: string; id: string; mode: 'arr' | 'dep' }[] = [];
  private seen = new Map<string, number>();

  note(track: Track, now: number): void {
    const { cls } = track;
    if (!cls.runway || !cls.airport) return;
    const key = `${track.hex}:${cls.runway}`;
    if ((this.seen.get(key) ?? 0) > now - 600_000) return;
    this.seen.set(key, now);
    this.events.push({ t: now, ap: cls.airport, id: cls.runway, mode: cls.kind === 'DEP' ? 'dep' : 'arr' });
  }

  /** Runway direction and runways in use at an airport during the last 20 minutes. */
  flow(ap: string, now: number): { dir?: string; arr: string[]; dep: string[] } {
    const cutoff = now - 20 * 60_000;
    this.events = this.events.filter((e) => e.t > cutoff);
    for (const [k, t] of this.seen) if (t < cutoff) this.seen.delete(k);
    const mine = this.events.filter((e) => e.ap === ap);
    if (!mine.length) return { arr: [], dep: [] };
    const votes = new Map<string, number>();
    for (const e of mine) {
      const dir = e.id.slice(0, 2);
      votes.set(dir, (votes.get(dir) ?? 0) + 1 + (now - e.t < 5 * 60_000 ? 1 : 0));
    }
    const dir = [...votes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const uniq = (mode: 'arr' | 'dep') =>
      [...new Set(mine.filter((e) => e.mode === mode && e.id.startsWith(dir ?? '')).map((e) => e.id))].sort();
    return { dir, arr: uniq('arr'), dep: uniq('dep') };
  }
}
