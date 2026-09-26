/**
 * Wires the pieces together: feed → tracks → analysis (classification, sight lines,
 * alerts) → scope, sky view and panels.
 */
import { RELAY_URL } from '../config.ts';
import type { SourceStatus, WeatherReport } from '../data/feed.ts';
import { Simulator } from '../data/simulator.ts';
import { Poller, ReadsbUrlSource, RelaySource, SimSource, type FeedSource, type PollResult } from '../data/source.ts';
import { legProgress, Enricher, simRoute } from '../enrich/lookup.ts';
import { daylight, moonPosition, sunPosition, type MoonInfo, type SkyBody } from '../geo/astro.ts';
import { compassPoint, DEG, KM_PER_NM, LocalFrame, normDeg } from '../geo/geo.ts';
import { Scope, type Corners } from '../render/scope.ts';
import { SkyView } from '../render/sky.ts';
import { applyThemeToCss, PALETTES, type Palette } from '../render/theme.ts';
import { classify, emergencyText, FlowMonitor } from '../track/classify.ts';
import { CLEAR_AIR, closestApproach, conditionsFor, lookGuide, trackSight, viewEntryS, type Conditions } from '../track/sight.ts';
import { TrackStore } from '../track/store.ts';
import type { Track } from '../track/track.ts';
import { Sfx } from '../ui/audio.ts';
import { DetailPanel } from '../ui/detail.ts';
import { SettingsDialog, SetupDialog } from '../ui/dialogs.ts';
import { clockSgt, clockZulu, displayName, fmtDuration, fmtSeeing, pad3, timeSgt } from '../ui/format.ts';
import { Compass, type Pointing } from '../ui/orientation.ts';
import { ContactsPanel, LogPanel, Toasts } from '../ui/panels.ts';
import { KeepAwake } from '../ui/wakelock.ts';
import { RANGES_KM, SettingsStore, type Settings } from './settings.ts';

type LinkState = 'connecting' | 'live' | 'degraded' | 'down' | 'sim';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const SOURCE_NAMES: Record<string, string> = {
  adsblol: 'ADSB.LOL',
  adsbfi: 'ADSB.FI',
  opensky: 'OPENSKY',
  custom: 'RECEIVER',
  sim: 'SIM',
};

export class App {
  private readonly settings = new SettingsStore();
  private frame: LocalFrame;
  private readonly store: TrackStore;
  private readonly flow = new FlowMonitor();
  private readonly enricher: Enricher;
  private readonly scope: Scope;
  private readonly sky: SkyView;
  private readonly sfx = new Sfx();
  private readonly compass: Compass;
  private readonly keepAwake = new KeepAwake();
  private readonly poller: Poller;
  private simulator: Simulator | undefined;
  private source: FeedSource;
  private palette: Palette;

  private readonly detail: DetailPanel;
  private readonly contacts: ContactsPanel;
  private readonly log: LogPanel;
  private readonly toasts: Toasts;
  private readonly setup: SetupDialog;
  private readonly settingsDlg: SettingsDialog;

  private visible: Track[] = [];
  private selected: Track | undefined;
  private hovered: Track | undefined;
  private pointed: Track | undefined;
  private pointing: Pointing | undefined;
  private sun: SkyBody = { az: 0, el: -90 };
  /** Changi's latest weather report, and how far that lets you see. */
  private wx: WeatherReport | undefined;
  private seeing: Conditions = { air: CLEAR_AIR, source: 'none' };
  private moon: MoonInfo = { az: 0, el: -90, fraction: 0, phase: 0 };
  private activeRunways: string[] = [];
  private flowDir: string | undefined;
  private link: {
    state: LinkState;
    sources: SourceStatus[];
    latency: number;
    /** Last time we received usable data. */
    lastOk: number;
    error?: string;
    station?: { online: boolean; ageMs: number | null };
  } = {
    state: 'connecting',
    sources: [],
    latency: 0,
    lastOk: 0,
  };
  /** When we first saw the home station offline in the current streak (it takes ~10 s to wake up). */
  private stationWaitSince = 0;
  private pictureBuilt = false;
  private lastViewToast = 0;
  /** Room the controls take in the scope's corners, which the sector display keeps clear of. */
  private corners: Corners | undefined;
  private scopeFit = '';
  private fitFrame: number | undefined;
  private flowHtml: string | undefined;

  constructor() {
    const s = this.settings.get();
    this.frame = new LocalFrame(s.observer);
    this.store = new TrackStore(this.frame);
    this.palette = PALETTES[s.theme];
    this.scope = new Scope($<HTMLCanvasElement>('canvas.scope'));
    this.sky = new SkyView($<HTMLCanvasElement>('canvas.sky'));
    // Lookups finish in bursts; re-analyse once per burst rather than once per result.
    let pending: ReturnType<typeof setTimeout> | undefined;
    this.enricher = new Enricher(() => {
      pending ??= setTimeout(() => {
        pending = undefined;
        this.analyze();
      }, 150);
    });
    this.compass = new Compass((p) => (this.pointing = p));
    this.source = this.makeSource(s);

    this.detail = new DetailPanel($('.detail'), () => this.select(undefined));
    this.contacts = new ContactsPanel($('.contacts-panel'), (hex) => this.selectHex(hex), () => this.refreshPanels());
    this.log = new LogPanel($('.log-panel'), (hex) => this.selectHex(hex));
    this.toasts = new Toasts($('.toasts'), (hex) => this.selectHex(hex));
    this.setup = new SetupDialog(this.settings, () => this.log.add('OBSERVATION POST UPDATED', 'system'));
    this.settingsDlg = new SettingsDialog(
      this.settings,
      () => this.setup.open(),
      () => this.statusText(),
    );

    this.poller = new Poller({
      source: () => this.source,
      query: () => {
        const cur = this.settings.get();
        return {
          lat: cur.observer.lat,
          lon: cur.observer.lon,
          radiusNm: Math.max(30, cur.rangeKm / KM_PER_NM + 10),
        };
      },
      intervalMs: () => this.settings.get().pollS * 1000,
      onResult: (r) => this.onFeed(r),
      onError: (err, n) => this.onFeedError(err, n),
    });
  }

  start(): void {
    const s = this.settings.get();
    applyThemeToCss(this.palette);
    this.sfx.enabled = s.sound;
    this.sfx.volume = s.volume;
    this.settings.subscribe((next, prev) => this.onSettings(next, prev));
    this.bindControls();
    this.syncHud();
    this.scheduleFit();
    addEventListener('resize', () => this.scheduleFit());
    void document.fonts.ready.then(() => this.scheduleFit());
    this.log.add(`REDCOAST v${__APP_VERSION__} ONLINE`, 'system');
    this.log.add(
      `POST ${s.configured ? s.observer.name.toUpperCase() : 'DEFAULT (EAST COAST PARK)'} · FACING ${pad3(s.observer.facing)} ${compassPoint(s.observer.facing)}`,
      'system',
    );
    if (!s.configured) this.setup.open();
    if (s.keepAwake) void this.keepAwake.set(true);
    this.poller.start();
    this.analyze();
    requestAnimationFrame(this.frameLoop);
    setInterval(() => this.analyze(), 500);
    setInterval(() => this.refreshPanels(), 1000);
    this.refreshPanels();
  }

  // ------------------------------------------------------------ data

  private makeSource(s: Settings): FeedSource {
    if (s.source === 'sim') {
      this.simulator ??= new Simulator();
      return new SimSource(this.simulator);
    }
    if (s.source === 'custom' && s.customUrl) return new ReadsbUrlSource(s.customUrl);
    return new RelaySource(s.relayUrl || RELAY_URL);
  }

  private onFeed({ resp, receivedAt, latencyMs }: PollResult): void {
    const { added } = this.store.ingest(resp, receivedAt, latencyMs);
    if (resp.wx && resp.wx.raw !== this.wx?.raw) {
      this.wx = resp.wx;
      const seeing = fmtSeeing(conditionsFor(resp.wx, 0, this.sun.el, Date.now()), this.settings.get().units);
      if (seeing) this.log.add(`WEATHER CHANGI ${timeSgt(resp.wx.t)} · ${seeing}`, 'system');
    }
    const wasOk = this.link.state === 'live' || this.link.state === 'sim';
    const station = resp.station;
    const stationDown = station !== undefined && !station.online;
    const anyOk = !stationDown && resp.sources.some((x) => x.ok);
    const allOk = anyOk && resp.sources.every((x) => x.ok);
    let state: LinkState = this.source.id === 'sim' ? 'sim' : anyOk ? (allOk ? 'live' : 'degraded') : 'down';
    let error: string | undefined;
    if (stationDown) {
      this.stationWaitSince ||= receivedAt;
      // Our poll just told the station someone is watching; give it a moment to start streaming.
      if (receivedAt - this.stationWaitSince < 25_000) state = 'connecting';
      else
        error =
          station.ageMs === null
            ? 'The home station has never connected to the relay.'
            : `The home station last reported ${fmtDuration(station.ageMs / 1000)} ago. Is the computer running it switched on?`;
    } else {
      this.stationWaitSince = 0;
    }
    this.link = {
      state,
      sources: resp.sources,
      latency: latencyMs,
      lastOk: anyOk ? receivedAt : this.link.lastOk,
      error,
      station,
    };
    if (!wasOk && anyOk) {
      this.log.add(
        `DATA LINK UP · ${resp.sources.filter((x) => x.ok).map((x) => SOURCE_NAMES[x.id] ?? x.id).join(' + ')}`,
        'system',
      );
    }
    for (const t of added) {
      if (!this.pictureBuilt) t.flags.announced = true;
    }
    this.analyze();
    // The first response with real data builds the picture (not an empty one while the station wakes).
    if (!this.pictureBuilt && anyOk) {
      this.pictureBuilt = true;
      const air = this.store.list().filter((t) => !t.a.gnd).length;
      this.log.add(`AIR PICTURE BUILT · ${air} AIRBORNE CONTACTS`, 'system');
    }
    this.syncHud();
  }

  private onFeedError(err: Error, n: number): void {
    if (n === 1 || n % 5 === 0) this.log.add(`DATA LINK ERROR: ${err.message.toUpperCase()} · RETRYING`, 'alert');
    this.link = { ...this.link, state: this.store.tracks.size ? 'degraded' : 'down', error: err.message };
    this.syncHud();
  }

  // ------------------------------------------------------------ analysis

  private analyze(): void {
    const now = Date.now();
    const s = this.settings.get();
    const obs = s.observer;
    const rangeKm = s.rangeKm;

    this.sun = sunPosition(now, obs.lat, obs.lon);
    this.moon = moonPosition(now, obs.lat, obs.lon);
    this.seeing = conditionsFor(this.wx, s.visKm, this.sun.el, now);
    const air = this.seeing.air;

    for (const t of this.store.list()) {
      t.route = t.a.sim ? simRoute(t.a.cs, t.a.sim.from, t.a.sim.to) : this.enricher.route(t.a.cs);
      t.aircraft = t.a.sim ? null : this.enricher.aircraftRecord(t.hex);
      t.photo = t.a.sim ? null : this.enricher.photo(t.hex);
      t.leg = t.route ? legProgress(t.route, t.a) : undefined;
      t.cls = classify(t);
      t.sight = trackSight(t, obs, now, air);
      t.cpa = closestApproach(t, now);
      t.viewEtaS = t.sight.visible ? 0 : viewEntryS(t, obs, now, air);
      this.flow.note(t, now);

      if (!t.a.sim && !t.a.gnd && t.sight.groundKm < rangeKm + 30) {
        const priority = 100 - t.sight.groundKm + (t.sight.inFov ? 30 : 0);
        this.enricher.want(t.hex, t.a.cs, priority, t === this.selected);
      }
      this.events(t, now, rangeKm);
    }

    for (const t of this.store.prune(now)) {
      if (t.flags.announced && !t.a.gnd && (t.sight?.groundKm ?? 1e9) < rangeKm) {
        this.log.add(`TN${String(t.tn).padStart(3, '0')} ${displayName(t)} · LOST CONTACT`, 'info');
      }
      if (t === this.selected) {
        this.toasts.show(`${displayName(t)}: contact lost`, 'info');
        this.select(undefined);
      }
    }

    const fl = this.flow.flow('WSSS', now);
    this.activeRunways = [...new Set([...fl.arr, ...fl.dep])].sort();
    if (fl.dir && fl.dir !== this.flowDir) {
      this.flowDir = fl.dir;
      const towards = fl.dir === '02' ? 'NNE' : 'SSW';
      this.log.add(`CHANGI FLOW ${fl.dir} · AIRCRAFT LANDING AND DEPARTING TOWARDS ${towards}`, 'system');
    }

    const hideAbove = s.maxAltFt;
    this.visible = this.store.list().filter((t) => {
      if (t.a.gnd && !s.showGround) return false;
      if (hideAbove && (t.altitude(now) ?? 0) > hideAbove) return false;
      return true;
    });

    this.pointed = undefined;
    const p = this.pointing;
    if (p?.upright) {
      const az = normDeg(p.az + s.compassOffset);
      let best = 12;
      for (const t of this.visible) {
        const cosd =
          Math.sin(p.el * DEG) * Math.sin(t.sight.el * DEG) +
          Math.cos(p.el * DEG) * Math.cos(t.sight.el * DEG) * Math.cos((az - t.sight.az) * DEG);
        const d = Math.acos(Math.max(-1, Math.min(1, cosd))) / DEG;
        if (d < best) {
          best = d;
          this.pointed = t;
        }
      }
    }
  }

  /** Log lines, sounds and toasts for things worth knowing about. */
  private events(t: Track, now: number, rangeKm: number): void {
    const s = this.settings.get();
    const tn = `TN${String(t.tn).padStart(3, '0')}`;
    const name = displayName(t);
    const near = !t.a.gnd && t.sight.groundKm < rangeKm;

    if (!t.flags.announced && (t.route !== undefined || now - t.firstSeen > 4000)) {
      t.flags.announced = true;
      if (near) {
        const angels = t.altitude(now) !== undefined ? (t.altitude(now)! / 1000).toFixed(1) : '?';
        this.log.add(
          `NEW CONTACT ${tn} ${name} ${t.a.type ?? ''} · BRG ${pad3(t.sight.az)} RNG ${t.sight.groundKm.toFixed(1)} KM · ANGELS ${angels}`,
          'info',
          t.hex,
        );
        if (s.alertNew) this.sfx.play('contact');
      }
    }
    if (t.cls.emergency && !t.flags.emergency) {
      t.flags.emergency = true;
      const what = emergencyText(t.cls.emergency);
      this.log.add(`!! ${tn} ${name} SQUAWKING ${t.a.sq ?? ''} · ${what}`, 'alert', t.hex);
      this.toasts.show(`⚠ ${name} squawking ${t.a.sq ?? ''} (${what})`, 'alert', t.hex, 15000);
      this.sfx.play('alarm');
    }
    if (t.cls.special && !t.flags.special && !t.a.gnd && t.sight.groundKm < 80) {
      t.flags.special = true;
      if (!t.cls.emergency) {
        const where = t.viewEtaS === 0 ? 'in your view now' : t.viewEtaS !== undefined ? `in view in ~${fmtDuration(t.viewEtaS)}` : `${t.sight.groundKm.toFixed(0)} km ${compassPoint(t.sight.az)}`;
        this.log.add(`★ ${t.cls.special.toUpperCase()} · ${name} · ${where.toUpperCase()}`, 'special', t.hex);
        if (s.alertSpecial) {
          this.toasts.show(`★ ${t.cls.special}: ${name}, ${where}`, 'special', t.hex);
          this.sfx.play('special');
        }
      }
    }
    if (t.sight.visible !== t.flags.inView) {
      t.flags.inView = t.sight.visible;
      if (t.sight.visible) {
        const guide = lookGuide(t.sight).text;
        this.log.add(`${tn} ${name} ENTERING YOUR VIEW · ${guide.toUpperCase()}`, 'view', t.hex);
        if (s.alertView && now - this.lastViewToast > 6000) {
          this.lastViewToast = now;
          this.toasts.show(`👁 ${name} in view: ${guide}`, 'view', t.hex);
          this.sfx.play('view');
        }
      }
    }
  }

  // ------------------------------------------------------------ selection

  private select(t: Track | undefined): void {
    this.selected = t;
    if (t) {
      this.sfx.play('lock');
      if (!t.a.sim) this.enricher.want(t.hex, t.a.cs, 1000, true);
    }
    this.refreshPanels();
  }

  /** Selection from the list, log or a toast. On phones, scroll back up to the scope. */
  private selectHex(hex: string): void {
    const t = this.store.tracks.get(hex);
    if (!t) return;
    this.select(t);
    if (matchMedia('(max-width: 1023px)').matches && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private step(dir: 1 | -1): void {
    const order = this.contacts.order;
    if (!order.length) return;
    const i = this.selected ? order.indexOf(this.selected.hex) : -1;
    const next = order[(i + dir + order.length) % order.length];
    if (next) this.selectHex(next);
  }

  // ------------------------------------------------------------ rendering

  /** Phones render at ~30 fps to save battery during long balcony sessions; desktops use the display rate. */
  private readonly minFrameMs = matchMedia('(pointer: coarse)').matches ? 32 : 0;
  private lastFrame = 0;

  private readonly frameLoop = (ts: number): void => {
    if (ts - this.lastFrame < this.minFrameMs) {
      requestAnimationFrame(this.frameLoop);
      return;
    }
    this.lastFrame = ts;
    const now = Date.now();
    const s = this.settings.get();
    const heading = this.pointing ? normDeg(this.pointing.az + s.compassOffset) : s.observer.facing;
    try {
      this.scope.render({
        now,
        tracks: this.visible,
        selected: this.selected,
        hovered: this.hovered ?? this.pointed,
        settings: s,
        palette: this.palette,
        frame: this.frame,
        heading,
        activeRunways: this.activeRunways,
        corners: this.corners,
      });
      this.sky.render({
        now,
        tracks: this.visible,
        selected: this.selected,
        observer: s.observer,
        frame: this.frame,
        center: this.pointing?.upright ? heading : s.observer.facing,
        palette: this.palette,
        units: s.units,
        sun: this.sun,
        moon: this.moon,
        air: this.seeing.air,
        pointer: this.pointing?.upright ? { az: heading, el: this.pointing.el } : undefined,
      });
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(this.frameLoop);
  };

  private refreshPanels(): void {
    const now = Date.now();
    const s = this.settings.get();
    const air = this.visible.filter((t) => !t.a.gnd);
    const emptyText =
      this.link.state === 'connecting'
        ? 'Establishing data link…'
        : this.link.state === 'down'
          ? 'No data link. Check your connection, or switch to Simulation in Settings.'
          : 'No contacts match this filter.';
    this.contacts.update(this.visible, this.selected, s.units, now, emptyText);
    this.detail.update(this.selected, { now, units: s.units, observer: s.observer, sunEl: this.sun.el, seeing: this.seeing });

    $('.clock .sgt').textContent = clockSgt(now);
    $('.clock .zulu').textContent = clockZulu(now);
    $('.trk b').textContent = String(air.length);

    const inView = air.filter((t) => t.sight.visible).length;
    const next = air
      .filter((t) => t.viewEtaS !== undefined && t.viewEtaS > 0)
      .sort((a, b) => a.viewEtaS! - b.viewEtaS!)[0];
    const seeing = fmtSeeing(this.seeing, s.units);
    $('.sky-next').textContent =
      `${inView} IN VIEW${seeing ? ` · ${seeing}` : ''}${next ? ` · NEXT ${displayName(next)} IN ${fmtDuration(next.viewEtaS!)}` : ''}`;
    const light = daylight(this.sun.el);
    $('.sky-light').textContent = light === 'day' ? 'DAY' : light === 'twilight' ? 'TWILIGHT' : 'NIGHT · LOOK FOR LIGHTS';

    const pointedEl = $('.pointing');
    pointedEl.hidden = !this.pointing;
    if (this.pointing) {
      const az = normDeg(this.pointing.az + s.compassOffset);
      pointedEl.textContent = this.pointed
        ? `POINTING AT ${displayName(this.pointed)} · TAP LOCK`
        : `POINTING ${pad3(az)}° ${compassPoint(az)} · ${this.pointing.upright ? `${Math.round(this.pointing.el)}° UP` : 'HOLD PHONE UP'}`;
    }

    const flowEl = $('.flow');
    const fl = this.flow.flow('WSSS', now);
    flowEl.title = fl.dir
      ? `Changi is using runway direction ${fl.dir}. Landing: ${fl.arr.join(', ') || '—'}. Taking off: ${fl.dep.join(', ') || '—'}.`
      : 'Changi runway direction appears once arrivals or departures are seen lined up.';
    // On phones "CHANGI" is dropped, so the readout stays clear of the sector's bearing labels.
    const flow = this.flowDir
      ? `<span class="long">CHANGI </span>RWY ${this.activeRunways.join(' ') || this.flowDir}`
      : this.link.state === 'sim'
        ? ''
        : 'CHANGI FLOW —';
    if (flow !== this.flowHtml) {
      this.flowHtml = flow;
      flowEl.innerHTML = flow;
      // It sits in a corner of the scope.
      this.scheduleFit();
    }
    this.settingsDlg.refreshStatus();
    this.syncLinkOverlay(now);
  }

  /** Refits the scope on the next frame, once however many changes ask for it. */
  private scheduleFit(): void {
    this.fitFrame ??= requestAnimationFrame(() => {
      this.fitFrame = undefined;
      this.fitScope();
    });
  }

  /**
   * Measures the controls in the scope's corners and, in sector mode, shrinks the scope to
   * the fan (body.sector-fit in styles.css) so there's no blank space above and below it.
   */
  private fitScope(): void {
    const canvas = this.scope.canvas.getBoundingClientRect();
    const size = (sel: string, right: boolean, bottom: boolean): [number, number] => {
      const r = $(`.scope-panel ${sel}`).getBoundingClientRect();
      if (!r.width || !r.height) return [0, 0];
      return [right ? canvas.right - r.left : r.right - canvas.left, bottom ? canvas.bottom - r.top : r.bottom - canvas.top];
    };
    this.corners = {
      tl: size('.ovl.tl', false, false),
      tr: size('.ovl.tr', true, false),
      bl: size('.ovl.bl', false, true),
      br: size('.ovl.br', true, true),
    };
    const h = this.scope.fitHeight(this.settings.get(), this.corners);
    // The panel is the canvas plus its 1 px border.
    const fit = h === undefined ? '' : `${h + 2}px`;
    if (fit === this.scopeFit) return;
    this.scopeFit = fit;
    document.body.classList.toggle('sector-fit', h !== undefined);
    document.body.style.setProperty('--scope-fit', fit || null);
  }

  private syncLinkOverlay(now: number): void {
    const s = this.settings.get();
    const down = s.source !== 'sim' && this.link.state === 'down' && !this.store.tracks.size && now - this.link.lastOk > 8000;
    $('.nolink').hidden = !down;
    if (down) {
      const stationOff = this.link.station && !this.link.station.online;
      $('.nolink h2').textContent = stationOff ? 'HOME STATION OFFLINE' : 'NO DATA LINK';
      $('.nolink .why').textContent = this.link.error ?? 'No response from the data relay.';
    }
  }

  private statusText(): string {
    const l = this.link;
    const lines = [`Link: ${l.state.toUpperCase()}${l.latency ? ` · ${Math.round(l.latency)} ms` : ''}`];
    if (l.station) {
      lines.push(
        `Home station: ${l.station.online ? 'online' : 'offline'}${l.station.ageMs !== null ? ` · last push ${fmtDuration(l.station.ageMs / 1000)} ago` : ' · never connected'}`,
      );
    }
    for (const x of l.sources) {
      lines.push(
        `${(SOURCE_NAMES[x.id] ?? x.id).padEnd(9)} ${x.ok ? 'OK ' : 'ERR'} ${String(x.count).padStart(3)} aircraft` +
          `${x.ageMs ? ` · ${(x.ageMs / 1000).toFixed(0)} s old` : ''}${x.note ? ` · ${x.note}` : ''}${x.error ? ` · ${x.error}` : ''}`,
      );
    }
    if (l.error) lines.push(`Last error: ${l.error}`);
    return lines.join('\n');
  }

  private syncHud(): void {
    const s = this.settings.get();
    const led = $('.led');
    led.dataset.state = this.link.state;
    const names = this.link.sources.filter((x) => x.ok).map((x) => SOURCE_NAMES[x.id] ?? x.id);
    const text: Record<LinkState, string> = {
      connecting: this.stationWaitSince ? 'WAKING STATION' : 'CONNECTING',
      live: `LIVE ${names.join('+')}`,
      degraded: names.length ? `PARTIAL ${names.join('+')}` : 'LINK DEGRADED',
      down: this.link.station && !this.link.station.online ? 'STATION OFFLINE' : 'NO LINK',
      sim: 'SIMULATION',
    };
    $('.link-text').textContent = text[this.link.state];
    $('.sim-banner').hidden = s.source !== 'sim';
    const unitKm = s.units === 'aviation' ? KM_PER_NM : 1;
    const r = s.rangeKm / unitKm;
    $('.range').textContent = `${Number.isInteger(r) ? r : r.toFixed(1)} ${s.units === 'aviation' ? 'NM' : 'KM'}`;
    $('[data-act="mode"]').textContent = s.mode === 'ppi' ? 'PPI 360°' : 'SECTOR';
    const orient = $<HTMLButtonElement>('[data-act="orient"]');
    orient.textContent = s.orientation === 'north' ? 'NORTH UP' : 'VIEW UP';
    // A sector always looks the way you face.
    orient.disabled = s.mode === 'sector';
    orient.hidden = s.mode === 'sector';
    $('[data-act="sound"]').setAttribute('aria-pressed', String(s.sound));
    $('[data-act="sound"]').textContent = s.sound ? 'SND ON' : 'SND OFF';
    $('.sky-facing').textContent = `FACING ${compassPoint(s.observer.facing)} ${pad3(s.observer.facing)}° · VIEW ${Math.round(s.observer.fov)}°`;
    $('.post').textContent = s.configured ? s.observer.name.toUpperCase() : 'DEFAULT POST · TAP ⚙ TO SET YOURS';
  }

  private onSettings(next: Settings, prev: Settings): void {
    const o = next.observer;
    const po = prev.observer;
    if (o.lat !== po.lat || o.lon !== po.lon) {
      this.frame = new LocalFrame(o);
      this.store.setFrame(this.frame);
      this.poller.kick();
    }
    if (next.source !== prev.source || next.customUrl !== prev.customUrl || next.relayUrl !== prev.relayUrl) {
      this.source = this.makeSource(next);
      this.store.clear();
      this.select(undefined);
      this.pictureBuilt = false;
      this.link = { state: 'connecting', sources: [], latency: 0, lastOk: 0 };
      this.log.add(`SOURCE → ${next.source === 'sim' ? 'SIMULATION' : next.source === 'custom' ? 'RECEIVER' : 'LIVE RELAY'}`, 'system');
      this.poller.kick();
    }
    if (next.theme !== prev.theme) {
      this.palette = PALETTES[next.theme];
      applyThemeToCss(this.palette);
    }
    if (next.rangeKm !== prev.rangeKm && next.rangeKm > prev.rangeKm) this.poller.kick();
    this.sfx.enabled = next.sound;
    this.sfx.volume = next.volume;
    if (next.keepAwake !== prev.keepAwake) void this.keepAwake.set(next.keepAwake);
    document.body.classList.toggle('no-crt', !next.crt);
    this.analyze();
    this.syncHud();
    this.refreshPanels();
    this.scheduleFit();
  }

  // ------------------------------------------------------------ input

  private zoom(dir: 1 | -1): void {
    const cur = this.settings.get().rangeKm;
    const i = RANGES_KM.indexOf(cur as (typeof RANGES_KM)[number]);
    const next = RANGES_KM[Math.min(RANGES_KM.length - 1, Math.max(0, i + dir))];
    if (next && next !== cur) this.settings.update({ rangeKm: next });
  }

  private bindControls(): void {
    document.body.classList.toggle('no-crt', !this.settings.get().crt);
    const on = (act: string, fn: () => void) => $(`[data-act="${act}"]`).addEventListener('click', fn);
    on('range-in', () => this.zoom(-1));
    on('range-out', () => this.zoom(1));
    on('mode', () => this.settings.update((s) => ({ mode: s.mode === 'ppi' ? 'sector' : 'ppi' })));
    on('orient', () => this.settings.update((s) => ({ orientation: s.orientation === 'north' ? 'facing' : 'north' })));
    on('settings', () => this.settingsDlg.open());
    on('sound', () => {
      this.sfx.unlock();
      this.settings.update((s) => ({ sound: !s.sound }));
      if (this.settings.get().sound) {
        this.sfx.enabled = true;
        this.sfx.play('view');
      }
    });
    on('retry', () => this.poller.kick());
    on('run-sim', () => this.settings.update({ source: 'sim' }));
    const pointBtn = $<HTMLButtonElement>('[data-act="point"]');
    pointBtn.hidden = !(Compass.supported() && matchMedia('(pointer: coarse)').matches);
    pointBtn.addEventListener('click', async () => {
      if (this.compass.active) {
        this.compass.stop();
        this.pointing = undefined;
        pointBtn.setAttribute('aria-pressed', 'false');
        return;
      }
      const ok = await this.compass.start();
      pointBtn.setAttribute('aria-pressed', String(ok));
      if (!ok) this.toasts.show('No compass available (or permission denied) on this device.', 'info');
      else this.log.add('POINT MODE ON · HOLD THE PHONE UP TOWARDS THE SKY', 'system');
    });
    $('.pointing').addEventListener('click', () => {
      if (this.pointed) this.select(this.pointed);
    });

    // Scope: tap to lock, hover for bearing/range, wheel or pinch to zoom.
    const canvas = this.scope.canvas;
    const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
    let pinchBase = 0;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e);
      pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now() });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchBase = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      const p = pointers.get(e.pointerId);
      if (p) {
        p.x = x;
        p.y = y;
      }
      if (pointers.size === 2 && pinchBase > 0) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (d / pinchBase > 1.3) {
          this.zoom(-1);
          pinchBase = d;
        } else if (d / pinchBase < 0.77) {
          this.zoom(1);
          pinchBase = d;
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        this.hovered = this.scope.hit(x, y);
        canvas.style.cursor = this.hovered ? 'pointer' : 'crosshair';
        const probe = this.scope.probe(x, y);
        const s = this.settings.get();
        const unitKm = s.units === 'aviation' ? KM_PER_NM : 1;
        $('.cursor').textContent = probe
          ? `BRG ${pad3(probe.brg)} · RNG ${(probe.km / unitKm).toFixed(1)} ${s.units === 'aviation' ? 'NM' : 'KM'}`
          : '';
      }
    });
    const end = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchBase = 0;
      if (!p || e.type === 'pointercancel') return;
      const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
      if (moved < 10 && performance.now() - p.t0 < 600 && pointers.size === 0) {
        const hit = this.scope.hit(p.x, p.y, e.pointerType === 'mouse' ? 22 : 32);
        this.select(hit);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      this.hovered = undefined;
      $('.cursor').textContent = '';
    });
    let lastWheel = 0;
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (performance.now() - lastWheel < 180 || Math.abs(e.deltaY) < 4) return;
        lastWheel = performance.now();
        this.zoom(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );

    this.sky.canvas.addEventListener('click', (e) => {
      const r = this.sky.canvas.getBoundingClientRect();
      const hit = this.sky.hit(e.clientX - r.left, e.clientY - r.top);
      if (hit) this.select(hit);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || document.querySelector('dialog[open]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case '+':
        case '=':
          this.zoom(-1);
          break;
        case '-':
        case '_':
          this.zoom(1);
          break;
        case 'm':
        case 'M':
          $('[data-act="mode"]').click();
          break;
        case 'n':
        case 'N':
          $('[data-act="orient"]').click();
          break;
        case 's':
        case 'S':
          $('[data-act="sound"]').click();
          break;
        case 'j':
        case 'ArrowDown':
          this.step(1);
          e.preventDefault();
          break;
        case 'k':
        case 'ArrowUp':
          this.step(-1);
          e.preventDefault();
          break;
        case 'Escape':
          this.select(undefined);
          break;
        case ',':
          this.settingsDlg.open();
          break;
        default:
          return;
      }
    });
  }
}
