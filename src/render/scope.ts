/**
 * The radar display.
 *
 *  PPI     classic round scope, observer at the centre, rotating sweep.
 *  SECTOR  forward-looking fan, observer at the bottom, sweep scanning side to side:
 *          all the pixels go to what's in front of the balcony.
 *
 * Layers: a cached "static" canvas (coastline, runways, rings, bearings), then per frame
 * the phosphor blips left by the sweep, the sweep beam, and the live symbols and data
 * blocks. Contacts are drawn at their smoothed, dead-reckoned positions every frame; the
 * sweep leaves fading "paints" where it crossed them, like a real phosphor screen.
 */
import type { Settings } from '../app/settings.ts';
import { lookupType } from '../data/static/aircraftTypes.ts';
import { DEG, KM_PER_NM, type LocalFrame } from '../geo/geo.ts';
import { approachLine, CHANGI_ENDS, EAST_COAST_PARK, LAND, LANDMARKS, MAP_BOX, RUNWAYS } from '../map/map.ts';
import { emergencyText } from '../track/classify.ts';
import type { Track } from '../track/track.ts';
import { blockAlt, displayName, pad3, trendArrow } from '../ui/format.ts';
import type { Palette } from './theme.ts';

export interface ScopeInput {
  now: number;
  tracks: Track[];
  selected?: Track;
  hovered?: Track;
  settings: Settings;
  palette: Palette;
  frame: LocalFrame;
  /** Bearing at the top of the display when facing-up (the balcony direction or a live compass). */
  heading: number;
  /** Changi runway ends currently in use, e.g. ["02L", "02C"]: their centrelines are highlighted. */
  activeRunways: string[];
}

interface Paint {
  x: number;
  y: number;
  t: number;
  strength: number;
  color: string;
}

interface RingCache {
  pts: Float32Array;
  edge: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  slot: number;
}

const FONT = '"B612 Mono", ui-monospace, Menlo, monospace';
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Label slot offsets (relative to the symbol) as functions of the box size. */
const SLOTS: ((w: number, h: number) => [number, number])[] = [
  (_w, h) => [11, -9 - h],
  (_w, h) => [13, -h / 2],
  () => [11, 9],
  (w, h) => [-11 - w, -9 - h],
  (w, h) => [-13 - w, -h / 2],
  (w) => [-11 - w, 9],
  (w, h) => [-w / 2, -13 - h],
  (w) => [-w / 2, 13],
];

function ringStep(range: number): number {
  for (const s of [0.5, 1, 2, 2.5, 5, 10, 15, 20]) if (range / s <= 5) return s;
  return 25;
}

export class Scope {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer = document.createElement('canvas');
  private readonly layerCtx: CanvasRenderingContext2D;
  private layerKey = '';
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cx = 0;
  private cy = 0;
  private R = 100;
  /** Half-width of the display in degrees (180 = full circle). */
  private half = 180;
  private rot = 0;
  private kmPx = 1;
  private mode: Settings['mode'] = 'ppi';
  private frameKey = '';
  private land: RingCache[] = [];
  private park: RingCache[] = [];
  private paints: Paint[] = [];
  private prevSweep: number | undefined;
  private hits: { t: Track; x: number; y: number }[] = [];
  private labels = new Map<string, LabelBox>();
  private lastLabelLayout = 0;
  private readonly textWidths = new Map<string, number>();
  private readonly hasConic: boolean;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.layerCtx = this.layer.getContext('2d')!;
    this.hasConic = typeof this.ctx.createConicGradient === 'function';
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.layerKey = '';
  }

  // ------------------------------------------------------------ geometry

  private layout(s: ScopeInput): void {
    const st = s.settings;
    this.mode = st.mode;
    this.rot = st.mode === 'sector' || st.orientation === 'facing' ? s.heading : 0;
    if (st.mode === 'ppi') {
      this.half = 180;
      this.cx = this.w / 2;
      this.cy = this.h / 2;
      this.R = Math.max(40, Math.min(this.w, this.h) / 2 - 30);
    } else {
      this.half = clamp(st.observer.fov / 2 + 12, 40, 90);
      const mx = 28;
      const mt = 30;
      const mb = 18;
      const availW = this.w - 2 * mx;
      const availH = this.h - mt - mb;
      const byW = this.half >= 89.9 ? availW / 2 : availW / (2 * Math.sin(this.half * DEG));
      this.R = Math.max(40, Math.min(availH, byW));
      this.cx = this.w / 2;
      this.cy = mt + (availH + this.R) / 2;
    }
    this.kmPx = this.R / st.rangeKm;
  }

  /** Local km (east, north) → CSS pixels. */
  project(x: number, y: number): [number, number] {
    const c = Math.cos(this.rot * DEG);
    const s = Math.sin(this.rot * DEG);
    return [this.cx + (x * c - y * s) * this.kmPx, this.cy - (x * s + y * c) * this.kmPx];
  }

  /** CSS pixels → local km. */
  unproject(sx: number, sy: number): [number, number] {
    const dx = (sx - this.cx) / this.kmPx;
    const dy = -(sy - this.cy) / this.kmPx;
    const c = Math.cos(this.rot * DEG);
    const s = Math.sin(this.rot * DEG);
    return [dx * c + dy * s, -dx * s + dy * c];
  }

  /** Screen angle (degrees clockwise from up) and radius (px) of a screen point. */
  private polar(sx: number, sy: number): [number, number] {
    return [Math.atan2(sx - this.cx, -(sy - this.cy)) / DEG, Math.hypot(sx - this.cx, sy - this.cy)];
  }

  private inside(sx: number, sy: number, pad = 0): boolean {
    const [a, r] = this.polar(sx, sy);
    return r <= this.R + pad && (this.half >= 180 || Math.abs(a) <= this.half);
  }

  private shape(ctx: CanvasRenderingContext2D, radius = this.R): void {
    ctx.beginPath();
    if (this.half >= 180) ctx.arc(this.cx, this.cy, radius, 0, TAU);
    else {
      ctx.moveTo(this.cx, this.cy);
      ctx.arc(this.cx, this.cy, radius, -Math.PI / 2 - this.half * DEG, -Math.PI / 2 + this.half * DEG);
      ctx.closePath();
    }
  }

  /** Bearing and range under the pointer, or undefined outside the scope. */
  probe(sx: number, sy: number): { brg: number; km: number } | undefined {
    if (!this.inside(sx, sy)) return undefined;
    const [x, y] = this.unproject(sx, sy);
    return { brg: ((Math.atan2(x, y) / DEG) + 360) % 360, km: Math.hypot(x, y) };
  }

  hit(sx: number, sy: number, radius = 24): Track | undefined {
    let best: Track | undefined;
    let bestD = radius;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      if (d < bestD) {
        bestD = d;
        best = h.t;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ map caching

  private cacheMap(frame: LocalFrame): void {
    const key = `${frame.origin.lat},${frame.origin.lon}`;
    if (key === this.frameKey) return;
    this.frameKey = key;
    const [bw, bs, be, bn] = MAP_BOX;
    const eps = 1e-7;
    const onEdge = (lon: number, lat: number) =>
      Math.abs(lon - bw) < eps || Math.abs(lon - be) < eps || Math.abs(lat - bs) < eps || Math.abs(lat - bn) < eps;
    const build = (ring: [number, number][], closed: boolean): RingCache => {
      const pts = new Float32Array(ring.length * 2);
      const edge = new Uint8Array(ring.length);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ring.forEach(([lon, lat], i) => {
        const [x, y] = frame.toXY(lat, lon);
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        const next = ring[i + 1];
        // Segment i→i+1 lies along the map box edge: fill it, but don't draw it as coastline.
        if (closed && next && onEdge(lon, lat) && onEdge(next[0], next[1]) && (lon === next[0] || lat === next[1])) edge[i] = 1;
      });
      return { pts, edge, minX, minY, maxX, maxY };
    };
    this.land = LAND.map((r) => build(r, true));
    this.park = EAST_COAST_PARK.map((r) => build(r, false));
    this.layerKey = '';
  }

  // ------------------------------------------------------------ static layer

  private drawLayer(s: ScopeInput): void {
    const st = s.settings;
    const key = [
      this.w, this.h, this.dpr, st.mode, Math.round(this.rot * 4) / 4, st.rangeKm, st.theme, st.units,
      st.observer.facing, st.observer.fov, s.activeRunways.join(','), this.frameKey,
    ].join('|');
    if (key === this.layerKey) return;
    this.layerKey = key;

    const p = s.palette;
    const ctx = this.layerCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    ctx.save();
    this.shape(ctx);
    const g = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.R);
    g.addColorStop(0, p.scopeCenter);
    g.addColorStop(1, p.scopeEdge);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();

    this.drawLand(ctx, p);
    this.drawFov(ctx, s);
    this.drawRunways(ctx, s);
    this.drawRings(ctx, s);
    this.drawLandmarks(ctx, s);
    ctx.restore();

    this.drawBearingScale(ctx, s);
    this.drawObserver(ctx, p);

    ctx.strokeStyle = p.ring;
    ctx.lineWidth = 1;
    this.shape(ctx);
    ctx.stroke();
  }

  private visibleBox(): [number, number, number, number] {
    const r = this.R / this.kmPx;
    return [-r, -r, r, r];
  }

  private tracePath(ctx: CanvasRenderingContext2D, ring: RingCache, close: boolean, skipEdges: boolean): void {
    const c = Math.cos(this.rot * DEG);
    const s = Math.sin(this.rot * DEG);
    const k = this.kmPx;
    let pen = false;
    const n = ring.pts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = ring.pts[i * 2]!;
      const y = ring.pts[i * 2 + 1]!;
      const sx = this.cx + (x * c - y * s) * k;
      const sy = this.cy - (x * s + y * c) * k;
      if (!pen) {
        ctx.moveTo(sx, sy);
        pen = true;
      } else ctx.lineTo(sx, sy);
      if (skipEdges && ring.edge[i]) pen = false;
    }
    if (close) ctx.closePath();
  }

  private drawLand(ctx: CanvasRenderingContext2D, p: Palette): void {
    const [x0, y0, x1, y1] = this.visibleBox();
    const visible = this.land.filter((r) => r.maxX >= x0 && r.minX <= x1 && r.maxY >= y0 && r.minY <= y1);
    ctx.beginPath();
    for (const r of visible) this.tracePath(ctx, r, true, false);
    ctx.fillStyle = p.land;
    ctx.fill('evenodd');
    ctx.beginPath();
    for (const r of visible) this.tracePath(ctx, r, false, true);
    ctx.strokeStyle = p.coast;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    for (const r of this.park) this.tracePath(ctx, r, false, false);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = p.park;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawFov(ctx: CanvasRenderingContext2D, s: ScopeInput): void {
    const o = s.settings.observer;
    if (o.fov >= 360) return;
    const p = s.palette;
    const a0 = (o.facing - o.fov / 2 - this.rot) * DEG - Math.PI / 2;
    const a1 = (o.facing + o.fov / 2 - this.rot) * DEG - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy);
    ctx.arc(this.cx, this.cy, this.R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = p.fov;
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = p.fovEdge;
    ctx.lineWidth = 1;
    for (const a of [a0, a1]) {
      ctx.beginPath();
      ctx.moveTo(this.cx, this.cy);
      ctx.lineTo(this.cx + Math.cos(a) * this.R, this.cy + Math.sin(a) * this.R);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const mid = (a0 + a1) / 2;
    ctx.fillStyle = p.fovEdge;
    ctx.font = `9px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOUR VIEW', this.cx + Math.cos(mid) * this.R * 0.93, this.cy + Math.sin(mid) * this.R * 0.93);
  }

  private drawRunways(ctx: CanvasRenderingContext2D, s: ScopeInput): void {
    const p = s.palette;
    // Approach centrelines for Changi: dashed, with a tick every nautical mile.
    for (const end of CHANGI_ENDS) {
      const active = s.activeRunways.includes(end.id);
      const line = approachLine(end, active ? 14 : 10);
      const [ax, ay] = this.project(...s.frame.toXY(line.from.lat, line.from.lon));
      const [bx, by] = this.project(...s.frame.toXY(line.to.lat, line.to.lon));
      ctx.strokeStyle = active ? p.centerlineActive : p.centerline;
      ctx.lineWidth = active ? 1.1 : 0.8;
      ctx.setLineDash(active ? [7, 4] : [3, 6]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      if (this.kmPx * KM_PER_NM > 7) {
        const ux = (bx - ax) / Math.hypot(bx - ax, by - ay);
        const uy = (by - ay) / Math.hypot(bx - ax, by - ay);
        for (const tick of line.ticks) {
          const [tx, ty] = this.project(...s.frame.toXY(tick.at.lat, tick.at.lon));
          const len = tick.nm % 5 === 0 ? 5 : 2.5;
          ctx.beginPath();
          ctx.moveTo(tx - uy * len, ty + ux * len);
          ctx.lineTo(tx + uy * len, ty - ux * len);
          ctx.stroke();
        }
      }
      if (active) {
        const [lx, ly] = this.project(...s.frame.toXY(line.ticks[4]!.at.lat, line.ticks[4]!.at.lon));
        ctx.fillStyle = p.centerlineActive;
        ctx.font = `9px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(end.id, lx + 6, ly);
      }
    }
    for (const r of RUNWAYS) {
      const [ax, ay] = this.project(...s.frame.toXY(r.a.lat, r.a.lon));
      const [bx, by] = this.project(...s.frame.toXY(r.b.lat, r.b.lon));
      ctx.strokeStyle = p.runway;
      ctx.lineWidth = Math.max(2, (r.widthM / 1000) * this.kmPx);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }

  private drawRings(ctx: CanvasRenderingContext2D, s: ScopeInput): void {
    const p = s.palette;
    const unitKm = s.settings.units === 'aviation' ? KM_PER_NM : 1;
    const unit = s.settings.units === 'aviation' ? 'NM' : 'KM';
    const range = s.settings.rangeKm / unitKm;
    const step = ringStep(range);
    ctx.strokeStyle = p.ring;
    ctx.lineWidth = 1;
    ctx.font = `9.5px ${FONT}`;
    ctx.fillStyle = p.ringText;
    ctx.textBaseline = 'middle';
    // Labels sit along a line off to one side, just inside each ring, so they never hide the forward view.
    const ppi = this.half >= 180;
    const labelAngle = (ppi ? -35 : this.half - 5) * DEG;
    ctx.textAlign = ppi ? 'left' : 'right';
    for (let d = step; d <= range + 1e-6; d += step) {
      const r = d * unitKm * this.kmPx;
      ctx.beginPath();
      if (ppi) ctx.arc(this.cx, this.cy, r, 0, TAU);
      else ctx.arc(this.cx, this.cy, r, -Math.PI / 2 - this.half * DEG, -Math.PI / 2 + this.half * DEG);
      ctx.setLineDash(d === range ? [] : [2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      const lx = this.cx + Math.sin(labelAngle) * (r - 4);
      const ly = this.cy - Math.cos(labelAngle) * (r - 4);
      const txt = `${Number.isInteger(d) ? d : d.toFixed(1)}${d + step > range + 1e-6 ? ` ${unit}` : ''}`;
      ctx.fillText(txt, lx + (ppi ? 2 : -2), ly + 6);
    }
  }

  private drawLandmarks(ctx: CanvasRenderingContext2D, s: ScopeInput): void {
    const p = s.palette;
    const range = s.settings.rangeKm;
    ctx.font = `9px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const lm of LANDMARKS) {
      if ((lm.minRange && range < lm.minRange) || (lm.maxRange && range > lm.maxRange)) continue;
      const [sx, sy] = this.project(...s.frame.toXY(lm.lat, lm.lon));
      if (!this.inside(sx, sy, -4)) continue;
      ctx.strokeStyle = p.landmark;
      ctx.fillStyle = p.landmark;
      ctx.lineWidth = 1;
      if (lm.kind === 'airport') {
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, TAU);
        ctx.stroke();
      } else if (lm.kind === 'landmark') {
        ctx.beginPath();
        ctx.moveTo(sx - 2.5, sy);
        ctx.lineTo(sx + 2.5, sy);
        ctx.moveTo(sx, sy - 2.5);
        ctx.lineTo(sx, sy + 2.5);
        ctx.stroke();
      }
      ctx.globalAlpha = lm.kind === 'place' ? 0.75 : 1;
      ctx.fillText(lm.label, sx + (lm.kind === 'place' ? -ctx.measureText(lm.label).width / 2 : 5), sy);
      ctx.globalAlpha = 1;
    }
  }

  private drawBearingScale(ctx: CanvasRenderingContext2D, s: ScopeInput): void {
    const p = s.palette;
    ctx.strokeStyle = p.tick;
    ctx.fillStyle = p.tick;
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let b = 0; b < 360; b += 5) {
      const a = (b - this.rot + 540) % 360 - 180;
      if (this.half < 180 && Math.abs(a) > this.half + 0.01) continue;
      const rad = a * DEG;
      const len = b % 30 === 0 ? 9 : b % 10 === 0 ? 6 : 3;
      const sin = Math.sin(rad);
      const cos = Math.cos(rad);
      ctx.beginPath();
      ctx.moveTo(this.cx + sin * this.R, this.cy - cos * this.R);
      ctx.lineTo(this.cx + sin * (this.R + len), this.cy - cos * (this.R + len));
      ctx.stroke();
      if (b % 30 === 0) {
        const cardinal = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[b];
        ctx.font = cardinal ? `bold 12px ${FONT}` : `9.5px ${FONT}`;
        ctx.fillText(cardinal ?? pad3(b), this.cx + sin * (this.R + 18), this.cy - cos * (this.R + 18));
      }
    }
  }

  private drawObserver(ctx: CanvasRenderingContext2D, p: Palette): void {
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 3.5, 0, TAU);
    ctx.moveTo(this.cx - 8, this.cy);
    ctx.lineTo(this.cx - 5, this.cy);
    ctx.moveTo(this.cx + 5, this.cy);
    ctx.lineTo(this.cx + 8, this.cy);
    ctx.moveTo(this.cx, this.cy - 8);
    ctx.lineTo(this.cx, this.cy - 5);
    ctx.stroke();
  }

  // ------------------------------------------------------------ sweep

  /** Sweep position (degrees clockwise from screen-up) and direction of travel. */
  private sweepAt(now: number, periodMs: number): { a: number; dir: 1 | -1 } {
    if (this.half >= 180) return { a: ((now % periodMs) / periodMs) * 360, dir: 1 };
    const phase = (now % (2 * periodMs)) / periodMs;
    const k = phase < 1 ? phase : 2 - phase;
    return { a: -this.half + 2 * this.half * k, dir: phase < 1 ? 1 : -1 };
  }

  private crossed(prev: number, cur: number, dir: 1 | -1, a: number): boolean {
    if (this.half >= 180) {
      const swept = (cur - prev + 360) % 360;
      const d = (a - prev + 360) % 360;
      return swept < 180 && d <= swept;
    }
    return dir === 1 ? a > prev && a <= cur : a < prev && a >= cur;
  }

  private drawBeam(ctx: CanvasRenderingContext2D, a: number, dir: 1 | -1, p: Palette): void {
    const trail = 42;
    const rad = a * DEG - Math.PI / 2;
    if (this.hasConic) {
      const start = dir === 1 ? rad - trail * DEG : rad;
      const g = ctx.createConicGradient(start, this.cx, this.cy);
      const f = trail / 360;
      const c = (al: number) => `rgba(${p.rgb},${al})`;
      if (dir === 1) {
        g.addColorStop(0, c(0));
        g.addColorStop(f * 0.6, c(0.05));
        g.addColorStop(f, c(0.28));
        g.addColorStop(Math.min(1, f + 0.001), c(0));
      } else {
        g.addColorStop(0, c(0.28));
        g.addColorStop(f * 0.4, c(0.05));
        g.addColorStop(f, c(0));
      }
      g.addColorStop(1, c(0));
      ctx.fillStyle = g;
      this.shape(ctx);
      ctx.fill();
    } else {
      for (let i = 0; i < 14; i++) {
        const a0 = rad - dir * (i + 1) * (trail / 14) * DEG;
        const a1 = rad - dir * i * (trail / 14) * DEG;
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.arc(this.cx, this.cy, this.R, Math.min(a0, a1), Math.max(a0, a1));
        ctx.closePath();
        ctx.fillStyle = `rgba(${p.rgb},${(0.2 * (1 - i / 14)) ** 1.5})`;
        ctx.fill();
      }
    }
    ctx.save();
    ctx.strokeStyle = `rgba(${p.rgb},0.95)`;
    ctx.shadowColor = `rgba(${p.rgb},0.9)`;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy);
    ctx.lineTo(this.cx + Math.cos(rad) * this.R, this.cy + Math.sin(rad) * this.R);
    ctx.stroke();
    ctx.restore();
  }

  private drawPaints(ctx: CanvasRenderingContext2D, now: number, periodMs: number): void {
    const tau = periodMs * 0.5;
    this.paints = this.paints.filter((pt) => now - pt.t < periodMs * 2.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const pt of this.paints) {
      const alpha = Math.exp(-(now - pt.t) / tau) * pt.strength;
      if (alpha < 0.02) continue;
      const [sx, sy] = this.project(pt.x, pt.y);
      const [ang, r] = this.polar(sx, sy);
      // A radar return is smeared along the arc by the beam width.
      const half = Math.max(1.3 * DEG, 3.5 / Math.max(r, 1));
      const base = ang * DEG - Math.PI / 2;
      ctx.strokeStyle = pt.color;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.lineWidth = 2.2 + pt.strength * 2;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, r, base - half, base + half);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ contacts

  private colorOf(t: Track, p: Palette, now: number): string {
    if (t.cls.emergency) return Math.floor(now / 400) % 2 ? p.emerg : p.selected;
    if (t.cls.mil) return p.mil;
    return p.kinds[t.cls.kind];
  }

  private drawSymbol(ctx: CanvasRenderingContext2D, t: Track, x: number, y: number, color: string): void {
    const k = 5.5;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (t.cls.kind === 'GND') {
      ctx.arc(x, y, 2, 0, TAU);
      ctx.fill();
      return;
    }
    if (t.cls.emergency) {
      ctx.rect(x - k, y - k, 2 * k, 2 * k);
      ctx.fill();
      return;
    }
    if (t.cls.heli) {
      ctx.arc(x, y, k, 0, TAU);
      ctx.moveTo(x - k, y);
      ctx.lineTo(x + k, y);
      ctx.moveTo(x, y - k);
      ctx.lineTo(x, y + k);
    } else if (t.cls.mil) {
      ctx.moveTo(x, y - k - 1);
      ctx.lineTo(x + k + 1, y);
      ctx.lineTo(x, y + k + 1);
      ctx.lineTo(x - k - 1, y);
      ctx.closePath();
    } else if (t.cls.kind === 'ARR') {
      ctx.moveTo(x - k, y - k * 0.7);
      ctx.lineTo(x + k, y - k * 0.7);
      ctx.lineTo(x, y + k);
      ctx.closePath();
    } else if (t.cls.kind === 'DEP') {
      ctx.moveTo(x - k, y + k * 0.7);
      ctx.lineTo(x + k, y + k * 0.7);
      ctx.lineTo(x, y - k);
      ctx.closePath();
    } else if (t.cls.kind === 'OVF') {
      ctx.rect(x - k * 0.8, y - k * 0.8, k * 1.6, k * 1.6);
    } else {
      ctx.arc(x, y, k * 0.85, 0, TAU);
    }
    ctx.stroke();
  }

  private textWidth(ctx: CanvasRenderingContext2D, s: string): number {
    let w = this.textWidths.get(s);
    if (w === undefined) {
      w = ctx.measureText(s).width;
      if (this.textWidths.size > 4000) this.textWidths.clear();
      this.textWidths.set(s, w);
    }
    return w;
  }

  private blockLines(t: Track, level: 'full' | 'compact' | 'min', now: number): string[] {
    const name = `${displayName(t)}${t.cls.special && !t.cls.emergency ? ' ★' : ''}`;
    if (t.cls.emergency) return [name, emergencyText(t.cls.emergency) ?? 'EMERG', `${blockAlt(t.altitude(now))} ${t.a.sq ?? ''}`];
    if (level === 'min') return [name];
    const alt = t.a.gnd ? 'GND' : blockAlt(t.altitude(now));
    const line2 = `${alt}${trendArrow(t.a.vr)} ${t.a.gs !== undefined ? pad3(t.a.gs) : '---'}`;
    if (level === 'compact') return [name, line2];
    const type = t.a.type ?? t.aircraft?.typeCode ?? '----';
    let route = '';
    if (t.leg?.plausible) {
      const code = (ap: { iata?: string; icao: string }) => ap.iata ?? ap.icao;
      if (t.cls.kind === 'ARR') route = code(t.leg.from);
      else if (t.cls.kind === 'DEP') route = code(t.leg.to);
      else route = `${code(t.leg.from)}›${code(t.leg.to)}`;
    }
    return [name, line2, `${type} ${route}`.trim()];
  }

  private layoutLabels(
    ctx: CanvasRenderingContext2D,
    items: { t: Track; x: number; y: number; lines: string[] }[],
  ): void {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const next = new Map<string, LabelBox>();
    const symbols = items.map((i) => ({ x: i.x - 7, y: i.y - 7, w: 14, h: 14 }));
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    for (const it of items) {
      const w = Math.max(...it.lines.map((l) => this.textWidth(ctx, l))) + 6;
      const h = it.lines.length * 12 + 3;
      const prev = this.labels.get(it.t.hex);
      let best: LabelBox | undefined;
      let bestScore = Infinity;
      SLOTS.forEach((slot, i) => {
        const [ox, oy] = slot(w, h);
        const box = { x: it.x + ox, y: it.y + oy, w, h };
        let score = i * 2 + (prev && prev.slot === i ? -25 : 0);
        for (const b of placed) score += overlap(box, b) * 4;
        for (const b of symbols) score += overlap(box, b) * 2;
        if (box.x < 2 || box.y < 2 || box.x + w > this.w - 2 || box.y + h > this.h - 2) score += 5000;
        if (score < bestScore) {
          bestScore = score;
          best = { x: ox, y: oy, w, h, slot: i };
        }
      });
      if (best) {
        next.set(it.t.hex, best);
        placed.push({ x: it.x + best.x, y: it.y + best.y, w, h });
      }
    }
    this.labels = next;
  }

  // ------------------------------------------------------------ frame

  render(s: ScopeInput): void {
    this.resize();
    this.layout(s);
    this.cacheMap(s.frame);
    this.drawLayer(s);

    const { now, palette: p, settings: st } = s;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Where is every contact on screen right now?
    const periodMs = st.sweepS * 1000;
    const sweep = this.sweepAt(now, periodMs);
    const prev = this.prevSweep;
    this.prevSweep = sweep.a;
    const items: { t: Track; x: number; y: number; px: number; py: number; ang: number }[] = [];
    for (const t of s.tracks) {
      const d = t.display(now);
      const [x, y] = this.project(d.x, d.y);
      if (!this.inside(x, y, 2)) continue;
      items.push({ t, x, y, px: d.x, py: d.y, ang: this.polar(x, y)[0] });
    }

    // The sweep leaves a glowing return where it crosses each contact (plus a little sea clutter).
    if (prev !== undefined) {
      for (const it of items) {
        if (!this.crossed(prev, sweep.a, sweep.dir, it.ang)) continue;
        const wake = lookupType(it.t.a.type)?.wake;
        const strength = wake === 'J' ? 1.25 : wake === 'H' ? 1.05 : wake === 'L' ? 0.6 : 0.85;
        this.paints.push({ x: it.px, y: it.py, t: now, strength, color: this.colorOf(it.t, p, now) });
      }
      if (st.crt) {
        const swept = this.half >= 180 ? (sweep.a - prev + 360) % 360 : Math.abs(sweep.a - prev);
        const n = swept < 90 ? Math.floor(swept * 0.35 + Math.random()) : 0;
        for (let i = 0; i < n; i++) {
          const r = (this.R * (0.05 + Math.random() ** 2 * 0.5)) / this.kmPx;
          const a = (this.rot + sweep.a - sweep.dir * Math.random() * swept) * DEG;
          this.paints.push({ x: Math.sin(a) * r, y: Math.cos(a) * r, t: now, strength: 0.18 + Math.random() * 0.2, color: `rgb(${p.rgb})` });
        }
      }
    }

    ctx.save();
    this.shape(ctx);
    ctx.clip();
    this.drawPaints(ctx, now, periodMs);
    this.drawBeam(ctx, sweep.a, sweep.dir, p);
    ctx.restore();

    this.drawContacts(ctx, s, items);
  }

  private drawContacts(
    ctx: CanvasRenderingContext2D,
    s: ScopeInput,
    items: { t: Track; x: number; y: number; px: number; py: number }[],
  ): void {
    const { now, palette: p, settings: st } = s;
    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    this.hits = items.map((i) => ({ t: i.t, x: i.x, y: i.y }));

    // Trails and leader lines first, so symbols and text sit on top.
    for (const { t, x, y } of items) {
      const color = this.colorOf(t, p, now);
      const stale = t.isStale(now);
      ctx.globalAlpha = stale ? 0.4 : 1;
      if (st.trailMin > 0 && t.history.length > 1) {
        const since = now - st.trailMin * 60_000;
        let lastT = Infinity;
        ctx.fillStyle = color;
        for (let i = t.history.length - 1; i >= 0; i--) {
          const h = t.history[i]!;
          if (h.t < since) break;
          if (lastT - h.t < 7000) continue;
          lastT = h.t;
          const [hx, hy] = this.project(h.x, h.y);
          const age = (now - h.t) / (st.trailMin * 60_000);
          ctx.globalAlpha = (stale ? 0.3 : 0.75) * (1 - age * 0.8);
          ctx.fillRect(hx - 1, hy - 1, 2, 2);
        }
        ctx.globalAlpha = stale ? 0.4 : 1;
      }
      if (st.leaderS > 0 && !t.a.gnd && t.a.gs) {
        const f = t.future(now, st.leaderS);
        const [fx, fy] = this.project(f.x, f.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(fx, fy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const sel = s.selected;
    if (sel) this.drawSelection(ctx, s, sel, items.find((i) => i.t === sel));

    for (const { t, x, y } of items) {
      ctx.globalAlpha = t.isStale(now) ? 0.45 : 1;
      this.drawSymbol(ctx, t, x, y, this.colorOf(t, p, now));
    }
    ctx.globalAlpha = 1;

    // Data blocks: fewer lines when the picture gets busy.
    if (st.labels === 'off') return;
    const busy = items.length > 45 ? 'min' : items.length > 25 || st.labels === 'compact' ? 'compact' : 'full';
    const byImportance = [...items].sort((a, b) => {
      if (a.t === sel) return -1;
      if (b.t === sel) return 1;
      return (a.t.sight?.groundKm ?? 0) - (b.t.sight?.groundKm ?? 0);
    });
    const withLines = byImportance.map((i) => ({
      ...i,
      lines: this.blockLines(i.t, i.t === sel ? 'full' : busy, now),
    }));
    if (now - this.lastLabelLayout > 250 || withLines.some((i) => !this.labels.has(i.t.hex))) {
      this.lastLabelLayout = now;
      this.layoutLabels(ctx, withLines);
    }
    for (const it of withLines) {
      const box = this.labels.get(it.t.hex);
      if (!box) continue;
      const color = it.t === sel ? p.selected : this.colorOf(it.t, p, now);
      const bx = it.x + box.x;
      const by = it.y + box.y;
      ctx.globalAlpha = it.t.isStale(now) ? 0.45 : 1;
      // Leader from the symbol to the nearest corner of the block.
      const cx = clamp(it.x, bx, bx + box.w);
      const cy = clamp(it.y, by, by + box.h);
      if (Math.hypot(cx - it.x, cy - it.y) > 8) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(it.x + ((cx - it.x) / Math.hypot(cx - it.x, cy - it.y)) * 7, it.y + ((cy - it.y) / Math.hypot(cx - it.x, cy - it.y)) * 7);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      // A dark halo keeps data blocks legible over coastlines and the sweep.
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      it.lines.forEach((line, i) => {
        ctx.strokeText(line, bx + 3, by + 2 + i * 12);
        ctx.fillText(line, bx + 3, by + 2 + i * 12);
      });
    }
    ctx.globalAlpha = 1;

    if (s.hovered && s.hovered !== sel) {
      const h = items.find((i) => i.t === s.hovered);
      if (h) {
        ctx.strokeStyle = p.selected;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 11, 0, TAU);
        ctx.stroke();
      }
    }
  }

  /** Target lock: brackets, electronic bearing line, variable range marker and predicted path. */
  private drawSelection(
    ctx: CanvasRenderingContext2D,
    s: ScopeInput,
    t: Track,
    it: { x: number; y: number; px: number; py: number } | undefined,
  ): void {
    const p = s.palette;
    const now = s.now;
    ctx.save();
    ctx.strokeStyle = p.selected;
    ctx.fillStyle = p.selected;

    // Predicted path for the next three minutes.
    if (!t.a.gnd && t.a.gs) {
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let sec = 0; sec <= 180; sec += 10) {
        const f = t.future(now, sec);
        const [fx, fy] = this.project(f.x, f.y);
        if (sec === 0) ctx.moveTo(fx, fy);
        else ctx.lineTo(fx, fy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!it) {
      ctx.restore();
      return;
    }
    const km = Math.hypot(it.px, it.py);
    // EBL and VRM.
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy);
    ctx.lineTo(it.x, it.y);
    ctx.stroke();
    ctx.beginPath();
    const r = km * this.kmPx;
    if (this.half >= 180) ctx.arc(this.cx, this.cy, r, 0, TAU);
    else ctx.arc(this.cx, this.cy, r, -Math.PI / 2 - this.half * DEG, -Math.PI / 2 + this.half * DEG);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Lock brackets, gently breathing.
    const k = 11 + Math.sin(now / 250) * 1.5;
    const l = 4;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const cx = it.x + sx * k;
      const cy = it.y + sy * k;
      ctx.moveTo(cx, cy - sy * l);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - sx * l, cy);
    }
    ctx.stroke();
    ctx.restore();
  }
}
