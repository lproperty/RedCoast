import { describe, expect, it } from 'vitest';
import {
  alongTrackKm,
  bearingDeg,
  compassPoint,
  crossTrackKm,
  destination,
  elevationDeg,
  haversineKm,
  LocalFrame,
  normDeg,
  signedDeg,
} from '../src/geo/geo.ts';
import { parseCoords } from '../src/geo/parse.ts';
import { moonPosition, sunPosition } from '../src/geo/astro.ts';

const CHANGI = { lat: 1.3644, lon: 103.9915 };
const MBS = { lat: 1.2837, lon: 103.8607 };

describe('angles', () => {
  it('normalises', () => {
    expect(normDeg(-10)).toBe(350);
    expect(normDeg(725)).toBe(5);
    expect(signedDeg(350)).toBe(-10);
    expect(signedDeg(180)).toBe(180);
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(22.5)).toBe('NNE');
    expect(compassPoint(359)).toBe('N');
  });
});

describe('great circle', () => {
  it('measures Changi to Marina Bay Sands', () => {
    expect(haversineKm(CHANGI, MBS)).toBeCloseTo(17.07, 1);
  });

  it('gives cardinal bearings', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 1, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 6);
  });

  it('round-trips destination and bearing', () => {
    const p = destination(CHANGI, 203, 22.2);
    expect(haversineKm(CHANGI, p)).toBeCloseTo(22.2, 6);
    expect(bearingDeg(CHANGI, p)).toBeCloseTo(203, 4);
  });

  it('computes cross- and along-track distance', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 10 };
    const p = { lat: 1, lon: 5 };
    expect(crossTrackKm(p, a, b)).toBeCloseTo(-111.2, 0); // north of an eastbound track: left
    expect(alongTrackKm(p, a, b)).toBeCloseTo(556, -1);
  });
});

describe('LocalFrame', () => {
  const frame = new LocalFrame({ lat: 1.3, lon: 103.9 });

  it('round-trips', () => {
    const [x, y] = frame.toXY(CHANGI.lat, CHANGI.lon);
    const back = frame.toLatLon(x, y);
    expect(back.lat).toBeCloseTo(CHANGI.lat, 9);
    expect(back.lon).toBeCloseTo(CHANGI.lon, 9);
  });

  it('uses WGS-84 scale at Singapore latitude', () => {
    // 0.1° of latitude and of longitude at 1.3°N on the ellipsoid.
    expect(frame.toXY(1.4, 103.9)[1]).toBeCloseTo(11.0574, 3);
    expect(frame.toXY(1.3, 104.0)[0]).toBeCloseTo(11.1289, 3);
  });

  it('stays within 0.5% of the spherical great-circle helpers over 50 km', () => {
    const far = destination(frame.origin, 57, 50);
    const [x, y] = frame.toXY(far.lat, far.lon);
    expect(Math.abs(Math.hypot(x, y) - 50)).toBeLessThan(0.25);
    expect(normDeg((Math.atan2(x, y) * 180) / Math.PI)).toBeCloseTo(57, 0);
  });
});

describe('elevation', () => {
  it('includes curvature and refraction', () => {
    // 1000 m up at 10 km: atan(1000/10000) = 5.71°, minus ~7 m of Earth curvature.
    expect(elevationDeg(10, 1000)).toBeCloseTo(5.67, 2);
    // Something at eye level 30 km away has sunk below the horizon.
    expect(elevationDeg(30, 0)).toBeLessThan(0);
  });
});

describe('parseCoords', () => {
  it.each([
    ['1.3018, 103.9128', 1.3018, 103.9128],
    ['1.3018 103.9128', 1.3018, 103.9128],
    ['103.9128, 1.3018', 1.3018, 103.9128],
    ['https://www.google.com/maps/@1.3018,103.9128,17z', 1.3018, 103.9128],
    ['https://maps.google.com/?q=1.3018,103.9128', 1.3018, 103.9128],
    ['https://www.google.com/maps/place/X/data=!3d1.3018!4d103.9128', 1.3018, 103.9128],
    [`1°18'06.5"N 103°54'46.1"E`, 1.30181, 103.91281],
  ])('reads %s', (text, lat, lon) => {
    const p = parseCoords(text);
    expect(p?.lat).toBeCloseTo(lat, 4);
    expect(p?.lon).toBeCloseTo(lon, 4);
  });

  it('rejects nonsense', () => {
    expect(parseCoords('')).toBeUndefined();
    expect(parseCoords('east coast')).toBeUndefined();
    expect(parseCoords('200, 300')).toBeUndefined();
  });
});

describe('astronomy', () => {
  it('puts the equinox Sun nearly overhead at Singapore noon and far below at midnight', () => {
    // Solar noon in Singapore is about 13:05 SGT (05:05 UTC).
    const noon = Date.UTC(2026, 2, 20, 5, 5);
    expect(sunPosition(noon, 1.3, 103.9).el).toBeGreaterThan(85);
    expect(sunPosition(noon + 12 * 3600_000, 1.3, 103.9).el).toBeLessThan(-80);
  });

  it('rises in the east and sets in the west', () => {
    const morning = sunPosition(Date.UTC(2026, 5, 1, 0, 0), 1.3, 103.9); // 08:00 SGT
    const evening = sunPosition(Date.UTC(2026, 5, 1, 11, 0), 1.3, 103.9); // 19:00 SGT
    expect(morning.az).toBeGreaterThan(45);
    expect(morning.az).toBeLessThan(90);
    expect(evening.az).toBeGreaterThan(270);
    expect(evening.az).toBeLessThan(315);
  });

  it('knows the Moon phase', () => {
    // Full moon (with a total lunar eclipse) on 3 March 2026, ~11:38 UTC.
    const full = Date.UTC(2026, 2, 3, 11, 38);
    expect(moonPosition(full, 1.3, 103.9).fraction).toBeGreaterThan(0.97);
    expect(moonPosition(full + 14.8 * 86_400_000, 1.3, 103.9).fraction).toBeLessThan(0.05);
  });
});
