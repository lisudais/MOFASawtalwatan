import type { Traveler, SaudisAbroadData } from '../types';
import { SAUDIS_ABROAD_COLORS, SAUDIS_ABROAD_OTHER_COLOR } from '../constants';
import { SAUDIS_ABROAD_TOTAL, saudiCountriesRanked } from './saudiDistribution';

// The 4 hand-written travelers keep their original ids/alert links (e.g. the
// ALERTED Beirut case wired to alert 'mock-1'); the rest of the 100-citizen
// presence layer is generated below from real city coordinates.
const BASE_TRAVELERS: Traveler[] = [
  {
    id: 'trav-1',
    nameAr: 'محمد العتيبي',
    nameEn: 'Mohammed Al-Otaibi',
    passportNumber: 'A12345678',
    destination: 'Beirut, Lebanon',
    countryCode: 'LB',
    lat: 33.8938,
    lng: 35.5018,
    arrivalDate: new Date(Date.now() - 2 * 86400000),
    departureDate: new Date(Date.now() + 5 * 86400000),
    phone: '+966501234567',
    status: 'ALERTED',
    alerts: ['mock-1'],
  },
  {
    id: 'trav-2',
    nameAr: 'سارة القحطاني',
    nameEn: 'Sarah Al-Qahtani',
    passportNumber: 'B98765432',
    destination: 'Karachi, Pakistan',
    countryCode: 'PK',
    lat: 24.8607,
    lng: 67.0011,
    arrivalDate: new Date(Date.now() - 1 * 86400000),
    departureDate: new Date(Date.now() + 8 * 86400000),
    phone: '+966559876543',
    status: 'ACTIVE',
    alerts: ['mock-3'],
  },
  {
    id: 'trav-3',
    nameAr: 'فهد الحربي',
    nameEn: 'Fahad Al-Harbi',
    passportNumber: 'C55566677',
    destination: 'Kinshasa, DRC',
    countryCode: 'CD',
    lat: -4.4419,
    lng: 15.2663,
    arrivalDate: new Date(Date.now() - 3 * 86400000),
    departureDate: new Date(Date.now() + 3 * 86400000),
    phone: '+966512345678',
    status: 'SAFE',
    alerts: [],
  },
  {
    id: 'trav-4',
    nameAr: 'نورة الدوسري',
    nameEn: 'Noura Al-Dosari',
    passportNumber: 'D11122233',
    destination: 'Mogadishu, Somalia',
    countryCode: 'SO',
    lat: 2.0469,
    lng: 45.3182,
    arrivalDate: new Date(Date.now() - 6 * 86400000),
    departureDate: new Date(Date.now() + 1 * 86400000),
    phone: '+966598765432',
    status: 'ACTIVE',
    alerts: [],
  },
];

// ── Generated Saudi-presence citizens (تواجد السعوديين) ─────────────────────
// 96 more mock citizens spread over real world cities, bringing the layer to a
// round 100. Fully DETERMINISTIC (index-driven, no Math.random) so every dot
// keeps its position, name and status across reloads.

const FIRST_NAMES: { ar: string; en: string }[] = [
  { ar: 'عبدالله', en: 'Abdullah' }, { ar: 'محمد', en: 'Mohammed' },
  { ar: 'فيصل', en: 'Faisal' },     { ar: 'خالد', en: 'Khalid' },
  { ar: 'سلطان', en: 'Sultan' },    { ar: 'تركي', en: 'Turki' },
  { ar: 'بندر', en: 'Bandar' },     { ar: 'ناصر', en: 'Nasser' },
  { ar: 'سعود', en: 'Saud' },       { ar: 'ماجد', en: 'Majed' },
  { ar: 'نورة', en: 'Noura' },      { ar: 'سارة', en: 'Sarah' },
  { ar: 'ريم', en: 'Reem' },        { ar: 'لطيفة', en: 'Latifa' },
  { ar: 'هند', en: 'Hind' },        { ar: 'العنود', en: 'Alanoud' },
  { ar: 'جواهر', en: 'Jawaher' },   { ar: 'منيرة', en: 'Munira' },
  { ar: 'لمى', en: 'Lama' },        { ar: 'دانة', en: 'Dana' },
];

const LAST_NAMES: { ar: string; en: string }[] = [
  { ar: 'العتيبي', en: 'Al-Otaibi' },   { ar: 'القحطاني', en: 'Al-Qahtani' },
  { ar: 'الحربي', en: 'Al-Harbi' },     { ar: 'الدوسري', en: 'Al-Dosari' },
  { ar: 'الشمري', en: 'Al-Shammari' },  { ar: 'المطيري', en: 'Al-Mutairi' },
  { ar: 'الغامدي', en: 'Al-Ghamdi' },   { ar: 'الزهراني', en: 'Al-Zahrani' },
  { ar: 'السبيعي', en: 'Al-Subaie' },   { ar: 'العنزي', en: 'Al-Anazi' },
  { ar: 'الشهري', en: 'Al-Shehri' },    { ar: 'المالكي', en: 'Al-Malki' },
  { ar: 'البقمي', en: 'Al-Buqami' },    { ar: 'الرشيدي', en: 'Al-Rashidi' },
  { ar: 'السهلي', en: 'Al-Sahli' },     { ar: 'اليامي', en: 'Al-Yami' },
];

// Real cities with coordinates — weighted toward where Saudis actually travel
// (Gulf, Egypt, Turkey, Europe, US/Asia hubs) plus the crisis regions the
// dashboard monitors, so the presence layer exercises every risk state.
const PRESENCE_CITIES: { city: string; countryCode: string; lat: number; lng: number }[] = [
  { city: 'Dubai, UAE', countryCode: 'AE', lat: 25.2048, lng: 55.2708 },
  { city: 'Abu Dhabi, UAE', countryCode: 'AE', lat: 24.4539, lng: 54.3773 },
  { city: 'Manama, Bahrain', countryCode: 'BH', lat: 26.2285, lng: 50.5860 },
  { city: 'Kuwait City, Kuwait', countryCode: 'KW', lat: 29.3759, lng: 47.9774 },
  { city: 'Doha, Qatar', countryCode: 'QA', lat: 25.2854, lng: 51.5310 },
  { city: 'Muscat, Oman', countryCode: 'OM', lat: 23.5880, lng: 58.3829 },
  { city: 'Cairo, Egypt', countryCode: 'EG', lat: 30.0444, lng: 31.2357 },
  { city: 'Alexandria, Egypt', countryCode: 'EG', lat: 31.2001, lng: 29.9187 },
  { city: 'Amman, Jordan', countryCode: 'JO', lat: 31.9539, lng: 35.9106 },
  { city: 'Istanbul, Turkey', countryCode: 'TR', lat: 41.0082, lng: 28.9784 },
  { city: 'Ankara, Turkey', countryCode: 'TR', lat: 39.9334, lng: 32.8597 },
  { city: 'London, UK', countryCode: 'GB', lat: 51.5074, lng: -0.1278 },
  { city: 'Manchester, UK', countryCode: 'GB', lat: 53.4808, lng: -2.2426 },
  { city: 'Paris, France', countryCode: 'FR', lat: 48.8566, lng: 2.3522 },
  { city: 'Berlin, Germany', countryCode: 'DE', lat: 52.5200, lng: 13.4050 },
  { city: 'Munich, Germany', countryCode: 'DE', lat: 48.1351, lng: 11.5820 },
  { city: 'Madrid, Spain', countryCode: 'ES', lat: 40.4168, lng: -3.7038 },
  { city: 'Rome, Italy', countryCode: 'IT', lat: 41.9028, lng: 12.4964 },
  { city: 'Vienna, Austria', countryCode: 'AT', lat: 48.2082, lng: 16.3738 },
  { city: 'Geneva, Switzerland', countryCode: 'CH', lat: 46.2044, lng: 6.1432 },
  { city: 'New York, USA', countryCode: 'US', lat: 40.7128, lng: -74.0060 },
  { city: 'Los Angeles, USA', countryCode: 'US', lat: 34.0522, lng: -118.2437 },
  { city: 'Houston, USA', countryCode: 'US', lat: 29.7604, lng: -95.3698 },
  { city: 'Washington DC, USA', countryCode: 'US', lat: 38.9072, lng: -77.0369 },
  { city: 'Toronto, Canada', countryCode: 'CA', lat: 43.6532, lng: -79.3832 },
  { city: 'Kuala Lumpur, Malaysia', countryCode: 'MY', lat: 3.1390, lng: 101.6869 },
  { city: 'Jakarta, Indonesia', countryCode: 'ID', lat: -6.2088, lng: 106.8456 },
  { city: 'Singapore', countryCode: 'SG', lat: 1.3521, lng: 103.8198 },
  { city: 'Tokyo, Japan', countryCode: 'JP', lat: 35.6762, lng: 139.6503 },
  { city: 'Seoul, South Korea', countryCode: 'KR', lat: 37.5665, lng: 126.9780 },
  { city: 'Mumbai, India', countryCode: 'IN', lat: 19.0760, lng: 72.8777 },
  { city: 'Islamabad, Pakistan', countryCode: 'PK', lat: 33.6844, lng: 73.0479 },
  { city: 'Beirut, Lebanon', countryCode: 'LB', lat: 33.8938, lng: 35.5018 },
  { city: 'Baghdad, Iraq', countryCode: 'IQ', lat: 33.3152, lng: 44.3661 },
  { city: 'Khartoum, Sudan', countryCode: 'SD', lat: 15.5007, lng: 32.5599 },
  { city: 'Addis Ababa, Ethiopia', countryCode: 'ET', lat: 9.0320, lng: 38.7469 },
  { city: 'Nairobi, Kenya', countryCode: 'KE', lat: -1.2921, lng: 36.8219 },
  { city: 'Lagos, Nigeria', countryCode: 'NG', lat: 6.5244, lng: 3.3792 },
  { city: 'Casablanca, Morocco', countryCode: 'MA', lat: 33.5731, lng: -7.5898 },
  { city: 'Tunis, Tunisia', countryCode: 'TN', lat: 36.8065, lng: 10.1815 },
  { city: 'Algiers, Algeria', countryCode: 'DZ', lat: 36.7538, lng: 3.0588 },
  { city: 'Sydney, Australia', countryCode: 'AU', lat: -33.8688, lng: 151.2093 },
  { city: 'São Paulo, Brazil', countryCode: 'BR', lat: -23.5505, lng: -46.6333 },
  { city: 'Buenos Aires, Argentina', countryCode: 'AR', lat: -34.6037, lng: -58.3816 },
  { city: 'Kyiv, Ukraine', countryCode: 'UA', lat: 50.4501, lng: 30.5234 },
  { city: 'Sarajevo, Bosnia', countryCode: 'BA', lat: 43.8563, lng: 18.4131 },
  { city: 'Tbilisi, Georgia', countryCode: 'GE', lat: 41.7151, lng: 44.8271 },
  { city: 'Baku, Azerbaijan', countryCode: 'AZ', lat: 40.4093, lng: 49.8671 },
  // Ensure every consulate sub-dashboard (embassies.ts registry) has citizens
  // in scope — these cover the registry countries missing from the list above.
  { city: 'Aden, Yemen', countryCode: 'YE', lat: 12.7855, lng: 45.0187 },
  { city: 'Beijing, China', countryCode: 'CN', lat: 39.9042, lng: 116.4074 },
  { city: 'Shanghai, China', countryCode: 'CN', lat: 31.2304, lng: 121.4737 },
  { city: 'Auckland, New Zealand', countryCode: 'NZ', lat: -36.8509, lng: 174.7645 },
];

// Mostly safe/active; a sprinkle of ALERTED and rare EVACUATED so the presence
// layer shows every status colour without looking like a crisis everywhere.
const STATUS_CYCLE: Traveler['status'][] = [
  'ACTIVE', 'SAFE', 'ACTIVE', 'SAFE', 'ACTIVE', 'SAFE', 'ACTIVE',
  'ALERTED', 'ACTIVE', 'SAFE', 'ACTIVE', 'SAFE', 'ALERTED', 'SAFE',
  'ACTIVE', 'SAFE', 'ACTIVE', 'EVACUATED', 'SAFE', 'ACTIVE',
];

function generatePresenceTravelers(count: number): Traveler[] {
  const out: Traveler[] = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    // Offset last-name index so name pairs don't repeat in lockstep.
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
    const cityInfo = PRESENCE_CITIES[i % PRESENCE_CITIES.length];
    // Small deterministic scatter (~±0.15°) so citizens sharing a city don't
    // stack on the exact same pixel.
    const jLat = (((i * 37) % 100) / 100 - 0.5) * 0.3;
    const jLng = (((i * 61) % 100) / 100 - 0.5) * 0.3;
    const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
    const stayedDays = (i % 13) + 1;      // arrived 1–13 days ago
    const remainingDays = (i % 9) + 1;    // departs in 1–9 days
    out.push({
      id: `trav-gen-${i + 1}`,
      nameAr: `${first.ar} ${last.ar}`,
      nameEn: `${first.en} ${last.en}`,
      passportNumber: `${String.fromCharCode(69 + (i % 20))}${String(10000000 + i * 137913).slice(0, 8)}`,
      destination: cityInfo.city,
      countryCode: cityInfo.countryCode,
      lat: cityInfo.lat + jLat,
      lng: cityInfo.lng + jLng,
      arrivalDate: new Date(Date.now() - stayedDays * 86400000),
      departureDate: new Date(Date.now() + remainingDays * 86400000),
      phone: `+9665${String(10000000 + i * 731371).slice(0, 8)}`,
      status,
      alerts: status === 'ALERTED' || status === 'EVACUATED' ? [`mock-gen-${i + 1}`] : [],
    });
  }
  return out;
}

/** The full تواجد السعوديين layer: 4 curated + 96 generated = 100 citizens. */
export const MOCK_TRAVELERS: Traveler[] = [
  ...BASE_TRAVELERS,
  ...generatePresenceTravelers(96),
];

// The "Saudis Abroad" national overview is now derived from the SINGLE unified
// distribution source (saudiDistribution.ts), so the sidebar total, the world
// map's distribution points, and each consulate counter all agree. Top-6
// countries are shown explicitly; the rest roll into "دول أخرى".
const SAUDIS_ABROAD_TOP_N = 6;

export function getSaudisAbroadData(): SaudisAbroadData {
  const total = SAUDIS_ABROAD_TOTAL;
  const ranked = saudiCountriesRanked();
  const top = ranked.slice(0, SAUDIS_ABROAD_TOP_N);
  const topSum = top.reduce((s, c) => s + c.count, 0);
  const otherCount = total - topSum;

  const countries = top.map((c, i) => ({
    country: c.countryAr,
    countryCode: c.countryCode,
    count: c.count,
    percentage: Math.round((c.count / total) * 1000) / 10,
    color: SAUDIS_ABROAD_COLORS[i % SAUDIS_ABROAD_COLORS.length],
  }));

  return {
    total,
    countries,
    otherCount,
    otherPercentage: Math.round((otherCount / total) * 1000) / 10,
    otherColor: SAUDIS_ABROAD_OTHER_COLOR,
  };
}

// Comprehensive per-country Saudi presence lives in its own dependency-free
// module; re-exported here so existing imports (`from '../services/mockData'`)
// keep working unchanged.
export { saudiResidents, getSaudiPresence, type SaudiPresence } from './saudiPresence';
