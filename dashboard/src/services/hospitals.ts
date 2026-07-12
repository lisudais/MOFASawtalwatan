// Hospitals inside a mission's authorized geographic scope.
//
// Live data from OpenStreetMap via the Overpass API (amenity=hospital) — no
// hardcoded coordinates. Results are validated (finite coords), reduced to
// the mission scope with point-in-polygon against the REAL country boundary
// BEFORE anything reaches the UI, enriched with the distance from the
// mission, and cached (memory + localStorage, 24h) per country so the same
// scope is not re-requested.

import type { EmbassyConfig } from './embassies';
import { distanceKm } from './embassies';
import { isPointInsideBoundary, type CountryBoundary } from './countryBoundary';

export type HospitalCategory = 'GOV' | 'PRIVATE' | 'UNKNOWN';

export interface Hospital {
  id: string;
  name: string;            // name:ar > name > name:en > fallback
  city: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  emergency: boolean | null;   // OSM emergency=yes/no; null = unknown
  website: string | null;
  openingHours: string | null; // raw OSM opening_hours; null = unknown
  category: HospitalCategory;
  distanceFromMissionKm: number;
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const LS_PREFIX = 'hospitals-v1-';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 400;

const memoryCache = new Map<string, Hospital[]>();

function categorize(tags: Record<string, string>): HospitalCategory {
  const op = (tags['operator:type'] ?? tags['ownership'] ?? '').toLowerCase();
  if (['government', 'public', 'state', 'municipal'].some((k) => op.includes(k))) return 'GOV';
  if (op.includes('private')) return 'PRIVATE';
  return 'UNKNOWN';
}

function parseElements(elements: any[], embassy: EmbassyConfig, boundary: CountryBoundary): Hospital[] {
  const out: Hospital[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Scope enforcement at the DATA layer: only hospitals inside the real
    // national boundary are ever returned.
    if (!isPointInsideBoundary(lat, lng, boundary)) continue;
    const tags: Record<string, string> = el.tags ?? {};
    const name = tags['name:ar'] ?? tags.name ?? tags['name:en'] ?? 'مستشفى (بدون اسم مسجل)';
    out.push({
      id: `${el.type}-${el.id}`,
      name,
      city: tags['addr:city'] ?? tags['addr:district'] ?? null,
      lat, lng,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      emergency: tags.emergency === 'yes' ? true : tags.emergency === 'no' ? false : null,
      website: tags.website ?? tags['contact:website'] ?? null,
      openingHours: tags.opening_hours ?? null,
      category: categorize(tags),
      distanceFromMissionKm: Math.round(distanceKm(embassy.coordinates.lat, embassy.coordinates.lng, lat, lng)),
    });
  }
  out.sort((a, b) => a.distanceFromMissionKm - b.distanceFromMissionKm);
  return out.slice(0, MAX_RESULTS);
}

/** Fetch hospitals for the mission's scope. Returns null on total failure
 *  (drives the error state); [] genuinely means no hospitals in scope. */
export async function fetchHospitals(embassy: EmbassyConfig, boundary: CountryBoundary): Promise<Hospital[] | null> {
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
    `[out:json][timeout:30];nwr["amenity"="hospital"](${latMin},${lngMin},${latMax},${lngMax});out center ${MAX_RESULTS + 200};`;

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
      const hospitals = parseElements(data.elements, embassy, boundary);
      memoryCache.set(cacheKey, hospitals);
      try {
        localStorage.setItem(LS_PREFIX + cacheKey, JSON.stringify({ at: Date.now(), data: hospitals }));
      } catch { /* quota — memory cache still holds it */ }
      return hospitals;
    } catch { /* try the next mirror */ }
  }
  return null;
}

/* ─── Quick filters ──────────────────────────────────────────────────── */

export type HospitalFilter = 'ALL' | 'GOV' | 'PRIVATE' | 'EMERGENCY' | 'NEAR';

export const HOSPITAL_FILTER_AR: Record<HospitalFilter, string> = {
  ALL: 'الكل',
  GOV: 'مستشفى حكومي',
  PRIVATE: 'مستشفى خاص',
  EMERGENCY: 'طوارئ 24/7',
  NEAR: 'قريب من السفارة',
};

export const NEAR_MISSION_KM = 15;

export function applyHospitalFilter(hospitals: Hospital[], filter: HospitalFilter): Hospital[] {
  switch (filter) {
    case 'ALL': return hospitals;
    case 'GOV': return hospitals.filter((h) => h.category === 'GOV');
    case 'PRIVATE': return hospitals.filter((h) => h.category === 'PRIVATE');
    case 'EMERGENCY': return hospitals.filter((h) => h.emergency === true);
    case 'NEAR': return hospitals.filter((h) => h.distanceFromMissionKm <= NEAR_MISSION_KM);
  }
}
