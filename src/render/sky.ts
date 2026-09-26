/**
 * The sky view: what you see standing on the balcony. Horizontal axis is direction
 * (centred on where you face), vertical is height above the horizon. The elevation scale
 * is stretched near the horizon, where nearly all distant aircraft are.
 */
import type { MoonInfo, SkyBody } from '../geo/astro.ts';
import { compassPoint, DEG, signedDeg } from '../geo/geo.ts';
import { HORIZON_MARKS } from '../map/map.ts';
import { FIST_DEG, lookGuide, sightAt, type Observer } from '../track/sight.ts';
import type { Track } from '../track/track.ts';
import { displayName, fmtDist, pad3 } from '../ui/format.ts';
import type { Palette } from './theme.ts';
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
}

const FONT = '"B612 Mono", ui-monospace, Menlo, monospace';
const TAU = Math.PI * 2;
const EL_LINES = [5, 10, 20, 30, 45, 60];

export class SkyView {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
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
    return this.horizonY - this.plotH * Math.sqrt(Math.min(90, el) / 90);
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
    this.resize();
    const ctx = this.ctx;
    const p = s.palette;
    const o = s.observer;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this.span = Math.min(300, Math.max(120, o.fov + 50));
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
    ctx.font = `9px ${FONT}`;
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

    ctx.font = `8.5px ${FONT}`;
    ctx.textBaseline = 'bottom';
    const usedX: number[] = [];
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
    }

    // A fist at arm's length is about 10°: a ruler you always carry.
    const fistW = (plotW * FIST_DEG) / this.span;
    const fx = this.left + 8;
    const fy = this.top + 12;
    ctx.strokeStyle = p.textDim;
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

    this.drawBodies(ctx, s);
    this.drawAircraft(ctx, s);

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

  private drawBodies(ctx: CanvasRenderingContext2D, s: SkyInput): void {
    const p = s.palette;
    const within = (az: number) => Math.abs(signedDeg(az - this.center)) < this.span / 2;
    if (s.sun.el > -1 && within(s.sun.az)) {
      const x = this.x(s.sun.az);
      const y = this.y(s.sun.el);
      ctx.fillStyle = p.sun;
      ctx.strokeStyle = p.sun;
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
    }
    if (s.moon.el > -1 && within(s.moon.az)) {
      const x = this.x(s.moon.az);
      const y = this.y(s.moon.el);
      const r = 6;
      // The lit limb points at the Sun, wherever it is (even below the horizon).
      const sunY = this.horizonY - this.plotH * Math.sign(s.sun.el) * Math.sqrt(Math.min(90, Math.abs(s.sun.el)) / 90);
      const angle = Math.atan2(sunY - y, this.x(s.sun.az) - x);
      const k = 1 - 2 * s.moon.fraction;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.moon;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      // Terminator: bulges into the lit half for a crescent, into the dark half when gibbous.
      ctx.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
      ctx.fill();
      ctx.strokeStyle = p.moon;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawAircraft(ctx: CanvasRenderingContext2D, s: SkyInput): void {
    const p = s.palette;
    const now = s.now;
    const o = s.observer;
    this.hits = [];
    let offLeft = 0;
    let offRight = 0;
    const labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
    ctx.font = `10px ${FONT}`;
    ctx.textBaseline = 'middle';

    const items = s.tracks
      .filter((t) => !t.a.gnd)
      .map((t) => {
        const d = t.display(now);
        return { t, sight: sightAt(o, d.x, d.y, t.trueAltitude(now)) };
      })
      .filter(({ sight }) => sight.slantKm < 80 && sight.el > -2)
      .sort((a, b) => (a.t === s.selected ? -1 : b.t === s.selected ? 1 : a.sight.slantKm - b.sight.slantKm));

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

      // Last minute of motion across your sky.
      ctx.fillStyle = color;
      for (const h of t.history) {
        if (now - h.t > 90_000) continue;
        const hs = sightAt(o, h.x, h.y, h.alt ?? t.trueAltitude(now));
        ctx.globalAlpha = 0.35;
        ctx.fillRect(this.x(hs.az) - 1, this.y(hs.el) - 1, 2, 2);
      }
      ctx.globalAlpha = faint ? 0.45 : 1;

      const size = t.cls.heli ? 4 : 4.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
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
      ctx.stroke();
      this.hits.push({ t, x, y });

      const label = `${displayName(t)} ${fmtDist(sight.slantKm, s.units)}`;
      const w = ctx.measureText(label).width + 4;
      const candidates: [number, number][] = [
        [x + 8, y - 8],
        [x - 8 - w, y - 8],
        [x + 8, y + 8],
        [x - 8 - w, y + 8],
      ];
      const spot = candidates.find(([lx, ly]) => {
        const box = { x: lx, y: ly - 6, w, h: 12 };
        if (box.x < this.left || box.x + w > this.w - this.right || box.y < this.top) return false;
        return !labelBoxes.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
      });
      if (spot || t === s.selected) {
        const [lx, ly] = spot ?? candidates[0]!;
        labelBoxes.push({ x: lx, y: ly - 6, w, h: 12 });
        ctx.fillStyle = t === s.selected ? p.selected : color;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.textAlign = 'left';
        ctx.strokeText(label, lx + 2, ly);
        ctx.fillText(label, lx + 2, ly);
      }
      ctx.globalAlpha = 1;

      if (t === s.selected) {
        const k = 10 + Math.sin(now / 250) * 1.2;
        ctx.strokeStyle = p.selected;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          ctx.moveTo(x + sx * k, y + sy * (k - 4));
          ctx.lineTo(x + sx * k, y + sy * k);
          ctx.lineTo(x + sx * (k - 4), y + sy * k);
        }
        ctx.stroke();
      }
    }

    ctx.font = `10px ${FONT}`;
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
      ctx.font = `bold 11px ${FONT}`;
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
