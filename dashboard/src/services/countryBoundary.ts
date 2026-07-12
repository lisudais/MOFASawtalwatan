// Real host-country boundaries for the embassy sub-dashboard.
//
// Loads the exact national boundary (Polygon / MultiPolygon GeoJSON, islands
// included) by ISO3 code, caches it (memory + localStorage) so the same
// country is never re-fetched, and provides point-in-polygon validation used
// as the PRIMARY geographic filter for embassy-scope events.
//
// Sources (first success wins):
//   1. johan/world.geo.json — small simplified per-country files, CORS-open
//   2. geoBoundaries ADM0 API — authoritative, two-step (meta → geojson)
// Fallback: the embassy's configured scope box as a rectangle polygon, so the
// dashboard still works offline (clearly reported via `source: 'FALLBACK'`).

import type { EmbassyConfig } from './embassies';

export type GeoPosition = [number, number]; // [lng, lat] — GeoJSON order
export interface GeoPolygon { type: 'Polygon'; coordinates: GeoPosition[][] }
export interface GeoMultiPolygon { type: 'MultiPolygon'; coordinates: GeoPosition[][][] }
export type CountryGeometry = GeoPolygon | GeoMultiPolygon;

export interface CountryBoundary {
  iso3: string;
  geometry: CountryGeometry;
  /** [[latMin, lngMin], [latMax, lngMax]] — ready for Leaflet fitBounds. */
  bounds: [[number, number], [number, number]];
  source: 'REMOTE' | 'CACHE' | 'FALLBACK';
}

const memoryCache = new Map<string, CountryBoundary>();
const LS_PREFIX = 'country-geojson-v1-';
const TIMEOUT = 12000;

/* ─── Geometry helpers (Polygon + MultiPolygon) ──────────────────────── */

function ringContains(ring: GeoPosition[], lng: number, lat: number): boolean {
  // Standard ray-casting; ring is [lng, lat][].
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContains(polygon: GeoPosition[][], lng: number, lat: number): boolean {
  if (polygon.length === 0 || !ringContains(polygon[0], lng, lat)) return false;
  // Holes (rings after the first) exclude the point.
  for (let h = 1; h < polygon.length; h++) {
    if (ringContains(polygon[h], lng, lat)) return false;
  }
  return true;
}

/** Point-in-polygon test supporting Polygon and MultiPolygon. */
export function isPointInsideBoundary(lat: number, lng: number, boundary: CountryBoundary): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const g = boundary.geometry;
  if (g.type === 'Polygon') return polygonContains(g.coordinates, lng, lat);
  return g.coordinates.some((poly) => polygonContains(poly, lng, lat));
}

function geometryBounds(g: CountryGeometry): [[number, number], [number, number]] {
  let latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
  const scan = (ring: GeoPosition[]) => {
    for (const [lng, lat] of ring) {
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
      if (lng < lngMin) lngMin = lng;
      if (lng > lngMax) lngMax = lng;
    }
  };
  if (g.type === 'Polygon') g.coordinates.forEach(scan);
  else g.coordinates.forEach((poly) => poly.forEach(scan));
  return [[latMin, lngMin], [latMax, lngMax]];
}

/** Outer rings only — used by the map's outside-the-country dim mask. */
export function outerRings(g: CountryGeometry): GeoPosition[][] {
  return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((poly) => poly[0]);
}

/* ─── Fetch + cache ──────────────────────────────────────────────────── */

function extractGeometry(geojson: any): CountryGeometry | null {
  const geom =
    geojson?.type === 'FeatureCollection' ? geojson.features?.[0]?.geometry :
    geojson?.type === 'Feature' ? geojson.geometry :
    geojson;
  if (geom?.type === 'Polygon' || geom?.type === 'MultiPolygon') return geom;
  return null;
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchRemote(iso3: string): Promise<CountryGeometry | null> {
  // Source 1 — simplified per-country files (fast, small).
  const simple = await fetchJson(
    `https://raw.githubusercontent.com/johan/world.geo.json/master/countries/${iso3}.geo.json`
  );
  const g1 = simple && extractGeometry(simple);
  if (g1) return g1;

  // Source 2 — geoBoundaries ADM0 (meta request, then the geojson itself).
  const meta = await fetchJson(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM0/`);
  const dl = meta?.simplifiedGeometryGeoJSON ?? meta?.gjDownloadURL;
  if (typeof dl === 'string') {
    const full = await fetchJson(dl);
    const g2 = full && extractGeometry(full);
    if (g2) return g2;
  }
  return null;
}

function fallbackBoundary(embassy: EmbassyConfig): CountryBoundary {
  const { latMin, latMax, lngMin, lngMax } = embassy.bounds;
  const ring: GeoPosition[] = [
    [lngMin, latMin], [lngMax, latMin], [lngMax, latMax], [lngMin, latMax], [lngMin, latMin],
  ];
  return {
    iso3: embassy.iso3,
    geometry: { type: 'Polygon', coordinates: [ring] },
    bounds: [[latMin, lngMin], [latMax, lngMax]],
    source: 'FALLBACK',
  };
}

/** Load (and cache) the host country's boundary. Never throws — falls back
 *  to the configured scope box when every remote source fails. */
export async function fetchCountryBoundary(embassy: EmbassyConfig): Promise<CountryBoundary> {
  const iso3 = embassy.iso3;

  const cached = memoryCache.get(iso3);
  if (cached) return cached;

  try {
    const raw = localStorage.getItem(LS_PREFIX + iso3);
    if (raw) {
      const geometry = extractGeometry(JSON.parse(raw));
      if (geometry) {
        const b: CountryBoundary = { iso3, geometry, bounds: geometryBounds(geometry), source: 'CACHE' };
        memoryCache.set(iso3, b);
        return b;
      }
    }
  } catch { /* corrupt cache entry — refetch below */ }

  const geometry = await fetchRemote(iso3);
  if (geometry) {
    const b: CountryBoundary = { iso3, geometry, bounds: geometryBounds(geometry), source: 'REMOTE' };
    memoryCache.set(iso3, b);
    try { localStorage.setItem(LS_PREFIX + iso3, JSON.stringify(geometry)); } catch { /* quota — memory cache still holds it */ }
    return b;
  }

  // Fallback is memory-cached for this session only (not localStorage), so
  // the next full page load retries the remote sources.
  const fb = fallbackBoundary(embassy);
  memoryCache.set(iso3, fb);
  return fb;
}
