/**
 * The target panel: everything known about the locked contact. Where to look for it from
 * the balcony, where it's flying, what it is, and the live telemetry.
 * All text from external services is escaped before it touches the DOM.
 */
import type { Units } from '../app/settings.ts';
import { AIRLINES, splitCallsign } from '../data/static/airlines.ts';
import { lookupType, prettyDesc } from '../data/static/aircraftTypes.ts';
import { compassName, M_PER_FT, signedDeg } from '../geo/geo.ts';
import { emergencyText } from '../track/classify.ts';
import { legDistances, legTimes } from '../track/eta.ts';
import { lookGuide, moonCompare, type Conditions, type Observer } from '../track/sight.ts';
import type { Track } from '../track/track.ts';
import {
  displayName,
  escapeHtml as esc,
  flag,
  fmtAlt,
  fmtAltBoth,
  fmtBrg,
  fmtDist,
  fmtDuration,
  fmtInt,
  fmtKm,
  fmtSpeedBoth,
  fmtVr,
  pad3,
  timeSgt,
} from './format.ts';

export interface DetailContext {
  now: number;
  units: Units;
  observer: Observer;
  sunEl: number;
  /** How far you can see today. */
  seeing: Conditions;
}

const KIND_TEXT: Record<string, string> = {
  ARR: 'ARRIVING',
  DEP: 'DEPARTED',
  OVF: 'OVERFLIGHT',
  LOCAL: 'LOCAL FLIGHT',
  UNK: 'UNIDENTIFIED',
  GND: 'ON GROUND',
};

const AIRPORT_SHORT: Record<string, string> = {
  WSSS: 'CHANGI',
  WSAP: 'PAYA LEBAR',
  WSSL: 'SELETAR',
  WIDD: 'BATAM',
  WMKJ: 'SENAI',
};

const PHASE_TEXT: Record<string, string> = {
  FINAL: 'ON FINAL',
  TAKEOFF: 'CLIMB-OUT',
  CLIMB: 'CLIMBING',
  DESCENT: 'DESCENDING',
  APPROACH: 'APPROACH',
  CRUISE: 'CRUISE',
  LEVEL: 'LEVEL',
  GROUND: 'TAXI',
};

const SOURCE_TEXT: Record<string, string> = {
  adsblol: 'adsb.lol',
  adsbfi: 'adsb.fi',
  opensky: 'OpenSky Network',
  custom: 'your receiver',
  sim: 'simulator',
};

const safeUrl = (u: string | undefined) => (u && /^https:\/\//.test(u) ? u : undefined);
const kv = (rows: [string, string | undefined][]) =>
  `<dl class="kv">${rows
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('')}</dl>`;

function head(t: Track): string {
  const a = t.a;
  const name = displayName(t);
  const parts = splitCallsign(a.cs);
  const ref = parts ? AIRLINES[parts.icao] : undefined;
  const airline = ref && parts ? { ...ref, icao: parts.icao } : t.route?.airline;
  const airlineLine =
    airline && 'name' in airline && airline.name
      ? `${flag(airline.country)} ${esc(airline.name)}${airline.radio ? ` · radio “${esc(airline.radio)}”` : ''}`
      : a.op
        ? esc(a.op)
        : '';
  const tags: string[] = [];
  const kindText = `${KIND_TEXT[t.cls.kind] ?? t.cls.kind}${t.cls.airport ? ` · ${AIRPORT_SHORT[t.cls.airport] ?? t.cls.airport}` : ''}`;
  tags.push(`<span class="tag k-${t.cls.kind.toLowerCase()}">${esc(kindText)}</span>`);
  if (t.cls.runway) tags.push(`<span class="tag">${t.cls.phase === 'FINAL' ? 'FINAL' : 'RWY'} ${esc(t.cls.runway)}</span>`);
  else if (t.cls.phase && t.cls.kind !== 'GND') tags.push(`<span class="tag">${PHASE_TEXT[t.cls.phase] ?? t.cls.phase}</span>`);
  const wake = lookupType(a.type ?? t.aircraft?.typeCode)?.wake;
  if (wake === 'J') tags.push('<span class="tag">SUPER</span>');
  if (wake === 'H') tags.push('<span class="tag">HEAVY</span>');
  if (t.cls.mil) tags.push('<span class="tag mil">MILITARY</span>');
  if (t.cls.heli) tags.push('<span class="tag">ROTORCRAFT</span>');
  if (t.cls.emergency) tags.push(`<span class="tag emerg">${esc(emergencyText(t.cls.emergency) ?? '')} · ${esc(a.sq ?? '')}</span>`);
  if (t.cls.special && !t.cls.mil && !t.cls.emergency) tags.push(`<span class="tag special">★ ${esc(t.cls.special)}</span>`);
  const cs = a.cs && a.cs !== name ? `<span class="d-cs">${esc(a.cs)}</span>` : '';
  return `<div class="d-title"><span class="d-name">${esc(name)}</span>${cs}<span class="d-tn">TN ${String(t.tn).padStart(3, '0')}</span></div>
    ${airlineLine ? `<div class="d-airline">${airlineLine}</div>` : ''}
    <div class="d-tags">${tags.join('')}</div>`;
}

function relativeWords(rel: number): string {
  const r = Math.abs(rel);
  if (r < 20) return 'ahead of you';
  if (r < 100) return rel < 0 ? 'to your left' : 'to your right';
  if (r < 150) return rel < 0 ? 'behind you, to the left' : 'behind you, to the right';
  return 'behind you';
}

function look(t: Track, c: DetailContext): string {
  const s = t.sight;
  if (!s) return '';
  if (t.a.gnd) return `<h3>FROM YOUR POST</h3><p class="look-big dim">On the ground, ${fmtDist(s.groundKm, c.units)} ${compassName(s.az)}.</p>`;
  const g = lookGuide(s);
  let headline: string;
  let cls = '';
  if (s.visible) {
    headline = `LOOK ${esc(g.side.toUpperCase())} · ${esc(g.up.toUpperCase())}`;
    cls = 'go';
  } else if (s.obscured === 'cloud') {
    const base = c.seeing.air.ceilingFt;
    headline = `Hidden above the cloud${base !== undefined ? ` (base ${fmtAlt(base, c.units)})` : ''}.`;
  } else if (s.obscured === 'haze') {
    headline = `Hidden by ${esc(c.seeing.what ?? 'haze')}: it's ${fmtDist(s.slantKm, c.units)} away and you can see about ${fmtDist(c.seeing.air.rangeKm, c.units)} right now.`;
  } else if (s.inFov && s.el < 1) {
    headline = `Low on the horizon, ${fmtDist(s.slantKm, c.units)} away. Likely hidden by buildings or haze.`;
  } else if (s.inFov) {
    headline = `In your view but ${fmtDist(s.slantKm, c.units)} away: a speck at best.`;
  } else {
    headline = `Out of view: ${relativeWords(s.rel)} (${compassName(s.az)}).`;
  }
  const eta =
    t.viewEtaS !== undefined && t.viewEtaS > 0 ? `enters your view in about ${fmtDuration(t.viewEtaS)}` : undefined;
  const spanM = lookupType(t.a.type ?? t.aircraft?.typeCode)?.span;
  const moved = t.a.gs ? (t.a.gs * 1.852 * s.soundDelayS) / 3600 : 0;
  const night = c.sunEl < -6;
  return `<h3>FROM YOUR POST</h3>
    <p class="look-big ${cls}">${headline}</p>
    ${kv([
      ['Direction', `${fmtBrg(s.az)} · ${signedDeg(s.rel) < 0 ? `${Math.round(-s.rel)}° left` : `${Math.round(s.rel)}° right`} of ahead`],
      [
        'Elevation',
        Math.abs(s.el) < 0.05
          ? 'right on the horizon'
          : s.el > 0
            ? `${s.el.toFixed(1)}° above the horizon`
            : `${(-s.el).toFixed(1)}° below the horizon (hidden by Earth's curve)`,
      ],
      ['Distance', `${fmtDist(s.groundKm, c.units)} away · ${fmtDist(s.slantKm, c.units)} line of sight`],
      ['Coming up', eta],
      [
        'Closest',
        t.cpa && t.cpa.tS > 5 ? `${fmtDist(t.cpa.distKm, c.units)} from you in ${fmtDuration(t.cpa.tS)}` : t.cpa ? 'passing closest now' : undefined,
      ],
      [
        'Sound',
        `arrives ${Math.round(s.soundDelayS)} s late${moved > 0.05 ? `, by then it's ${moved.toFixed(1)} km further on` : ''}`,
      ],
      ['Looks like', spanM ? moonCompare(spanM, s.slantKm) : undefined],
      ['At night', night ? 'look for the blinking red beacon, white strobes, and red (left) / green (right) wingtip lights' : undefined],
    ])}`;
}

function route(t: Track, c: DetailContext): string {
  const r = t.route;
  if (r === undefined && t.a.cs) return '<h3>ROUTE</h3><p class="dim">Looking up route…</p>';
  if (!r) return `<h3>ROUTE</h3><p class="dim">No published route for ${esc(t.a.cs ?? 'this contact')}.</p>`;
  const leg = t.leg;
  const from = leg?.from ?? r.legs[0]!;
  const to = leg?.to ?? r.legs[r.legs.length - 1]!;
  const apt = (a: typeof from, when: string | undefined) => `<div class="apt">
      <b>${esc(a.iata ?? a.icao)}</b>
      <span>${flag(a.country)} ${esc(a.city ?? a.countryName ?? '')}</span>
      <small>${esc(a.name)}</small>
      ${when ? `<span class="apt-time">${when}</span>` : ''}
    </div>`;
  // Estimates, so to the minute when close and to 5 minutes when hours away.
  const clock = (at: number) => {
    const step = Math.abs(at - c.now) > 2 * 3_600_000 ? 300_000 : 60_000;
    return `${timeSgt(Math.round(at / step) * step)} SGT`;
  };
  const times = leg ? legTimes(t, leg, c.now) : {};
  const departed = times.departed ? `Took off ${t.liftoff !== undefined ? '' : '~'}${clock(times.departed.at)}` : undefined;
  const arrives =
    times.arrives === undefined ? undefined : times.arrives - c.now < 60_000 ? 'Landing now' : `Lands ~${clock(times.arrives)}`;
  const via = r.legs.length > 2 ? `<div class="dim">Full route: ${r.legs.map((l) => esc(l.iata ?? l.icao)).join(' → ')}</div>` : '';
  let progress = '';
  if (leg) {
    const pct = Math.round(leg.fraction * 100);
    const dist = leg.plausible ? legDistances(t.a, leg) : { flownKm: leg.flownKm, toGoKm: leg.remainingKm };
    const left = times.arrives !== undefined ? (times.arrives - c.now) / 1000 : undefined;
    const eta = left !== undefined && left >= 60 ? ` · about ${fmtDuration(left)} of flying left` : '';
    progress = `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div style="width:${pct}%"></div><i style="left:${pct}%">✈</i></div>
      <div class="route-meta">${fmtKm(dist.flownKm)} flown · ${fmtKm(dist.toGoKm)} to go (${fmtKm(leg.totalKm)} total)${eta}</div>`;
  }
  const warn =
    leg && !leg.plausible
      ? `<p class="warn">This route doesn't match where the aircraft is. The database entry for ${esc(r.callsign)} may be out of date.</p>`
      : '';
  return `<h3>ROUTE</h3><div class="route-line">${apt(from, departed)}<div class="route-arrow">➜</div>${apt(to, arrives)}</div>${progress}${via}${warn}
    <div class="src">route data: ${esc(r.source === 'sim' ? 'simulator' : r.source === 'adsbdb' ? 'adsbdb.com' : 'hexdb.io')}</div>`;
}

function photo(t: Track): string {
  const p = t.photo ?? t.aircraft?.fallbackPhoto;
  const src = safeUrl(p?.src);
  if (!p || !src) return '';
  const link = safeUrl(p.link);
  const reg = t.a.reg ?? t.aircraft?.reg ?? '';
  const img = `<img src="${esc(src)}" alt="Photo of ${esc(reg || 'this aircraft')}" loading="lazy" referrerpolicy="no-referrer">`;
  const credit = `${p.credit ? `© ${esc(p.credit)} · ` : ''}${esc(p.source)}`;
  return `<figure class="d-photo">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${img}</a>` : img}
    <figcaption>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${credit}</a>` : credit}</figcaption></figure>`;
}

function aircraft(t: Track, now: number): string {
  const a = t.a;
  const rec = t.aircraft;
  const code = a.type ?? rec?.typeCode;
  const ref = lookupType(code);
  const name = ref
    ? `${ref.maker} ${ref.name}`
    : rec?.typeName
      ? `${rec.maker ?? ''} ${rec.typeName}`.trim()
      : prettyDesc(a.desc) ?? code ?? 'Unknown type';
  const reg = a.reg ?? rec?.reg;
  const year = a.year;
  const wakeText = ref?.wake ? ({ J: 'Super', H: 'Heavy', M: 'Medium', L: 'Light' } as const)[ref.wake] : undefined;
  return `<h3>AIRCRAFT</h3><div class="ac-name">${esc(name)}</div>
    ${kv([
      ['Type code', code ? `${esc(code)}${wakeText ? ` · ${wakeText} wake` : ''}` : undefined],
      ['Registration', reg ? `${esc(reg)} ${flag(rec?.ownerCountry)}` : undefined],
      ['Operator', rec?.owner ? esc(rec.owner) : a.op ? esc(a.op) : undefined],
      ['Built', year ? `${year} · ${new Date(now).getFullYear() - year} years old` : undefined],
      ['Engines', ref?.engines ? esc(ref.engines) : undefined],
      ['Seats', ref?.seats ? `${esc(ref.seats)} (typical)` : undefined],
      ['Size', ref?.length ? `${ref.length} m long${ref.span ? ` · ${ref.span} m wingspan` : ''}` : undefined],
      ['Range', ref?.rangeKm ? `${fmtInt(ref.rangeKm)} km` : undefined],
      ['Type first flew', ref?.firstFlight ? String(ref.firstFlight) : undefined],
    ])}
    ${ref?.fact ? `<p class="fact">★ ${esc(ref.fact)}</p>` : ''}`;
}

function telemetry(t: Track, c: DetailContext): string {
  const a = t.a;
  const alt = t.altitude(c.now);
  const ago = (c.now - a.t) / 1000;
  const autopilot =
    a.navAlt !== undefined && !a.gnd
      ? `set to ${fmtInt(Math.round(a.navAlt / 100) * 100)} ft${a.navHdg ? `, heading ${pad3(a.navHdg)}°` : ''}`
      : undefined;
  const airspeed = [a.ias && `IAS ${a.ias} kt`, a.tas && `TAS ${a.tas} kt`, a.mach && `Mach ${a.mach.toFixed(2)}`].filter(Boolean).join(' · ');
  const air = [
    a.oat !== undefined && `${a.oat} °C outside`,
    a.wd !== undefined && a.ws !== undefined && `wind from ${pad3(a.wd)}° at ${a.ws} kt`,
  ]
    .filter(Boolean)
    .join(' · ');
  const geo = a.galt !== undefined && !a.gnd ? ` (GPS ${fmtInt(Math.round(a.galt * M_PER_FT))} m)` : '';
  return `<h3>TELEMETRY</h3>${kv([
    ['Altitude', a.gnd ? 'on the ground' : `${fmtAltBoth(alt)}${geo}`],
    ['Vertical', a.gnd ? undefined : fmtVr(a.vr)],
    ['Ground speed', fmtSpeedBoth(a.gs)],
    ['Track', a.trk !== undefined ? `${pad3(a.trk)}° ${compassName(a.trk)}` : undefined],
    ['Squawk', a.sq ? esc(a.sq) : undefined],
    ['Autopilot', autopilot],
    ['Airspeed', airspeed || undefined],
    ['Outside air', air || undefined],
    [
      'Signal',
      `${a.src === 'mlat' ? 'MLAT' : a.src === 'adsb' ? 'ADS-B' : esc(a.src.toUpperCase())} via ${esc(SOURCE_TEXT[a.via] ?? a.via)} · ${ago < 1 ? 'just now' : `${ago.toFixed(0)} s ago`}${t.isStale(c.now) ? ' (stale)' : ''}`,
    ],
    ['Tracked', `${fmtDuration((c.now - t.firstSeen) / 1000)} · ICAO ${esc(t.hex.toUpperCase().replace('~', ''))}`],
  ])}`;
}

function links(t: Track): string {
  const out: string[] = [];
  const cs = t.a.cs;
  if (cs) {
    out.push(`<a href="https://www.flightradar24.com/${encodeURIComponent(cs)}" target="_blank" rel="noopener">FlightRadar24</a>`);
    out.push(`<a href="https://www.flightaware.com/live/flight/${encodeURIComponent(cs)}" target="_blank" rel="noopener">FlightAware</a>`);
  }
  if (!t.hex.startsWith('~')) {
    out.push(`<a href="https://globe.adsb.lol/?icao=${encodeURIComponent(t.hex)}" target="_blank" rel="noopener">ADSB.lol map</a>`);
    out.push(`<a href="https://www.planespotters.net/hex/${encodeURIComponent(t.hex.toUpperCase())}" target="_blank" rel="noopener">Planespotters</a>`);
  }
  return out.length ? `<nav class="d-links">${out.join('')}</nav>` : '';
}

const SECTIONS = ['head', 'route', 'look', 'photo', 'aircraft', 'telemetry', 'links'] as const;
type Section = (typeof SECTIONS)[number];

export class DetailPanel {
  private readonly els = new Map<Section, HTMLElement>();
  private readonly last = new Map<Section, string>();
  private current: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    onClose: () => void,
  ) {
    root.innerHTML = `<button class="d-handle" type="button" aria-expanded="false" aria-label="Show more details"><span></span></button>
      <button class="icon-btn d-close" type="button" aria-label="Release target">✕</button>
      <div class="d-scroll">${SECTIONS.map((s) => `<section class="d-${s}"></section>`).join('')}</div>`;
    for (const s of SECTIONS) this.els.set(s, root.querySelector<HTMLElement>(`.d-${s}`)!);
    root.querySelector('.d-close')!.addEventListener('click', onClose);
    // On phones the panel is a bottom sheet: compact by default, the handle expands it.
    const handle = root.querySelector<HTMLButtonElement>('.d-handle')!;
    handle.addEventListener('click', () => {
      const expanded = root.classList.toggle('expanded');
      handle.setAttribute('aria-expanded', String(expanded));
      handle.setAttribute('aria-label', expanded ? 'Show less' : 'Show more details');
    });
  }

  update(t: Track | undefined, c: DetailContext): void {
    this.root.hidden = !t;
    document.body.classList.toggle('has-target', Boolean(t));
    if (!t) {
      this.current = undefined;
      return;
    }
    if (this.current !== t.hex) {
      this.current = t.hex;
      this.last.clear();
      this.root.querySelector('.d-scroll')!.scrollTop = 0;
      this.root.classList.remove('expanded');
    }
    const html: Record<Section, string> = {
      head: head(t),
      look: look(t, c),
      route: route(t, c),
      photo: photo(t),
      aircraft: aircraft(t, c.now),
      telemetry: telemetry(t, c),
      links: links(t),
    };
    for (const s of SECTIONS) {
      if (this.last.get(s) === html[s]) continue;
      this.last.set(s, html[s]);
      const el = this.els.get(s)!;
      el.innerHTML = html[s];
      el.hidden = !html[s];
    }
  }
}
