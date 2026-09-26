import { describe, expect, it } from 'vitest';
import { epochMs, mergeFeeds, parseOpenSky, parseReadsb, type FeedAircraft } from '../src/data/feed.ts';

const NOW = 1_790_400_000_000;

describe('parseReadsb', () => {
  const sample = {
    now: NOW,
    ac: [
      {
        hex: '76CEE6',
        type: 'adsb_icao',
        flight: 'SIA321  ',
        r: '9V-SWF',
        t: 'B77W',
        alt_baro: 4500,
        alt_geom: 4700,
        gs: 250.4,
        track: 23.1,
        baro_rate: -832,
        squawk: '2237',
        emergency: 'none',
        category: 'A5',
        nav_altitude_mcp: 3008,
        lat: 1.25,
        lon: 103.95,
        seen_pos: 1.5,
        wd: 200,
        ws: 12,
        oat: 18,
        dbFlags: 0,
      },
      { hex: '750111', alt_baro: 'ground', gs: 3, lat: 1.36, lon: 103.99, seen_pos: 0.2, type: 'mlat' },
      { hex: 'abcdef', alt_baro: 30000, lat: 1.1, lon: 103.5, seen_pos: 75 },
      { hex: 'ae1234', alt_baro: 2000, lat: 1.35, lon: 103.9, seen_pos: 2, dbFlags: 1, emergency: 'general' },
      { hex: 'nopos', alt_baro: 2000 },
    ],
  };

  it('maps fields and units', () => {
    const [a] = parseReadsb(sample, 'adsblol', NOW);
    expect(a).toMatchObject({
      hex: '76cee6',
      cs: 'SIA321',
      reg: '9V-SWF',
      type: 'B77W',
      alt: 4500,
      galt: 4700,
      gs: 250.4,
      trk: 23.1,
      vr: -832,
      sq: '2237',
      cat: 'A5',
      navAlt: 3008,
      wd: 200,
      src: 'adsb',
      via: 'adsblol',
      t: NOW - 1500,
    });
    expect(a!.em).toBeUndefined();
    expect(a!.mil).toBeUndefined();
  });

  it('handles ground, stale, military and position-less records', () => {
    const out = parseReadsb(sample, 'adsblol', NOW);
    expect(out.map((a) => a.hex)).toEqual(['76cee6', '750111', 'ae1234']);
    expect(out[1]).toMatchObject({ gnd: true, src: 'mlat' });
    expect(out[1]!.alt).toBeUndefined();
    expect(out[2]).toMatchObject({ mil: true, em: 'general' });
  });

  it('accepts adsb.fi style (seconds, "aircraft" key)', () => {
    const out = parseReadsb({ now: NOW / 1000, aircraft: [{ hex: 'aaaaaa', lat: 1, lon: 104, seen_pos: 2 }] }, 'adsbfi', 0);
    expect(out[0]!.t).toBe(NOW - 2000);
  });

  it('survives junk', () => {
    expect(parseReadsb(null, 'adsblol', NOW)).toEqual([]);
    expect(parseReadsb({ ac: 'nope' }, 'adsblol', NOW)).toEqual([]);
    expect(epochMs('x', 5)).toBe(5);
  });
});

describe('parseOpenSky', () => {
  it('converts state vectors', () => {
    const t = NOW / 1000;
    const out = parseOpenSky(
      {
        time: t,
        states: [
          ['76cef3', 'SIA318  ', 'Singapore', t - 1, t, 103.9999, 1.2078, 1516.38, false, 138.12, 65.34, -3.9, null, 1550, '7700', false, 0, 6],
          ['7814ba', '', 'China', t - 14, t, 103.9919, 1.3638, null, true, 1.54, 120.9, null, null, null, null, false, 2],
          ['dead00', 'OLD', 'X', t - 300, t, 103, 1, 1000, false, 100, 0, 0, null, null, null, false, 0],
        ],
      },
      0,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ hex: '76cef3', cs: 'SIA318', alt: 4975, gs: 268.5, vr: -768, sq: '7700', em: 'general', cat: 'A5', via: 'opensky', t: NOW - 1000 });
    expect(out[1]).toMatchObject({ gnd: true, src: 'mlat' });
    expect(out[1]!.cs).toBeUndefined();
  });
});

describe('mergeFeeds', () => {
  const base = (over: Partial<FeedAircraft>): FeedAircraft => ({ hex: 'abc123', lat: 1, lon: 104, t: NOW, src: 'adsb', via: 'adsblol', ...over });

  it('keeps the freshest position and fills metadata from the other feed', () => {
    const lol = base({ t: NOW - 8000, lat: 1.0, reg: '9V-ABC', type: 'A359', alt: 5000, navAlt: 3000 });
    const os = base({ t: NOW - 1000, lat: 1.01, via: 'opensky', alt: 4800 });
    const [m] = mergeFeeds([[lol], [os]]);
    expect(m).toMatchObject({ lat: 1.01, alt: 4800, via: 'opensky', reg: '9V-ABC', type: 'A359', navAlt: 3000 });
  });

  it('does not inherit a stale on-ground flag or position fields', () => {
    const old = base({ t: NOW - 20_000, gnd: true, galt: 50 });
    const fresh = base({ t: NOW, alt: 1200, via: 'opensky' });
    const [m] = mergeFeeds([[old], [fresh]]);
    expect(m!.gnd).toBeUndefined();
    expect(m!.galt).toBeUndefined();
    expect(m!.alt).toBe(1200);
  });

  it('borrows speed and track only from a recent report', () => {
    const recent = mergeFeeds([[base({ t: NOW - 5000, gs: 250, trk: 90 })], [base({ t: NOW, via: 'opensky' })]])[0]!;
    expect(recent.gs).toBe(250);
    const old = mergeFeeds([[base({ t: NOW - 30_000, gs: 250 })], [base({ t: NOW, via: 'opensky' })]])[0]!;
    expect(old.gs).toBeUndefined();
  });
});
