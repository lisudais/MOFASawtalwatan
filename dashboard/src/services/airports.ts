// Airports for a mission's host country — STATIC data from OurAirports
// (public domain), pre-filtered to major airports (large/medium types that
// carry an IATA code) and grouped by ISO2 country in public/data/airports.json.
//
// This replaces the previous live OSM/Overpass fetch, which was slow and often
// returned nothing (leaving the map layer and the "المطارات والحدود" section
// empty). OurAirports rarely changes, so a bundled snapshot is reliable and
// works offline. Filtered to the host country's ISO2 at runtime.

import type { EmbassyConfig } from './embassies';
import { distanceKm } from './embassies';

export interface Airport {
  id: string;
  type: 'AIRPORT';
  name: string;            // real airport name (OurAirports)
  city: string | null;     // Arabic city when known, else the English municipality
  lat: number;
  lng: number;
  iata: string | null;
  icao: string | null;
  /** large_airport in OurAirports (hub / scheduled international) — the "major" signal. */
  international: boolean;
  distanceFromMissionKm: number;
}

interface RawAirport {
  iata: string; icao: string | null; name: string; city: string | null;
  cc: string; lat: number; lng: number; large: boolean;
}

// Arabic names for the host countries' hub cities, so the list/map read in
// Arabic where we have it (falls back to the English municipality otherwise).
const CITY_AR: Record<string, string> = {
  Cairo: 'القاهرة', Alexandria: 'الإسكندرية', 'Sharm el-Sheikh': 'شرم الشيخ', 'Sharm El Sheikh': 'شرم الشيخ',
  Hurghada: 'الغردقة', Luxor: 'الأقصر', Aswan: 'أسوان', 'Marsa Alam': 'مرسى علم', 'El Alamein': 'العلمين', 'Asyut': 'أسيوط',
  Dubai: 'دبي', 'Abu Dhabi': 'أبوظبي', Sharjah: 'الشارقة', 'Al Ain': 'العين', 'Ras Al Khaimah': 'رأس الخيمة',
  Istanbul: 'إسطنبول', Ankara: 'أنقرة', Izmir: 'إزمير', Antalya: 'أنطاليا', Bodrum: 'بودروم',
  Karachi: 'كراتشي', Islamabad: 'إسلام آباد', Lahore: 'لاهور', Peshawar: 'بيشاور', Quetta: 'كويتة', Multan: 'مُلتان',
  'Hong Kong': 'هونغ كونغ', Beijing: 'بكين', Shanghai: 'شنغهاي', Guangzhou: 'قوانغتشو',
  Aden: 'عدن', Sanaa: 'صنعاء', "Sana'a": 'صنعاء', Seiyun: 'سيئون',
  London: 'لندن', Manchester: 'مانشستر', Birmingham: 'برمنغهام',
  'Los Angeles': 'لوس أنجلوس', Houston: 'هيوستن', 'New York': 'نيويورك', 'Newark': 'نيوارك',
  Frankfurt: 'فرانكفورت', Berlin: 'برلين', Munich: 'ميونخ', 'München': 'ميونخ', Hamburg: 'هامبورغ',
  Geneva: 'جنيف', Zurich: 'زيورخ', 'Zürich': 'زيورخ', Basel: 'بازل',
  Madrid: 'مدريد', Barcelona: 'برشلونة', Malaga: 'مالقة', 'Málaga': 'مالقة',
  Sydney: 'سيدني', Melbourne: 'ملبورن', Brisbane: 'بريزبن', Perth: 'بيرث',
  Auckland: 'أوكلاند', Wellington: 'ويلنغتون', Christchurch: 'كرايستشيرش',
  Kano: 'كانو', Lagos: 'لاغوس', Abuja: 'أبوجا', 'Port Harcourt': 'بورت هاركورت',
  Jakarta: 'جاكرتا', Surabaya: 'سورابايا', Denpasar: 'دينباسار', 'Kuala Lumpur': 'كوالالمبور', Penang: 'بينانغ',
};

const cityAr = (city: string | null): string | null => (city ? CITY_AR[city] ?? city : null);

let _cache: Promise<Record<string, RawAirport[]>> | null = null;
function loadAll(): Promise<Record<string, RawAirport[]>> {
  if (!_cache) {
    _cache = fetch('/data/airports.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return _cache;
}

/** Major airports first (large hubs), then nearest to the mission. */
function majorScore(a: Airport): number {
  return (a.international ? 2 : 0) + (a.iata ? 1 : 0);
}
export function pickTopAirports(airports: Airport[], limit = 3): Airport[] {
  return [...airports]
    .sort((a, b) => majorScore(b) - majorScore(a) || a.distanceFromMissionKm - b.distanceFromMissionKm)
    .slice(0, limit);
}

function toAirport(r: RawAirport, missionLat: number, missionLng: number): Airport {
  return {
    id: `apt-${r.iata}`,
    type: 'AIRPORT',
    name: r.name,
    city: cityAr(r.city),
    lat: r.lat,
    lng: r.lng,
    iata: r.iata || null,
    icao: r.icao ?? null,
    international: r.large,
    distanceFromMissionKm: Math.round(distanceKm(missionLat, missionLng, r.lat, r.lng)),
  };
}

/** All airports for the mission's host country (ISO2), largest hubs first. */
export async function fetchAirports(embassy: EmbassyConfig): Promise<Airport[]> {
  const all = await loadAll();
  const raw = all[(embassy.hostCountryCode || '').toUpperCase()] ?? [];
  const list = raw.map((r) => toAirport(r, embassy.coordinates.lat, embassy.coordinates.lng));
  list.sort((a, b) => majorScore(b) - majorScore(a) || a.distanceFromMissionKm - b.distanceFromMissionKm);
  return list;
}

/** Convenience for callers that only have an ISO2 code (e.g. the airports list
 *  in the consulate dashboard). Returns up to `limit` major airports. */
export async function airportsForCountry(iso2: string, limit = 6): Promise<Airport[]> {
  const all = await loadAll();
  const raw = all[(iso2 || '').toUpperCase()] ?? [];
  const list = raw.map((r) => toAirport(r, r.lat, r.lng)); // distance 0 — not needed here
  list.sort((a, b) => majorScore(b) - majorScore(a) || a.name.localeCompare(b.name));
  return list.slice(0, limit);
}
