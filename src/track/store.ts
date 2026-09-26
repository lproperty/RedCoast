import type { FeedResponse } from '../data/feed.ts';
import type { LocalFrame } from '../geo/geo.ts';
import { LOST_MS, Track } from './track.ts';

/**
 * Keeps the air picture: one Track per ICAO address. Also converts the relay's timestamps
 * to this device's clock, since phone clocks are often a second or two off.
 */
export class TrackStore {
  readonly tracks = new Map<string, Track>();
  private nextTn = 1;
  private clockOffsetMs = 0;
  private clockSynced = false;

  constructor(public frame: LocalFrame) {}

  /** Moves the observer: every track is re-expressed in the new local frame. */
  setFrame(frame: LocalFrame): void {
    const old = this.frame;
    this.frame = frame;
    for (const t of this.tracks.values()) t.rebase(frame, (x, y) => old.toLatLon(x, y));
  }

  get clockOffset(): number {
    return this.clockOffsetMs;
  }

  ingest(resp: FeedResponse, receivedAt: number, latencyMs: number): { added: Track[]; updated: number } {
    const sample = receivedAt - latencyMs / 2 - resp.now;
    this.clockOffsetMs = this.clockSynced ? this.clockOffsetMs * 0.8 + sample * 0.2 : sample;
    this.clockSynced = true;

    const added: Track[] = [];
    let updated = 0;
    for (const rec of resp.ac) {
      const a = { ...rec, t: rec.t + this.clockOffsetMs };
      const existing = this.tracks.get(a.hex);
      if (existing) {
        if (existing.update(a, this.frame, receivedAt)) updated++;
      } else {
        const track = new Track(this.nextTn, a, this.frame, receivedAt);
        this.nextTn = (this.nextTn % 999) + 1;
        this.tracks.set(a.hex, track);
        added.push(track);
      }
    }
    return { added, updated };
  }

  /** Removes contacts not heard from for LOST_MS. */
  prune(now: number): Track[] {
    const lost: Track[] = [];
    for (const [hex, t] of this.tracks) {
      if (now - t.a.t > LOST_MS) {
        this.tracks.delete(hex);
        lost.push(t);
      }
    }
    return lost;
  }

  clear(): void {
    this.tracks.clear();
    this.clockSynced = false;
  }

  list(): Track[] {
    return [...this.tracks.values()];
  }
}
