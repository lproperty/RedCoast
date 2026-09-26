import { describe, expect, it } from 'vitest';
import type { FeedAircraft, FeedResponse } from '../src/data/feed.ts';
import { destination, LocalFrame } from '../src/geo/geo.ts';
import { TrackStore } from '../src/track/store.ts';
import { LOST_MS, MAX_EXTRAPOLATE_MS, Track } from '../src/track/track.ts';

const ORIGIN = { lat: 1.3, lon: 103.9 };
const frame = new LocalFrame(ORIGIN);
const T0 = 1_790_400_000_000;

const ac = (over: Partial<FeedAircraft> = {}): FeedAircraft => ({
  hex: 'abc123',
  cs: 'SIA1',
  lat: ORIGIN.lat,
  lon: ORIGIN.lon,
  t: T0,
  alt: 5000,
  gs: 360, // 0.1852 km/s
  trk: 90,
  src: 'adsb',
  via: 'adsblol',
  ...over,
});

describe('Track dead reckoning', () => {
  it('moves along a straight track', () => {
    const t = new Track(1, ac(), frame, T0);
    const p = t.predict(T0 + 10_000);
    expect(p.x).toBeCloseTo(1.852, 3);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('follows a turn', () => {
    const t = new Track(1, ac({ trate: 3 }), frame, T0);
    const p = t.predict(T0 + 10_000);
    expect(p.trk).toBeCloseTo(120, 6);
    // Arc length stays 1.852 km, so the straight-line distance is a bit shorter.
    const chord = Math.hypot(p.x, p.y);
    expect(chord).toBeLessThan(1.852);
    expect(chord).toBeGreaterThan(1.8);
    expect(p.y).toBeLessThan(0); // turning right from east goes south
  });

  it('stops extrapolating after MAX_EXTRAPOLATE_MS', () => {
    const t = new Track(1, ac(), frame, T0);
    expect(t.predict(T0 + 120_000).x).toBeCloseTo(t.predict(T0 + MAX_EXTRAPOLATE_MS).x, 9);
    expect(t.predict(T0 + MAX_EXTRAPOLATE_MS).x).toBeGreaterThan(t.predict(T0 + 10_000).x);
  });

  it('extrapolates altitude with the vertical rate', () => {
    const t = new Track(1, ac({ vr: -1200 }), frame, T0);
    expect(t.altitude(T0 + 10_000)).toBeCloseTo(4800, 6);
  });

  it('levels off at the autopilot altitude when predicting ahead', () => {
    const t = new Track(1, ac({ vr: 2000, navAlt: 6000 }), frame, T0);
    expect(t.futureAltitude(T0, 120)).toBeCloseTo(6000, 6);
  });
});

describe('Track updates', () => {
  it('blends a new fix in without jumping', () => {
    const t = new Track(1, ac(), frame, T0);
    const before = t.display(T0 + 5000);
    // The real position turns out to be 300 m further north.
    const fix = destination(ORIGIN, 90, 0.926);
    t.update(ac({ t: T0 + 5000, lat: fix.lat + 0.0027, lon: fix.lon }), frame, T0 + 5000);
    const at = t.display(T0 + 5000);
    expect(Math.hypot(at.x - before.x, at.y - before.y)).toBeLessThan(1e-6);
    const settled = t.display(T0 + 9000);
    const truth = t.predict(T0 + 9000);
    expect(Math.hypot(settled.x - truth.x, settled.y - truth.y)).toBeLessThan(0.01);
  });

  it('ignores older positions but keeps their metadata', () => {
    const t = new Track(1, ac({ t: T0 }), frame, T0);
    const moved = t.update(ac({ t: T0 - 5000, lat: 1.5, reg: '9V-XYZ' }), frame, T0 + 100);
    expect(moved).toBe(false);
    expect(t.a.lat).toBe(ORIGIN.lat);
    expect(t.a.reg).toBe('9V-XYZ');
  });

  it('clears the on-ground flag when a newer report is airborne', () => {
    const t = new Track(1, ac({ gnd: true, alt: undefined }), frame, T0);
    t.update(ac({ t: T0 + 3000, alt: 400 }), frame, T0 + 3000);
    expect(t.a.gnd).toBeUndefined();
    expect(t.a.alt).toBe(400);
  });

  it('holds back an impossible jump until a second report confirms it', () => {
    const t = new Track(1, ac(), frame, T0);
    // 3 s later, 40 km away: no airliner does that.
    const far = destination(ORIGIN, 0, 40);
    expect(t.update(ac({ t: T0 + 3000, lat: far.lat, lon: far.lon }), frame, T0 + 3000)).toBe(false);
    expect(t.a.lat).toBe(ORIGIN.lat);
    // A normal report next: the glitch is forgotten.
    const ok = destination(ORIGIN, 90, 1.1);
    expect(t.update(ac({ t: T0 + 6000, lat: ok.lat, lon: ok.lon }), frame, T0 + 6000)).toBe(true);
    // Two consistent reports over there: accepted (e.g. the first fix was the bad one).
    const far2 = destination(far, 90, 0.5);
    t.update(ac({ t: T0 + 9000, lat: far.lat, lon: far.lon }), frame, T0 + 9000);
    expect(t.update(ac({ t: T0 + 12_000, lat: far2.lat, lon: far2.lon }), frame, T0 + 12_000)).toBe(true);
    expect(t.a.lat).toBeCloseTo(far2.lat, 9);
  });

  it('keeps ten minutes of history', () => {
    const t = new Track(1, ac(), frame, T0);
    for (let i = 1; i <= 200; i++) t.update(ac({ t: T0 + i * 5000, lon: ORIGIN.lon + i * 0.01 }), frame, T0 + i * 5000);
    expect(t.history.length).toBeLessThanOrEqual(121);
    expect(t.history[0]!.t).toBeGreaterThanOrEqual(T0 + 200 * 5000 - 600_000);
  });
});

describe('TrackStore', () => {
  const resp = (now: number, list: FeedAircraft[]): FeedResponse => ({ v: 1, now, sources: [], ac: list });

  it('converts relay time to this device and numbers new tracks', () => {
    const store = new TrackStore(frame);
    // The relay clock is 2 s behind this device; latency 200 ms.
    const { added } = store.ingest(resp(T0 - 2000, [ac({ t: T0 - 3000 })]), T0, 200);
    expect(added).toHaveLength(1);
    expect(added[0]!.tn).toBe(1);
    expect(added[0]!.a.t).toBeCloseTo(T0 - 3000 + 1900, 6);
  });

  it('drops contacts that go silent', () => {
    const store = new TrackStore(frame);
    store.ingest(resp(T0, [ac()]), T0, 0);
    expect(store.prune(T0 + LOST_MS - 1)).toHaveLength(0);
    expect(store.prune(T0 + LOST_MS + 1)).toHaveLength(1);
    expect(store.tracks.size).toBe(0);
  });

  it('re-expresses tracks when the observer moves', () => {
    const store = new TrackStore(frame);
    store.ingest(resp(T0, [ac({ lat: 1.35, lon: 103.95 })]), T0, 0);
    const moved = new LocalFrame({ lat: 1.35, lon: 103.95 });
    store.setFrame(moved);
    const t = store.list()[0]!;
    expect(t.fx).toBeCloseTo(0, 6);
    expect(t.fy).toBeCloseTo(0, 6);
  });
});
