/**
 * Cloudflare Worker entry point, plus the Durable Object that holds the home station's
 * latest picture. The picture lives in memory only: it's refreshed every few seconds while
 * anyone is watching, and is worthless a minute later anyway.
 */
import type { FeedResponse } from '../../src/data/feed.ts';
import { handleRequest, type Ctx, type Env, type StationStore } from './handler.ts';

/** Minimal Durable Object types, so this file also type-checks without workers-types. */
interface DurableObjectStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}
interface WorkerEnv extends Env {
  STATION?: DurableObjectNamespace;
}

/** Someone counts as watching for this long after their last poll. */
const WATCH_WINDOW_MS = 60_000;

export class Station {
  private raw: string | null = null;
  private at: number | null = null;
  private lastViewer = 0;

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = Date.now();
    const watching = () => now - this.lastViewer < WATCH_WINDOW_MS;
    switch (pathname) {
      case '/push':
        this.raw = await request.text();
        this.at = now;
        return Response.json({ watching: watching() });
      case '/read':
        this.lastViewer = now;
        return new Response(this.raw ?? 'null', {
          headers: { 'Content-Type': 'application/json', 'X-Station-At': this.at === null ? '' : String(this.at) },
        });
      case '/status':
        return Response.json({ watching: watching(), ageMs: this.at === null ? null : now - this.at });
      default:
        return new Response('not found', { status: 404 });
    }
  }
}

function stationStore(ns: DurableObjectNamespace): StationStore {
  const stub = () => ns.get(ns.idFromName('home'));
  return {
    async read() {
      const res = await stub().fetch('https://station/read');
      const at = Number(res.headers.get('X-Station-At')) || null;
      return { at, resp: (await res.json()) as FeedResponse | null };
    },
    async push(resp) {
      const res = await stub().fetch('https://station/push', { method: 'POST', body: JSON.stringify(resp) });
      return (await res.json()) as { watching: boolean };
    },
    async status() {
      const res = await stub().fetch('https://station/status');
      return (await res.json()) as { watching: boolean; ageMs: number | null };
    },
  };
}

export default {
  fetch(request: Request, env: WorkerEnv, ctx: Ctx): Promise<Response> {
    return handleRequest(request, env, ctx, env.STATION ? stationStore(env.STATION) : undefined);
  },
};
