// Embassy sub-dashboard configuration + permission layer.
//
// The registry below is CONFIGURATION (names, coordinates, scope boundaries,
// contacts) — not mock event data. All live incident/health/security data on
// the embassy dashboard comes from the same real services the main dashboard
// uses, filtered through `isEventInEmbassyScope` BEFORE rendering (never
// loaded globally and hidden visually).

import type { GeoEvent, Traveler } from '../types';

/* ─── Types ──────────────────────────────────────────────────────────── */

export type EmbassyStatus = 'ACTIVE' | 'SUSPENDED';
export type MissionType = 'EMBASSY' | 'CONSULATE_GENERAL' | 'CONSULATE' | 'PERMANENT_MISSION';

export const MISSION_TYPE_AR: Record<MissionType, string> = {
  EMBASSY: 'سفارة',
  CONSULATE_GENERAL: 'قنصلية عامة',
  CONSULATE: 'قنصلية',
  PERMANENT_MISSION: 'بعثة دائمة',
};
export type PortStatus = 'OPEN' | 'DELAYS' | 'CLOSED' | 'MONITORED' | 'PARTIAL';

export interface EmbassyPort {
  nameAr: string;
  type: 'AIRPORT' | 'SEAPORT' | 'LAND_BORDER';
  status: PortStatus;
  /** Real-world public coordinates — lets this same port also render as a map
   *  marker (EmbassyMap's Airports layer) instead of a separate list. Optional
   *  so a port added without coordinates still type-checks; it just won't
   *  appear on the map until filled in. */
  coordinates?: { lat: number; lng: number };
}

export interface EmbassyContacts {
  emergencyPhone: string | null;
  phone: string | null;
  email: string | null;
  workingHoursAr: string | null;
  afterHoursAr: string | null;
}

export interface EmbassyConfig {
  id: string;
  nameAr: string;
  nameEn: string;
  hostCountry: string;      // English name as used by the live feeds
  hostCountryAr: string;
  hostCountryCode: string;  // ISO alpha-2, matches GeoEvent.countryCode / Traveler.countryCode
  iso3: string;             // ISO alpha-3 — keys the real GeoJSON boundary lookup
  city: string;
  cityAr: string;
  missionType: MissionType;
  status: EmbassyStatus;
  riskLevelAr: string;      // shown in the selector list
  /** Consulate cities under this country card. When a country hosts more than
   *  one consulate they are grouped into ONE country record and listed here
   *  (e.g. الولايات المتحدة → لوس أنجلس · هيوستن · نيويورك) rather than a
   *  separate card per city. Length drives the "N قنصليات" count badge. */
  consulateCitiesAr?: string[];
  coordinates: { lat: number; lng: number };
  coveredCountries: string[];      // English names (feed matching)
  coveredCountryCodes: string[];   // ISO alpha-2 (traveler/event matching)
  neighboringCountriesAr: string[];
  coveredCities: string[];
  coveredCitiesAr: string[];
  /** Geographic scope box — geographic events inside it count as in-scope
   *  even when their country string doesn't text-match (spec requirement). */
  bounds: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  mapZoom: number;
  /** Port/border statuses come from embassy ops configuration until a real
   *  status API exists — clearly config, not invented live data. */
  ports: EmbassyPort[];
  /** Contact fields are nullable by design: production fills them from
   *  configuration/API; a null renders "غير متاح" — never a fake number. */
  contacts: EmbassyContacts;
}

/* ─── Permissions ────────────────────────────────────────────────────── */

/** What an embassy-scoped session may do. Enforced at the route + data layer:
 *  the embassy dashboard only ever receives scope-filtered data, and the
 *  route guard refuses to render an embassy the session cannot access. */
export interface EmbassyAccess {
  role: 'HQ' | 'EMBASSY';
  /** 'ALL' (HQ command center) or an explicit list of embassy ids. */
  allowedEmbassies: 'ALL' | string[];
  canSubmitFieldReport: boolean;
  canCreateFollowUpTask: boolean;
  canRequestEscalation: boolean;
  canDraftCitizenAlert: boolean;
  // Global capabilities are deliberately absent for embassy scope:
  // no global indicators, no other-embassy management, no system settings.
}

/** Session access. HQ users (the main dashboard) can open any embassy.
 *  Swap this for the real auth/claims lookup when authentication lands. */
export function getCurrentAccess(): EmbassyAccess {
  return {
    role: 'HQ',
    allowedEmbassies: 'ALL',
    canSubmitFieldReport: true,
    canCreateFollowUpTask: true,
    canRequestEscalation: true,
    canDraftCitizenAlert: true,
  };
}

export function canAccessEmbassy(access: EmbassyAccess, embassyId: string): boolean {
  return access.allowedEmbassies === 'ALL' || access.allowedEmbassies.includes(embassyId);
}

/* ─── Registry — Saudi CONSULATES, grouped by country ────────────────────
   Each COUNTRY is one record (one card), never a card per city. Countries with
   several consulates list their cities in `consulateCitiesAr` and render a
   count badge instead of repeating cards.

   Geographic fields (ISO codes, city coordinates, country names) are real,
   public facts. Operational fields have no real backend yet: `ports` is empty
   and every contact is null (renders "غير متاح", never a fake number). `status`
   is ACTIVE (these are operating consulates) and `riskLevelAr` is a static
   configuration value — the SAME mechanism the previous mission records used,
   shown as-is in the list; wire it to the live per-country feed later if a
   dynamic chip is wanted. */

interface ConsulateSeed {
  id: string;
  countryAr: string;
  countryEn: string;   // English name as the live feeds use it
  code: string;        // ISO alpha-2
  iso3: string;        // ISO alpha-3
  riskLevelAr: string; // static config value (same as prior mission records)
  cities: { ar: string; lat: number; lng: number }[]; // real city coordinates
}

// Order follows the requested list. Coordinates are the standard city centroids.
const CONSULATE_SEEDS: ConsulateSeed[] = [
  { id: 'egypt-consulates', countryAr: 'مصر', countryEn: 'Egypt', code: 'EG', iso3: 'EGY', riskLevelAr: 'متوسط',
    cities: [ { ar: 'الإسكندرية', lat: 31.2001, lng: 29.9187 }, { ar: 'السويس', lat: 29.9668, lng: 32.5498 } ] },
  { id: 'yemen-consulates', countryAr: 'اليمن', countryEn: 'Yemen', code: 'YE', iso3: 'YEM', riskLevelAr: 'مرتفع',
    cities: [ { ar: 'عدن', lat: 12.7855, lng: 45.0187 } ] },
  { id: 'pakistan-consulates', countryAr: 'باكستان', countryEn: 'Pakistan', code: 'PK', iso3: 'PAK', riskLevelAr: 'مرتفع',
    cities: [ { ar: 'كراتشي', lat: 24.8607, lng: 67.0011 } ] },
  { id: 'china-consulates', countryAr: 'الصين', countryEn: 'China', code: 'CN', iso3: 'CHN', riskLevelAr: 'منخفض',
    cities: [ { ar: 'هونغ كونغ', lat: 22.3193, lng: 114.1694 } ] },
  { id: 'turkey-consulates', countryAr: 'تركيا', countryEn: 'Turkey', code: 'TR', iso3: 'TUR', riskLevelAr: 'متوسط',
    cities: [ { ar: 'إسطنبول', lat: 41.0082, lng: 28.9784 } ] },
  { id: 'uae-consulates', countryAr: 'الإمارات', countryEn: 'United Arab Emirates', code: 'AE', iso3: 'ARE', riskLevelAr: 'منخفض',
    cities: [ { ar: 'دبي', lat: 25.2048, lng: 55.2708 } ] },
  { id: 'germany-consulates', countryAr: 'ألمانيا', countryEn: 'Germany', code: 'DE', iso3: 'DEU', riskLevelAr: 'منخفض',
    cities: [ { ar: 'فرانكفورت', lat: 50.1109, lng: 8.6821 } ] },
  { id: 'switzerland-consulates', countryAr: 'سويسرا', countryEn: 'Switzerland', code: 'CH', iso3: 'CHE', riskLevelAr: 'منخفض',
    cities: [ { ar: 'جنيف', lat: 46.2044, lng: 6.1432 } ] },
  { id: 'spain-consulates', countryAr: 'إسبانيا', countryEn: 'Spain', code: 'ES', iso3: 'ESP', riskLevelAr: 'منخفض',
    cities: [ { ar: 'ملقا', lat: 36.7213, lng: -4.4214 } ] },
  { id: 'uk-consulates', countryAr: 'المملكة المتحدة', countryEn: 'United Kingdom', code: 'GB', iso3: 'GBR', riskLevelAr: 'منخفض',
    cities: [ { ar: 'لندن', lat: 51.5074, lng: -0.1278 } ] },
  { id: 'usa-consulates', countryAr: 'الولايات المتحدة', countryEn: 'United States', code: 'US', iso3: 'USA', riskLevelAr: 'متوسط',
    cities: [ { ar: 'لوس أنجلس', lat: 34.0522, lng: -118.2437 }, { ar: 'هيوستن', lat: 29.7604, lng: -95.3698 }, { ar: 'نيويورك', lat: 40.7128, lng: -74.0060 } ] },
  { id: 'australia-consulates', countryAr: 'أستراليا', countryEn: 'Australia', code: 'AU', iso3: 'AUS', riskLevelAr: 'منخفض',
    cities: [ { ar: 'سيدني', lat: -33.8688, lng: 151.2093 } ] },
  { id: 'newzealand-consulates', countryAr: 'نيوزيلندا', countryEn: 'New Zealand', code: 'NZ', iso3: 'NZL', riskLevelAr: 'منخفض',
    cities: [ { ar: 'أوكلاند', lat: -36.8485, lng: 174.7633 } ] },
  { id: 'nigeria-consulates', countryAr: 'نيجيريا', countryEn: 'Nigeria', code: 'NG', iso3: 'NGA', riskLevelAr: 'مرتفع',
    cities: [ { ar: 'كانو', lat: 12.0022, lng: 8.5920 } ] },
];

function buildConsulate(s: ConsulateSeed): EmbassyConfig {
  const many = s.cities.length > 1;
  const primary = s.cities[0];
  const lats = s.cities.map((c) => c.lat);
  const lngs = s.cities.map((c) => c.lng);
  const PAD = 3; // degrees — keeps offshore/nearby events in scope
  return {
    id: s.id,
    nameAr: many
      ? `قنصليات المملكة العربية السعودية في ${s.countryAr}`
      : `قنصلية المملكة العربية السعودية في ${primary.ar}`,
    nameEn: `Saudi Consulate${many ? 's' : ''} — ${s.countryEn}`,
    hostCountry: s.countryEn,
    hostCountryAr: s.countryAr,
    hostCountryCode: s.code,
    iso3: s.iso3,
    city: '',
    cityAr: primary.ar,
    missionType: 'CONSULATE',
    status: 'ACTIVE',
    riskLevelAr: s.riskLevelAr,
    coordinates: { lat: primary.lat, lng: primary.lng },
    coveredCountries: [s.countryEn],
    coveredCountryCodes: [s.code],
    neighboringCountriesAr: [],
    coveredCities: [],
    coveredCitiesAr: s.cities.map((c) => c.ar),
    consulateCitiesAr: s.cities.map((c) => c.ar),
    bounds: {
      latMin: Math.min(...lats) - PAD, latMax: Math.max(...lats) + PAD,
      lngMin: Math.min(...lngs) - PAD, lngMax: Math.max(...lngs) + PAD,
    },
    mapZoom: many ? 4 : 7,
    ports: [],
    contacts: { emergencyPhone: null, phone: null, email: null, workingHoursAr: null, afterHoursAr: null },
  };
}

export const EMBASSIES: EmbassyConfig[] = CONSULATE_SEEDS.map(buildConsulate);


export function getEmbassyById(id: string): EmbassyConfig | null {
  return EMBASSIES.find((e) => e.id === id) ?? null;
}

/** Routes a country/region back to the consulate that covers it — used to
 *  hand an HQ-approved alert to the right embassy inbox. Text-match against
 *  `coveredCountries` first (handles region names like "Bali"), then ISO code.
 *  Returns undefined when no configured embassy covers that country: this
 *  system currently models a handful of missions, not global coverage, and
 *  that gap is surfaced to the approver rather than silently dropped. */
export function getEmbassyForCountryCode(countryCode: string, countryName?: string): EmbassyConfig | undefined {
  return EMBASSIES.find((e) =>
    e.coveredCountryCodes.includes(countryCode) ||
    (countryName && e.coveredCountries.some((c) => countryName.includes(c) || c.includes(countryName)))
  );
}

/* ─── Scope filtering (data layer) ───────────────────────────────────── */

function inBounds(lat: number, lng: number, b: EmbassyConfig['bounds']): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

/** In-scope = country match (name or ISO code) OR coordinates inside the
 *  embassy's geographic scope box — text matching alone misses offshore
 *  earthquakes and region-named events. */
export function isEventInEmbassyScope(event: GeoEvent, embassy: EmbassyConfig): boolean {
  if (embassy.coveredCountryCodes.includes(event.countryCode)) return true;
  if (embassy.coveredCountries.some((c) => event.country?.includes(c))) return true;
  return inBounds(event.lat, event.lng, embassy.bounds);
}

export function isTravelerInEmbassyScope(traveler: Traveler, embassy: EmbassyConfig): boolean {
  if (embassy.coveredCountryCodes.includes(traveler.countryCode)) return true;
  return inBounds(traveler.lat, traveler.lng, embassy.bounds);
}

/** Haversine distance in km — for the "citizens near danger" computation. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const PORT_STATUS_AR: Record<PortStatus, string> = {
  OPEN: 'مفتوح',
  DELAYS: 'تأخير',
  CLOSED: 'مغلق',
  MONITORED: 'مراقبة',
  PARTIAL: 'قيود جزئية',
};

export const PORT_STATUS_COLOR: Record<PortStatus, string> = {
  OPEN: '#00E676',
  DELAYS: '#FFD600',
  CLOSED: '#FF1744',
  MONITORED: '#FF6D00',
  PARTIAL: '#FFD600',
};
