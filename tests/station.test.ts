import { afterEach, describe, expect, it, vi } from 'vitest';
import { areaOf, nextDelayMs, stationRound, validateConfig, type StationConfig, type StationState } from '../station/station.ts';

const cfg: StationConfig = { relayUrl: 'https://relay.test/', token: 't'.repeat(64), lat: 1.3456, lon: 103.8765 };

describe('station config', () => {
  it('validates', () => {
    expect(validateConfig(cfg)).toBe(cfg);
    expect(() => validateConfig({ ...cfg, token: 'short' })).toThrow(/token/);
    expect(() => validateConfig({ ...cfg, relayUrl: 'relay' })).toThrow(/relayUrl/);
    expect(() => validateConfig(null)).toThrow();
  });

  it('only ever asks the feeds about a coarse area', () => {
    expect(areaOf(cfg)).toEqual({ lat: 1.3, lon: 103.9, r: 50 });
  });

  it('paces itself', () => {
    expect(nextDelayMs(true, 0, 1000)).toBe(3000);
    expect(nextDelayMs(false, 0, 200)).toBe(9800);
    expect(nextDelayMs(true, 0, 9000)).toBe(500);
    expect(nextDelayMs(false, 3, 0)).toBe(16_000);
    expect(nextDelayMs(false, 20, 0)).toBe(60_000);
  });
});

describe('stationRound', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks whether anyone is watching, then streams the merged picture', async () => {
    const now = Date.now();
    const calls: { url: string; method: string; auth?: string | null; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('Authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url === 'https://relay.test/v1/station') return Response.json({ watching: true });
        if (url === 'https://relay.test/v1/push') return Response.json({ watching: false });
        if (url.includes('adsb.lol') || url.includes('adsb.fi')) {
          return Response.json({ now, ac: [{ hex: 'abc123', flight: 'SIA1', lat: 1.3, lon: 104, alt_baro: 3000, seen_pos: 1 }] });
        }
        if (url.includes('opensky-network.org')) return Response.json({ time: now / 1000, states: [] });
        throw new Error(`unexpected ${url}`);
      }),
    );
    const logs: string[] = [];
    const state: StationState = { watching: false, failures: 0, pushes: 0 };

    await stationRound(cfg, state, (m) => logs.push(m));
    expect(calls.map((c) => c.url)).toEqual(['https://relay.test/v1/station']);
    expect(calls[0]!.auth).toBe(`Bearer ${cfg.token}`);
    expect(state.watching).toBe(true);

    calls.length = 0;
    await stationRound(cfg, state, (m) => logs.push(m));
    const push = calls.find((c) => c.url.endsWith('/v1/push'))!;
    expect(push.method).toBe('POST');
    expect((push.body as { ac: { hex: string }[] }).ac.map((a) => a.hex)).toEqual(['abc123']);
    expect(calls.some((c) => c.url.includes('/lat/1.3/lon/103.9/dist/50'))).toBe(true);
    expect(state).toMatchObject({ watching: false, pushes: 1, failures: 0 });
    expect(logs.join('\n')).toMatch(/streaming/);
  });

  it('counts failures and keeps going', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const state: StationState = { watching: false, failures: 0, pushes: 0 };
    const logs: string[] = [];
    await stationRound(cfg, state, (m) => logs.push(m));
    await stationRound(cfg, state, (m) => logs.push(m));
    expect(state.failures).toBe(2);
    expect(logs).toHaveLength(1); // quiet after the first error
  });
});
