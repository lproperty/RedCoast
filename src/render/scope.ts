/**
 * The radar display.
 *
 *  PPI     classic round scope, observer at the centre, rotating sweep.
 *  SECTOR  forward-looking fan, observer at the bottom, sweep scanning side to side:
 *          all the pixels go to what's in front of the balcony.
 *
 * Layers: a cached "static" canvas (coastline, runways, rings, bearings), then per frame
 * the sea clutter left by the sweep, the sweep beam, and the live symbols and data blocks.
 * Contacts are drawn at their smoothed, dead-reckoned positions every frame. Like a
 * phosphor screen, the sweep lights each contact up as it passes and it fades until the
 * next pass.
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
  /** Room the HTML controls take in the corners of the scope, which the sector display keeps clear of. */
  corners?: Corners;
}

/** [width, height] of the controls in each corner of the canvas, measured from that corner (CSS px). */
export interface Corners {
  tl: [number, number];
  tr: [number, number];
  bl: [number, number];
  br: [number, number];
}

const NO_CORNERS: Corners = { tl: [0, 0], tr: [0, 0], bl: [0, 0], br: [0, 0] };

interface Paint {
  x: number;
  y: number;
  t: number;
  strength: number;
}

interface RingCache {
  pts: Float32Array;
  edge: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A contact on screen this frame. */
interface Item {
  t: Track;
  x: number;
  y: number;
  /** Position in local km. */
  px: number;
  py: number;
  /** Screen position of the end of its leader line, if it has one. */
  lead?: [number, number];
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

/**
 * Did the sweep pass screen angle `a` (degrees clockwise from up, any range) between two
 * frames? A full circle turns clockwise through 0..360; a sector swings between ±half.
 */
export function sweptPast(prev: number, cur: number, dir: 1 | -1, a: number, fullCircle: boolean): boolean {
  if (fullCircle) {
    const swept = (cur - prev + 360) % 360;
    const d = (((a - prev) % 360) + 360) % 360;
    return swept < 180 && d > 0 && d <= swept;
  }
  return dir === 1 ? a > prev && a <= cur : a < prev && a >= cur;
}

/** Bearing labels are centred this far outside the rim; their text reaches about 7 px further. */
const LABEL_OUT = 18;

/**
 * Sector (fan) geometry for a canvas `w` px wide: the fan's half-angle, the largest radius
 * the width allows, and the room a fan of radius R needs above and below its apex so that
 * the bearing labels and the fan itself stay clear of the controls in the corners.
 */
export function sectorGeometry(w: number, fov: number, corners: Corners = NO_CORNERS) {
  const half = clamp(fov / 2 + 12, 40, 90);
  const sin = Math.sin(half * DEG);
  const cos = half >= 89.9 ? 0 : Math.cos(half * DEG);
  const cx = w / 2;
  const gap = 4;
  const maxR = Math.max(40, (cx - 28) / (half >= 89.9 ? 1 : sin));
  const above = (R: number): number => {
    const ring = R + LABEL_OUT + 7;
    let need = ring + 2;
    for (const [bw, bh] of [corners.tl, corners.tr]) {
      if (bw <= 0 || bh <= 0) continue;
      // The label ring is highest over the box where it meets the box's inner edge
      // (less half a label's width), if it reaches that far round.
      const d = Math.max(0, cx - bw - gap - 10);
      if (d >= ring * Math.sin(Math.min(half + 3, 90) * DEG)) continue;
      need = Math.max(need, bh + gap + Math.sqrt(ring * ring - d * d));
    }
    return need;
  };
  const below = (R: number): number => {
    let need = 12;
    for (const [bw, bh] of [corners.bl, corners.br]) {
      if (bw <= 0 || bh <= 0) continue;
      const d = cx - bw - gap;
      // Lowest point of the display over the box (+ below the apex, − above it): the observer
      // mark, else the fan's lower edge at the box's inner edge, and the labels at the fan's ends.
      let low = d < 10 ? 10 : (-d * cos) / sin;
      if ((R + LABEL_OUT) * sin + 12 >= d) low = Math.max(low, 7 - (R + LABEL_OUT) * cos);
      need = Math.max(need, low + gap + bh);
    }
    return need;
  };
  return { half, maxR, above, below, height: (R: number) => above(R) + below(R) };
}

/** Brightness a contact fades to between sweeps: symbol and leader line, and data block. */
const BODY_FLOOR = 0.45;
const TEXT_FLOOR = 0.8;

const rgbCache = new Map<string, [number, number, number]>();

/** A "#rrggbb" colour blended towards white by f (0..1). */
function whiten(color: string, f: number): string {
  let c = rgbCache.get(color);
  if (!c) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
    const n = parseInt(color.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(color, c);
  }
  const m = (v: number) => Math.round(v + (255 - v) * f);
  return `rgb(${m(c[0])},${m(c[1])},${m(c[2])})`;
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
  /** Phone-sized display: slightly larger text and symbols. */
  private small = false;
  private corners = NO_CORNERS;
  private frameKey = '';
  private land: RingCache[] = [];
  private park: RingCache[] = [];
  private paints: Paint[] = [];
  /** When the sweep last passed each contact, by hex. */
  private readonly litAt = new Map<string, number>();
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
    const small = this.w < 560;
    if (small !== this.small) this.textWidths.clear();
    this.small = small;
    this.corners = s.corners ?? NO_CORNERS;
    this.rot = st.mode === 'sector' || st.orientation === 'facing' ? s.heading : 0;
    if (st.mode === 'ppi') {
      this.half = 180;
      this.cx = this.w / 2;
      this.cy = this.h / 2;
      this.R = Math.max(40, Math.min(this.w, this.h) / 2 - 30);
    } else {
      const geo = sectorGeometry(this.w, st.observer.fov, this.corners);
      let R = geo.maxR;
      if (geo.height(R) > this.h) {
        // Not tall enough for the width: the largest fan that fits the height.
        let lo = 40;
        let hi = R;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          if (geo.height(mid) <= this.h) lo = mid;
          else hi = mid;
        }
        R = lo;
      }
      this.half = geo.half;
      this.R = R;
      this.cx = this.w / 2;
      this.cy = geo.above(R) + Math.max(0, this.h - geo.height(R)) / 2;
    }
    this.kmPx = this.R / st.rangeKm;
  }

  /**
   * The canvas height a sector display wants at the canvas's current width: just the fan,
   * its labels and the corner controls, with no blank space. Undefined in PPI mode.
   */
  fitHeight(settings: Settings, corners?: Corners): number | undefined {
    if (settings.mode !== 'sector') return undefined;
    const geo = sectorGeometry(this.canvas.clientWidth, settings.observer.fov, corners);
    return Math.ceil(geo.height(geo.maxR));
  }

  /** Font size for canvas text: a size up on phones. */
  private fs(px: number): number {
    return this.small ? px + 1 : px;
  }

  /** Line spacing of the data blocks. */
  private get lineH(): number {
    return this.small ? 13 : 12;
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
      this.cx.toFixed(1), this.cy.toFixed(1), this.R.toFixed(1),
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
    ctx.font = `${this.fs(9)}px ${FONT}`;
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
        ctx.font = `${this.fs(9)}px ${FONT}`;
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
    ctx.font = `${this.fs(9.5)}px ${FONT}`;
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
    ctx.font = `${this.fs(9)}px ${FONT}`;
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
        ctx.font = cardinal ? `bold ${this.fs(12)}px ${FONT}` : `${this.fs(9.5)}px ${FONT}`;
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

  private drawPaints(ctx: CanvasRenderingContext2D, now: number, periodMs: number, p: Palette): void {
    const tau = periodMs * 0.5;
    this.paints = this.paints.filter((pt) => now - pt.t < periodMs * 2.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgb(${p.rgb})`;
    for (const pt of this.paints) {
      const alpha = Math.exp(-(now - pt.t) / tau) * pt.strength;
      if (alpha < 0.02) continue;
      const [sx, sy] = this.project(pt.x, pt.y);
      const [ang, r] = this.polar(sx, sy);
      // A radar return is smeared along the arc by the beam width.
      const half = Math.max(1.3 * DEG, 3.5 / Math.max(r, 1));
      const base = ang * DEG - Math.PI / 2;
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

  /**
   * How lit a contact is, 0..1: `flash` flares as the sweep passes and dies within a fraction
   * of a second; `glow` is the afterglow, which fades over most of a revolution so that the
   * next pass stands out.
   */
  private lit(t: Track, now: number, periodMs: number): { flash: number; glow: number } {
    const at = this.litAt.get(t.hex);
    if (at === undefined) return { flash: 0, glow: 0 };
    const dt = Math.max(0, now - at);
    return { flash: Math.exp(-dt / Math.min(450, periodMs * 0.1)), glow: Math.exp(-dt / (periodMs * 0.45)) };
  }

  /** The contact's symbol. When the sweep has just lit it, it flares: whiter, bolder, filled and glowing. */
  private drawSymbol(ctx: CanvasRenderingContext2D, t: Track, x: number, y: number, color: string, flash = 0): void {
    const lit = flash > 0.02;
    const k = (this.small ? 6.2 : 5.5) * (1 + 0.15 * flash);
    ctx.strokeStyle = lit ? whiten(color, 0.55 * flash) : color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = (this.small ? 1.7 : 1.5) + 0.7 * flash;
    if (lit) {
      // Heavier aircraft make a bigger return.
      const wake = lookupType(t.a.type)?.wake;
      ctx.shadowColor = color;
      ctx.shadowBlur = (wake === 'J' ? 16 : wake === 'H' ? 13 : wake === 'L' ? 7 : 10) * flash * this.dpr;
    }
    ctx.beginPath();
    if (t.cls.kind === 'GND') {
      ctx.arc(x, y, 2, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }
    if (t.cls.emergency) {
      ctx.rect(x - k, y - k, 2 * k, 2 * k);
      ctx.fill();
      ctx.shadowBlur = 0;
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
    if (lit) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * 0.5 * flash;
      ctx.fill();
      ctx.globalAlpha = a;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
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
    const { tl, tr, bl, br } = this.corners;
    const controls = [
      { x: 0, y: 0, w: tl[0], h: tl[1] },
      { x: this.w - tr[0], y: 0, w: tr[0], h: tr[1] },
      { x: 0, y: this.h - bl[1], w: bl[0], h: bl[1] },
      { x: this.w - br[0], y: this.h - br[1], w: br[0], h: br[1] },
    ];
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    for (const it of items) {
      const w = Math.max(...it.lines.map((l) => this.textWidth(ctx, l))) + 6;
      const h = it.lines.length * this.lineH + 3;
      const prev = this.labels.get(it.t.hex);
      let best: LabelBox | undefined;
      let bestScore = Infinity;
      SLOTS.forEach((slot, i) => {
        const [ox, oy] = slot(w, h);
        const box = { x: it.x + ox, y: it.y + oy, w, h };
        let score = i * 2 + (prev && prev.slot === i ? -25 : 0);
        for (const b of placed) score += overlap(box, b) * 4;
        for (const b of symbols) score += overlap(box, b) * 2;
        for (const b of controls) score += overlap(box, b) * 8;
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
    const items: Item[] = [];
    for (const t of s.tracks) {
      const d = t.display(now);
      const [x, y] = this.project(d.x, d.y);
      if (!this.inside(x, y, 2)) continue;
      let lead: [number, number] | undefined;
      if (st.leaderS > 0 && !t.a.gnd && t.a.gs) {
        const f = t.future(now, st.leaderS);
        lead = this.project(f.x, f.y);
      }
      items.push({ t, x, y, px: d.x, py: d.y, lead });
    }

    // The sweep lights up each contact as it reaches it (its symbol, or the end of its leader
    // line if that comes first), and leaves a little sea clutter.
    if (prev !== undefined) {
      const full = this.half >= 180;
      for (const it of items) {
        const hit =
          sweptPast(prev, sweep.a, sweep.dir, this.polar(it.x, it.y)[0], full) ||
          (it.lead !== undefined && sweptPast(prev, sweep.a, sweep.dir, this.polar(...it.lead)[0], full));
        const last = this.litAt.get(it.t.hex);
        if (hit && (last === undefined || now - last > periodMs * 0.3)) this.litAt.set(it.t.hex, now);
      }
      if (st.clutter) {
        // Fewer echoes on a smaller scope, so a phone looks as sparse as a desktop.
        const density = Math.min(1, (this.R / 400) ** 2);
        const swept = this.half >= 180 ? (sweep.a - prev + 360) % 360 : Math.abs(sweep.a - prev);
        const n = swept < 90 ? Math.floor(swept * 0.35 * density + Math.random()) : 0;
        for (let i = 0; i < n; i++) {
          const r = (this.R * (0.05 + Math.random() ** 2 * 0.5)) / this.kmPx;
          const a = (this.rot + sweep.a - sweep.dir * Math.random() * swept) * DEG;
          this.paints.push({ x: Math.sin(a) * r, y: Math.cos(a) * r, t: now, strength: 0.18 + Math.random() * 0.2 });
        }
      }
    }
    if (this.litAt.size > 400) {
      for (const [hex, at] of this.litAt) if (now - at > periodMs * 4) this.litAt.delete(hex);
    }

    ctx.save();
    this.shape(ctx);
    ctx.clip();
    this.drawPaints(ctx, now, periodMs, p);
    this.drawBeam(ctx, sweep.a, sweep.dir, p);
    ctx.restore();

    this.drawContacts(ctx, s, items);
  }

  private drawContacts(ctx: CanvasRenderingContext2D, s: ScopeInput, items: Item[]): void {
    const { now, palette: p, settings: st } = s;
    const sel = s.selected;
    this.hits = items.map((i) => ({ t: i.t, x: i.x, y: i.y }));

    // How brightly each contact shows: it flares as the sweep passes, then fades until the
    // next pass. The locked target and emergencies stay bright; stale contacts stay dim.
    const shown = items.map((it) => {
      const { flash, glow } = this.lit(it.t, now, st.sweepS * 1000);
      const keep = it.t.cls.emergency ? 1 : it.t === sel ? 0.85 : 0;
      const stale = it.t.isStale(now) ? 0.45 : 1;
      return {
        ...it,
        color: this.colorOf(it.t, p, now),
        flash: flash * stale,
        body: stale * Math.max(keep, BODY_FLOOR + (1 - BODY_FLOOR) * glow),
        text: stale * Math.max(keep, TEXT_FLOOR + (1 - TEXT_FLOOR) * glow),
      };
    });

    // Trails and leader lines first, so symbols and text sit on top.
    for (const c of shown) {
      const { t, x, y, color } = c;
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
          ctx.globalAlpha = c.body * 0.75 * (1 - age * 0.8);
          ctx.fillRect(hx - 1, hy - 1, 2, 2);
        }
      }
      // The leader line, where it will be in a minute, flares with the symbol.
      if (c.lead) {
        const [fx, fy] = c.lead;
        const lit = c.flash > 0.02;
        ctx.globalAlpha = c.body;
        ctx.strokeStyle = lit ? whiten(color, 0.5 * c.flash) : color;
        ctx.lineWidth = (this.small ? 1.2 : 1) + 0.9 * c.flash;
        if (lit) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8 * c.flash * this.dpr;
        }
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;

    if (sel) this.drawSelection(ctx, s, sel, items.find((i) => i.t === sel));

    for (const c of shown) {
      ctx.globalAlpha = c.body;
      this.drawSymbol(ctx, c.t, c.x, c.y, c.color, c.flash);
    }
    ctx.globalAlpha = 1;

    // Data blocks: fewer lines when the picture gets busy for the size of the display.
    if (st.labels === 'off') return;
    ctx.font = `${this.fs(11)}px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const room = (this.half >= 180 ? Math.PI : this.half * DEG) * this.R * this.R;
    const n = items.length;
    const busy =
      n > Math.min(45, room / 3300) ? 'min' : n > Math.min(25, room / 6500) || st.labels === 'compact' ? 'compact' : 'full';
    const byImportance = [...shown].sort((a, b) => {
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
    const lh = this.lineH;
    for (const it of withLines) {
      const box = this.labels.get(it.t.hex);
      if (!box) continue;
      const color = it.t === sel ? p.selected : it.color;
      const bx = it.x + box.x;
      const by = it.y + box.y;
      ctx.globalAlpha = it.text;
      // Leader from the symbol to the nearest corner of the block.
      const cx = clamp(it.x, bx, bx + box.w);
      const cy = clamp(it.y, by, by + box.h);
      const d = Math.hypot(cx - it.x, cy - it.y);
      if (d > 8) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(it.x + ((cx - it.x) / d) * 7, it.y + ((cy - it.y) / d) * 7);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      // A dark halo keeps data blocks legible over coastlines and the sweep.
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = this.small ? 3.5 : 3;
      ctx.lineJoin = 'round';
      it.lines.forEach((line, i) => ctx.strokeText(line, bx + 3, by + 2 + i * lh));
      const lit = it.flash > 0.05;
      ctx.fillStyle = lit ? whiten(color, 0.45 * it.flash) : color;
      if (lit) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 * it.flash * this.dpr;
      }
      it.lines.forEach((line, i) => ctx.fillText(line, bx + 3, by + 2 + i * lh));
      ctx.shadowBlur = 0;
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
