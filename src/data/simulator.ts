/**
 * Synthetic traffic for demo mode: Changi arrivals and departures in the "02" direction
 * (landing towards the NNE, so arrivals pass over the sea south of East Coast Park),
 * high overflights and a helicopter along the coast. Clearly labelled SIMULATION in the UI.
 */
import { bearingDeg, destination, haversineKm, lerpDeg, type LatLon } from '../geo/geo.ts';
import type { FeedAircraft, FeedResponse } from './feed.ts';

interface Waypoint extends LatLon {
  alt: number;
  gs: number;
}

interface FleetEntry {
  airline: string;
  type: string;
  other: string;
  cat: string;
}

interface Flow {
  name: string;
  path: Waypoint[];
  everyS: number;
  fleet: FleetEntry[];
  /** "arr": `other` is the origin; "dep": the destination; "ovf": [origin, destination] from `other`. */
  dir: 'arr' | 'dep' | 'ovf';
}

const T02C = { lat: 1.3288, lon: 103.98497 };
const T02L = { lat: 1.34895, lon: 103.97746 };
const CRS = 23;
const onFinal = (thr: LatLon, km: number) => destination(thr, CRS + 180, km);
const pastThr = (thr: LatLon, km: number) => destination(thr, CRS, km);
const wp = (p: LatLon, alt: number, gs: number): Waypoint => ({ ...p, alt, gs });

const f = (airline: string, type: string, other: string, cat = 'A5'): FleetEntry => ({ airline, type, other, cat });

const FLOWS: Flow[] = [
  {
    name: 'arrival-west',
    dir: 'arr',
    everyS: 150,
    path: [
      wp({ lat: 1.22, lon: 103.3 }, 12000, 300),
      wp({ lat: 1.17, lon: 103.62 }, 9000, 270),
      wp({ lat: 1.135, lon: 103.82 }, 6000, 240),
      wp({ lat: 1.12, lon: 103.885 }, 4000, 210),
      wp(onFinal(T02C, 22.2), 3000, 180),
      wp(onFinal(T02C, 9.26), 1600, 160),
      wp(T02C, 50, 145),
      wp(pastThr(T02C, 1.5), 0, 60),
    ],
    fleet: [
      f('SIA', 'B77W', 'EGLL'), f('SIA', 'A359', 'EDDF'), f('UAE', 'A388', 'OMDB'), f('QTR', 'A35K', 'OTHH'),
      f('BAW', 'B77W', 'EGLL'), f('AIC', 'B788', 'VIDP'), f('SIA', 'A388', 'EGLL'), f('TGW', 'A21N', 'VCBI', 'A3'),
    ],
  },
  {
    name: 'arrival-east',
    dir: 'arr',
    everyS: 200,
    path: [
      wp({ lat: 1.75, lon: 104.55 }, 13000, 310),
      wp({ lat: 1.45, lon: 104.35 }, 9000, 280),
      wp({ lat: 1.2, lon: 104.2 }, 6000, 240),
      wp({ lat: 1.1, lon: 104.05 }, 4000, 210),
      wp(onFinal(T02L, 18.5), 3000, 180),
      wp(onFinal(T02L, 9.26), 1600, 160),
      wp(T02L, 50, 145),
      wp(pastThr(T02L, 1.5), 0, 60),
    ],
    fleet: [
      f('CPA', 'A359', 'VHHH'), f('JAL', 'B789', 'RJTT'), f('SIA', 'B78X', 'RJAA'), f('ANA', 'B788', 'RJTT'),
      f('KAL', 'B77W', 'RKSI'), f('TGW', 'B789', 'RCTP'), f('SIA', 'A359', 'ZSPD'), f('CES', 'A333', 'ZSPD'),
    ],
  },
  {
    name: 'departure-south',
    dir: 'dep',
    everyS: 180,
    path: [
      wp(T02C, 0, 150),
      wp(pastThr(T02C, 3), 800, 170),
      wp(pastThr(T02C, 9), 3000, 210),
      wp({ lat: 1.43, lon: 104.13 }, 6000, 250),
      wp({ lat: 1.3, lon: 104.22 }, 9000, 280),
      wp({ lat: 1.0, lon: 104.25 }, 15000, 320),
      wp({ lat: 0.7, lon: 104.3 }, 21000, 350),
    ],
    fleet: [
      f('QFA', 'A333', 'YSSY'), f('SIA', 'A359', 'YMML'), f('SIA', 'B78X', 'YPPH'), f('TGW', 'A21N', 'WADD', 'A3'),
      f('GIA', 'B738', 'WIII', 'A3'), f('SIA', 'B38M', 'WADD', 'A3'), f('ANZ', 'B789', 'NZAA'),
    ],
  },
  // Real overflights of Singapore: Kuala Lumpur and Bangkok to and from Jakarta.
  {
    name: 'overflight-se',
    dir: 'ovf',
    everyS: 320,
    path: [wp({ lat: 1.95, lon: 103.45 }, 37000, 470), wp({ lat: 0.75, lon: 104.55 }, 37000, 470)],
    fleet: [
      f('MAS', 'A333', 'WMKK-WIII'), f('AXM', 'A320', 'WMKK-WIII', 'A3'), f('GIA', 'B738', 'WMKK-WIII', 'A3'),
      f('THA', 'A359', 'VTBS-WIII'),
    ],
  },
  {
    name: 'overflight-nw',
    dir: 'ovf',
    everyS: 380,
    path: [wp({ lat: 0.75, lon: 104.45 }, 36000, 460), wp({ lat: 1.95, lon: 103.35 }, 36000, 460)],
    fleet: [f('GIA', 'B738', 'WIII-WMKK', 'A3'), f('AXM', 'A20N', 'WIII-WMKK', 'A3'), f('THA', 'A359', 'WIII-VTBS')],
  },
  {
    name: 'coast-helicopter',
    dir: 'ovf',
    everyS: 900,
    path: [
      wp({ lat: 1.285, lon: 103.865 }, 1000, 90),
      wp({ lat: 1.296, lon: 103.905 }, 1000, 90),
      wp({ lat: 1.305, lon: 103.94 }, 1000, 90),
      wp({ lat: 1.315, lon: 103.985 }, 1000, 90),
      wp({ lat: 1.335, lon: 104.0 }, 800, 80),
    ],
    fleet: [f('HEL', 'EC35', 'WSSL-WSSL', 'A7')],
  },
];

/** Deterministic PRNG so a given seed always produces the same traffic. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Leg {
  from: Waypoint;
  to: Waypoint;
  startS: number;
  durS: number;
  brg: number;
}

function legsOf(path: Waypoint[]): { legs: Leg[]; totalS: number } {
  const legs: Leg[] = [];
  let t = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const km = haversineKm(from, to);
    const kmh = ((from.gs + to.gs) / 2) * 1.852;
    const durS = (km / kmh) * 3600;
    legs.push({ from, to, startS: t, durS, brg: bearingDeg(from, to) });
    t += durS;
  }
  return { legs, totalS: t };
}

interface SimFlight {
  hex: string;
  cs: string;
  type: string;
  cat: string;
  from: string;
  to: string;
  legs: Leg[];
  startMs: number;
  endMs: number;
}

export class Simulator {
  private readonly flows = FLOWS.map((fl) => ({ ...fl, ...legsOf(fl.path) }));
  private flights: SimFlight[] = [];
  private readonly nextSpawn = new Map<string, number>();
  private readonly rand: () => number;
  private serial = 0;

  constructor(seed = 7, now = Date.now()) {
    this.rand = mulberry32(seed);
    // Pre-populate so the picture isn't empty at start.
    for (const fl of this.flows) {
      let t = now - fl.totalS * 1000;
      while (t < now) {
        this.spawn(fl, t);
        t += fl.everyS * 1000 * (0.7 + this.rand() * 0.6);
      }
      this.nextSpawn.set(fl.name, t);
    }
  }

  private spawn(fl: (typeof this.flows)[number], startMs: number): void {
    const e = fl.fleet[Math.floor(this.rand() * fl.fleet.length)]!;
    const num = e.airline === 'HEL' ? '01' : String(100 + Math.floor(this.rand() * 890));
    const [a, b] = e.other.split('-');
    const from = fl.dir === 'arr' ? e.other : fl.dir === 'dep' ? 'WSSS' : a!;
    const to = fl.dir === 'arr' ? 'WSSS' : fl.dir === 'dep' ? e.other : b!;
    this.serial++;
    this.flights.push({
      hex: `~sim${this.serial.toString(16).padStart(3, '0')}`,
      cs: `${e.airline}${num}`,
      type: e.type,
      cat: e.cat,
      from,
      to,
      legs: fl.legs,
      startMs,
      endMs: startMs + fl.totalS * 1000,
    });
  }

  snapshot(now: number): FeedResponse {
    for (const fl of this.flows) {
      let next = this.nextSpawn.get(fl.name) ?? now;
      while (next <= now) {
        this.spawn(fl, next);
        next += fl.everyS * 1000 * (0.7 + this.rand() * 0.6);
      }
      this.nextSpawn.set(fl.name, next);
    }
    this.flights = this.flights.filter((fl) => fl.endMs > now);
    const ac: FeedAircraft[] = [];
    for (const fl of this.flights) {
      if (fl.startMs > now) continue;
      const s = (now - fl.startMs) / 1000;
      const i = fl.legs.findIndex((l) => s < l.startS + l.durS);
      const leg = fl.legs[i === -1 ? fl.legs.length - 1 : i]!;
      const k = Math.min(1, (s - leg.startS) / leg.durS);
      const lat = leg.from.lat + (leg.to.lat - leg.from.lat) * k;
      const lon = leg.from.lon + (leg.to.lon - leg.from.lon) * k;
      const alt = leg.from.alt + (leg.to.alt - leg.from.alt) * k;
      const gs = leg.from.gs + (leg.to.gs - leg.from.gs) * k;
      // Blend headings near waypoints so turns look like turns.
      const prev = fl.legs[i - 1];
      const next = fl.legs[i + 1];
      let trk = leg.brg;
      if (k > 0.85 && next) trk = lerpDeg(leg.brg, next.brg, ((k - 0.85) / 0.15) * 0.5);
      else if (k < 0.15 && prev) trk = lerpDeg(prev.brg, leg.brg, 0.5 + (k / 0.15) * 0.5);
      const vr = Math.round(((leg.to.alt - leg.from.alt) / leg.durS) * 60);
      const onGround = alt < 30 && !next;
      ac.push({
        hex: fl.hex,
        cs: fl.cs,
        type: fl.type,
        cat: fl.cat,
        lat,
        lon,
        t: now - 400,
        ...(onGround ? { gnd: true } : { alt: Math.round(alt / 25) * 25, vr }),
        gs: Math.round(gs),
        trk: Math.round(trk * 10) / 10,
        wd: 200,
        ws: 12,
        oat: Math.round(30 - alt * 0.00198),
        src: 'adsb',
        via: 'sim',
        sim: { from: fl.from, to: fl.to },
      });
    }
    return { v: 1, now, sources: [{ id: 'sim', ok: true, count: ac.length }], ac };
  }
}
