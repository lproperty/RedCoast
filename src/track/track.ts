/**
 * One tracked aircraft ("contact"). Positions arrive every few seconds; between fixes the
 * track is dead-reckoned along its ground track (following turns), and each new fix is
 * blended in over ~0.7 s so symbols glide instead of jumping.
 */
import type { FeedAircraft } from '../data/feed.ts';
import { DEG, normDeg, signedDeg, type LocalFrame } from '../geo/geo.ts';
import type { AircraftRecord, LegProgress, Photo, Route } from '../enrich/lookup.ts';
import type { Classification } from './classify.ts';
import type { Sight } from './sight.ts';

export interface Fix {
  /** Client clock, epoch ms. */
  t: number;
  /** Local frame, km east/north of the observer. */
  x: number;
  y: number;
  alt?: number;
}

export const KT_TO_KMS = 1.852 / 3600;
/** Beyond this the symbol stops moving: better frozen than confidently wrong. */
export const MAX_EXTRAPOLATE_MS = 45_000;
/** Older than this, the contact is drawn dimmed. (OpenSky's free tier is often ~20 s behind.) */
export const STALE_MS = 25_000;
export const LOST_MS = 60_000;
const SMOOTH_TAU_MS = 700;
const HISTORY_MS = 10 * 60_000;
/** A turn is assumed to continue for this long, then the aircraft rolls out straight. */
const TURN_HORIZON_S = 25;

/** Fields that belong to one position report and must not be inherited from an older one. */
const EXACT_KEYS = ['lat', 'lon', 't', 'alt', 'galt', 'gnd', 'src', 'via', 'em'] as const;
/** Motion fields: an older report must not overwrite these either. */
const MOTION_KEYS = ['gs', 'trk', 'trate', 'vr', 'hdg', 'roll'] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Track {
  readonly hex: string;
  /** Track number, as a military console would assign it. */
  readonly tn: number;
  a: FeedAircraft;
  readonly firstSeen: number;
  /** The first report: seen low near its origin, it dates the take-off. */
  readonly first: { t: number; lat: number; lon: number; alt?: number };
  /** When it was seen leaving the ground (client clock). */
  liftoff: number | undefined;
  lastUpdate: number;
  /** Position of the latest fix in the local frame. */
  fx = 0;
  fy = 0;
  history: Fix[] = [];
  /** Estimated rate of turn, degrees per second. */
  turnRate = 0;
  private corrX = 0;
  private corrY = 0;
  private corrT = 0;
  /** A report that put the aircraft somewhere it couldn't be, held until a second one agrees. */
  private suspect: FeedAircraft | undefined;

  // Filled in by the app each tick.
  route: Route | null | undefined;
  leg: LegProgress | undefined;
  aircraft: AircraftRecord | null | undefined;
  photo: Photo | null | undefined;
  cls!: Classification;
  sight!: Sight;
  /** Seconds until this contact is predicted to enter the balcony view (0 = in view now). */
  viewEtaS: number | undefined;
  /** Closest approach to the observer along the current track. */
  cpa: { tS: number; distKm: number } | undefined;
  flags = { announced: false, inView: false, special: false, emergency: false };

  constructor(tn: number, a: FeedAircraft, frame: LocalFrame, now: number) {
    this.hex = a.hex;
    this.tn = tn;
    this.a = a;
    this.firstSeen = now;
    this.first = { t: a.t, lat: a.lat, lon: a.lon, ...(a.gnd ? {} : { alt: a.alt }) };
    this.lastUpdate = now;
    if (a.trate !== undefined) this.turnRate = clamp(a.trate, -4, 4);
    this.place(frame);
    this.pushHistory();
  }

  private place(frame: LocalFrame): void {
    [this.fx, this.fy] = frame.toXY(this.a.lat, this.a.lon);
  }

  /** Re-expresses the track in a new local frame after the observer moved. */
  rebase(frame: LocalFrame, toLatLon: (x: number, y: number) => { lat: number; lon: number }): void {
    this.history = this.history.map((h) => {
      const ll = toLatLon(h.x, h.y);
      const [x, y] = frame.toXY(ll.lat, ll.lon);
      return { ...h, x, y };
    });
    this.place(frame);
    this.corrX = this.corrY = 0;
  }

  get callsign(): string | undefined {
    return this.a.cs;
  }

  /** Merges a new report (its `t` already on the client clock). Returns true for a new position. */
  update(next: FeedAircraft, frame: LocalFrame, now: number): boolean {
    this.lastUpdate = now;
    if (next.t <= this.a.t) {
      // Same or older position (e.g. a slower feed): keep our fix, take any new metadata.
      const kept: Record<string, unknown> = {};
      for (const k of [...EXACT_KEYS, ...MOTION_KEYS]) if (this.a[k] !== undefined) kept[k] = this.a[k];
      const merged = { ...this.a, ...next, ...kept } as Record<string, unknown>;
      for (const k of EXACT_KEYS) if (this.a[k] === undefined) delete merged[k];
      this.a = merged as unknown as FeedAircraft;
      return false;
    }

    const dt = (next.t - this.a.t) / 1000;
    if (this.isOutlier(next, frame, dt)) return false;
    if (next.trate !== undefined) this.turnRate = clamp(next.trate, -4, 4);
    else if (next.trk !== undefined && this.a.trk !== undefined && dt > 0.5 && dt < 20) {
      this.turnRate = 0.5 * this.turnRate + 0.5 * clamp(signedDeg(next.trk - this.a.trk) / dt, -4, 4);
    }

    const before = this.display(now);
    const wasOnGround = this.a.gnd;
    const merged = { ...this.a, ...next } as Record<string, unknown>;
    for (const k of EXACT_KEYS) if (!(k in next)) delete merged[k];
    this.a = merged as unknown as FeedAircraft;
    if (wasOnGround && !this.a.gnd) this.liftoff = this.a.t;
    [this.fx, this.fy] = frame.toXY(this.a.lat, this.a.lon);

    const after = this.predict(now);
    const dx = before.x - after.x;
    const dy = before.y - after.y;
    if (Math.hypot(dx, dy) < 2) {
      this.corrX = dx;
      this.corrY = dy;
      this.corrT = now;
    } else {
      this.corrX = this.corrY = 0;
    }
    this.pushHistory();
    return true;
  }

  /**
   * Feeds occasionally report a wildly wrong position (bad multilateration, decoding errors).
   * A jump the aircraft couldn't have flown is held back unless the next report confirms it.
   */
  private isOutlier(next: FeedAircraft, frame: LocalFrame, dt: number): boolean {
    const [nx, ny] = frame.toXY(next.lat, next.lon);
    const kmS = Math.max(this.a.gs ?? 0, next.gs ?? 0, 250) * KT_TO_KMS;
    const jump = Math.hypot(nx - this.fx, ny - this.fy);
    if (jump <= 3 || jump <= kmS * dt * 2 + 2) {
      this.suspect = undefined;
      return false;
    }
    const s = this.suspect;
    if (s && next.t > s.t) {
      const [sx, sy] = frame.toXY(s.lat, s.lon);
      if (Math.hypot(nx - sx, ny - sy) <= kmS * ((next.t - s.t) / 1000) * 2 + 2) {
        this.suspect = undefined;
        return false; // two reports agree: the aircraft really is over there
      }
    }
    this.suspect = next;
    return true;
  }

  private pushHistory(): void {
    const last = this.history[this.history.length - 1];
    if (!last || this.a.t - last.t > 4000 || Math.hypot(this.fx - last.x, this.fy - last.y) > 0.25) {
      this.history.push({ t: this.a.t, x: this.fx, y: this.fy, alt: this.a.alt });
    }
    const cutoff = this.a.t - HISTORY_MS;
    while (this.history.length > 1 && this.history[0]!.t < cutoff) this.history.shift();
  }

  /** Position `s` seconds after the latest fix: follows the current turn briefly, then straight. */
  afterFix(s: number): { x: number; y: number; trk: number | undefined } {
    const a = this.a;
    if (a.gnd || a.gs === undefined || a.trk === undefined || a.gs < 2 || s <= 0) {
      return { x: this.fx, y: this.fy, trk: a.trk };
    }
    const v = a.gs * KT_TO_KMS;
    const th = a.trk * DEG;
    const w = Math.abs(this.turnRate) >= 0.15 ? this.turnRate * DEG : 0;
    const turnS = w === 0 ? 0 : Math.min(s, TURN_HORIZON_S);
    let x = this.fx;
    let y = this.fy;
    let th2 = th;
    if (turnS > 0) {
      th2 = th + w * turnS;
      x += (v / w) * (Math.cos(th) - Math.cos(th2));
      y += (v / w) * (Math.sin(th2) - Math.sin(th));
    }
    const straight = s - turnS;
    x += v * Math.sin(th2) * straight;
    y += v * Math.cos(th2) * straight;
    return { x, y, trk: normDeg(th2 / DEG) };
  }

  /** Dead-reckoned position at client time t, capped at MAX_EXTRAPOLATE_MS past the fix. */
  predict(t: number): { x: number; y: number; trk: number | undefined } {
    return this.afterFix(clamp(t - this.a.t, 0, MAX_EXTRAPOLATE_MS) / 1000);
  }

  /** Where to draw the contact: the prediction plus a correction that decays after each fix. */
  display(t: number): { x: number; y: number } {
    const p = this.predict(t);
    const k = this.corrT ? Math.exp(-(t - this.corrT) / SMOOTH_TAU_MS) : 0;
    return { x: p.x + this.corrX * k, y: p.y + this.corrY * k };
  }

  /** Position `aheadS` seconds from now, for path previews and closest-approach math. */
  future(now: number, aheadS: number): { x: number; y: number } {
    return this.afterFix((now - this.a.t) / 1000 + aheadS);
  }

  /** Barometric altitude (ft) at time t, extrapolated by vertical rate for up to 20 s. */
  altitude(t: number): number | undefined {
    const a = this.a;
    if (a.gnd) return 0;
    if (a.alt === undefined) return undefined;
    const s = clamp((t - a.t) / 1000, 0, 20);
    return a.vr ? a.alt + (a.vr * s) / 60 : a.alt;
  }

  /** Best estimate of true height above sea level (ft), for sight lines. GNSS height if we have it. */
  trueAltitude(t: number): number {
    const a = this.a;
    if (a.gnd) return 0;
    const base = a.galt ?? a.alt ?? 0;
    const s = clamp((t - a.t) / 1000, 0, 20);
    return Math.max(0, a.vr ? base + (a.vr * s) / 60 : base);
  }

  /** Altitude `aheadS` seconds from now: follows the vertical rate, levelling at the autopilot altitude. */
  futureAltitude(now: number, aheadS: number): number {
    const a = this.a;
    const alt0 = this.trueAltitude(now);
    if (!a.vr) return alt0;
    let alt = alt0 + (a.vr * aheadS) / 60;
    const target = a.navAlt !== undefined && a.alt !== undefined ? a.navAlt + (alt0 - a.alt) : undefined;
    if (target !== undefined && a.vr > 0 && target > alt0) alt = Math.min(alt, target);
    if (target !== undefined && a.vr < 0 && target < alt0) alt = Math.max(alt, target);
    return clamp(alt, 0, 50_000);
  }

  ageMs(now: number): number {
    return now - this.a.t;
  }

  isStale(now: number): boolean {
    return this.ageMs(now) > STALE_MS;
  }
}
