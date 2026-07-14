// Major hospitals for a mission's host country — MOCK data (clearly labeled).
//
// There is no free, comprehensive, reliable hospital API, and the previous live
// OSM/Overpass fetch was slow and frequently empty. So — following the same
// approved mock-data methodology used elsewhere in this project (mockData.ts) —
// this is a small curated set of well-known major hospitals per host country
// (real names + approximate coordinates), enough to populate the map layer and
// the consulate view. Replace with a real facility API when one exists.
// Filtered to the host country's ISO2.

import type { EmbassyConfig } from './embassies';
import { distanceKm } from './embassies';

export type HospitalCategory = 'GOV' | 'PRIVATE' | 'UNKNOWN';

export interface Hospital {
  id: string;
  type: 'HOSPITAL';
  name: string;            // Arabic name
  city: string | null;     // Arabic city
  lat: number;
  lng: number;
  emergency: boolean | null;
  category: HospitalCategory;
  distanceFromMissionKm: number;
}

interface RawHospital { name: string; city: string; lat: number; lng: number; emergency?: boolean; category?: HospitalCategory }

// 3–5 major hospitals per host country. Real, well-known facilities; coordinates
// are approximate. MOCK — not a live registry.
const HOSPITALS_BY_CC: Record<string, RawHospital[]> = {
  EG: [
    { name: 'مستشفى قصر العيني الجامعي', city: 'القاهرة', lat: 30.0287, lng: 31.2299, emergency: true, category: 'GOV' },
    { name: 'مستشفى دار الفؤاد', city: 'القاهرة', lat: 29.9782, lng: 30.9453, emergency: true, category: 'PRIVATE' },
    { name: 'مستشفى الجلاء', city: 'القاهرة', lat: 30.0606, lng: 31.2419, emergency: true, category: 'GOV' },
    { name: 'مستشفى الإسكندرية الجامعي (الشاطبي)', city: 'الإسكندرية', lat: 31.2103, lng: 29.9130, emergency: true, category: 'GOV' },
  ],
  AE: [
    { name: 'مستشفى راشد', city: 'دبي', lat: 25.2337, lng: 55.3117, emergency: true, category: 'GOV' },
    { name: 'مدينة الشيخ خليفة الطبية', city: 'أبوظبي', lat: 24.4215, lng: 54.4527, emergency: true, category: 'GOV' },
    { name: 'كليفلاند كلينك أبوظبي', city: 'أبوظبي', lat: 24.4979, lng: 54.3838, emergency: true, category: 'PRIVATE' },
    { name: 'مستشفى توام', city: 'العين', lat: 24.2601, lng: 55.7189, emergency: true, category: 'GOV' },
  ],
  TR: [
    { name: 'مستشفى جراح باشا الجامعي', city: 'إسطنبول', lat: 41.0060, lng: 28.9430, emergency: true, category: 'GOV' },
    { name: 'مستشفى أجيبادم الدولي', city: 'إسطنبول', lat: 40.9905, lng: 29.1230, emergency: true, category: 'PRIVATE' },
    { name: 'مستشفى أنقرة سيتي', city: 'أنقرة', lat: 39.9260, lng: 32.7360, emergency: true, category: 'GOV' },
  ],
  PK: [
    { name: 'مستشفى آغا خان الجامعي', city: 'كراتشي', lat: 24.8918, lng: 67.0742, emergency: true, category: 'PRIVATE' },
    { name: 'المستشفى المدني', city: 'كراتشي', lat: 24.8560, lng: 67.0100, emergency: true, category: 'GOV' },
    { name: 'مستشفى ميو', city: 'لاهور', lat: 31.5780, lng: 74.3070, emergency: true, category: 'GOV' },
    { name: 'معهد باكستان للعلوم الطبية', city: 'إسلام آباد', lat: 33.7010, lng: 73.0530, emergency: true, category: 'GOV' },
  ],
  CN: [
    { name: 'مستشفى الملكة ماري', city: 'هونغ كونغ', lat: 22.2703, lng: 114.1310, emergency: true, category: 'GOV' },
    { name: 'مستشفى الأمير ويلز', city: 'هونغ كونغ', lat: 22.3790, lng: 114.2010, emergency: true, category: 'GOV' },
    { name: 'مستشفى الملكة إليزابيث', city: 'هونغ كونغ', lat: 22.3093, lng: 114.1760, emergency: true, category: 'GOV' },
  ],
  YE: [
    { name: 'مستشفى الجمهورية التعليمي', city: 'عدن', lat: 12.7940, lng: 45.0250, emergency: true, category: 'GOV' },
    { name: 'مستشفى عدن العام', city: 'عدن', lat: 12.8010, lng: 45.0180, emergency: true, category: 'GOV' },
    { name: 'مستشفى الثورة العام', city: 'صنعاء', lat: 15.3620, lng: 44.2020, emergency: true, category: 'GOV' },
  ],
  GB: [
    { name: 'مستشفى سانت توماس', city: 'لندن', lat: 51.4980, lng: -0.1180, emergency: true, category: 'GOV' },
    { name: 'مستشفى تشيلسي وويستمنستر', city: 'لندن', lat: 51.4842, lng: -0.1812, emergency: true, category: 'GOV' },
    { name: 'مستشفى مانشستر الملكي', city: 'مانشستر', lat: 53.4626, lng: -2.2250, emergency: true, category: 'GOV' },
  ],
  US: [
    { name: 'مركز سيدارز-سيناء الطبي', city: 'لوس أنجلوس', lat: 34.0752, lng: -118.3800, emergency: true, category: 'PRIVATE' },
    { name: 'مستشفى هيوستن ميثوديست', city: 'هيوستن', lat: 29.7100, lng: -95.3990, emergency: true, category: 'PRIVATE' },
    { name: 'مستشفى ماونت سيناء', city: 'نيويورك', lat: 40.7900, lng: -73.9530, emergency: true, category: 'PRIVATE' },
  ],
  DE: [
    { name: 'مستشفى شاريتيه', city: 'برلين', lat: 52.5260, lng: 13.3760, emergency: true, category: 'GOV' },
    { name: 'مستشفى فرانكفورت الجامعي', city: 'فرانكفورت', lat: 50.0930, lng: 8.6650, emergency: true, category: 'GOV' },
    { name: 'مستشفى ميونخ الجامعي (LMU)', city: 'ميونخ', lat: 48.1100, lng: 11.4690, emergency: true, category: 'GOV' },
  ],
  ES: [
    { name: 'مستشفى لا باث الجامعي', city: 'مدريد', lat: 40.4800, lng: -3.6880, emergency: true, category: 'GOV' },
    { name: 'مستشفى ملقة الإقليمي', city: 'مالقة', lat: 36.7160, lng: -4.4890, emergency: true, category: 'GOV' },
    { name: 'مستشفى فال ديبرون', city: 'برشلونة', lat: 41.4280, lng: 2.1420, emergency: true, category: 'GOV' },
  ],
  CH: [
    { name: 'مستشفى جنيف الجامعي', city: 'جنيف', lat: 46.1920, lng: 6.1480, emergency: true, category: 'GOV' },
    { name: 'مستشفى زيورخ الجامعي', city: 'زيورخ', lat: 47.3770, lng: 8.5500, emergency: true, category: 'GOV' },
    { name: 'مستشفى بازل الجامعي', city: 'بازل', lat: 47.5610, lng: 7.5830, emergency: true, category: 'GOV' },
  ],
  AU: [
    { name: 'مستشفى سيدني الملكي', city: 'سيدني', lat: 33.8880, lng: 151.2210, emergency: true, category: 'GOV' },
    { name: 'مستشفى ملبورن الملكي', city: 'ملبورن', lat: 37.7990, lng: 144.9560, emergency: true, category: 'GOV' },
  ],
  NZ: [
    { name: 'مستشفى أوكلاند سيتي', city: 'أوكلاند', lat: 36.8600, lng: 174.7690, emergency: true, category: 'GOV' },
    { name: 'مستشفى ويلنغتون', city: 'ويلنغتون', lat: -41.3080, lng: 174.7800, emergency: true, category: 'GOV' },
  ],
  NG: [
    { name: 'مستشفى محمد عبد الله واسي التخصصي', city: 'كانو', lat: 12.0000, lng: 8.5170, emergency: true, category: 'GOV' },
    { name: 'مستشفى لاغوس الجامعي (LUTH)', city: 'لاغوس', lat: 6.5170, lng: 3.3540, emergency: true, category: 'GOV' },
    { name: 'المستشفى الوطني أبوجا', city: 'أبوجا', lat: 9.0550, lng: 7.4890, emergency: true, category: 'GOV' },
  ],
  ID: [
    { name: 'مستشفى شيبتومانغونكوسومو', city: 'جاكرتا', lat: -6.1860, lng: 106.7970, emergency: true, category: 'GOV' },
    { name: 'مستشفى سانغلاه', city: 'دينباسار', lat: -8.6700, lng: 115.2160, emergency: true, category: 'GOV' },
  ],
  MY: [
    { name: 'مستشفى كوالالمبور', city: 'كوالالمبور', lat: 3.1720, lng: 101.7000, emergency: true, category: 'GOV' },
    { name: 'مستشفى بينانغ العام', city: 'بينانغ', lat: 5.4160, lng: 100.3120, emergency: true, category: 'GOV' },
  ],
};

/** Picks up to `limit` major hospitals for the map layer (emergency-capable first). */
export function pickTopHospitals(hospitals: Hospital[], limit = 3): Hospital[] {
  return [...hospitals]
    .sort((a, b) => Number(b.emergency === true) - Number(a.emergency === true) || a.distanceFromMissionKm - b.distanceFromMissionKm)
    .slice(0, limit);
}

function toHospital(r: RawHospital, i: number, missionLat: number, missionLng: number): Hospital {
  return {
    id: `hosp-${i}-${r.name}`,
    type: 'HOSPITAL',
    name: r.name,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    emergency: r.emergency ?? null,
    category: r.category ?? 'UNKNOWN',
    distanceFromMissionKm: Math.round(distanceKm(missionLat, missionLng, r.lat, r.lng)),
  };
}

/** Major hospitals for the mission's host country (mock, ISO2-filtered). */
export async function fetchHospitals(embassy: EmbassyConfig): Promise<Hospital[]> {
  const raw = HOSPITALS_BY_CC[(embassy.hostCountryCode || '').toUpperCase()] ?? [];
  return raw.map((r, i) => toHospital(r, i, embassy.coordinates.lat, embassy.coordinates.lng));
}
