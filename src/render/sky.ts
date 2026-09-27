/**
 * The sky view: what you see standing on the balcony. Horizontal axis is direction
 * (centred on where you face), vertical is height above the horizon. The elevation scale
 * is stretched near the horizon, where nearly all distant aircraft are.
 */
import type { MoonInfo, SkyBody } from '../geo/astro.ts';
import { compassPoint, DEG, signedDeg } from '../geo/geo.ts';
import { HORIZON_MARKS } from '../map/map.ts';
import { CLEAR_AIR, FIST_DEG, lookGuide, sightAt, type Air, type Observer } from '../track/sight.ts';
import type { Track } from '../track/track.ts';
import { displayName, fmtDist, pad3 } from '../ui/format.ts';
import type { Palette } from './theme.ts';
import { whiten } from './scope.ts';
import type { LocalFrame } from '../geo/geo.ts';
import type { Units } from '../app/settings.ts';

export interface SkyInput {
  now: number;
  tracks: Track[];
  selected?: Track;
  observer: Observer;
  frame: LocalFrame;
  /** Direction at the centre of the strip: where you face, or where the phone points. */
  center: number;
  palette: Palette;
  units: Units;
  sun: SkyBody;
  moon: MoonInfo;
  /** Where the phone is pointing, in point mode. */
  pointer?: { az: number; el: number };
  /** How far you can see today: aircraft lost in haze or cloud are drawn faint. */
  air?: Air;
  /** How lit the radar's sweep has left an aircraft, when the radar shows it too. */
  light?: (t: Track) => { flash: number; glow: number } | undefined;
}

const TAU = Math.PI * 2;
const EL_LINES = [5, 10, 20, 30, 60];
/** Degrees: the smaller, the more of the strip goes to the low sky. */
const EL_K = 2;

/**
 * How far up the strip an elevation sits, 0..1. A log scale gives the low sky, where nearly all
 * aircraft are, most of the room: 5° is a third of the way up, 10° nearly half.
 */
function elFrac(el: number): number {
  return Math.log(1 + Math.min(90, el) / EL_K) / Math.log(1 + 90 / EL_K);
}
/** The Moon's darker "seas" as [x, y, radius] on a unit disc, so it reads as the Moon, not a ball. */
const MARIA: [number, number, number][] = [
  [-0.35, -0.3, 0.3],
  [-0.45, 0.15, 0.28],
  [0.2, -0.35, 0.2],
  [0.35, 0, 0.24],
  [-0.05, 0.45, 0.18],
  [0.68, -0.2, 0.12],
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** A "#rrggbb" colour with alpha. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class SkyView {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private font = '';
  private left = 34;
  private right = 10;
  private top = 10;
  private horizonY = 0;
  private plotH = 0;
  private span = 180;
  private center = 180;
  private hits: { t: Track; x: number; y: number }[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
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
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  private x(az: number): number {
    const plotW = this.w - this.left - this.right;
    return this.left + (signedDeg(az - this.center) / this.span + 0.5) * plotW;
  }

  private y(el: number): number {
    if (el < 0) return this.horizonY + Math.min(8, -el * 3);
    return this.horizonY - this.plotH * elFrac(el);
  }

  hit(sx: number, sy: number): Track | undefined {
    let best: Track | undefined;
    let bestD = 22;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      if (d < bestD) {
        bestD = d;
        best = h.t;
      }
    }
    return best;
  }

  render(s: SkyInput): void {
    this.font = s.palette.font;
    this.resize();
    const ctx = this.ctx;
    const p = s.palette;
    const o = s.observer;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // A little of the sky either side of the view; less on a phone, where width is precious.
    this.span = Math.min(300, Math.max(120, o.fov + (this.w < 560 ? 20 : 50)));
    this.center = s.center;
    this.horizonY = this.h - 22;
    this.plotH = this.horizonY - this.top;
    const plotW = this.w - this.left - this.right;

    const sky = ctx.createLinearGradient(0, this.top, 0, this.horizonY);
    sky.addColorStop(0, p.sky);
    sky.addColorStop(1, p.skyHorizon);
    ctx.fillStyle = sky;
    ctx.fillRect(this.left, this.top, plotW, this.plotH);

    // Outside the balcony's view: shaded.
    if (o.fov < 360) {
      const xa = this.x(o.facing - o.fov / 2);
      const xb = this.x(o.facing + o.fov / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      if (xa > this.left) ctx.fillRect(this.left, this.top, xa - this.left, this.plotH);
      if (xb < this.w - this.right) ctx.fillRect(xb, this.top, this.w - this.right - xb, this.plotH);
      ctx.strokeStyle = p.fovEdge;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      for (const xe of [xa, xb]) {
        if (xe <= this.left || xe >= this.w - this.right) continue;
        ctx.beginPath();
        ctx.moveTo(xe, this.top);
        ctx.lineTo(xe, this.horizonY);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Elevation grid.
    ctx.font = `9px ${this.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (const el of EL_LINES) {
      const y = this.y(el);
      ctx.strokeStyle = p.ring;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(this.left, y);
      ctx.lineTo(this.w - this.right, y);
      ctx.stroke();
      ctx.fillStyle = p.ringText;
      ctx.fillText(`${el}°`, this.left - 4, y);
    }
    ctx.setLineDash([]);

    // Horizon, direction ticks and landmarks.
    ctx.strokeStyle = p.coast;
    ctx.beginPath();
    ctx.moveTo(this.left, this.horizonY);
    ctx.lineTo(this.w - this.right, this.horizonY);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const start = Math.ceil((this.center - this.span / 2) / 10) * 10;
    for (let az = start; az <= this.center + this.span / 2; az += 10) {
      const x = this.x(az);
      const major = ((az % 30) + 30) % 30 === 0;
      ctx.strokeStyle = p.tick;
      ctx.beginPath();
      ctx.moveTo(x, this.horizonY);
      ctx.lineTo(x, this.horizonY + (major ? 5 : 3));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = p.tick;
        ctx.fillText(`${compassPoint(az)} ${pad3(az)}`, x, this.horizonY + 7);
      }
    }
    // "Straight ahead" marker.
    const ax = this.x(o.facing);
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.moveTo(ax, this.horizonY + 1);
    ctx.lineTo(ax - 4, this.horizonY + 7);
    ctx.lineTo(ax + 4, this.horizonY + 7);
    ctx.closePath();
    ctx.fill();

    ctx.font = `8.5px ${this.font}`;
    ctx.textBaseline = 'bottom';
    const usedX: number[] = [];
    const marks: Box[] = [];
    for (const m of HORIZON_MARKS) {
      const [mx, my] = s.frame.toXY(m.lat, m.lon);
      const az = (Math.atan2(mx, my) / DEG + 360) % 360;
      if (Math.abs(signedDeg(az - this.center)) > this.span / 2 - 3) continue;
      const x = this.x(az);
      if (usedX.some((u) => Math.abs(u - x) < 46)) continue;
      usedX.push(x);
      ctx.strokeStyle = p.landmark;
      ctx.beginPath();
      ctx.moveTo(x, this.horizonY);
      ctx.lineTo(x, this.horizonY - 4);
      ctx.stroke();
      ctx.fillStyle = p.landmark;
      ctx.fillText(m.label, x, this.horizonY - 5);
      const tw = ctx.measureText(m.label).width;
      marks.push({ x: x - tw / 2, y: this.horizonY - 15, w: tw, h: 11 });
    }

    const taken = [...this.drawBodies(ctx, s), ...marks];

    // A fist at arm's length is about 10°: a ruler you always carry. Top left, unless the Sun or
    // Moon is there.
    ctx.font = `8.5px ${this.font}`;
    const fistW = (plotW * FIST_DEG) / this.span;
    const rulerW = Math.max(fistW, ctx.measureText('1 FIST = 10°').width) + 8;
    const ruler = (x: number): Box => ({ x: x - 4, y: this.top + 4, w: rulerW, h: 24 });
    let fx = this.left + 8;
    if (taken.some((b) => overlaps(b, ruler(fx)))) fx = this.w - this.right - rulerW + 4;
    const fy = this.top + 12;
    taken.push(ruler(fx));
    ctx.strokeStyle = p.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 3);
    ctx.lineTo(fx, fy);
    ctx.lineTo(fx + fistW, fy);
    ctx.lineTo(fx + fistW, fy - 3);
    ctx.stroke();
    ctx.fillStyle = p.textDim;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('1 FIST = 10°', fx, fy + 3);

    this.drawAircraft(ctx, s, taken);

    if (s.pointer) {
      const x = this.x(s.pointer.az);
      const y = this.y(s.pointer.el);
      ctx.strokeStyle = p.selected;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, TAU);
      ctx.moveTo(x - 22, y);
      ctx.lineTo(x - 8, y);
      ctx.moveTo(x + 8, y);
      ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x, y - 8);
      ctx.moveTo(x, y + 8);
      ctx.lineTo(x, y + 22);
      ctx.stroke();
    }
  }

  /** The Sun and Moon. Returns the space they take, for the ruler and aircraft labels to avoid. */
  private drawBodies(ctx: CanvasRenderingContext2D, s: SkyInput): Box[] {
    const p = s.palette;
    const taken: Box[] = [];
    const within = (az: number) => Math.abs(signedDeg(az - this.center)) < this.span / 2;
    const take = (x: number, y: number, r: number) => taken.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    if (s.sun.el > -1 && within(s.sun.az)) {
      const x = this.x(s.sun.az);
      const y = this.y(s.sun.el);
      ctx.fillStyle = p.sun;
      ctx.strokeStyle = p.sun;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
        ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
        ctx.stroke();
      }
      take(x, y, 12);
    }
    if (s.moon.el > -1 && within(s.moon.az)) {
      const x = this.x(s.moon.az);
      const y = this.y(s.moon.el);
      const r = 6;
      // Moonlight: a soft halo, brighter the fuller the Moon.
      const halo = ctx.createRadialGradient(x, y, r, x, y, r * 3);
      halo.addColorStop(0, rgba(p.moon, 0.1 + 0.18 * s.moon.fraction));
      halo.addColorStop(1, rgba(p.moon, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, TAU);
      ctx.fill();
      // The lit limb points at the Sun, wherever it is (even below the horizon).
      const sunY = this.horizonY - this.plotH * Math.sign(s.sun.el) * elFrac(Math.abs(s.sun.el));
      const angle = Math.atan2(sunY - y, this.x(s.sun.az) - x);
      const k = 1 - 2 * s.moon.fraction;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      // Terminator: bulges into the lit half for a crescent, into the dark half when gibbous.
      ctx.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
      ctx.fillStyle = rgba(p.moon, 0.9);
      ctx.fill();
      // The seas, on the lit part only.
      ctx.clip();
      ctx.rotate(-angle);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (const [mx, my, mr] of MARIA) {
        ctx.beginPath();
        ctx.arc(mx * r, my * r, mr * r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      // The whole disc's rim, dark side included.
      ctx.strokeStyle = rgba(p.moon, 0.35);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      take(x, y, r + 2);
    }
    return taken;
  }

  /** An aircraft: a triangle pointing down for arrivals, up for departures, a ring otherwise. */
  private drawSymbol(ctx: CanvasRenderingContext2D, t: Track, x: number, y: number, color: string, alpha: number, flash: number): void {
    const lit = flash > 0.02;
    const size = (t.cls.heli ? 4 : 4.5) * (1 + 0.2 * flash);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha + flash);
    ctx.strokeStyle = lit ? whiten(color, 0.55 * flash) : color;
    ctx.lineWidth = 1.4 + 0.8 * flash;
    ctx.lineJoin = 'round';
    if (lit) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 * flash * this.dpr;
    }
    ctx.beginPath();
    if (t.cls.kind === 'ARR') {
      ctx.moveTo(x - size, y - size * 0.7);
      ctx.lineTo(x + size, y - size * 0.7);
      ctx.lineTo(x, y + size);
      ctx.closePath();
    } else if (t.cls.kind === 'DEP') {
      ctx.moveTo(x - size, y + size * 0.7);
      ctx.lineTo(x + size, y + size * 0.7);
      ctx.lineTo(x, y - size);
      ctx.closePath();
    } else {
      ctx.arc(x, y, size * 0.8, 0, TAU);
    }
    if (lit) {
      ctx.fillStyle = whiten(color, 0.3 * flash, 0.45 * flash);
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * An aircraft's flight code and distance, at the first spot beside it clear of `avoid`.
   * Returns false when there's none; the locked target's label goes in regardless.
   */
  private drawLabel(
    ctx: CanvasRenderingContext2D,
    s: SkyInput,
    it: { t: Track; km: number; x: number; y: number; color: string },
    alpha: number,
    avoid: Box[],
    taken: Box[],
  ): boolean {
    const { t, x, y } = it;
    const sel = t === s.selected;
    const label = `${displayName(t)} ${fmtDist(it.km, s.units)}`;
    const w = ctx.measureText(label).width + 4;
    const candidates: [number, number][] = [
      [x + 8, y - 8],
      [x - 8 - w, y - 8],
      [x + 8, y + 8],
      [x - 8 - w, y + 8],
      [x - w / 2, y - 14],
      [x + 8, y - 20],
      [x - 8 - w, y - 20],
    ];
    const spot = candidates.find(([lx, ly]) => {
      const box = { x: lx, y: ly - 6, w, h: 12 };
      if (box.x < this.left || box.x + w > this.w - this.right || box.y < this.top) return false;
      if (box.y + 12 > this.horizonY + 2) return false;
      return !avoid.some((b) => overlaps(box, b));
    });
    if (!spot && !sel) return false;
    const [lx, ly] = spot ?? candidates[0]!;
    taken.push({ x: lx, y: ly - 6, w, h: 12 });
    ctx.globalAlpha = sel ? 1 : alpha;
    ctx.fillStyle = sel ? s.palette.selected : it.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'left';
    ctx.strokeText(label, lx + 2, ly);
    ctx.fillText(label, lx + 2, ly);
    ctx.globalAlpha = 1;
    return true;
  }

  private drawAircraft(ctx: CanvasRenderingContext2D, s: SkyInput, taken: Box[]): void {
    const p = s.palette;
    const now = s.now;
    const o = s.observer;
    this.hits = [];
    let offLeft = 0;
    let offRight = 0;
    const labelBoxes: Box[] = [...taken];
    ctx.font = `10px ${this.font}`;
    ctx.textBaseline = 'middle';

    const items = s.tracks
      .filter((t) => !t.a.gnd)
      .map((t) => {
        const d = t.display(now);
        return { t, sight: sightAt(o, d.x, d.y, t.trueAltitude(now), s.air ?? CLEAR_AIR) };
      })
      .filter(({ sight }) => sight.slantKm < 80 && sight.el > -2)
      .sort((a, b) => (a.t === s.selected ? -1 : b.t === s.selected ? 1 : a.sight.slantKm - b.sight.slantKm));

    // Symbols first, each claiming its spot, so no label ends up on top of another aircraft.
    const shown: {
      t: Track;
      km: number;
      x: number;
      y: number;
      faint: boolean;
      color: string;
      text: number;
      swept: number;
    }[] = [];
    const symbols: Box[] = [];
    for (const { t, sight } of items) {
      const rel = signedDeg(sight.az - this.center);
      if (Math.abs(rel) > this.span / 2) {
        if (sight.slantKm < 40) rel < 0 ? offLeft++ : offRight++;
        continue;
      }
      const color = t.cls.emergency ? p.emerg : t.cls.mil ? p.mil : p.kinds[t.cls.kind];
      const x = this.x(sight.az);
      const y = this.y(sight.el);
      const faint = !sight.visible;
      // Pulse with the radar: flare as its sweep passes, then fade until the next pass.
      const light = s.light?.(t);
      const keep = t === s.selected || t.cls.emergency;
      const flash = light?.flash ?? 0;
      const glow = light && !keep ? light.glow : 1;
      const body = (faint ? 0.45 : 1) * (0.45 + 0.55 * glow);
      this.drawSymbol(ctx, t, x, y, color, body, flash);
      symbols.push({ x: x - 6, y: y - 6, w: 12, h: 12 });
      this.hits.push({ t, x, y });
      const text = (faint ? 0.5 : 1) * (0.75 + 0.25 * glow);
      shown.push({ t, km: sight.slantKm, x, y, faint, color, text, swept: light && !keep ? light.glow : 0 });
    }

    // Then labels, nearest first, where they fit. A phone has room for a few: aircraft lost in
    // the haze go unlabelled there, and so do the far ones once the strip gets busy.
    const narrow = this.w < 560;
    let labelled = 0;
    const later: typeof shown = [];
    for (const it of shown) {
      if (it.t !== s.selected && narrow && (it.faint || labelled >= 6)) later.push(it);
      else if (this.drawLabel(ctx, s, it, it.text, [...labelBoxes, ...symbols], labelBoxes)) labelled++;
      else if (it.t !== s.selected) later.push(it);
    }
    // The rest get a label while the radar's sweep has them lit, fading out with them, so the
    // strip comes alive as the beam goes round. Over another aircraft's symbol, if need be.
    for (const it of later) {
      const fade = Math.min(1, (it.swept - 0.3) / 0.3);
      if (fade <= 0) continue;
      this.drawLabel(ctx, s, it, it.text * fade, [...labelBoxes, ...symbols], labelBoxes) ||
        this.drawLabel(ctx, s, it, it.text * fade, labelBoxes, labelBoxes);
    }

    const sel = shown.find((it) => it.t === s.selected);
    if (sel) {
      const k = 10 + Math.sin(now / 250) * 1.2;
      ctx.strokeStyle = p.selected;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(sel.x + sx * k, sel.y + sy * (k - 4));
        ctx.lineTo(sel.x + sx * k, sel.y + sy * k);
        ctx.lineTo(sel.x + sx * (k - 4), sel.y + sy * k);
      }
      ctx.stroke();
    }

    ctx.font = `10px ${this.font}`;
    ctx.fillStyle = p.textDim;
    ctx.textBaseline = 'middle';
    const midY = this.top + this.plotH * 0.55;
    if (offLeft) {
      ctx.textAlign = 'left';
      ctx.fillText(`◀ ${offLeft}`, this.left + 4, midY);
    }
    if (offRight) {
      ctx.textAlign = 'right';
      ctx.fillText(`${offRight} ▶`, this.w - this.right - 4, midY);
    }

    // Where to look for the locked target, in plain words.
    if (s.selected && !s.selected.a.gnd) {
      const d = s.selected.display(now);
      const sight = sightAt(o, d.x, d.y, s.selected.trueAltitude(now));
      const text = `${displayName(s.selected)}: ${lookGuide(sight).text}`;
      ctx.font = `bold 11px ${this.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const w = ctx.measureText(text).width + 12;
      const cx = this.left + (this.w - this.left - this.right) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(cx - w / 2, this.top + 1, w, 16);
      ctx.fillStyle = p.selected;
      ctx.fillText(text, cx, this.top + 3);
    }
  }
}
