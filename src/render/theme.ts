/**
 * Display palettes. Canvas code reads these objects directly; the same values are pushed
 * into CSS custom properties so panels match the scope.
 */
import type { ThemeName } from '../app/settings.ts';
import type { Kind } from '../track/classify.ts';

export interface Palette {
  name: ThemeName;
  /** Font family for the canvases and the panels. */
  font: string;
  /** The military console look: glowing text, and scanlines if the CRT setting is on. */
  console: boolean;
  /** "r,g,b" of the main phosphor colour, for gradients with varying alpha. */
  rgb: string;
  bg: string;
  scopeCenter: string;
  scopeEdge: string;
  land: string;
  coast: string;
  park: string;
  ring: string;
  ringText: string;
  tick: string;
  runway: string;
  centerline: string;
  centerlineActive: string;
  fov: string;
  fovEdge: string;
  landmark: string;
  text: string;
  textDim: string;
  kinds: Record<Kind, string>;
  mil: string;
  emerg: string;
  selected: string;
  sky: string;
  skyHorizon: string;
  sun: string;
  moon: string;
}

const CONSOLE_FONT = '"B612 Mono", ui-monospace, Menlo, Consolas, monospace';
const SYSTEM_FONT = '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export const PALETTES: Record<ThemeName, Palette> = {
  phosphor: {
    name: 'phosphor',
    font: CONSOLE_FONT,
    console: true,
    rgb: '51,255,102',
    bg: '#010603',
    scopeCenter: '#04200e',
    scopeEdge: '#010903',
    land: 'rgba(60,255,120,0.075)',
    coast: 'rgba(80,255,130,0.5)',
    park: 'rgba(150,255,180,0.75)',
    ring: 'rgba(60,255,120,0.26)',
    ringText: 'rgba(110,255,150,0.62)',
    tick: 'rgba(100,255,145,0.6)',
    runway: 'rgba(120,255,160,0.6)',
    centerline: 'rgba(90,255,140,0.28)',
    centerlineActive: 'rgba(150,255,180,0.7)',
    fov: 'rgba(80,255,130,0.055)',
    fovEdge: 'rgba(110,255,150,0.45)',
    landmark: 'rgba(130,255,165,0.6)',
    text: '#a6ffbf',
    textDim: 'rgba(130,255,165,0.55)',
    kinds: {
      ARR: '#62ff8e',
      DEP: '#4ff2d0',
      OVF: '#2fae57',
      LOCAL: '#c2ff5c',
      UNK: '#7fcf8f',
      GND: '#3f7f52',
    },
    mil: '#ffb347',
    emerg: '#ff4d4d',
    selected: '#eafff0',
    sky: '#021208',
    skyHorizon: '#06301a',
    sun: '#ffe680',
    moon: '#d9ffe4',
  },
  // For everyone else: a quiet grey with the system font, arrivals soft blue and departures soft
  // orange, and none of the console's glow or scanlines.
  graphite: {
    name: 'graphite',
    font: SYSTEM_FONT,
    console: false,
    rgb: '200,205,212',
    bg: '#121315',
    scopeCenter: '#23262b',
    scopeEdge: '#141518',
    land: 'rgba(255,255,255,0.07)',
    coast: 'rgba(215,220,228,0.42)',
    park: 'rgba(230,233,238,0.65)',
    ring: 'rgba(210,215,222,0.2)',
    ringText: 'rgba(215,220,228,0.55)',
    tick: 'rgba(215,220,228,0.5)',
    runway: 'rgba(235,238,242,0.6)',
    centerline: 'rgba(210,215,222,0.22)',
    centerlineActive: 'rgba(240,242,246,0.7)',
    fov: 'rgba(255,255,255,0.045)',
    fovEdge: 'rgba(220,224,230,0.38)',
    landmark: 'rgba(220,224,230,0.55)',
    text: '#eceef1',
    textDim: 'rgba(215,220,228,0.58)',
    kinds: {
      ARR: '#8cc8ff',
      DEP: '#ffc27a',
      OVF: '#b4b9c2',
      LOCAL: '#c8b4ff',
      UNK: '#9aa0aa',
      GND: '#5d626b',
    },
    mil: '#f29bc4',
    emerg: '#ff5f57',
    selected: '#ffffff',
    sky: '#17191d',
    skyHorizon: '#383c44',
    sun: '#ffd27a',
    moon: '#f2f3f5',
  },
};

export function applyThemeToCss(p: Palette): void {
  const root = document.documentElement.style;
  root.setProperty('--rgb', p.rgb);
  root.setProperty('--bg', p.bg);
  root.setProperty('--text', p.text);
  root.setProperty('--text-dim', p.textDim);
  root.setProperty('--arr', p.kinds.ARR);
  root.setProperty('--dep', p.kinds.DEP);
  root.setProperty('--ovf', p.kinds.OVF);
  root.setProperty('--mil', p.mil);
  root.setProperty('--emerg', p.emerg);
  root.setProperty('--sel', p.selected);
  root.setProperty('--font', p.font);
  root.setProperty('--glow', p.console ? '0 0 6px rgba(var(--rgb), 0.55)' : 'none');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}
