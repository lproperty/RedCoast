import { parseReadsb, type FeedResponse } from './feed.ts';
import type { Simulator } from './simulator.ts';

export interface FeedQuery {
  lat: number;
  lon: number;
  radiusNm: number;
}

export interface FeedSource {
  readonly id: 'relay' | 'custom' | 'sim';
  fetch(q: FeedQuery, signal: AbortSignal): Promise<FeedResponse>;
}

/**
 * The RedCoast relay. The location sent is rounded to 0.1° (~11 km): the relay and the
 * upstream feeds never learn exactly where you are. Precision is restored locally.
 */
export class RelaySource implements FeedSource {
  readonly id = 'relay';
  constructor(private readonly base: string) {}

  async fetch(q: FeedQuery, signal: AbortSignal): Promise<FeedResponse> {
    const url =
      `${this.base.replace(/\/+$/, '')}/v1/traffic` +
      `?lat=${q.lat.toFixed(1)}&lon=${q.lon.toFixed(1)}&r=${Math.ceil(q.radiusNm)}`;
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok && res.status !== 502) throw new Error(`relay HTTP ${res.status}`);
    const body = (await res.json()) as FeedResponse;
    if (body?.v !== 1 || !Array.isArray(body.ac)) throw new Error('unexpected relay response');
    return body;
  }
}

/** Any readsb/tar1090 `aircraft.json` that allows CORS, e.g. your own receiver. */
export class ReadsbUrlSource implements FeedSource {
  readonly id = 'custom';
  constructor(private readonly url: string) {}

  async fetch(_q: FeedQuery, signal: AbortSignal): Promise<FeedResponse> {
    const started = performance.now();
    const res = await fetch(this.url, { signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { now?: number };
    const now = Date.now();
    const ac = parseReadsb(json, 'custom', now);
    return {
      v: 1,
      now,
      sources: [{ id: 'custom', ok: true, count: ac.length, ms: Math.round(performance.now() - started) }],
      ac,
    };
  }
}

export class SimSource implements FeedSource {
  readonly id = 'sim';
  constructor(private readonly sim: Simulator) {}

  async fetch(): Promise<FeedResponse> {
    return this.sim.snapshot(Date.now());
  }
}

export interface PollResult {
  resp: FeedResponse;
  receivedAt: number;
  latencyMs: number;
}

interface PollerOptions {
  source: () => FeedSource;
  query: () => FeedQuery;
  intervalMs: () => number;
  onResult: (r: PollResult) => void;
  onError: (err: Error, consecutiveFailures: number) => void;
}

/** Polls the feed on a timer; pauses while the page is hidden and backs off on errors. */
export class Poller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private busy = false;
  private failures = 0;

  constructor(private readonly opts: PollerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Poll right away (e.g. after the source or location changed). */
  kick(): void {
    this.failures = 0;
    if (this.running && !this.busy) void this.tick();
  }

  private readonly onVisibility = () => {
    if (!document.hidden) this.kick();
  };

  private async tick(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.running || document.hidden || this.busy) return;
    this.busy = true;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    const started = performance.now();
    try {
      const resp = await this.opts.source().fetch(this.opts.query(), ctrl.signal);
      this.failures = 0;
      this.opts.onResult({ resp, receivedAt: Date.now(), latencyMs: performance.now() - started });
    } catch (err) {
      this.failures++;
      this.opts.onError(err instanceof Error ? err : new Error(String(err)), this.failures);
    } finally {
      clearTimeout(timeout);
      this.busy = false;
    }
    if (!this.running) return;
    const interval = this.opts.intervalMs();
    const delay = this.failures
      ? Math.min(30_000, interval * 2 ** Math.min(this.failures, 4))
      : Math.max(250, interval - (performance.now() - started));
    this.timer = setTimeout(() => void this.tick(), delay);
  }
}
