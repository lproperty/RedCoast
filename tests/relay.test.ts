import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedResponse } from '../src/data/feed.ts';
import { handleRequest, originAllowed, parseQuery, type StationStore } from '../relay/src/handler.ts';
import { Station } from '../relay/src/worker.ts';

const env = { ALLOWED_ORIGINS: 'https://lproperty.github.io, http://localhost:*' };
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined) };

describe('parseQuery', () => {
  it('coarsens the position and radius', () => {
    expect(parseQuery(new URL('https://r/v1/traffic?lat=1.2621&lon=103.9143&r=23'))).toEqual({ lat: 1.3, lon: 103.9, r: 25 });
    expect(parseQuery(new URL('https://r/v1/traffic?lat=1.3&lon=103.9&r=500'))).toMatchObject({ r: 100 });
    expect(parseQuery(new URL('https://r/v1/traffic?lat=1.3&lon=103.9&r=1'))).toMatchObject({ r: 10 });
  });

  it('rejects bad input', () => {
    expect(typeof parseQuery(new URL('https://r/v1/traffic?lon=103.9'))).toBe('string');
    expect(typeof parseQuery(new URL('https://r/v1/traffic?lat=95&lon=103.9'))).toBe('string');
    expect(typeof parseQuery(new URL('https://r/v1/traffic?lat=1&lon=abc'))).toBe('string');
    expect(typeof parseQuery(new URL('https://r/v1/traffic?lat=1&lon=103&r=-5'))).toBe('string');
  });
});

describe('originAllowed', () => {
  it('matches exact origins and localhost on any port', () => {
    expect(originAllowed('https://lproperty.github.io', env)).toBe(true);
    expect(originAllowed('http://localhost:5173', env)).toBe(true);
    expect(originAllowed('http://localhost', env)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(originAllowed(null, env)).toBe(false);
    expect(originAllowed('https://evil.example', env)).toBe(false);
    expect(originAllowed('https://lproperty.github.io.evil.example', env)).toBe(false);
    expect(originAllowed('http://localhost.evil.example', env)).toBe(false);
    expect(originAllowed('http://localhost:5173.evil.example', env)).toBe(false);
  });

  it('allows anything in local development', () => {
    expect(originAllowed(null, { DEV: '1' })).toBe(true);
  });
});

describe('handleRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  const call = (path: string, init: RequestInit & { origin?: string } = {}) =>
    handleRequest(
      new Request(`https://relay.test${path}`, {
        method: init.method ?? 'GET',
        headers: init.origin ? { Origin: init.origin } : {},
      }),
      env,
      ctx,
    );

  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await call('/v1/traffic', { method: 'OPTIONS', origin: 'https://lproperty.github.io' });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://lproperty.github.io');
    const bad = await call('/v1/traffic', { method: 'OPTIONS', origin: 'https://evil.example' });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses unknown origins and paths', async () => {
    expect((await call('/v1/traffic?lat=1.3&lon=103.9', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/v1/traffic?lat=1.3&lon=103.9')).status).toBe(403);
    expect((await call('/etc/passwd', { origin: 'https://lproperty.github.io' })).status).toBe(404);
    expect((await call('/v1/traffic?lat=x&lon=1', { origin: 'https://lproperty.github.io' })).status).toBe(400);
  });

  it('merges adsb.lol and OpenSky for an allowed origin', async () => {
    const now = Date.now();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.adsb.lol')) {
        expect(url).toContain('/v2/lat/1.2/lon/104.1/dist/40');
        return Response.json({
          now,
          ac: [
            { hex: 'aaa111', flight: 'SIA1', lat: 1.2, lon: 104, alt_baro: 3000, seen_pos: 5, r: '9V-AAA', t: 'A359' },
          ],
        });
      }
      if (url.includes('opensky-network.org/api/states/all')) {
        return new Response(
          JSON.stringify({
            time: now / 1000,
            states: [
              ['aaa111', 'SIA1', 'SG', now / 1000 - 1, now / 1000, 104.01, 1.21, 900, false, 100, 20, 0, null, null, null, false, 0],
              ['bbb222', 'TGW2', 'SG', now / 1000 - 2, now / 1000, 103.9, 1.3, 600, false, 80, 200, 0, null, null, null, false, 0],
            ],
          }),
          { headers: { 'X-Rate-Limit-Remaining': '321' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await call('/v1/traffic?lat=1.2&lon=104.1&r=40', { origin: 'https://lproperty.github.io' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://lproperty.github.io');
    const body = (await res.json()) as { sources: { id: string; ok: boolean; note?: string }[]; ac: { hex: string; lat: number; reg?: string; via: string }[] };
    expect(body.sources.map((s) => [s.id, s.ok])).toEqual([
      ['adsblol', true],
      ['opensky', true],
    ]);
    expect(body.sources[1]!.note).toContain('321 credits left');
    const a = body.ac.find((x) => x.hex === 'aaa111')!;
    expect(a).toMatchObject({ lat: 1.21, via: 'opensky', reg: '9V-AAA' });
    expect(body.ac.map((x) => x.hex).sort()).toEqual(['aaa111', 'bbb222']);
  });

  it('falls back to adsb.fi when adsb.lol rate-limits, and then leaves adsb.lol alone', async () => {
    const now = Date.now();
    const hits: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        hits.push(new URL(url).host);
        if (url.includes('api.adsb.lol')) return new Response('slow down', { status: 429 });
        if (url.includes('adsb.fi')) return Response.json({ now: now / 1000, aircraft: [{ hex: 'ccc333', lat: 1.4, lon: 104.3, seen_pos: 1 }] });
        return Response.json({ time: now / 1000, states: [] });
      }),
    );
    const first = (await (await call('/v1/traffic?lat=1.4&lon=104.3&r=20', { origin: 'https://lproperty.github.io' })).json()) as {
      sources: { id: string; note?: string }[];
      ac: { hex: string }[];
    };
    expect(first.sources[0]).toMatchObject({ id: 'adsbfi' });
    expect(first.sources[0]!.note).toContain('429');
    expect(first.ac.map((a) => a.hex)).toContain('ccc333');

    hits.length = 0;
    await call('/v1/traffic?lat=1.5&lon=104.3&r=20', { origin: 'https://lproperty.github.io' });
    expect(hits).not.toContain('api.adsb.lol');
    expect(hits).toContain('opendata.adsb.fi');
  });
});

describe('home station mailbox', () => {
  const TOKEN = 'a'.repeat(64);
  const envS = { ...env, STATION_TOKEN: TOKEN };

  class MemStation implements StationStore {
    at: number | null = null;
    resp: FeedResponse | null = null;
    lastViewer = 0;
    async read() {
      this.lastViewer = Date.now();
      return { at: this.at, resp: this.resp };
    }
    async push(r: FeedResponse) {
      this.resp = r;
      this.at = Date.now();
      return { watching: Date.now() - this.lastViewer < 60_000 };
    }
    async status() {
      return { watching: Date.now() - this.lastViewer < 60_000, ageMs: this.at === null ? null : Date.now() - this.at };
    }
  }

  const req = (path: string, init: { method?: string; token?: string; origin?: string; body?: string } = {}) =>
    new Request(`https://relay.test${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.origin ? { Origin: init.origin } : {}),
      },
      body: init.body,
    });

  it('only accepts the station with the right token', async () => {
    const st = new MemStation();
    expect((await handleRequest(req('/v1/station'), envS, ctx, st)).status).toBe(401);
    expect((await handleRequest(req('/v1/station', { token: 'b'.repeat(64) }), envS, ctx, st)).status).toBe(401);
    expect((await handleRequest(req('/v1/station', { token: TOKEN }), envS, ctx, st)).status).toBe(200);
    // A missing or too-short secret on the relay locks everyone out.
    expect((await handleRequest(req('/v1/station', { token: 'short' }), { ...env, STATION_TOKEN: 'short' }, ctx, st)).status).toBe(401);
    expect((await handleRequest(req('/v1/station', { token: TOKEN }), envS, ctx)).status).toBe(404);
  });

  it('serves the pushed picture to viewers, filtered to their area, and tells the station someone is watching', async () => {
    const st = new MemStation();
    const now = Date.now();
    const status = async () => (await (await handleRequest(req('/v1/station', { token: TOKEN }), envS, ctx, st)).json()) as { watching: boolean };
    expect((await status()).watching).toBe(false);

    // A viewer arrives before the station has ever pushed.
    const first = (await (await handleRequest(req('/v1/traffic?lat=1.3&lon=103.9&r=30', { origin: 'https://lproperty.github.io' }), envS, ctx, st)).json()) as FeedResponse;
    expect(first.station).toEqual({ online: false, ageMs: null });
    expect(first.ac).toEqual([]);
    expect((await status()).watching).toBe(true);

    const picture: FeedResponse = {
      v: 1,
      now,
      sources: [{ id: 'adsblol', ok: true, count: 3 }],
      ac: [
        { hex: 'near01', lat: 1.25, lon: 103.95, t: now - 1000, src: 'adsb', via: 'adsblol' },
        { hex: 'far001', lat: 2.5, lon: 105.0, t: now - 1000, src: 'adsb', via: 'adsblol' },
        { hex: 'old001', lat: 1.3, lon: 103.9, t: now - 120_000, src: 'adsb', via: 'adsblol' },
      ],
    };
    const pushed = await handleRequest(req('/v1/push', { method: 'POST', token: TOKEN, body: JSON.stringify(picture) }), envS, ctx, st);
    expect(pushed.status).toBe(200);
    expect(await pushed.json()).toEqual({ watching: true });

    const res = await handleRequest(req('/v1/traffic?lat=1.3&lon=103.9&r=30', { origin: 'https://lproperty.github.io' }), envS, ctx, st);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://lproperty.github.io');
    const body = (await res.json()) as FeedResponse;
    expect(body.ac.map((a) => a.hex)).toEqual(['near01']);
    expect(body.station?.online).toBe(true);
    expect(body.sources).toEqual(picture.sources);
  });

  it("passes the station's weather report on to viewers, and drops a malformed one", async () => {
    const st = new MemStation();
    const now = Date.now();
    const wx = { id: 'WSSS', raw: 'METAR WSSS 261500Z 11004KT 4000 HZ FEW018 29/26 Q1012 NOSIG', t: now - 600_000 };
    const push = (extra: object) =>
      handleRequest(
        req('/v1/push', { method: 'POST', token: TOKEN, body: JSON.stringify({ v: 1, now, sources: [], ac: [], ...extra }) }),
        envS,
        ctx,
        st,
      );
    const view = async () =>
      (await (await handleRequest(req('/v1/traffic?lat=1.3&lon=103.9&r=30', { origin: 'https://lproperty.github.io' }), envS, ctx, st)).json()) as FeedResponse;

    expect((await push({ wx })).status).toBe(200);
    expect((await view()).wx).toEqual(wx);
    expect((await push({ wx: { id: 'WSSS', raw: 42 } })).status).toBe(200);
    expect((await view()).wx).toBeUndefined();
  });

  it('rejects malformed pictures', async () => {
    const st = new MemStation();
    const push = (body: string) => handleRequest(req('/v1/push', { method: 'POST', token: TOKEN, body }), envS, ctx, st);
    expect((await push('not json')).status).toBe(400);
    expect((await push(JSON.stringify({ v: 2, ac: [], sources: [] }))).status).toBe(400);
    expect((await push(JSON.stringify({ v: 1, ac: 'x', sources: [] }))).status).toBe(400);
    expect(st.at).toBeNull();
  });
});

describe('Station Durable Object', () => {
  it('keeps the latest picture and tracks viewers', async () => {
    const station = new Station();
    const call = (path: string, init?: RequestInit) => station.fetch(new Request(`https://station${path}`, init));
    expect(await (await call('/status')).json()).toEqual({ watching: false, ageMs: null });
    const read = await call('/read');
    expect(read.headers.get('X-Station-At')).toBe('');
    expect(await read.json()).toBeNull();
    const pushed = await call('/push', { method: 'POST', body: JSON.stringify({ v: 1, now: 1, sources: [], ac: [] }) });
    expect(await pushed.json()).toEqual({ watching: true });
    const again = await call('/read');
    expect(Number(again.headers.get('X-Station-At'))).toBeGreaterThan(0);
    expect(await again.json()).toMatchObject({ v: 1 });
  });
});

describe('weather report', () => {
  afterEach(() => vi.unstubAllGlobals());

  const report = (obs: number) => [
    { icaoId: 'WSSS', obsTime: obs, rawOb: 'METAR WSSS 261500Z 11004KT 4000 HZ FEW018 29/26 Q1012 NOSIG' },
  ];
  const stub = (weather: () => Response) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('aviationweather.gov')) return weather();
        if (url.includes('adsb')) return Response.json({ now: Date.now(), ac: [] });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

  it("adds Changi's latest METAR to the picture, then reuses it for a while", async () => {
    vi.resetModules();
    const { fetchTraffic } = await import('../relay/src/upstream.ts');
    const obs = Math.floor(Date.now() / 1000) - 600;
    const weather = vi.fn(() => Response.json(report(obs)));
    stub(weather);
    const first = await fetchTraffic({ lat: 1.3, lon: 103.9, r: 30 }, {}, ctx, { opensky: false });
    expect(first.wx).toEqual({ id: 'WSSS', raw: expect.stringContaining('4000 HZ'), t: obs * 1000 });
    const again = await fetchTraffic({ lat: 1.3, lon: 103.9, r: 30 }, {}, ctx, { opensky: false });
    expect(again.wx).toEqual(first.wx);
    expect(weather).toHaveBeenCalledTimes(1);
  });

  it('still delivers the traffic when the weather service is down, or its report is stale', async () => {
    vi.resetModules();
    let { fetchTraffic } = await import('../relay/src/upstream.ts');
    stub(() => new Response('down', { status: 503 }));
    const down = await fetchTraffic({ lat: 1.3, lon: 103.9, r: 30 }, {}, ctx, { opensky: false });
    expect(down.sources[0]!.ok).toBe(true);
    expect(down.wx).toBeUndefined();

    vi.resetModules();
    ({ fetchTraffic } = await import('../relay/src/upstream.ts'));
    stub(() => Response.json(report(Math.floor(Date.now() / 1000) - 5 * 3600)));
    expect((await fetchTraffic({ lat: 1.3, lon: 103.9, r: 30 }, {}, ctx, { opensky: false })).wx).toBeUndefined();
  });
});
