/**
 * The radar "video map": coastline, runways, approach centrelines and landmarks.
 * Coastline and runways come from OpenStreetMap (scripts/build-basemap.mjs).
 */
import basemap from './basemap.json';
import { bearingDeg, destination, KM_PER_NM, type LatLon } from '../geo/geo.ts';

export type Ring = [number, number][];

interface BasemapRunway {
  ap: string;
  ids: [string, string];
  ends: [[number, number], [number, number]];
  width: number;
}

interface Basemap {
  attribution: string;
  box: [number, number, number, number];
  land: Ring[];
  runways: BasemapRunway[];
  eastCoastPark: Ring[];
}

const MAP = basemap as unknown as Basemap;

export const MAP_ATTRIBUTION = MAP.attribution;
/** [west, south, east, north] of the map data. */
export const MAP_BOX = MAP.box;
export const LAND: Ring[] = MAP.land;
export const EAST_COAST_PARK: Ring[] = MAP.eastCoastPark;

/** One landing/take-off direction of a runway, e.g. "02L" at Changi. */
export interface RunwayEnd {
  ap: string;
  id: string;
  /** Threshold (start of the usable runway in this direction). */
  thr: LatLon;
  /** Far end. */
  end: LatLon;
  /** True course of the runway in this direction, degrees. */
  course: number;
  lengthKm: number;
}

export interface Runway {
  ap: string;
  ids: [string, string];
  a: LatLon;
  b: LatLon;
  widthM: number;
}

const toLL = ([lon, lat]: [number, number]): LatLon => ({ lat, lon });

export const RUNWAYS: Runway[] = MAP.runways.map((r) => ({
  ap: r.ap,
  ids: r.ids,
  a: toLL(r.ends[0]),
  b: toLL(r.ends[1]),
  widthM: r.width,
}));

export const RUNWAY_ENDS: RunwayEnd[] = RUNWAYS.flatMap((r) => {
  const lengthKm = Math.hypot((r.b.lat - r.a.lat) * 110.57, (r.b.lon - r.a.lon) * 111.32);
  return [
    { ap: r.ap, id: r.ids[0], thr: r.a, end: r.b, course: bearingDeg(r.a, r.b), lengthKm },
    { ap: r.ap, id: r.ids[1], thr: r.b, end: r.a, course: bearingDeg(r.b, r.a), lengthKm },
  ];
});

export const CHANGI_ENDS = RUNWAY_ENDS.filter((e) => e.ap === 'WSSS');

/** Extended centreline of the approach to a runway end, with a tick every nautical mile. */
export function approachLine(end: RunwayEnd, lengthNm = 12): { from: LatLon; to: LatLon; ticks: { at: LatLon; nm: number }[] } {
  const back = (end.course + 180) % 360;
  const ticks = Array.from({ length: lengthNm }, (_, i) => ({ at: destination(end.thr, back, (i + 1) * KM_PER_NM), nm: i + 1 }));
  return { from: end.thr, to: destination(end.thr, back, lengthNm * KM_PER_NM), ticks };
}

export type LandmarkKind = 'landmark' | 'airport' | 'place';

export interface Landmark extends LatLon {
  label: string;
  kind: LandmarkKind;
  /** Only label it when the display range (km) is within these bounds. */
  minRange?: number;
  maxRange?: number;
}

export const LANDMARKS: Landmark[] = [
  { label: 'CHANGI', kind: 'airport', lat: 1.3644, lon: 103.9915 },
  { label: 'PAYA LEBAR AB', kind: 'airport', lat: 1.3602, lon: 103.9098, maxRange: 40 },
  { label: 'SELETAR', kind: 'airport', lat: 1.4167, lon: 103.8678, maxRange: 40 },
  { label: 'TENGAH AB', kind: 'airport', lat: 1.3872, lon: 103.7086, minRange: 15 },
  { label: 'SEMBAWANG AB', kind: 'airport', lat: 1.4253, lon: 103.8129, minRange: 15, maxRange: 40 },
  { label: 'BATAM', kind: 'airport', lat: 1.121, lon: 104.119, minRange: 15 },
  { label: 'SENAI', kind: 'airport', lat: 1.6413, lon: 103.67, minRange: 25 },
  { label: 'TG PINANG', kind: 'airport', lat: 0.9227, lon: 104.5324, minRange: 40 },
  { label: 'MARINA BAY SANDS', kind: 'landmark', lat: 1.2837, lon: 103.8607, maxRange: 25 },
  { label: 'SINGAPORE FLYER', kind: 'landmark', lat: 1.2894, lon: 103.8633, maxRange: 10 },
  { label: 'NATIONAL STADIUM', kind: 'landmark', lat: 1.3045, lon: 103.8743, maxRange: 10 },
  { label: 'JEWEL', kind: 'landmark', lat: 1.3602, lon: 103.9897, maxRange: 10 },
  { label: 'BEDOK JETTY', kind: 'landmark', lat: 1.3064, lon: 103.9418, maxRange: 15 },
  { label: 'MARINE COVE', kind: 'landmark', lat: 1.3018, lon: 103.9128, maxRange: 10 },
  { label: 'TANAH MERAH FT', kind: 'landmark', lat: 1.3146, lon: 103.9891, maxRange: 10 },
  { label: 'EAST COAST PARK', kind: 'place', lat: 1.2985, lon: 103.9275, minRange: 5, maxRange: 25 },
  { label: 'P. UBIN', kind: 'place', lat: 1.4134, lon: 103.9659, maxRange: 40 },
  { label: 'P. TEKONG', kind: 'place', lat: 1.413, lon: 104.0529, maxRange: 40 },
  { label: 'SENTOSA', kind: 'place', lat: 1.2497, lon: 103.8298, maxRange: 40 },
  { label: 'JOHOR BAHRU', kind: 'place', lat: 1.4582, lon: 103.7649, minRange: 10 },
  { label: 'BATAM', kind: 'place', lat: 1.075, lon: 104.03, minRange: 25 },
  { label: 'BINTAN', kind: 'place', lat: 1.06, lon: 104.45, minRange: 25 },
];

/** Horizon references for the sky view: what lies in each direction at ground level. */
export const HORIZON_MARKS: { label: string; lat: number; lon: number }[] = [
  { label: 'CHANGI', lat: 1.3644, lon: 103.9915 },
  { label: 'MBS', lat: 1.2837, lon: 103.8607 },
  { label: 'STADIUM', lat: 1.3045, lon: 103.8743 },
  { label: 'BEDOK JETTY', lat: 1.3064, lon: 103.9418 },
  { label: 'BATAM', lat: 1.1318, lon: 104.0554 },
  { label: 'SENTOSA', lat: 1.2497, lon: 103.8298 },
  { label: 'P. UBIN', lat: 1.4134, lon: 103.9659 },
  { label: 'PAYA LEBAR AB', lat: 1.3602, lon: 103.9098 },
];
