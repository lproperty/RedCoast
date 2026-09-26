/** First-run "observation post" setup and the settings dialog. */
import { DEFAULT_POST, setupLink, type Settings, type SettingsStore } from '../app/settings.ts';
import { compassPoint, normDeg } from '../geo/geo.ts';
import { parseCoords } from '../geo/parse.ts';
import { escapeHtml as esc } from './format.ts';

const ROSE: [string, number][] = [
  ['NW', 315], ['N', 0], ['NE', 45],
  ['W', 270], ['', -1], ['E', 90],
  ['SW', 225], ['S', 180], ['SE', 135],
];

/** Singapore is low-lying: street level ~10 m above sea, ~3 m per storey. */
const heightFromFloor = (floor: number) => 10 + Math.max(0, floor) * 3;
const floorFromHeight = (h: number) => Math.max(0, Math.round((h - 10) / 3));

export class SetupDialog {
  private readonly dlg: HTMLDialogElement;
  private readonly form: HTMLFormElement;

  constructor(
    private readonly store: SettingsStore,
    private readonly onDone: () => void,
  ) {
    this.dlg = document.createElement('dialog');
    this.dlg.className = 'dlg';
    this.dlg.setAttribute('aria-labelledby', 'setup-title');
    this.dlg.innerHTML = `
      <form method="dialog" class="dlg-body">
        <h2 id="setup-title">OBSERVATION POST</h2>
        <p class="dim">Where are you watching from? This is saved only in this browser. The data relay only ever
          sees your position rounded to about 11&nbsp;km.</p>
        <label class="field"><span>Coordinates</span>
          <input name="coords" autocomplete="off" spellcheck="false" placeholder="1.3018, 103.9128 or a Google Maps link">
        </label>
        <div class="row">
          <button type="button" data-act="gps">⌖ USE GPS</button>
          <span class="gps-status dim small" aria-live="polite"></span>
        </div>
        <fieldset class="field">
          <legend>Your view faces</legend>
          <div class="rose-row">
            <div class="rose">${ROSE.map(([l, d]) =>
              d < 0 ? '<span class="rose-c">◎</span>' : `<button type="button" data-dir="${d}">${l}</button>`,
            ).join('')}</div>
            <label class="inline">exactly <input name="facing" type="number" min="0" max="359" step="1" inputmode="numeric"> °</label>
          </div>
        </fieldset>
        <label class="field"><span>How wide your open view is: <output name="fovOut"></output></span>
          <input name="fov" type="range" min="60" max="360" step="10">
        </label>
        <label class="field"><span>Floor (for the height of your eyes)</span>
          <input name="floor" type="number" min="0" max="90" step="1" inputmode="numeric">
        </label>
        <label class="field"><span>Name (optional)</span><input name="name" maxlength="40" placeholder="Home balcony"></label>
        <p class="error" role="alert" hidden></p>
        <div class="dlg-actions">
          <button type="button" data-act="demo" class="ghost">USE EAST COAST PARK</button>
          <button type="submit" class="primary">SAVE POST</button>
        </div>
      </form>`;
    document.body.append(this.dlg);
    this.form = this.dlg.querySelector('form')!;

    const facing = this.input('facing');
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) =>
      b.addEventListener('click', () => {
        facing.value = b.dataset.dir!;
        this.syncRose();
      }),
    );
    facing.addEventListener('input', () => this.syncRose());
    this.input('fov').addEventListener('input', () => this.syncFov());
    this.dlg.querySelector('[data-act="gps"]')!.addEventListener('click', () => this.useGps());
    this.dlg.querySelector('[data-act="demo"]')!.addEventListener('click', () => {
      this.store.update({ observer: { ...DEFAULT_POST }, configured: true });
      this.dlg.close();
      this.onDone();
    });
    this.form.addEventListener('submit', (e) => {
      if (!this.save()) e.preventDefault();
    });
  }

  private input(name: string): HTMLInputElement {
    return this.form.elements.namedItem(name) as HTMLInputElement;
  }

  private syncRose(): void {
    const v = Number(this.input('facing').value);
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.dir) === normDeg(Math.round(v / 45) * 45) && Number.isFinite(v))),
    );
  }

  private syncFov(): void {
    const v = Number(this.input('fov').value);
    (this.form.elements.namedItem('fovOut') as HTMLOutputElement).value = v >= 360 ? 'all round' : `${v}°`;
  }

  open(): void {
    const o = this.store.get().observer;
    const configured = this.store.get().configured;
    this.input('coords').value = configured ? `${o.lat.toFixed(6)}, ${o.lon.toFixed(6)}` : '';
    this.input('facing').value = String(Math.round(o.facing));
    this.input('fov').value = String(o.fov);
    this.input('floor').value = String(floorFromHeight(o.heightM));
    this.input('name').value = configured ? o.name : '';
    this.syncRose();
    this.syncFov();
    this.error('');
    if (!this.dlg.open) this.dlg.showModal();
  }

  private error(msg: string): void {
    const el = this.dlg.querySelector<HTMLElement>('.error')!;
    el.textContent = msg;
    el.hidden = !msg;
  }

  private useGps(): void {
    const status = this.dlg.querySelector<HTMLElement>('.gps-status')!;
    if (!navigator.geolocation) {
      status.textContent = 'GPS not available in this browser.';
      return;
    }
    status.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.input('coords').value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        status.textContent = `Got it, accurate to about ${Math.round(pos.coords.accuracy)} m.`;
      },
      (err) => {
        status.textContent = err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not get a GPS fix.';
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  private save(): boolean {
    const pos = parseCoords(this.input('coords').value);
    if (!pos) {
      this.error('Enter coordinates like "1.3018, 103.9128", paste a Google Maps link, or use GPS.');
      return false;
    }
    const facing = Number(this.input('facing').value);
    this.store.update({
      configured: true,
      observer: {
        name: this.input('name').value.trim() || 'Balcony',
        lat: pos.lat,
        lon: pos.lon,
        facing: Number.isFinite(facing) ? normDeg(facing) : 180,
        fov: Number(this.input('fov').value),
        heightM: heightFromFloor(Number(this.input('floor').value) || 0),
      },
    });
    this.onDone();
    return true;
  }
}

type FieldKind = 'num' | 'bool' | 'str';
const FIELDS: Record<string, FieldKind> = {
  mode: 'str', orientation: 'str', theme: 'str', units: 'str', labels: 'str',
  trailMin: 'num', leaderS: 'num', sweepS: 'num', maxAltFt: 'num', visKm: 'num', showGround: 'bool', crt: 'bool',
  sound: 'bool', volume: 'num', alertView: 'bool', alertSpecial: 'bool', alertNew: 'bool',
  keepAwake: 'bool', compassOffset: 'num', source: 'str', customUrl: 'str', pollS: 'num', relayUrl: 'str',
};

export class SettingsDialog {
  private readonly dlg: HTMLDialogElement;
  private readonly form: HTMLFormElement;

  constructor(
    private readonly store: SettingsStore,
    private readonly editPost: () => void,
    private readonly sourceStatus: () => string,
  ) {
    this.dlg = document.createElement('dialog');
    this.dlg.className = 'dlg wide';
    this.dlg.setAttribute('aria-labelledby', 'settings-title');
    this.dlg.innerHTML = `
      <form method="dialog" class="dlg-body">
        <header class="dlg-head"><h2 id="settings-title">SETTINGS</h2>
          <button value="close" class="icon-btn" aria-label="Close settings">✕</button></header>
        <section><h3>OBSERVATION POST</h3>
          <p class="post-summary"></p>
          <div class="row">
            <button type="button" data-act="edit-post">EDIT POST</button>
            <button type="button" data-act="copy-link">COPY SETUP LINK</button>
          </div>
          <p class="dim small">The setup link opens RedCoast pre-set to your post on another device. It contains your
            coordinates, so only share it with people you'd tell where you live.</p>
        </section>
        <section class="legend"><h3>READING THE SCOPE</h3>
          <ul class="legend-list">
            <li><span class="sym" style="color:var(--arr)">▽</span> arriving</li>
            <li><span class="sym" style="color:var(--dep)">△</span> departing</li>
            <li><span class="sym" style="color:var(--ovf)">□</span> overflight</li>
            <li><span class="sym">○</span> local / unknown</li>
            <li><span class="sym" style="color:var(--mil)">◇</span> military</li>
            <li><span class="sym">⊕</span> helicopter</li>
            <li><span class="sym" style="color:var(--emerg)">■</span> emergency</li>
            <li><span class="sym">★</span> special aircraft</li>
          </ul>
          <pre class="legend-block">SQ321 ★      flight number
045↓ 180      altitude in hundreds of ft (4,500 ft), ↑↓ climbing/descending, speed in knots
B77W LHR      aircraft type, and where it came from (arrivals) or is going (departures)</pre>
          <p class="dim small">The line ahead of each contact shows where it will be in a minute; the dots behind show
            where it has been. On the locked target, the dashed line and ring from you give its bearing and range.
            The sweep leaves glowing returns like a real phosphor screen.</p>
        </section>
        <section class="grid"><h3>DISPLAY</h3>
          <label>Scope <select name="mode"><option value="ppi">PPI · 360° round scope</option><option value="sector">Sector · forward fan</option></select></label>
          <label>Orientation <select name="orientation"><option value="facing">Your view at the top</option><option value="north">North at the top</option></select></label>
          <label>Theme <select name="theme"><option value="phosphor">Phosphor green</option><option value="amber">Amber</option><option value="night">Night red (keeps night vision)</option></select></label>
          <label>Units <select name="units"><option value="metric">Metric (km, m)</option><option value="aviation">Aviation (nm, ft, kt)</option></select></label>
          <label>Data blocks <select name="labels"><option value="full">Full</option><option value="compact">Compact</option><option value="off">Off</option></select></label>
          <label>History trail <select name="trailMin"><option value="0">Off</option><option value="1">1 min</option><option value="2">2 min</option><option value="5">5 min</option></select></label>
          <label>Leader line <select name="leaderS"><option value="0">Off</option><option value="30">30 s ahead</option><option value="60">1 min ahead</option><option value="120">2 min ahead</option></select></label>
          <label>How far you can see <select name="visKm"><option value="0">Auto: Changi weather report</option><option value="45">Clear, no haze</option><option value="20">20 km</option><option value="10">10 km</option><option value="5">5 km</option><option value="3">3 km</option><option value="1">1 km</option></select></label>
          <label>Altitude filter <select name="maxAltFt"><option value="0">Show all</option><option value="30000">Below 30,000 ft</option><option value="20000">Below 20,000 ft</option><option value="10000">Below 10,000 ft</option><option value="5000">Below 5,000 ft</option></select></label>
          <label>Sweep: one pass every <output data-for="sweepS"></output><input name="sweepS" type="range" min="2" max="8" step="0.5"></label>
          <label class="check"><input type="checkbox" name="showGround"> Show aircraft on the ground</label>
          <label class="check"><input type="checkbox" name="crt"> CRT effects (scanlines, sea clutter)</label>
        </section>
        <section class="grid"><h3>ALERTS</h3>
          <label class="check"><input type="checkbox" name="sound"> Sound on</label>
          <label>Volume <input name="volume" type="range" min="0" max="1" step="0.05"></label>
          <label class="check"><input type="checkbox" name="alertView"> A plane enters your view</label>
          <label class="check"><input type="checkbox" name="alertSpecial"> Special aircraft (A380, 747, military…)</label>
          <label class="check"><input type="checkbox" name="alertNew"> Every new contact (busy!)</label>
        </section>
        <section class="grid"><h3>PHONE</h3>
          <label class="check"><input type="checkbox" name="keepAwake"> Keep the screen awake</label>
          <label>Compass correction <output data-for="compassOffset"></output><input name="compassOffset" type="range" min="-30" max="30" step="1"></label>
        </section>
        <section class="grid"><h3>DATA</h3>
          <label>Source <select name="source"><option value="live">Live: adsb.lol + OpenSky</option><option value="sim">Simulation (demo traffic)</option><option value="custom">My own receiver</option></select></label>
          <label>Update every <select name="pollS"><option value="2">2 s</option><option value="3">3 s</option><option value="5">5 s</option><option value="10">10 s</option></select></label>
          <label class="span2">Receiver URL (readsb / tar1090 aircraft.json with CORS)
            <input name="customUrl" type="url" placeholder="https://…/data/aircraft.json"></label>
          <details class="span2"><summary>Advanced</summary>
            <label>Relay URL override <input name="relayUrl" type="url" placeholder="built-in relay"></label>
          </details>
          <pre class="source-status span2"></pre>
        </section>
        <section class="about"><h3>ABOUT</h3>
          <p><b>RedCoast</b> v${__APP_VERSION__} (${__BUILD_DATE__}) · an air-surveillance scope for the East Coast.
            <a href="https://github.com/lproperty/RedCoast" target="_blank" rel="noopener">Source on GitHub</a> (MIT).</p>
          <p class="small">Live positions: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> (ODbL) with
            <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a> as backup, and
            <a href="https://opensky-network.org" target="_blank" rel="noopener">The OpenSky Network</a>.
            Routes and aircraft: <a href="https://www.adsbdb.com" target="_blank" rel="noopener">adsbdb</a>,
            <a href="https://hexdb.io" target="_blank" rel="noopener">hexdb.io</a>. Photos:
            <a href="https://www.planespotters.net" target="_blank" rel="noopener">planespotters.net</a> (credited on each photo).
            Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.
            Type: B612 Mono, designed for Airbus cockpit displays.</p>
          <p class="small">Keys: <kbd>+</kbd>/<kbd>−</kbd> range · <kbd>M</kbd> scope · <kbd>N</kbd> north-up ·
            <kbd>J</kbd>/<kbd>K</kbd> next/previous contact · <kbd>S</kbd> sound · <kbd>Esc</kbd> release target.</p>
          <p class="small dim">For fun and plane-spotting only; not for navigation. Coverage depends on volunteer receivers,
            so some aircraft (especially military) may be missing.</p>
        </section>
        <div class="dlg-actions">
          <button type="button" data-act="reset" class="ghost danger">RESET ALL</button>
          <button value="close" class="primary">DONE</button>
        </div>
      </form>`;
    document.body.append(this.dlg);
    this.form = this.dlg.querySelector('form')!;

    this.form.addEventListener('input', (e) => this.onField(e.target as HTMLInputElement));
    this.form.addEventListener('change', (e) => this.onField(e.target as HTMLInputElement));
    this.dlg.querySelector('[data-act="edit-post"]')!.addEventListener('click', () => {
      this.dlg.close();
      this.editPost();
    });
    this.dlg.querySelector('[data-act="copy-link"]')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(setupLink(this.store.get()));
        btn.textContent = 'COPIED ✓';
      } catch {
        btn.textContent = 'COPY FAILED';
      }
      setTimeout(() => (btn.textContent = 'COPY SETUP LINK'), 2000);
    });
    this.dlg.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
      if (!confirm('Reset all settings, including your observation post?')) return;
      this.store.reset();
      this.fill();
    });
  }

  open(): void {
    this.fill();
    if (!this.dlg.open) this.dlg.showModal();
  }

  refreshStatus(): void {
    if (!this.dlg.open) return;
    this.dlg.querySelector('.source-status')!.textContent = this.sourceStatus();
  }

  private fill(): void {
    const s = this.store.get();
    for (const [name, kind] of Object.entries(FIELDS)) {
      const el = this.form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) continue;
      const v = s[name as keyof Settings];
      if (kind === 'bool') (el as HTMLInputElement).checked = Boolean(v);
      else el.value = String(v);
    }
    const o = s.observer;
    this.dlg.querySelector('.post-summary')!.innerHTML = s.configured
      ? `<b>${esc(o.name)}</b>: ${o.lat.toFixed(5)}, ${o.lon.toFixed(5)} · facing ${Math.round(o.facing)}° ${compassPoint(o.facing)} · view ${Math.round(o.fov)}° · eye height ≈${Math.round(o.heightM)} m`
      : `Not set: showing the public default (${esc(DEFAULT_POST.name)}).`;
    this.syncOutputs();
    this.refreshStatus();
  }

  private syncOutputs(): void {
    const s = this.store.get();
    this.dlg.querySelector<HTMLOutputElement>('[data-for="sweepS"]')!.value = `${s.sweepS} s`;
    this.dlg.querySelector<HTMLOutputElement>('[data-for="compassOffset"]')!.value = `${s.compassOffset > 0 ? '+' : ''}${s.compassOffset}°`;
    this.dlg.querySelectorAll<HTMLElement>('[name="customUrl"]').forEach((el) => {
      el.closest('label')!.hidden = s.source !== 'custom';
    });
  }

  private onField(el: HTMLInputElement): void {
    const kind = FIELDS[el.name];
    if (!kind) return;
    if (el.type === 'url' && el.value && !el.checkValidity()) return;
    const value = kind === 'bool' ? el.checked : kind === 'num' ? Number(el.value) : el.value.trim();
    this.store.update({ [el.name]: value } as Partial<Settings>);
    this.syncOutputs();
  }
}
