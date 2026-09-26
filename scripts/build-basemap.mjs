#!/usr/bin/env node
/**
 * Builds src/map/basemap.json — the "video map" drawn under the radar sweep.
 *
 * Source: OpenStreetMap via the Overpass API (© OpenStreetMap contributors, ODbL 1.0).
 *
 *   node scripts/build-basemap.mjs            # uses cached downloads in scripts/.cache/
 *   node scripts/build-basemap.mjs --refresh  # re-downloads from Overpass
 *
 * Steps:
 *   1. Download coastline ways, runways and the East Coast Park outline for the region.
 *   2. Stitch coastline ways into chains by shared node ids.
 *   3. Closed chains are islands. Open chains (mainland Johor, big islands leaving the box)
 *      are clipped to the box and closed along its edges. OSM coastlines keep land on the
 *      left, so walking the box edge counter-clockwise from each exit reaches the next entry.
 *   4. Simplify with Douglas–Peucker, finer near the East Coast and coarser farther out,
 *      drop specks, and round to 5 decimals (~1 m).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'scripts', '.cache');
const OUT_FILE = path.join(ROOT, 'src', 'map', 'basemap.json');
const REFRESH = process.argv.includes('--refresh');

/** Map box: ±60 km around the East Coast, enough for the 60 km max radar range. */
const BOX = { s: 0.75, w: 103.35, n: 1.85, e: 104.55 };
const CENTER = { lat: 1.3, lon: 103.93 };

const OVERPASS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'RedCoast-basemap/1.0 (+https://github.com/lproperty/RedCoast)';

/** Known aerodromes; runways are assigned to the nearest one. */
const AERODROMES = [
  { id: 'WSSS', lat: 1.3644, lon: 103.9915 }, // Changi
  { id: 'WSAP', lat: 1.3602, lon: 103.9098 }, // Paya Lebar Air Base
  { id: 'WSSL', lat: 1.4167, lon: 103.8678 }, // Seletar
  { id: 'WSAT', lat: 1.3872, lon: 103.7086 }, // Tengah Air Base
  { id: 'WSAG', lat: 1.4253, lon: 103.8129 }, // Sembawang Air Base
  { id: 'SUDONG', lat: 1.2053, lon: 103.7195 }, // Pulau Sudong (military)
  { id: 'WIDD', lat: 1.121, lon: 104.119 }, // Batam Hang Nadim
  { id: 'WMKJ', lat: 1.6413, lon: 103.67 }, // Johor Senai
  { id: 'WIDN', lat: 0.9227, lon: 104.5324 }, // Tanjung Pinang
  { id: 'WIDT', lat: 1.0527, lon: 103.3919 }, // Karimun
];

// ---------------------------------------------------------------- geometry helpers

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((CENTER.lat * Math.PI) / 180);

/** Equirectangular km offsets from CENTER; accurate to <0.1% at this scale. */
const toKm = ([lon, lat]) => [(lon - CENTER.lon) * KM_PER_DEG_LON, (lat - CENTER.lat) * KM_PER_DEG_LAT];
const distFromCenterKm = (p) => Math.hypot(...toKm(p));

/** Simplification tolerance (km) as a function of distance from the East Coast. */
function toleranceKm(dKm) {
  if (dKm < 12) return 0.012;
  if (dKm < 25) return 0.025;
  if (dKm < 45) return 0.05;
  return 0.09;
}

function segDistKm(p, a, b) {
  const [px, py] = toKm(p);
  const [ax, ay] = toKm(a);
  const [bx, by] = toKm(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker with a tolerance that depends on where the segment is. Iterative. */
function simplify(points) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = points[i];
    const b = points[j];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const tol = toleranceKm(distFromCenterKm(mid));
    let maxD = -1;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDistKm(points[k], a, b);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** Simplify a closed ring (first point == last point) without collapsing it. */
function simplifyRing(ring) {
  const open = ring.slice(0, -1);
  if (open.length < 4) return ring;
  // Split at the point farthest from the first so both halves have real extent.
  let far = 0;
  let farD = -1;
  for (let k = 1; k < open.length; k++) {
    const d = Math.hypot(open[k][0] - open[0][0], open[k][1] - open[0][1]);
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const a = simplify(open.slice(0, far + 1));
  const b = simplify([...open.slice(far), open[0]]);
  return [...a, ...b.slice(1)];
}

function ringAreaKm2(ring) {
  let s = 0;
  for (let k = 0; k < ring.length - 1; k++) {
    const [x1, y1] = toKm(ring[k]);
    const [x2, y2] = toKm(ring[k + 1]);
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

const inside = ([x, y]) => x >= BOX.w && x <= BOX.e && y >= BOX.s && y <= BOX.n;

/** Sutherland–Hodgman clip of a closed ring against the map box. */
function clipRing(ring) {
  const edges = [
    { in: (p) => p[0] >= BOX.w, x: (a, b) => lerpX(a, b, BOX.w) },
    { in: (p) => p[0] <= BOX.e, x: (a, b) => lerpX(a, b, BOX.e) },
    { in: (p) => p[1] >= BOX.s, x: (a, b) => lerpY(a, b, BOX.s) },
    { in: (p) => p[1] <= BOX.n, x: (a, b) => lerpY(a, b, BOX.n) },
  ];
  let out = ring.slice(0, -1);
  for (const edge of edges) {
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const cur = input[k];
      const prev = input[(k + input.length - 1) % input.length];
      if (edge.in(cur)) {
        if (!edge.in(prev)) out.push(edge.x(prev, cur));
        out.push(cur);
      } else if (edge.in(prev)) {
        out.push(edge.x(prev, cur));
      }
    }
    if (!out.length) return null;
  }
  return [...out, out[0]];
}
function lerpX(a, b, x) {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
function lerpY(a, b, y) {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

/** Liang–Barsky: the part of segment a→b inside the box, or null. */
function clipSegment(a, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks = [
    [-dx, a[0] - BOX.w],
    [dx, BOX.e - a[0]],
    [-dy, a[1] - BOX.s],
    [dy, BOX.n - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/** Clip an open polyline into the pieces that lie inside the box. */
function clipPolyline(points) {
  const pieces = [];
  let cur = null;
  for (let k = 0; k < points.length - 1; k++) {
    const seg = clipSegment(points[k], points[k + 1]);
    if (!seg) {
      if (cur) pieces.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = [seg[0]];
    cur.push(seg[1]);
    if (!inside(points[k + 1])) {
      pieces.push(cur);
      cur = null;
    }
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.length >= 2);
}

/** Position of a boundary point on the box perimeter, counter-clockwise from the SW corner, in [0, 4). */
function perimeterParam([x, y]) {
  const eps = 1e-9;
  if (Math.abs(y - BOX.s) < eps) return (x - BOX.w) / (BOX.e - BOX.w);
  if (Math.abs(x - BOX.e) < eps) return 1 + (y - BOX.s) / (BOX.n - BOX.s);
  if (Math.abs(y - BOX.n) < eps) return 2 + (BOX.e - x) / (BOX.e - BOX.w);
  if (Math.abs(x - BOX.w) < eps) return (3 + (BOX.n - y) / (BOX.n - BOX.s)) % 4;
  return null;
}
const CORNERS = [
  [BOX.w, BOX.s],
  [BOX.e, BOX.s],
  [BOX.e, BOX.n],
  [BOX.w, BOX.n],
];

/** Close open coastline pieces into land polygons by walking the box edge counter-clockwise. */
function closeAlongBox(pieces) {
  const items = [];
  for (const pts of pieces) {
    const pin = perimeterParam(pts[0]);
    const pout = perimeterParam(pts[pts.length - 1]);
    if (pin === null || pout === null) continue; // piece does not touch the edge: cannot close
    items.push({ pts, pin, pout });
  }
  const ccw = (a, b) => (((b - a) % 4) + 4) % 4;
  const unused = new Set(items);
  const rings = [];
  while (unused.size) {
    const start = unused.values().next().value;
    unused.delete(start);
    const ring = [...start.pts];
    let cur = start;
    for (let guard = 0; guard < items.length + 1; guard++) {
      let best = null;
      let bestD = Infinity;
      for (const it of items) {
        const d = ccw(cur.pout, it.pin);
        if (d < bestD && (unused.has(it) || it === start)) {
          bestD = d;
          best = it;
        }
      }
      if (!best) break;
      // Add the box corners passed while walking from cur.pout to best.pin.
      let k = Math.floor(cur.pout) + 1;
      while (k < cur.pout + bestD + 1e-12) {
        ring.push(CORNERS[k % 4]);
        k++;
      }
      if (best === start) break;
      unused.delete(best);
      ring.push(...best.pts);
      cur = best;
    }
    ring.push(ring[0]);
    rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------- data download

async function overpass(name, query) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (!REFRESH && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (const url of OVERPASS) {
    try {
      console.log(`  ${name}: querying ${new URL(url).host} …`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) {
        console.warn(`  ${name}: HTTP ${res.status} from ${url}`);
        continue;
      }
      const json = await res.json();
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(json));
      return json;
    } catch (err) {
      console.warn(`  ${name}: ${err.message} from ${url}`);
    }
  }
  throw new Error(`All Overpass endpoints failed for ${name}`);
}

const bbox = `${BOX.s},${BOX.w},${BOX.n},${BOX.e}`;

// ---------------------------------------------------------------- build

const round = (v) => Math.round(v * 1e5) / 1e5;
const roundPts = (pts) => pts.map(([x, y]) => [round(x), round(y)]);

async function buildLand() {
  const data = await overpass(
    'coastline',
    `[out:json][timeout:240];way["natural"="coastline"](${bbox});out geom;`,
  );
  const ways = data.elements
    .filter((e) => e.type === 'way' && e.geometry?.length >= 2)
    .map((e) => ({ nodes: e.nodes, pts: e.geometry.map((g) => [g.lon, g.lat]) }));

  // Stitch ways into chains by shared end nodes.
  const byStart = new Map(ways.map((w) => [w.nodes[0], w]));
  const byEnd = new Map(ways.map((w) => [w.nodes[w.nodes.length - 1], w]));
  const remaining = new Set(ways);
  const chains = [];
  while (remaining.size) {
    const w = remaining.values().next().value;
    remaining.delete(w);
    const nodes = [...w.nodes];
    const pts = [...w.pts];
    for (;;) {
      const next = byStart.get(nodes[nodes.length - 1]);
      if (!next || !remaining.has(next)) break;
      remaining.delete(next);
      nodes.push(...next.nodes.slice(1));
      pts.push(...next.pts.slice(1));
    }
    for (;;) {
      const prev = byEnd.get(nodes[0]);
      if (!prev || !remaining.has(prev)) break;
      remaining.delete(prev);
      nodes.unshift(...prev.nodes.slice(0, -1));
      pts.unshift(...prev.pts.slice(0, -1));
    }
    chains.push({ closed: nodes[0] === nodes[nodes.length - 1], pts });
  }

  const rings = [];
  const openPieces = [];
  for (const c of chains) {
    if (c.closed) {
      if (c.pts.every(inside)) rings.push(c.pts);
      else {
        const clipped = clipRing(c.pts);
        if (clipped && clipped.length >= 4) rings.push(clipped);
      }
    } else {
      openPieces.push(...clipPolyline(c.pts));
    }
  }
  rings.push(...closeAlongBox(openPieces));

  const land = [];
  let dropped = 0;
  for (const ring of rings) {
    const area = Math.abs(ringAreaKm2(ring));
    const nearest = Math.min(...ring.map(distFromCenterKm));
    const minArea = nearest < 15 ? 0.004 : nearest < 35 ? 0.03 : 0.15;
    if (area < minArea) {
      dropped++;
      continue;
    }
    const simplified = simplifyRing(ring);
    if (simplified.length >= 4) land.push(roundPts(simplified));
  }
  land.sort((a, b) => Math.abs(ringAreaKm2(b)) - Math.abs(ringAreaKm2(a)));
  const pts = land.reduce((n, r) => n + r.length, 0);
  console.log(
    `  land: ${chains.length} chains → ${land.length} polygons (${dropped} specks dropped), ${pts} points`,
  );
  return land;
}

function bearingDeg([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x =
    Math.cos(lat1 * r) * Math.sin(lat2 * r) -
    Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

async function buildRunways() {
  const data = await overpass(
    'runways',
    `[out:json][timeout:120];way["aeroway"="runway"](${bbox});out tags geom;`,
  );
  const runways = [];
  for (const e of data.elements) {
    const ref = e.tags?.ref?.replace(/\s+/g, '');
    if (!ref || !e.geometry?.length || /^H/i.test(ref)) continue; // skip unnamed and helicopter strips
    const [d1, d2] = ref.split('/');
    if (!d1 || !d2) continue;
    let a = [e.geometry[0].lon, e.geometry[0].lat];
    let b = [e.geometry.at(-1).lon, e.geometry.at(-1).lat];
    // Make `a` the threshold of the first designator: heading a→b should match it.
    const heading = parseInt(d1, 10) * 10;
    const diff = Math.abs(((bearingDeg(a, b) - heading + 540) % 360) - 180);
    if (diff > 90) [a, b] = [b, a];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ap = AERODROMES.reduce((best, x) =>
      Math.hypot(x.lon - mid[0], x.lat - mid[1]) < Math.hypot(best.lon - mid[0], best.lat - mid[1])
        ? x
        : best,
    );
    runways.push({
      ap: ap.id,
      ids: [d1, d2],
      ends: roundPts([a, b]),
      width: Number.parseFloat(e.tags.width) || 45,
    });
  }
  runways.sort((x, y) => x.ap.localeCompare(y.ap) || x.ids[0].localeCompare(y.ids[0]));
  console.log(`  runways: ${runways.map((r) => `${r.ap} ${r.ids.join('/')}`).join(', ')}`);
  return runways;
}

async function buildParks() {
  const data = await overpass(
    'east-coast-park',
    `[out:json][timeout:120];(way["leisure"="park"]["name"="East Coast Park"](${bbox});relation["leisure"="park"]["name"="East Coast Park"](${bbox}););out geom;`,
  );
  const rings = [];
  for (const e of data.elements) {
    if (e.type === 'way' && e.geometry) rings.push(e.geometry.map((g) => [g.lon, g.lat]));
    if (e.type === 'relation') {
      for (const m of e.members ?? []) {
        if (m.role === 'outer' && m.geometry) rings.push(m.geometry.map((g) => [g.lon, g.lat]));
      }
    }
  }
  const out = rings
    .map((r) => simplify(r))
    .filter((r) => r.length >= 3)
    .map(roundPts);
  console.log(`  East Coast Park: ${out.length} outline part(s), ${out.reduce((n, r) => n + r.length, 0)} points`);
  return out;
}

console.log('Building basemap …');
const land = await buildLand();
const runways = await buildRunways();
const eastCoastPark = await buildParks();
const out = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  generated: new Date().toISOString().slice(0, 10),
  box: [BOX.w, BOX.s, BOX.e, BOX.n],
  land,
  runways,
  eastCoastPark,
};
await mkdir(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(out);
await writeFile(OUT_FILE, json);
console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
