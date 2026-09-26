/** Contacts table, tactical log and alert toasts. */
import type { Units } from '../app/settings.ts';
import type { Track } from '../track/track.ts';
import { blockAlt, clockSgt, displayName, escapeHtml as esc, fmtDuration, pad3, trendArrow } from './format.ts';
import { KM_PER_NM } from '../geo/geo.ts';

export type ContactFilter = 'all' | 'arr' | 'dep' | 'view' | 'soon';
export type ContactSort = 'dist' | 'alt' | 'eta';

const FILTERS: [ContactFilter, string][] = [
  ['all', 'ALL'],
  ['view', 'IN VIEW'],
  ['soon', 'COMING'],
  ['arr', 'ARR'],
  ['dep', 'DEP'],
];

export class ContactsPanel {
  filter: ContactFilter = 'all';
  sort: ContactSort = 'dist';
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly empty: HTMLElement;
  private lastHtml = '';
  /** Order of rows as last rendered, for keyboard next/previous. */
  order: string[] = [];

  constructor(root: HTMLElement, onSelect: (hex: string) => void, onChange: () => void) {
    root.innerHTML = `
      <header class="panel-head">
        <h2>CONTACTS <span class="count"></span></h2>
        <div class="seg" role="group" aria-label="Filter contacts">
          ${FILTERS.map(([f, label]) => `<button type="button" data-filter="${f}" aria-pressed="${f === 'all'}">${label}</button>`).join('')}
        </div>
      </header>
      <div class="table-wrap">
        <table class="contacts">
          <thead><tr>
            <th scope="col">TN</th><th scope="col">FLIGHT</th><th scope="col">ROUTE</th>
            <th scope="col" data-sort="alt" class="sortable">ALT</th>
            <th scope="col" data-sort="dist" class="sortable sorted">RNG</th>
            <th scope="col">BRG</th>
            <th scope="col" data-sort="eta" class="sortable">VIEW</th>
          </tr></thead>
          <tbody></tbody>
        </table>
        <p class="empty" hidden></p>
      </div>`;
    this.body = root.querySelector('tbody')!;
    this.count = root.querySelector('.count')!;
    this.empty = root.querySelector('.empty')!;
    root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
      b.addEventListener('click', () => {
        this.filter = b.dataset.filter as ContactFilter;
        root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onChange();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-sort]').forEach((th) =>
      th.addEventListener('click', () => {
        this.sort = th.dataset.sort as ContactSort;
        root.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('sorted', x === th));
        onChange();
      }),
    );
    this.body.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-hex]');
      if (row?.dataset.hex) onSelect(row.dataset.hex);
    });
  }

  update(tracks: Track[], selected: Track | undefined, units: Units, now: number, emptyText: string): void {
    const shown = tracks.filter((t) => {
      switch (this.filter) {
        case 'arr':
          return t.cls.kind === 'ARR';
        case 'dep':
          return t.cls.kind === 'DEP';
        case 'view':
          return t.sight?.visible;
        case 'soon':
          return t.viewEtaS !== undefined;
        default:
          return true;
      }
    });
    const key = (t: Track) =>
      this.sort === 'alt' ? (t.altitude(now) ?? 0) : this.sort === 'eta' ? (t.viewEtaS ?? 1e9) : (t.sight?.groundKm ?? 1e9);
    shown.sort((a, b) => key(a) - key(b));
    this.order = shown.map((t) => t.hex);
    this.count.textContent = String(tracks.length);

    const unitKm = units === 'aviation' ? KM_PER_NM : 1;
    const html = shown
      .map((t) => {
        const code = (ap: { iata?: string; icao: string }) => esc(ap.iata ?? ap.icao);
        const routeText = t.leg ? `${code(t.leg.from)}›${code(t.leg.to)}${t.leg.plausible ? '' : '?'}` : '';
        const type = esc(t.a.type ?? t.aircraft?.typeCode ?? '');
        const view = t.sight?.visible ? '●' : t.viewEtaS !== undefined ? fmtDuration(t.viewEtaS) : '';
        const km = t.sight ? t.sight.groundKm / unitKm : undefined;
        const cls = [
          `k-${t.cls.kind.toLowerCase()}`,
          t === selected ? 'sel' : '',
          t.sight?.visible ? 'inview' : '',
          t.cls.mil ? 'mil' : '',
          t.cls.emergency ? 'emerg' : '',
          t.isStale(now) ? 'stale' : '',
        ].join(' ');
        return `<tr data-hex="${esc(t.hex)}" class="${cls}">
          <td class="tn">${String(t.tn).padStart(3, '0')}</td>
          <td class="cs"><b>${esc(displayName(t))}${t.cls.special ? ' ★' : ''}</b><small>${type}</small></td>
          <td class="rt">${routeText}</td>
          <td class="alt">${t.a.gnd ? 'GND' : blockAlt(t.altitude(now))}${trendArrow(t.a.vr)}</td>
          <td class="rng">${km === undefined ? '' : km < 10 ? km.toFixed(1) : Math.round(km)}</td>
          <td class="brg">${t.sight ? pad3(t.sight.az) : ''}</td>
          <td class="vw">${view}</td></tr>`;
      })
      .join('');
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.body.innerHTML = html;
    }
    this.empty.hidden = shown.length > 0;
    this.empty.textContent = shown.length ? '' : emptyText;
  }
}

export type LogLevel = 'info' | 'view' | 'special' | 'alert' | 'system';

export class LogPanel {
  private readonly list: HTMLElement;

  constructor(root: HTMLElement, onSelect: (hex: string) => void) {
    root.innerHTML = `<header class="panel-head"><h2>TAC LOG</h2></header><ol class="log" aria-live="polite"></ol>`;
    this.list = root.querySelector('ol')!;
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-hex]');
      if (li?.dataset.hex) onSelect(li.dataset.hex);
    });
  }

  add(text: string, level: LogLevel = 'info', hex?: string): void {
    const stick = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 20;
    const li = document.createElement('li');
    li.className = `lv-${level}`;
    if (hex) li.dataset.hex = hex;
    li.innerHTML = `<time>${clockSgt(Date.now())}</time> ${esc(text)}`;
    this.list.append(li);
    while (this.list.children.length > 250) this.list.firstElementChild?.remove();
    if (stick) this.list.scrollTop = this.list.scrollHeight;
  }
}

export class Toasts {
  constructor(
    private readonly root: HTMLElement,
    private readonly onSelect: (hex: string) => void,
  ) {}

  show(text: string, level: LogLevel, hex?: string, ms = 7000): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `toast lv-${level}`;
    el.textContent = text;
    el.addEventListener('click', () => {
      if (hex) this.onSelect(hex);
      el.remove();
    });
    this.root.prepend(el);
    while (this.root.children.length > 3) this.root.lastElementChild?.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }
}
