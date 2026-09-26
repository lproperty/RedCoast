import { describe, expect, it } from 'vitest';
import { LocalFrame } from '../src/geo/geo.ts';
import {
  airFor,
  CLEAR_AIR,
  closestApproach,
  conditionsFor,
  fists,
  lookGuide,
  moonCompare,
  sightAt,
  viewEntryS,
  type Observer,
} from '../src/track/sight.ts';
import { Track } from '../src/track/track.ts';

const obs: Observer = { lat: 1.3, lon: 103.9, heightM: 40, facing: 180, fov: 150 };
const T0 = 1_790_400_000_000;

describe('sightAt', () => {
  it('sees an aircraft straight ahead', () => {
    const s = sightAt(obs, 0, -10, 3000);
    expect(s.az).toBeCloseTo(180, 6);
    expect(s.rel).toBeCloseTo(0, 6);
    expect(s.el).toBeCloseTo(4.95, 1);
    expect(s).toMatchObject({ inFov: true, visible: true });
    expect(s.soundDelayS).toBeCloseTo(29.3, 0);
  });

  it('knows what is behind you or too low', () => {
    expect(sightAt(obs, 0, 10, 3000).inFov).toBe(false); // due north, facing south
    const low = sightAt(obs, 0, -40, 200); // on the horizon far away
    expect(low.inFov).toBe(true);
    expect(low.visible).toBe(false);
  });

  it('puts east on your left when facing south', () => {
    expect(sightAt(obs, 10, -10, 3000).rel).toBeCloseTo(-45, 6);
  });
});

describe('seeing through haze and cloud', () => {
  const hazyDay = airFor(4, 30);
  const hazyNight = airFor(4, -30);

  it('loses low, distant aircraft in the haze, by day first', () => {
    // 3,000 ft, 10 km out: a long, shallow sight line through the haze.
    expect(sightAt(obs, 0, -10, 3000, CLEAR_AIR).visible).toBe(true);
    const lost = sightAt(obs, 0, -10, 3000, hazyDay);
    expect(lost).toMatchObject({ inFov: true, visible: false, obscured: 'haze' });
    // 3,000 ft, 3.5 km out: close enough.
    expect(sightAt(obs, 0, -3.5, 3000, hazyDay).visible).toBe(true);
    // At night its lights carry further.
    expect(sightAt(obs, 0, -5.5, 3000, hazyDay).visible).toBe(false);
    expect(sightAt(obs, 0, -5.5, 3000, hazyNight).visible).toBe(true);
  });

  it('still sees high aircraft above the haze layer', () => {
    // 35,000 ft, 12 km away: steep enough to look through only a little haze.
    const high = sightAt(obs, 0, -12, 35_000, hazyDay);
    expect(high.el).toBeGreaterThan(35);
    expect(high.visible).toBe(true);
  });

  it('hides aircraft above a broken or overcast deck', () => {
    const cloudy = airFor(10, 30, 2500);
    expect(sightAt(obs, 0, -8, 2000, cloudy).visible).toBe(true);
    expect(sightAt(obs, 0, -8, 5000, cloudy)).toMatchObject({ visible: false, obscured: 'cloud' });
    // High cirrus doesn't count.
    expect(airFor(10, 30, 28_000).ceilingFt).toBeUndefined();
  });

  it('only calls it haze when the aircraft would otherwise be in sight', () => {
    expect(sightAt(obs, 0, 10, 3000, hazyDay).obscured).toBeUndefined(); // behind you
  });

  it('predicts when an aircraft comes out of the haze', () => {
    // 12 km south at 3,000 ft, flying north towards the balcony.
    const t = new Track(1, { hex: 'a', lat: obs.lat - 12 / 110.57, lon: obs.lon, t: T0, alt: 3000, gs: 200, trk: 0, src: 'adsb', via: 'sim' }, new LocalFrame(obs), T0);
    expect(viewEntryS(t, obs, T0, CLEAR_AIR)).toBe(0);
    expect(viewEntryS(t, obs, T0, hazyDay)).toBeGreaterThan(60);
  });
});

describe('conditionsFor', () => {
  const now = T0;
  const report = (raw: string, ageMin = 10) => ({ id: 'WSSS', raw, t: now - ageMin * 60_000 });

  it("uses Changi's report, with the light", () => {
    const c = conditionsFor(report('METAR WSSS 261500Z 11004KT 4000 HZ FEW018 BKN080 29/26 Q1012 NOSIG'), 0, -20, now);
    expect(c).toMatchObject({ source: 'report', visKm: 4, what: 'haze', air: { rangeKm: 6, ceilingFt: 8000 } });
  });

  it('treats "10 km or more" as a clear-ish day, and ignores stale reports', () => {
    expect(conditionsFor(report('METAR WSSS 260600Z 16008KT 9999 FEW020 32/24 Q1010'), 0, 40, now).air.rangeKm).toBe(20);
    expect(conditionsFor(report('METAR WSSS 260600Z 16008KT 2000 HZ', 240), 0, 40, now)).toEqual({ air: CLEAR_AIR, source: 'none' });
    expect(conditionsFor(undefined, 0, 40, now)).toEqual({ air: CLEAR_AIR, source: 'none' });
  });

  it('lets a visibility set by hand override the report', () => {
    const c = conditionsFor(report('METAR WSSS 261500Z 11004KT 4000 HZ BKN015 29/26 Q1012'), 45, 40, now);
    expect(c).toEqual({ air: { rangeKm: 45 }, visKm: 45, source: 'setting' });
  });
});

describe('lookGuide', () => {
  it('speaks in fists', () => {
    expect(fists(10)).toBe('1 fist');
    expect(fists(25)).toBe('2½ fists');
    expect(fists(4)).toBe('½ fist');
    expect(lookGuide(sightAt(obs, 10, -10, 3000)).side).toBe('4½ fists left');
    expect(lookGuide({ ...sightAt(obs, 0, -10, 3000), rel: -25 }).side).toBe('2½ fists left');
    expect(lookGuide({ ...sightAt(obs, 0, -10, 3000), rel: 80 }).side).toBe('far right (80°)');
    expect(lookGuide({ ...sightAt(obs, 0, 10, 3000) }).side).toBe('behind you (N)');
    expect(lookGuide({ ...sightAt(obs, 0, -10, 3000), el: 1 }).up).toBe('on the horizon');
    expect(lookGuide({ ...sightAt(obs, 0, -10, 3000), el: 80 }).up).toBe('nearly overhead');
  });
});

describe('prediction', () => {
  const frame = new LocalFrame(obs);

  it('finds the closest point of approach', () => {
    // 5 km east, 20 km north, heading due south at 360 kt (0.1852 km/s).
    const ll = frame.toLatLon(5, 20);
    const t = new Track(1, { hex: 'a', lat: ll.lat, lon: ll.lon, t: T0, alt: 3000, gs: 360, trk: 180, src: 'adsb', via: 'sim' }, frame, T0);
    const cpa = closestApproach(t, T0)!;
    expect(cpa.distKm).toBeCloseTo(5, 3);
    expect(cpa.tS).toBeCloseTo(20 / 0.1852, 0);
  });

  it('predicts when a contact enters the view', () => {
    // North of us, flying south: it comes into view once it passes the observer's east-west line.
    const ll = frame.toLatLon(2, 10);
    const t = new Track(1, { hex: 'a', lat: ll.lat, lon: ll.lon, t: T0, alt: 3000, gs: 360, trk: 180, src: 'adsb', via: 'sim' }, frame, T0);
    const eta = viewEntryS(t, obs, T0)!;
    expect(eta).toBeGreaterThan(50);
    expect(eta).toBeLessThan(70);
  });
});

describe('moonCompare', () => {
  it('compares apparent size with the Moon', () => {
    // A 65 m wingspan at 7.2 km is about 0.52°: one full Moon.
    expect(moonCompare(65, 7.16)).toBe('about as wide as the full Moon');
    expect(moonCompare(65, 20)).toMatch(/% of the full Moon/);
    expect(moonCompare(undefined, 5)).toBeUndefined();
  });
});
