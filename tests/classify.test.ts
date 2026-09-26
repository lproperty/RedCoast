import { describe, expect, it } from 'vitest';
import type { FeedAircraft } from '../src/data/feed.ts';
import { legProgress, simRoute } from '../src/enrich/lookup.ts';
import { destination, LocalFrame } from '../src/geo/geo.ts';
import { CHANGI_ENDS } from '../src/map/map.ts';
import { classify, FlowMonitor, runwayAlignment } from '../src/track/classify.ts';
import { Track } from '../src/track/track.ts';

const frame = new LocalFrame({ lat: 1.3, lon: 103.9 });
const T0 = 1_790_400_000_000;
const end = (id: string) => CHANGI_ENDS.find((e) => e.id === id)!;

const track = (over: Partial<FeedAircraft>) =>
  new Track(1, { hex: 'abc123', lat: 1.3, lon: 103.9, t: T0, src: 'adsb', via: 'adsblol', ...over }, frame, T0);

describe('Changi runways', () => {
  it('has all six runway ends', () => {
    expect(CHANGI_ENDS.map((e) => e.id).sort()).toEqual(['02C', '02L', '02R', '20C', '20L', '20R']);
    const e02c = end('02C');
    expect(e02c.course).toBeGreaterThan(15);
    expect(e02c.course).toBeLessThan(30);
    expect(e02c.lengthKm).toBeGreaterThan(3.8);
  });
});

describe('runwayAlignment', () => {
  it('spots an aircraft on final for 02C', () => {
    const e = end('02C');
    const p = destination(e.thr, e.course + 180, 8);
    const a = runwayAlignment(p, e.course, 2500, -700);
    expect(a?.mode).toBe('arr');
    expect(a?.end.id).toBe('02C');
    expect(a?.distKm).toBeCloseTo(8, 0);
  });

  it('spots a climb-out from 20C', () => {
    const e = end('20C');
    const p = destination(e.thr, e.course, 7);
    const a = runwayAlignment(p, e.course, 2200, 2000);
    expect(a?.mode).toBe('dep');
    expect(a?.end.id).toBe('20C');
  });

  it('ignores aircraft crossing the centreline or too high', () => {
    const e = end('02C');
    const p = destination(e.thr, e.course + 180, 8);
    expect(runwayAlignment(p, e.course + 90, 2500, -700)).toBeUndefined();
    expect(runwayAlignment(p, e.course, 9000, -700)).toBeUndefined();
  });
});

describe('classify', () => {
  it('uses the route: arrival into Changi', () => {
    const t = track({ cs: 'SIA321', lat: 1.1, lon: 103.5, alt: 9000, vr: -1500, gs: 280, trk: 60 });
    t.route = simRoute('SIA321', 'EGLL', 'WSSS');
    t.leg = legProgress(t.route!, t.a);
    const c = classify(t);
    expect(c.kind).toBe('ARR');
    expect(c.airport).toBe('WSSS');
    expect(c.phase).toBe('APPROACH');
  });

  it('uses the route: departure and overflight', () => {
    const dep = track({ cs: 'SIA231', lat: 1.2, lon: 104.1, alt: 15000, vr: 2500, gs: 330, trk: 150 });
    dep.route = simRoute('SIA231', 'WSSS', 'YSSY');
    dep.leg = legProgress(dep.route!, dep.a);
    expect(classify(dep).kind).toBe('DEP');

    const ovf = track({ cs: 'THA1', lat: 1.0, lon: 103.5, alt: 37000, vr: 0, gs: 480, trk: 140 });
    ovf.route = simRoute('THA1', 'VTBS', 'WADD');
    ovf.leg = legProgress(ovf.route!, ovf.a);
    expect(classify(ovf).kind).toBe('OVF');
    expect(classify(ovf).phase).toBe('CRUISE');
  });

  it('falls back to geometry without a route', () => {
    const e = end('02L');
    const p = destination(e.thr, e.course + 180, 12);
    const t = track({ lat: p.lat, lon: p.lon, alt: 3200, vr: -800, gs: 170, trk: e.course });
    const c = classify(t);
    expect(c).toMatchObject({ kind: 'ARR', airport: 'WSSS', runway: '02L', phase: 'FINAL' });
  });

  it('flags special, military and emergency contacts', () => {
    expect(classify(track({ type: 'A388', alt: 30000 })).special).toBe('A380-800');
    expect(classify(track({ mil: true, alt: 3000 }))).toMatchObject({ mil: true, special: 'Military' });
    expect(classify(track({ em: 'general', sq: '7700', alt: 3000 }))).toMatchObject({ emergency: 'general', special: 'EMERGENCY' });
    expect(classify(track({ cat: 'A7', alt: 800 })).heli).toBe(true);
    expect(classify(track({ gnd: true })).kind).toBe('GND');
  });
});

describe('legProgress', () => {
  it('measures progress and rejects impossible routes', () => {
    const route = simRoute('SIA321', 'EGLL', 'WSSS')!;
    const near = legProgress(route, { lat: 1.4, lon: 103.5 })!;
    expect(near.plausible).toBe(true);
    expect(near.fraction).toBeGreaterThan(0.95);
    // Over Australia, nowhere near London–Singapore.
    expect(legProgress(route, { lat: -25, lon: 135 })!.plausible).toBe(false);
  });
});

describe('FlowMonitor', () => {
  it('works out the runway direction from recent finals', () => {
    const flow = new FlowMonitor();
    const e = end('02C');
    for (let i = 0; i < 3; i++) {
      const p = destination(e.thr, e.course + 180, 6);
      const t = new Track(i, { hex: `a${i}`, lat: p.lat, lon: p.lon, t: T0, alt: 1800, vr: -700, gs: 160, trk: e.course, src: 'adsb', via: 'adsblol' }, frame, T0);
      t.cls = classify(t);
      flow.note(t, T0 + i * 1000);
    }
    expect(flow.flow('WSSS', T0 + 5000)).toMatchObject({ dir: '02', arr: ['02C'] });
    expect(flow.flow('WSSS', T0 + 30 * 60_000).dir).toBeUndefined();
  });
});
