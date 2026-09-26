import type { Units } from '../app/settings.ts';
import { iataFlight } from '../data/static/airlines.ts';
import { compassPoint, KM_PER_NM, normDeg } from '../geo/geo.ts';
import type { Track } from '../track/track.ts';

const int = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 });

export function fmtInt(n: number): string {
  return int.format(n);
}

/** Barometric altitude: flight level above the transition altitude (11,000 ft in Singapore), feet below. */
export function fmtAlt(ft: number | undefined, units: Units): string {
  if (ft === undefined) return '—';
  if (units === 'aviation' && ft >= 11000) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return units === 'metric' ? `${fmtInt(Math.round(ft * 0.3048))} m` : `${fmtInt(Math.round(ft / 25) * 25)} ft`;
}

export function fmtAltBoth(ft: number | undefined): string {
  if (ft === undefined) return '—';
  return `${fmtInt(Math.round(ft / 25) * 25)} ft · ${fmtInt(Math.round(ft * 0.3048))} m`;
}

export function fmtDist(km: number | undefined, units: Units): string {
  if (km === undefined) return '—';
  if (units === 'aviation') {
    const nm = km / KM_PER_NM;
    return `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm`;
  }
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function fmtSpeed(kt: number | undefined, units: Units): string {
  if (kt === undefined) return '—';
  return units === 'aviation' ? `${Math.round(kt)} kt` : `${Math.round(kt * 1.852)} km/h`;
}

export function fmtSpeedBoth(kt: number | undefined): string {
  if (kt === undefined) return '—';
  return `${Math.round(kt)} kt · ${Math.round(kt * 1.852)} km/h`;
}

export function fmtVr(fpm: number | undefined): string {
  if (fpm === undefined || Math.abs(fpm) < 150) return 'level';
  return `${fpm > 0 ? '↑ climbing' : '↓ descending'} ${fmtInt(Math.abs(Math.round(fpm / 50) * 50))} ft/min`;
}

export const pad3 = (deg: number) => String(Math.round(normDeg(deg)) % 360).padStart(3, '0');

export function fmtBrg(deg: number): string {
  return `${pad3(deg)}° ${compassPoint(deg)}`;
}

export function fmtDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m}m ${String(t % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtKm(km: number): string {
  return `${fmtInt(Math.round(km))} km`;
}

/** Regional-indicator flag emoji for an ISO country code ("SG" → 🇸🇬). */
export function flag(iso: string | undefined): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return '';
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Data-block altitude in hundreds of feet, as on an ATC scope: 4,500 ft → "045". */
export function blockAlt(ft: number | undefined): string {
  if (ft === undefined) return '---';
  return String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');
}

export function trendArrow(fpm: number | undefined): string {
  if (fpm === undefined || Math.abs(fpm) < 300) return ' ';
  return fpm > 0 ? '↑' : '↓';
}

/** A real IATA flight number: two-character airline designator plus 1–4 digits ("SQ321", "3K512"). */
const IATA_FLIGHT = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;

/** The name people know a flight by: IATA flight number if known, else the callsign, registration or hex. */
export function displayName(t: Track): string {
  const flight = t.route?.flight && IATA_FLIGHT.test(t.route.flight) ? t.route.flight : undefined;
  return flight ?? iataFlight(t.a.cs) ?? t.a.cs ?? t.a.reg ?? t.aircraft?.reg ?? t.hex.toUpperCase().replace('~', '');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const sgt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const utc = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function clockSgt(ms: number): string {
  return sgt.format(ms);
}

export function clockZulu(ms: number): string {
  return `${utc.format(ms).replace(/:/g, '')}Z`;
}
