/**
 * Reads a METAR, an airport's routine weather report, for what matters when looking for
 * aircraft: how far you can see, what's in the air (haze, rain…) and the cloud layers.
 *
 *   METAR WSSS 261500Z 11004KT 4000 HZ FEW018 FEW020CB BKN280 29/26 Q1012 NOSIG
 *                              ^^^^ ^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                        visibility (m) · haze · cloud cover and base (hundreds of ft)
 */

export type CloudCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';

export interface Metar {
  /** Prevailing visibility, km. 10 means "10 km or more" (9999 or CAVOK). */
  visKm?: number;
  /** Present weather at the airport, e.g. ["HZ"] or ["-SHRA"]. */
  weather: string[];
  /** Cloud layers, lowest first. "VV" is a sky hidden by fog or haze, with its vertical visibility. */
  clouds: { cover: CloudCover; baseFt: number }[];
}

const WEATHER =
  /^(?:[+-]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*$/;

export function parseMetar(raw: string): Metar {
  const m: Metar = { weather: [], clouds: [] };
  for (const tok of raw.trim().split(/\s+/)) {
    // What follows is a forecast or remarks, not the observation.
    if (tok === 'NOSIG' || tok === 'BECMG' || tok === 'TEMPO' || tok === 'RMK') break;
    let g: RegExpMatchArray | null;
    if (tok === 'CAVOK') {
      m.visKm = 10;
    } else if (m.visKm === undefined && (g = tok.match(/^(\d{4})$/))) {
      m.visKm = Number(g[1]) >= 9999 ? 10 : Number(g[1]) / 1000;
    } else if (m.visKm === undefined && (g = tok.match(/^(P?)(\d+)(?:\/(\d+))?SM$/))) {
      const miles = g[3] ? Number(g[2]) / Number(g[3]) : Number(g[2]);
      m.visKm = g[1] || miles * 1.609 >= 10 ? 10 : miles * 1.609;
    } else if ((g = tok.match(/^(FEW|SCT|BKN|OVC)(\d{3})/))) {
      m.clouds.push({ cover: g[1] as CloudCover, baseFt: Number(g[2]) * 100 });
    } else if ((g = tok.match(/^VV(\d{3})$/))) {
      m.clouds.push({ cover: 'VV', baseFt: Number(g[1]) * 100 });
    } else if (tok.length >= 2 && WEATHER.test(tok) && !/^[+-]$/.test(tok)) {
      m.weather.push(tok);
    }
  }
  m.clouds.sort((a, b) => a.baseFt - b.baseFt);
  return m;
}

/** The base of the lowest layer that hides what's above it: broken, overcast or obscured sky. */
export function ceilingFt(m: Metar): number | undefined {
  return m.clouds.find((c) => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV')?.baseFt;
}

const WORDS: [RegExp, string][] = [
  [/TS/, 'thunderstorms'],
  [/FG/, 'fog'],
  [/FU/, 'smoke'],
  [/HZ/, 'haze'],
  [/SH/, 'showers'],
  [/RA/, 'rain'],
  [/DZ/, 'drizzle'],
  [/BR/, 'mist'],
  [/DU|SA/, 'dust'],
];

/** What's in the air at the airport, in a word ("haze", "rain"…), ignoring weather only nearby (VC). */
export function weatherWord(codes: string[]): string | undefined {
  const here = codes.filter((c) => !c.startsWith('VC'));
  for (const [re, word] of WORDS) if (here.some((c) => re.test(c))) return word;
  return undefined;
}
