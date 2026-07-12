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

/* ─── Registry ───────────────────────────────────────────────────────── */

export const EMBASSIES: EmbassyConfig[] = [
  {
    id: 'indonesia-jakarta',
    nameAr: 'سفارة المملكة العربية السعودية في جاكرتا',
    nameEn: 'Embassy of Saudi Arabia in Jakarta',
    hostCountry: 'Indonesia',
    hostCountryAr: 'إندونيسيا',
    hostCountryCode: 'ID',
    iso3: 'IDN',
    city: 'Jakarta',
    cityAr: 'جاكرتا',
    missionType: 'EMBASSY',
    status: 'ACTIVE',
    riskLevelAr: 'متوسط',
    coordinates: { lat: -6.2297, lng: 106.8296 },
    coveredCountries: ['Indonesia'],
    coveredCountryCodes: ['ID'],
    neighboringCountriesAr: ['ماليزيا', 'سنغافورة', 'تيمور الشرقية', 'بابوا غينيا الجديدة'],
    coveredCities: ['Jakarta', 'Surabaya', 'Denpasar', 'Medan', 'Makassar'],
    coveredCitiesAr: ['جاكرتا', 'سورابايا', 'دينباسار', 'ميدان', 'ماكاسار'],
    bounds: { latMin: -11.5, latMax: 6.5, lngMin: 94.5, lngMax: 141.5 },
    mapZoom: 5,
    ports: [
      { nameAr: 'مطار سوكارنو-هاتا الدولي (جاكرتا)', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: -6.1256, lng: 106.6559 } },
      { nameAr: 'مطار نغوراه راي الدولي (بالي)', type: 'AIRPORT', status: 'MONITORED', coordinates: { lat: -8.7482, lng: 115.1671 } },
      { nameAr: 'مطار جواندا الدولي (سورابايا)', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: -7.3798, lng: 112.7869 } },
      { nameAr: 'ميناء تانجونج برايوك', type: 'SEAPORT', status: 'OPEN', coordinates: { lat: -6.1045, lng: 106.8800 } },
      { nameAr: 'معبر إنتيكونغ البري (كاليمانتان)', type: 'LAND_BORDER', status: 'PARTIAL', coordinates: { lat: 0.9539, lng: 109.9806 } },
    ],
    contacts: {
      emergencyPhone: null,
      phone: null,
      email: null,
      workingHoursAr: 'الأحد – الخميس، 9:00 ص – 4:00 م',
      afterHoursAr: null,
    },
  },
  {
    id: 'malaysia-kuala-lumpur',
    nameAr: 'سفارة المملكة العربية السعودية في كوالالمبور',
    nameEn: 'Embassy of Saudi Arabia in Kuala Lumpur',
    hostCountry: 'Malaysia',
    hostCountryAr: 'ماليزيا',
    hostCountryCode: 'MY',
    iso3: 'MYS',
    city: 'Kuala Lumpur',
    cityAr: 'كوالالمبور',
    missionType: 'EMBASSY',
    status: 'ACTIVE',
    riskLevelAr: 'منخفض',
    coordinates: { lat: 3.157, lng: 101.712 },
    coveredCountries: ['Malaysia', 'Brunei'],
    coveredCountryCodes: ['MY', 'BN'],
    neighboringCountriesAr: ['إندونيسيا', 'سنغافورة', 'تايلاند', 'بروناي'],
    coveredCities: ['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Kota Kinabalu'],
    coveredCitiesAr: ['كوالالمبور', 'بينانغ', 'جوهور باهرو', 'كوتا كينابالو'],
    bounds: { latMin: 0.5, latMax: 7.5, lngMin: 99.0, lngMax: 119.5 },
    mapZoom: 6,
    ports: [
      { nameAr: 'مطار كوالالمبور الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 2.7456, lng: 101.7099 } },
      { nameAr: 'مطار بينانغ الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 5.2971, lng: 100.2769 } },
      { nameAr: 'ميناء كلانج', type: 'SEAPORT', status: 'OPEN', coordinates: { lat: 3.0000, lng: 101.4000 } },
      { nameAr: 'معبر وودلاندز (سنغافورة)', type: 'LAND_BORDER', status: 'OPEN', coordinates: { lat: 1.4478, lng: 103.7708 } },
    ],
    contacts: {
      emergencyPhone: null,
      phone: null,
      email: null,
      workingHoursAr: 'الأحد – الخميس، 9:00 ص – 4:00 م',
      afterHoursAr: null,
    },
  },
  {
    id: 'pakistan-islamabad',
    nameAr: 'سفارة المملكة العربية السعودية في إسلام آباد',
    nameEn: 'Embassy of Saudi Arabia in Islamabad',
    hostCountry: 'Pakistan',
    hostCountryAr: 'باكستان',
    hostCountryCode: 'PK',
    iso3: 'PAK',
    city: 'Islamabad',
    cityAr: 'إسلام آباد',
    missionType: 'EMBASSY',
    status: 'ACTIVE',
    riskLevelAr: 'مرتفع',
    coordinates: { lat: 33.7215, lng: 73.0433 },
    coveredCountries: ['Pakistan'],
    coveredCountryCodes: ['PK'],
    neighboringCountriesAr: ['الهند', 'أفغانستان', 'إيران', 'الصين'],
    coveredCities: ['Islamabad', 'Karachi', 'Lahore', 'Peshawar'],
    coveredCitiesAr: ['إسلام آباد', 'كراتشي', 'لاهور', 'بيشاور'],
    bounds: { latMin: 23.5, latMax: 37.5, lngMin: 60.5, lngMax: 77.5 },
    mapZoom: 5.4,
    ports: [
      { nameAr: 'مطار إسلام آباد الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 33.5490, lng: 72.8250 } },
      { nameAr: 'مطار جناح الدولي (كراتشي)', type: 'AIRPORT', status: 'DELAYS', coordinates: { lat: 24.9065, lng: 67.1608 } },
      { nameAr: 'ميناء كراتشي', type: 'SEAPORT', status: 'OPEN', coordinates: { lat: 24.8280, lng: 66.9800 } },
      { nameAr: 'معبر طورخم (أفغانستان)', type: 'LAND_BORDER', status: 'MONITORED', coordinates: { lat: 34.1500, lng: 71.0800 } },
    ],
    contacts: {
      emergencyPhone: null,
      phone: null,
      email: null,
      workingHoursAr: 'الأحد – الخميس، 9:00 ص – 4:00 م',
      afterHoursAr: null,
    },
  },
  {
    id: 'egypt-cairo',
    nameAr: 'سفارة المملكة العربية السعودية في القاهرة',
    nameEn: 'Embassy of Saudi Arabia in Cairo',
    hostCountry: 'Egypt',
    hostCountryAr: 'مصر',
    hostCountryCode: 'EG',
    iso3: 'EGY',
    city: 'Cairo',
    cityAr: 'القاهرة',
    missionType: 'EMBASSY',
    status: 'ACTIVE',
    riskLevelAr: 'متوسط',
    coordinates: { lat: 30.0596, lng: 31.2237 },
    coveredCountries: ['Egypt'],
    coveredCountryCodes: ['EG'],
    neighboringCountriesAr: ['ليبيا', 'السودان', 'فلسطين', 'الأردن'],
    coveredCities: ['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh', 'Hurghada'],
    coveredCitiesAr: ['القاهرة', 'الإسكندرية', 'الجيزة', 'شرم الشيخ', 'الغردقة'],
    bounds: { latMin: 21.5, latMax: 32.0, lngMin: 24.5, lngMax: 37.0 },
    mapZoom: 5.6,
    ports: [
      { nameAr: 'مطار القاهرة الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 30.1219, lng: 31.4056 } },
      { nameAr: 'مطار الغردقة الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 27.1783, lng: 33.7994 } },
      { nameAr: 'ميناء الإسكندرية', type: 'SEAPORT', status: 'OPEN', coordinates: { lat: 31.2000, lng: 29.8850 } },
      { nameAr: 'معبر السلوم البري (ليبيا)', type: 'LAND_BORDER', status: 'MONITORED', coordinates: { lat: 31.5667, lng: 25.1500 } },
    ],
    contacts: {
      emergencyPhone: null,
      phone: null,
      email: null,
      workingHoursAr: 'الأحد – الخميس، 9:00 ص – 4:00 م',
      afterHoursAr: null,
    },
  },
  {
    id: 'uae-dubai-cg',
    nameAr: 'القنصلية العامة للمملكة العربية السعودية في دبي',
    nameEn: 'Consulate General of Saudi Arabia in Dubai',
    hostCountry: 'United Arab Emirates',
    hostCountryAr: 'الإمارات العربية المتحدة',
    hostCountryCode: 'AE',
    iso3: 'ARE',
    city: 'Dubai',
    cityAr: 'دبي',
    missionType: 'CONSULATE_GENERAL',
    status: 'ACTIVE',
    riskLevelAr: 'منخفض',
    coordinates: { lat: 25.2048, lng: 55.2708 },
    coveredCountries: ['United Arab Emirates'],
    coveredCountryCodes: ['AE'],
    neighboringCountriesAr: ['عُمان', 'قطر', 'السعودية', 'إيران'],
    coveredCities: ['Dubai', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah'],
    coveredCitiesAr: ['دبي', 'الشارقة', 'عجمان', 'رأس الخيمة', 'الفجيرة'],
    bounds: { latMin: 22.5, latMax: 26.5, lngMin: 51.0, lngMax: 56.5 },
    mapZoom: 7,
    ports: [
      { nameAr: 'مطار دبي الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 25.2532, lng: 55.3657 } },
      { nameAr: 'مطار آل مكتوم الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 24.8969, lng: 55.1614 } },
      { nameAr: 'ميناء جبل علي', type: 'SEAPORT', status: 'OPEN', coordinates: { lat: 25.0113, lng: 55.0612 } },
      { nameAr: 'معبر حتا البري (عُمان)', type: 'LAND_BORDER', status: 'OPEN', coordinates: { lat: 24.7690, lng: 56.1200 } },
    ],
    contacts: {
      emergencyPhone: null,
      phone: null,
      email: null,
      workingHoursAr: 'الاثنين – الجمعة، 8:30 ص – 3:30 م',
      afterHoursAr: null,
    },
  },
  {
    id: 'switzerland-geneva-pm',
    nameAr: 'البعثة الدائمة للمملكة العربية السعودية لدى الأمم المتحدة في جنيف',
    nameEn: 'Permanent Mission of Saudi Arabia to the UN in Geneva',
    hostCountry: 'Switzerland',
    hostCountryAr: 'سويسرا',
    hostCountryCode: 'CH',
    iso3: 'CHE',
    city: 'Geneva',
    cityAr: 'جنيف',
    missionType: 'PERMANENT_MISSION',
    status: 'ACTIVE',
    riskLevelAr: 'منخفض',
    coordinates: { lat: 46.2226, lng: 6.1432 },
    coveredCountries: ['Switzerland'],
    coveredCountryCodes: ['CH'],
    neighboringCountriesAr: ['فرنسا', 'ألمانيا', 'إيطاليا', 'النمسا'],
    coveredCities: ['Geneva', 'Bern', 'Zurich', 'Lausanne'],
    coveredCitiesAr: ['جنيف', 'برن', 'زيورخ', 'لوزان'],
    bounds: { latMin: 45.7, latMax: 47.9, lngMin: 5.8, lngMax: 10.6 },
    mapZoom: 7.4,
    ports: [
      { nameAr: 'مطار جنيف الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 46.2381, lng: 6.1090 } },
      { nameAr: 'مطار زيورخ الدولي', type: 'AIRPORT', status: 'OPEN', coordinates: { lat: 47.4581, lng: 8.5555 } },
      { nameAr: 'معبر بارديونيكس (فرنسا)', type: 'LAND_BORDER', status: 'OPEN', coordinates: { lat: 46.1119, lng: 6.1044 } },
    ],
    contacts: {
      emergencyPhone: null,
      phone: null,
      email: null,
      workingHoursAr: 'الاثنين – الجمعة، 9:00 ص – 5:00 م',
      afterHoursAr: null,
    },
  },
];

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
