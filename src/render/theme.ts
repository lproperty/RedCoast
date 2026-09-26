/**
 * Display palettes. Canvas code reads these objects directly; the same values are pushed
 * into CSS custom properties so panels match the scope.
 */
import type { ThemeName } from '../app/settings.ts';
import type { Kind } from '../track/classify.ts';

export interface Palette {
  name: ThemeName;
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

export const PALETTES: Record<ThemeName, Palette> = {
  phosphor: {
    name: 'phosphor',
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
    runway: 'rgba(190,255,205,0.9)',
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
  amber: {
    name: 'amber',
    rgb: '255,176,0',
    bg: '#070400',
    scopeCenter: '#241600',
    scopeEdge: '#0a0600',
    land: 'rgba(255,176,0,0.07)',
    coast: 'rgba(255,190,60,0.5)',
    park: 'rgba(255,215,130,0.75)',
    ring: 'rgba(255,176,0,0.25)',
    ringText: 'rgba(255,200,90,0.62)',
    tick: 'rgba(255,190,70,0.6)',
    runway: 'rgba(255,230,170,0.9)',
    centerline: 'rgba(255,180,40,0.28)',
    centerlineActive: 'rgba(255,215,120,0.7)',
    fov: 'rgba(255,176,0,0.05)',
    fovEdge: 'rgba(255,196,80,0.45)',
    landmark: 'rgba(255,205,110,0.6)',
    text: '#ffd488',
    textDim: 'rgba(255,200,110,0.55)',
    kinds: {
      ARR: '#ffc233',
      DEP: '#ffe39a',
      OVF: '#b37a00',
      LOCAL: '#fff06a',
      UNK: '#d9a441',
      GND: '#7a5200',
    },
    mil: '#ff7a45',
    emerg: '#ff3030',
    selected: '#fff4dc',
    sky: '#120b00',
    skyHorizon: '#2e1d00',
    sun: '#fff1b3',
    moon: '#fff0cc',
  },
  night: {
    name: 'night',
    rgb: '255,50,40',
    bg: '#040000',
    scopeCenter: '#1a0200',
    scopeEdge: '#060000',
    land: 'rgba(255,40,30,0.06)',
    coast: 'rgba(255,60,45,0.4)',
    park: 'rgba(255,110,90,0.6)',
    ring: 'rgba(255,40,30,0.22)',
    ringText: 'rgba(255,80,60,0.55)',
    tick: 'rgba(255,70,55,0.5)',
    runway: 'rgba(255,120,100,0.75)',
    centerline: 'rgba(255,50,40,0.25)',
    centerlineActive: 'rgba(255,100,80,0.6)',
    fov: 'rgba(255,40,30,0.045)',
    fovEdge: 'rgba(255,70,55,0.4)',
    landmark: 'rgba(255,90,70,0.5)',
    text: '#ff7a66',
    textDim: 'rgba(255,90,70,0.5)',
    kinds: {
      ARR: '#ff5a4a',
      DEP: '#ff8f75',
      OVF: '#a3261d',
      LOCAL: '#ff7a3d',
      UNK: '#c9453a',
      GND: '#5c130e',
    },
    mil: '#ffae8f',
    emerg: '#ffffff',
    selected: '#ffd6cf',
    sky: '#0d0100',
    skyHorizon: '#260402',
    sun: '#ff9b80',
    moon: '#ffc2b5',
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}
