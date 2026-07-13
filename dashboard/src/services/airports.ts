// Airports inside a mission's authorized geographic scope.
//
// Live data from OpenStreetMap via the Overpass API (aeroway=aerodrome) — no
// hardcoded coordinates. Results are validated (finite coords), reduced to
// the mission scope with point-in-polygon against the REAL country boundary
// BEFORE anything reaches the UI, enriched with the distance from the
// mission, and cached (memory + localStorage, 24h) per country so the same
// scope is not re-requested. Mirrors services/hospitals.ts.

import type { EmbassyConfig } from './embassies';
import { distanceKm } from './embassies';
import { isPointInsideBoundary, type CountryBoundary } from './countryBoundary';

export interface Airport {
  id: string;
  type: 'AIRPORT';
  name: string;            // name:ar > name > name:en > fallback
  city: string | null;
  lat: number;
  lng: number;
  iata: string | null;
  icao: string | null;
  /** Has scheduled commercial service (IATA code) or is explicitly tagged an
   *  international aerodrome — the "major airport" signal, since OSM carries
   *  no passenger-traffic figures. */
  international: boolean;
  distanceFromMissionKm: number;
}

/** "Major" score, mirrors services/hospitals.ts's majorScore: an IATA code
 *  means scheduled commercial service; international status is the next
 *  strongest signal. Ties broken by proximity to the mission. */
function majorScore(a: Airport): number {
  let s = 0;
  if (a.iata) s += 2;
  if (a.international) s += 1;
  return s;
}

/** Picks up to `limit` major airports for the map layer — highest majorScore
 *  first, nearest-to-mission as the tiebreaker. Returns fewer than `limit`
 *  gracefully when the country genuinely has fewer valid results in scope. */
export function pickTopAirports(airports: Airport[], limit = 3): Airport[] {
  return [...airports]
    .sort((a, b) => majorScore(b) - majorScore(a) || a.distanceFromMissionKm - b.distanceFromMissionKm)
    .slice(0, limit);
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const LS_PREFIX = 'airports-v1-';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 200;

const memoryCache = new Map<string, Airport[]>();

function isInternational(tags: Record<string, string>): boolean {
  if (tags['aerodrome:type']?.toLowerCase().includes('international')) return true;
  if (tags.iata) return true; // IATA codes are only assigned to scheduled commercial airports
  const name = (tags['name:en'] ?? tags.name ?? '').toLowerCase();
  return name.includes('international') || name.includes('دولي');
}

function parseElements(elements: any[], embassy: EmbassyConfig, boundary: CountryBoundary): Airport[] {
  const out: Airport[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Scope enforcement at the DATA layer: only airports inside the real
    // national boundary are ever returned.
    if (!isPointInsideBoundary(lat, lng, boundary)) continue;
    const tags: Record<string, string> = el.tags ?? {};
    const name = tags['name:ar'] ?? tags.name ?? tags['name:en'];
    if (!name) continue; // unnamed aerodromes are almost never "major"
    out.push({
      id: `${el.type}-${el.id}`,
      type: 'AIRPORT',
      name,
      city: tags['addr:city'] ?? tags['addr:district'] ?? null,
      lat, lng,
      iata: tags.iata ?? null,
      icao: tags.icao ?? null,
      international: isInternational(tags),
      distanceFromMissionKm: Math.round(distanceKm(embassy.coordinates.lat, embassy.coordinates.lng, lat, lng)),
    });
  }
  // Major airports first (international/scheduled service), then nearest.
  out.sort((a, b) => {
    if (a.international !== b.international) return a.international ? -1 : 1;
    return a.distanceFromMissionKm - b.distanceFromMissionKm;
  });
  return out.slice(0, MAX_RESULTS);
}

/** Fetch airports for the mission's scope. Returns null on total failure
 *  (drives the error state); [] genuinely means no airports in scope. */
export async function fetchAirports(embassy: EmbassyConfig, boundary: CountryBoundary): Promise<Airport[] | null> {
  const cacheKey = embassy.iso3;

  const inMem = memoryCache.get(cacheKey);
  if (inMem) return inMem;

  try {
    const raw = localStorage.getItem(LS_PREFIX + cacheKey);
    if (raw) {
      const { at, data } = JSON.parse(raw);
      if (Date.now() - at < CACHE_TTL_MS && Array.isArray(data)) {
        memoryCache.set(cacheKey, data);
        return data;
      }
    }
  } catch { /* corrupt cache — refetch */ }

  const [[latMin, lngMin], [latMax, lngMax]] = boundary.bounds;
  const query =
    `[out:json][timeout:30];nwr["aeroway"="aerodrome"](${latMin},${lngMin},${latMax},${lngMax});out center ${MAX_RESULTS + 100};`;

  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data?.elements)) continue;
      const airports = parseElements(data.elements, embassy, boundary);
      memoryCache.set(cacheKey, airports);
      try {
        localStorage.setItem(LS_PREFIX + cacheKey, JSON.stringify({ at: Date.now(), data: airports }));
      } catch { /* quota — memory cache still holds it */ }
      return airports;
    } catch { /* try the next mirror */ }
  }
  return null;
}
