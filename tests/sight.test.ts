import { describe, expect, it } from 'vitest';
import { LocalFrame } from '../src/geo/geo.ts';
import { closestApproach, fists, lookGuide, moonCompare, sightAt, viewEntryS, type Observer } from '../src/track/sight.ts';
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
