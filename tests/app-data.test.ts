import { describe, expect, it } from 'vitest';
import { DEFAULT_POST, parseHash, sanitize } from '../src/app/settings.ts';
import { Simulator } from '../src/data/simulator.ts';
import { lookupType, prettyDesc } from '../src/data/static/aircraftTypes.ts';
import { iataFlight, splitCallsign } from '../src/data/static/airlines.ts';
import { isFlightCallsign, legProgress, simRoute } from '../src/enrich/lookup.ts';
import { blockAlt, displayName, flag, fmtAlt, fmtDuration, trendArrow } from '../src/ui/format.ts';

describe('settings', () => {
  it('sanitises junk into safe defaults', () => {
    const s = sanitize({ rangeKm: 7, observer: { lat: 'x', facing: 540, fov: 5 }, theme: 'neon', pollS: 0.1 });
    expect(s.rangeKm).toBe(25);
    expect(s.observer.lat).toBe(DEFAULT_POST.lat);
    expect(s.observer.facing).toBe(180);
    expect(s.observer.fov).toBe(20);
    expect(s.theme).toBe('phosphor');
    expect(s.pollS).toBe(2);
  });

  it('reads a setup link', () => {
    const p = parseHash('#lat=1.25&lon=103.95&facing=160&fov=120&h=45');
    expect(p?.observer).toMatchObject({ lat: 1.25, lon: 103.95, facing: 160, fov: 120, heightM: 45 });
    expect(p?.configured).toBe(true);
    expect(parseHash('#post=1.2,103.8')?.observer).toMatchObject({ lat: 1.2, lon: 103.8 });
    expect(parseHash('#src=sim')).toEqual({ source: 'sim' });
    expect(parseHash('')).toBeUndefined();
  });
});

describe('reference data', () => {
  it('knows common Changi types', () => {
    for (const code of ['A359', 'A388', 'B77W', 'B78X', 'B38M', 'A20N', 'A21N', 'E290', 'AT76']) {
      expect(lookupType(code), code).toBeDefined();
    }
    expect(lookupType('b77f')?.name).toBe('777-200LR / 777F');
    expect(lookupType('ZZZZ')).toBeUndefined();
    expect(prettyDesc('BOEING 777-300ER')).toBe('Boeing 777-300ER');
  });

  it('turns callsigns into flight numbers', () => {
    expect(splitCallsign('SIA321')).toEqual({ icao: 'SIA', number: '321' });
    expect(splitCallsign('9VYFH')).toBeUndefined();
    expect(iataFlight('SIA0321')).toBe('SQ321');
    expect(iataFlight('TGW7')).toBe('TR7');
    expect(isFlightCallsign('N889ST')).toBe(false);
    expect(isFlightCallsign('QTR948')).toBe(true);
  });
});

describe('formatting', () => {
  it('formats like a controller', () => {
    expect(blockAlt(4500)).toBe('045');
    expect(blockAlt(37000)).toBe('370');
    expect(trendArrow(-1200)).toBe('↓');
    expect(trendArrow(100)).toBe(' ');
    expect(fmtAlt(37000, 'aviation')).toBe('FL370');
    expect(fmtAlt(4500, 'aviation')).toBe('4,500 ft');
    expect(fmtAlt(4500, 'metric')).toBe('1,372 m');
    expect(fmtDuration(80)).toBe('1m 20s');
    expect(fmtDuration(3900)).toBe('1h 05m');
    expect(flag('sg')).toBe('🇸🇬');
    expect(flag(undefined)).toBe('');
  });

  it('prefers the IATA flight number people know', () => {
    const t = { a: { cs: 'SIA321' }, route: undefined, hex: 'abc' } as unknown as Parameters<typeof displayName>[0];
    expect(displayName(t)).toBe('SQ321');
  });
});

describe('Simulator', () => {
  it('produces believable, deterministic traffic', () => {
    const now = 1_790_400_000_000;
    const a = new Simulator(7, now).snapshot(now + 60_000);
    const b = new Simulator(7, now).snapshot(now + 60_000);
    expect(a.ac.length).toBeGreaterThan(8);
    expect(a.ac).toEqual(b.ac);
    for (const x of a.ac) {
      expect(x.sim?.from).toMatch(/^[A-Z]{4}$/);
      expect(x.hex.startsWith('~sim')).toBe(true);
      expect(x.lat).toBeGreaterThan(0.5);
      expect(x.lat).toBeLessThan(2.1);
      expect(x.lon).toBeGreaterThan(103);
      expect(x.lon).toBeLessThan(104.8);
    }
    expect(a.ac.some((x) => x.sim?.to === 'WSSS')).toBe(true);
    expect(a.ac.some((x) => x.sim?.from === 'WSSS')).toBe(true);
  });

  it('gives every simulated flight a route that fits where it flies', () => {
    const now = 1_790_400_000_000;
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const x of new Simulator(seed, now).snapshot(now + 90_000).ac) {
        if (x.sim!.from === x.sim!.to) continue; // the coastal helicopter goes home
        const route = simRoute(x.cs, x.sim!.from, x.sim!.to);
        expect(route, `${x.cs} ${x.sim!.from}-${x.sim!.to}`).not.toBeNull();
        expect(legProgress(route!, x)!.plausible, `${x.cs} ${x.sim!.from}-${x.sim!.to}`).toBe(true);
      }
    }
  });
});
