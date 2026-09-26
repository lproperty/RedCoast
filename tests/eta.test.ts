import { describe, expect, it } from 'vitest';
import type { FeedAircraft } from '../src/data/feed.ts';
import { legProgress, type Airport, type Route } from '../src/enrich/lookup.ts';
import { destination, LocalFrame } from '../src/geo/geo.ts';
import { legTimes } from '../src/track/eta.ts';
import { Track } from '../src/track/track.ts';

const T0 = 1_790_400_000_000;
const MIN = 60_000;
const frame = new LocalFrame({ lat: 1.3, lon: 103.9 });
const SIN: Airport = { icao: 'WSSS', iata: 'SIN', name: 'Changi', lat: 1.3644, lon: 103.9915 };
const LHR: Airport = { icao: 'EGLL', iata: 'LHR', name: 'Heathrow', lat: 51.47, lon: -0.4543 };
const KUL: Airport = { icao: 'WMKK', iata: 'KUL', name: 'Kuala Lumpur', lat: 2.7456, lon: 101.7099 };
const route = (from: Airport, to: Airport) => ({ callsign: 'TEST1', legs: [from, to], source: 'sim' }) as Route;

function flying(at: { lat: number; lon: number }, over: Partial<FeedAircraft>): Track {
  return new Track(1, { hex: 'abc123', t: T0, src: 'adsb', via: 'sim', ...at, ...over }, frame, T0);
}

describe('legTimes', () => {
  it('lands a couple of minutes after a plane on final is 10 km out', () => {
    const pos = destination(SIN, 203, 10);
    const t = flying(pos, { alt: 3000, gs: 150, trk: 23 });
    const { arrives } = legTimes(t, legProgress(route(KUL, SIN), pos)!, T0);
    expect((arrives! - T0) / MIN).toBeGreaterThan(2);
    expect((arrives! - T0) / MIN).toBeLessThan(3);
  });

  it('allows for the slower, longer approach when 150 km out', () => {
    const pos = destination(SIN, 300, 150);
    const t = flying(pos, { alt: 20_000, gs: 280, trk: 120 });
    const { arrives } = legTimes(t, legProgress(route(KUL, SIN), pos)!, T0);
    expect((arrives! - T0) / MIN).toBeGreaterThan(15);
    expect((arrives! - T0) / MIN).toBeLessThan(25);
  });

  it('estimates when a London flight left and when it lands', () => {
    const pos = destination(SIN, 300, 300);
    const t = flying(pos, { alt: 36_000, gs: 460, trk: 120 });
    const { departed, arrives } = legTimes(t, legProgress(route(LHR, SIN), pos)!, T0);
    expect(departed!.seen).toBe(false);
    expect((T0 - departed!.at) / 3_600_000).toBeGreaterThan(11.5);
    expect((T0 - departed!.at) / 3_600_000).toBeLessThan(13.5);
    expect((arrives! - T0) / MIN).toBeGreaterThan(20);
    expect((arrives! - T0) / MIN).toBeLessThan(35);
  });

  it('uses the take-off it saw', () => {
    const rwy = destination(SIN, 23, 1);
    const t = flying(rwy, { gnd: true, gs: 10, trk: 23 });
    const up = destination(SIN, 23, 3);
    t.update({ hex: 'abc123', ...up, t: T0 + 50_000, alt: 800, gs: 170, trk: 23, src: 'adsb', via: 'sim' }, frame, T0 + 50_000);
    expect(t.liftoff).toBe(T0 + 50_000);
    const { departed } = legTimes(t, legProgress(route(SIN, KUL), up)!, T0 + 60_000);
    expect(departed).toEqual({ at: T0 + 50_000, seen: true });
  });

  it('dates a climb-out it first saw low near the airport', () => {
    const pos = destination(SIN, 23, 6);
    const t = flying(pos, { alt: 1500, gs: 180, trk: 23, vr: 2000 });
    const { departed } = legTimes(t, legProgress(route(SIN, KUL), pos)!, T0 + MIN);
    expect(departed).toEqual({ at: T0 - 45_000, seen: true });
  });

  it('says nothing on the ground or for a route that does not fit', () => {
    const pos = destination(SIN, 23, 1);
    expect(legTimes(flying(pos, { gnd: true }), legProgress(route(KUL, SIN), pos)!, T0)).toEqual({});
    const lost = destination(SIN, 90, 2000);
    const leg = legProgress(route(KUL, SIN), lost)!;
    expect(leg.plausible).toBe(false);
    expect(legTimes(flying(lost, { alt: 30_000, gs: 450, trk: 90 }), leg, T0)).toEqual({});
  });
});
