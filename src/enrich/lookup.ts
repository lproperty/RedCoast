/**
 * Looks up the "fun details" for a contact: route (origin → destination), airline,
 * registration/owner, and a photo. All sources below allow in-browser requests (CORS):
 *
 *   adsbdb.com         routes by callsign, aircraft by ICAO address
 *   hexdb.io           fallback routes and airport records
 *   planespotters.net  aircraft photos (credit and link back are required, see detail panel)
 *
 * Results are cached in localStorage; each flight is looked up at most about once a day.
 */
import { alongTrackKm, crossTrackKm, haversineKm, type LatLon } from '../geo/geo.ts';
import { AIRLINES, splitCallsign } from '../data/static/airlines.ts';
import { AIRPORTS, type AirportRef } from '../data/static/airports.ts';
import { TtlCache } from './cache.ts';
import { TaskQueue } from './queue.ts';

export interface Airport extends LatLon {
  icao: string;
  iata?: string;
  name: string;
  city?: string;
  /** ISO country code. */
  country?: string;
  countryName?: string;
}

export interface Airline {
  icao: string;
  iata?: string;
  name: string;
  country?: string;
  radio?: string;
}

export interface Route {
  callsign: string;
  /** IATA flight number, e.g. "SQ321". */
  flight?: string;
  airline?: Airline;
  /** Origin, optional stops, destination. */
  legs: Airport[];
  source: 'adsbdb' | 'hexdb' | 'sim';
}

export interface AircraftRecord {
  reg?: string;
  typeCode?: string;
  typeName?: string;
  maker?: string;
  owner?: string;
  ownerCountry?: string;
  fallbackPhoto?: Photo;
}

export interface Photo {
  src: string;
  link?: string;
  credit?: string;
  width?: number;
  height?: number;
  source: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TIMEOUT_MS = 8000;
/** After a network error, leave that lookup alone for a while. */
const RETRY_AFTER_MS = 90_000;

type Json = Record<string, any>;

async function getJson(url: string): Promise<{ status: number; body: Json | null }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, body: (await res.json()) as Json };
}

function fromRef(r: AirportRef): Airport {
  return { icao: r.icao, iata: r.iata, name: r.name, city: r.city, country: r.country, lat: r.lat, lon: r.lon };
}

function adsbdbAirport(o: Json | undefined): Airport | undefined {
  if (!o || typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return undefined;
  return {
    icao: o.icao_code,
    iata: o.iata_code || undefined,
    name: o.name,
    city: o.municipality || undefined,
    country: o.country_iso_name || undefined,
    countryName: o.country_name || undefined,
    lat: o.latitude,
    lon: o.longitude,
  };
}

/** True for callsigns that look like airline flights ("SIA321"), which is all routes can be found for. */
export function isFlightCallsign(cs: string | undefined): cs is string {
  return Boolean(splitCallsign(cs));
}

export class Enricher {
  private readonly routes = new TtlCache<Route>('route', 2000);
  private readonly aircraft = new TtlCache<AircraftRecord>('ac', 3000);
  private readonly photos = new TtlCache<Photo>('photo', 1500);
  private readonly airports = new TtlCache<Airport>('apt', 800);
  private readonly queue = new TaskQueue(2, 200);
  private readonly failedAt = new Map<string, number>();

  constructor(private readonly onUpdate: (kind: 'route' | 'aircraft' | 'photo', key: string) => void) {}

  route(cs: string | undefined): Route | null | undefined {
    return isFlightCallsign(cs) ? this.routes.get(cs) : null;
  }

  aircraftRecord(hex: string): AircraftRecord | null | undefined {
    return hex.startsWith('~') ? null : this.aircraft.get(hex);
  }

  photo(hex: string): Photo | null | undefined {
    return hex.startsWith('~') ? null : this.photos.get(hex);
  }

  /** Queue whatever is still unknown about a contact. Higher priority runs first. */
  want(hex: string, cs: string | undefined, priority: number, withPhoto = false): void {
    if (isFlightCallsign(cs) && this.routes.get(cs) === undefined) {
      this.enqueue(`r:${cs}`, priority, () => this.fetchRoute(cs));
    }
    if (!hex.startsWith('~') && this.aircraft.get(hex) === undefined) {
      this.enqueue(`a:${hex}`, priority - 1, () => this.fetchAircraft(hex));
    }
    if (withPhoto && !hex.startsWith('~') && this.photos.get(hex) === undefined) {
      this.enqueue(`p:${hex}`, priority + 1, () => this.fetchPhoto(hex));
    }
  }

  private enqueue(key: string, priority: number, run: () => Promise<void>): void {
    const failed = this.failedAt.get(key);
    if (failed && Date.now() - failed < RETRY_AFTER_MS) return;
    this.queue.add(key, priority, async () => {
      try {
        await run();
        this.failedAt.delete(key);
      } catch {
        this.failedAt.set(key, Date.now());
      }
    });
  }

  private async fetchRoute(cs: string): Promise<void> {
    let route: Route | null = null;
    const { status, body } = await getJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`);
    const fr = body?.response?.flightroute as Json | undefined;
    if (status === 200 && fr) {
      const legs = [adsbdbAirport(fr.origin), adsbdbAirport(fr.midpoint), adsbdbAirport(fr.destination)].filter(
        (x): x is Airport => Boolean(x),
      );
      if (legs.length >= 2) {
        const al = fr.airline as Json | undefined;
        // adsbdb's airline records can be years out of date (e.g. TGW is Scoot, not Tiger Airways);
        // the curated table wins when it knows the airline.
        const parts = splitCallsign(cs);
        const ref = parts ? AIRLINES[parts.icao] : undefined;
        route = {
          callsign: cs,
          flight: fr.callsign_iata || undefined,
          airline:
            ref && parts
              ? { icao: parts.icao, iata: ref.iata, name: ref.name, country: ref.country, radio: ref.radio }
              : al?.icao
                ? { icao: al.icao, iata: al.iata || undefined, name: al.name, country: al.country_iso || undefined, radio: al.callsign || undefined }
                : undefined,
          legs,
          source: 'adsbdb',
        };
      }
    }
    if (!route) route = await this.fetchHexdbRoute(cs);
    this.routes.set(cs, route, route ? 12 * HOUR : 6 * HOUR);
    this.onUpdate('route', cs);
  }

  private async fetchHexdbRoute(cs: string): Promise<Route | null> {
    const { body } = await getJson(`https://hexdb.io/api/v1/route/icao/${encodeURIComponent(cs)}`);
    const codes = typeof body?.route === 'string' ? (body.route as string).split('-').filter(Boolean) : [];
    if (codes.length < 2) return null;
    const legs = (await Promise.all(codes.map((c) => this.airportByIcao(c)))).filter((x): x is Airport => Boolean(x));
    if (legs.length < 2) return null;
    const parts = splitCallsign(cs);
    const ref = parts ? AIRLINES[parts.icao] : undefined;
    return {
      callsign: cs,
      flight: ref?.iata && parts ? `${ref.iata}${parts.number}` : undefined,
      airline: ref && parts ? { icao: parts.icao, iata: ref.iata, name: ref.name, country: ref.country, radio: ref.radio } : undefined,
      legs,
      source: 'hexdb',
    };
  }

  private async airportByIcao(icao: string): Promise<Airport | undefined> {
    const known = AIRPORTS[icao];
    if (known) return fromRef(known);
    const cached = this.airports.get(icao);
    if (cached !== undefined) return cached ?? undefined;
    const { body } = await getJson(`https://hexdb.io/api/v1/airport/icao/${encodeURIComponent(icao)}`);
    const apt: Airport | null =
      body && typeof body.latitude === 'number'
        ? {
            icao,
            iata: body.iata || undefined,
            name: body.airport,
            city: body.region_name || undefined,
            country: body.country_code || undefined,
            lat: body.latitude,
            lon: body.longitude,
          }
        : null;
    this.airports.set(icao, apt, apt ? 180 * DAY : 7 * DAY);
    return apt ?? undefined;
  }

  private async fetchAircraft(hex: string): Promise<void> {
    const { status, body } = await getJson(`https://api.adsbdb.com/v0/aircraft/${hex}`);
    const a = body?.response?.aircraft as Json | undefined;
    const rec: AircraftRecord | null =
      status === 200 && a
        ? {
            reg: a.registration || undefined,
            typeCode: a.icao_type || undefined,
            typeName: a.type || undefined,
            maker: a.manufacturer || undefined,
            owner: a.registered_owner || undefined,
            ownerCountry: a.registered_owner_country_iso_name || undefined,
            fallbackPhoto: a.url_photo_thumbnail
              ? { src: a.url_photo_thumbnail, link: a.url_photo || undefined, source: 'airport-data.com' }
              : undefined,
          }
        : null;
    this.aircraft.set(hex, rec, rec ? 30 * DAY : 7 * DAY);
    this.onUpdate('aircraft', hex);
  }

  private async fetchPhoto(hex: string): Promise<void> {
    const { body } = await getJson(`https://api.planespotters.net/pub/photos/hex/${hex}`);
    const p = (body?.photos as Json[] | undefined)?.[0];
    const img = (p?.thumbnail_large ?? p?.thumbnail) as Json | undefined;
    const photo: Photo | null = img?.src
      ? {
          src: img.src,
          width: img.size?.width,
          height: img.size?.height,
          link: p?.link,
          credit: p?.photographer,
          source: 'planespotters.net',
        }
      : null;
    this.photos.set(hex, photo, photo ? 14 * DAY : 3 * DAY);
    this.onUpdate('photo', hex);
  }
}

/** Builds a route from the simulator's hint without touching the network. */
export function simRoute(cs: string | undefined, from: string, to: string): Route | null {
  const a = AIRPORTS[from];
  const b = AIRPORTS[to];
  if (!a || !b || !cs) return null;
  const parts = splitCallsign(cs);
  const ref = parts ? AIRLINES[parts.icao] : undefined;
  return {
    callsign: cs,
    flight: ref?.iata && parts ? `${ref.iata}${parts.number}` : undefined,
    airline: ref && parts ? { icao: parts.icao, iata: ref.iata, name: ref.name, country: ref.country, radio: ref.radio } : undefined,
    legs: [fromRef(a), fromRef(b)],
    source: 'sim',
  };
}

export interface LegProgress {
  from: Airport;
  to: Airport;
  totalKm: number;
  flownKm: number;
  remainingKm: number;
  /** 0..1 along the great circle. */
  fraction: number;
  /** Whether the aircraft's position is consistent with this route at all. */
  plausible: boolean;
}

/**
 * Picks the leg of a route the aircraft is flying and how far along it is. Route databases
 * are keyed by callsign and occasionally stale, so a route that doesn't fit the aircraft's
 * position is flagged implausible rather than trusted.
 */
export function legProgress(route: Route, pos: LatLon): LegProgress | undefined {
  let best: LegProgress | undefined;
  let bestScore = Infinity;
  for (let i = 0; i < route.legs.length - 1; i++) {
    const from = route.legs[i]!;
    const to = route.legs[i + 1]!;
    const totalKm = haversineKm(from, to);
    if (totalKm < 1) continue;
    const xt = Math.abs(crossTrackKm(pos, from, to));
    const at = alongTrackKm(pos, from, to);
    const nearEnd = Math.min(haversineKm(pos, from), haversineKm(pos, to)) < 120;
    const plausible = nearEnd || (at > -50 && at < totalKm + 50 && xt < Math.max(150, totalKm * 0.15));
    const score = xt + Math.max(0, -at, at - totalKm) + (plausible ? 0 : 1e6);
    if (score < bestScore) {
      bestScore = score;
      const flownKm = Math.min(totalKm, Math.max(0, at));
      best = { from, to, totalKm, flownKm, remainingKm: totalKm - flownKm, fraction: flownKm / totalKm, plausible };
    }
  }
  return best;
}
