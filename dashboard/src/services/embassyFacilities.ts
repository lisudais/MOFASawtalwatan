// Two mock-data layers for the embassy map — both clearly scoped and
// documented as placeholders, never presented as verified/live data. Both
// are distributed across each host country's major cities (not just the
// capital), matching the country-wide boundary/fitBounds view.

export interface HospitalFacility {
  id: string;
  nameAr: string;
  cityAr: string;
  lat: number;
  lng: number;
  addressAr?: string;
}

// TODO: no real facility-registry API is wired into this project yet.
// Replace with the WHO Facility Registry or Overpass API (OpenStreetMap
// `amenity=hospital`) when one is available. Until then this is a small,
// hand-picked set of major hospitals per host country — spread across each
// country's major cities (see EmbassyConfig.coveredCitiesAr), real names,
// approximate coordinates — not a verified or complete directory.
export const MOCK_HOSPITALS: Record<string, HospitalFacility[]> = {
  'indonesia-jakarta': [
    { id: 'jkt-h1', nameAr: 'مستشفى فاتماواتي العام', cityAr: 'جاكرتا', lat: -6.2932, lng: 106.7986, addressAr: 'جنوب جاكرتا' },
    { id: 'jkt-h2', nameAr: 'مستشفى غاتوت سوبروتو العسكري', cityAr: 'جاكرتا', lat: -6.1745, lng: 106.8383, addressAr: 'وسط جاكرتا' },
    { id: 'jkt-h3', nameAr: 'مستشفى تشيبتو مانجونكوسومو', cityAr: 'جاكرتا', lat: -6.1978, lng: 106.8422, addressAr: 'وسط جاكرتا' },
    { id: 'sub-h1', nameAr: 'مستشفى دكتور سوتومو العام', cityAr: 'سورابايا', lat: -7.2637, lng: 112.7378 },
    { id: 'sub-h2', nameAr: 'مستشفى سيلوم سورابايا', cityAr: 'سورابايا', lat: -7.2848, lng: 112.7378 },
    { id: 'dps-h1', nameAr: 'مستشفى سانغلاه العام', cityAr: 'دينباسار', lat: -8.6721, lng: 115.2226, addressAr: 'بالي' },
    { id: 'dps-h2', nameAr: 'مستشفى BIMC كوتا', cityAr: 'دينباسار', lat: -8.7204, lng: 115.1668, addressAr: 'بالي' },
    { id: 'mdn-h1', nameAr: 'مستشفى حاجي آدم مالك', cityAr: 'ميدان', lat: 3.5610, lng: 98.6612 },
    { id: 'mks-h1', nameAr: 'مستشفى وحيدين سودیروهوسودو', cityAr: 'ماكاسار', lat: -5.1522, lng: 119.4360 },
  ],
  'malaysia-kuala-lumpur': [
    { id: 'kl-h1', nameAr: 'مستشفى كوالالمبور العام', cityAr: 'كوالالمبور', lat: 3.1729, lng: 101.7016 },
    { id: 'kl-h2', nameAr: 'مركز جامعة ملايا الطبي', cityAr: 'كوالالمبور', lat: 3.1201, lng: 101.6544 },
    { id: 'kl-h3', nameAr: 'مستشفى بانتاي كوالالمبور', cityAr: 'كوالالمبور', lat: 3.1180, lng: 101.6707 },
    { id: 'png-h1', nameAr: 'مستشفى بينانغ العام', cityAr: 'بينانغ', lat: 5.4084, lng: 100.3122 },
    { id: 'png-h2', nameAr: 'مستشفى آيلاند بينانغ', cityAr: 'بينانغ', lat: 5.4239, lng: 100.3081 },
    { id: 'jhb-h1', nameAr: 'مستشفى سلطانة أمينة', cityAr: 'جوهور باهرو', lat: 1.4570, lng: 103.7550 },
    { id: 'jhb-h2', nameAr: 'مستشفى KPJ جوهور التخصصي', cityAr: 'جوهور باهرو', lat: 1.4900, lng: 103.7440 },
    { id: 'bki-h1', nameAr: 'مستشفى الملكة إليزابيث', cityAr: 'كوتا كينابالو', lat: 5.9983, lng: 116.0846 },
  ],
  'pakistan-islamabad': [
    { id: 'isb-h1', nameAr: 'معهد باكستان لعلوم الطب (PIMS)', cityAr: 'إسلام آباد', lat: 33.7089, lng: 73.0563 },
    { id: 'isb-h2', nameAr: 'مستشفى شفاء الدولي', cityAr: 'إسلام آباد', lat: 33.6660, lng: 73.0169 },
    { id: 'isb-h3', nameAr: 'المستشفى العسكري المشترك', cityAr: 'روالبندي', lat: 33.5989, lng: 73.0551 },
    { id: 'khi-h1', nameAr: 'مستشفى جامعة آغا خان', cityAr: 'كراتشي', lat: 24.8926, lng: 67.0822 },
    { id: 'khi-h2', nameAr: 'مركز جناح التعليمي', cityAr: 'كراتشي', lat: 24.8511, lng: 67.0294 },
    { id: 'lhe-h1', nameAr: 'مستشفى مايو', cityAr: 'لاهور', lat: 31.5686, lng: 74.3132 },
    { id: 'lhe-h2', nameAr: 'مستشفى شوكت خانم التذكاري', cityAr: 'لاهور', lat: 31.4788, lng: 74.2827 },
    { id: 'pes-h1', nameAr: 'مستشفى ليدي ريدنغ', cityAr: 'بيشاور', lat: 34.0086, lng: 71.5453 },
  ],
  'egypt-cairo': [
    { id: 'cai-h1', nameAr: 'مستشفى قصر العيني', cityAr: 'القاهرة', lat: 30.0333, lng: 31.2278 },
    { id: 'cai-h2', nameAr: 'مستشفيات جامعة عين شمس', cityAr: 'القاهرة', lat: 30.0791, lng: 31.2870 },
    { id: 'cai-h3', nameAr: 'مستشفى السلام الدولي (المعادي)', cityAr: 'القاهرة', lat: 29.9601, lng: 31.2599 },
    { id: 'alx-h1', nameAr: 'مستشفى الإسكندرية الجامعي الرئيسي', cityAr: 'الإسكندرية', lat: 31.1975, lng: 29.9097 },
    { id: 'alx-h2', nameAr: 'مستشفى الشاطبي', cityAr: 'الإسكندرية', lat: 31.2156, lng: 29.9187 },
    { id: 'shm-h1', nameAr: 'مستشفى شرم الدولي', cityAr: 'شرم الشيخ', lat: 27.9000, lng: 34.3400 },
    { id: 'hrg-h1', nameAr: 'مستشفى الغردقة العام', cityAr: 'الغردقة', lat: 27.2579, lng: 33.8116 },
  ],
};

export function hospitalsForEmbassy(embassyId: string): HospitalFacility[] {
  return MOCK_HOSPITALS[embassyId] ?? [];
}

// ── Saudi-presence scatter ──────────────────────────────────────────────
// The one other approved mock-data exception in this codebase, same
// principle as services/mockData.ts's Saudis-abroad figures: NOT real
// individual locations, never presented as such. A small, deterministic
// scatter of points spread across the host country's major cities (weighted
// so the capital/largest cities read denser — a plausible general pattern,
// not a claim about real distribution), never as identifiable or trackable
// positions of real people. Deterministic (seeded by embassy id) so the
// scatter is stable across re-renders instead of jumping around.
interface CityHub { nameAr: string; lat: number; lng: number; weight: number }

const EMBASSY_CITY_HUBS: Record<string, CityHub[]> = {
  'indonesia-jakarta': [
    { nameAr: 'جاكرتا', lat: -6.2088, lng: 106.8456, weight: 5 },
    { nameAr: 'سورابايا', lat: -7.2575, lng: 112.7521, weight: 2 },
    { nameAr: 'دينباسار', lat: -8.6705, lng: 115.2126, weight: 2 },
    { nameAr: 'ميدان', lat: 3.5952, lng: 98.6722, weight: 1.5 },
    { nameAr: 'ماكاسار', lat: -5.1477, lng: 119.4327, weight: 1 },
  ],
  'malaysia-kuala-lumpur': [
    { nameAr: 'كوالالمبور', lat: 3.1390, lng: 101.6869, weight: 5 },
    { nameAr: 'بينانغ', lat: 5.4141, lng: 100.3288, weight: 2 },
    { nameAr: 'جوهور باهرو', lat: 1.4927, lng: 103.7414, weight: 1.5 },
    { nameAr: 'كوتا كينابالو', lat: 5.9804, lng: 116.0735, weight: 1 },
  ],
  'pakistan-islamabad': [
    { nameAr: 'إسلام آباد', lat: 33.6844, lng: 73.0479, weight: 3 },
    { nameAr: 'كراتشي', lat: 24.8607, lng: 67.0011, weight: 5 },
    { nameAr: 'لاهور', lat: 31.5497, lng: 74.3436, weight: 4 },
    { nameAr: 'بيشاور', lat: 34.0151, lng: 71.5249, weight: 1.5 },
  ],
  'egypt-cairo': [
    { nameAr: 'القاهرة', lat: 30.0444, lng: 31.2357, weight: 5 },
    { nameAr: 'الإسكندرية', lat: 31.2001, lng: 29.9187, weight: 2.5 },
    { nameAr: 'الجيزة', lat: 30.0131, lng: 31.2089, weight: 2 },
    { nameAr: 'شرم الشيخ', lat: 27.9158, lng: 34.3300, weight: 1 },
    { nameAr: 'الغردقة', lat: 27.2579, lng: 33.8116, weight: 1 },
  ],
};

function mulberry32(seed: number) {
  return function random() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

// Total kept modest on purpose: spread across up to 5 city hubs this still
// renders as plain (non-clustered) CircleMarkers with no measurable map
// slowdown. If this ever needs to grow into the hundreds, that's the point
// to add a clustering layer (e.g. leaflet.markercluster) — not before.
const TOTAL_PRESENCE_POINTS = 70;
const PRESENCE_SPREAD_DEG = 0.16; // ~18km disc around each city hub

export function saudiPresencePoints(embassyId: string): { lat: number; lng: number }[] {
  const hubs = EMBASSY_CITY_HUBS[embassyId];
  if (!hubs || hubs.length === 0) return [];
  const rand = mulberry32(seedFromString(embassyId));
  const totalWeight = hubs.reduce((s, h) => s + h.weight, 0);
  const points: { lat: number; lng: number }[] = [];
  for (const hub of hubs) {
    const count = Math.max(1, Math.round((TOTAL_PRESENCE_POINTS * hub.weight) / totalWeight));
    for (let i = 0; i < count; i++) {
      // Sample within a disc (not a square) so each hub's scatter reads as a
      // soft cluster around that city rather than a visible bounding box.
      const angle = rand() * Math.PI * 2;
      const radius = Math.sqrt(rand()) * PRESENCE_SPREAD_DEG;
      points.push({ lat: hub.lat + radius * Math.sin(angle), lng: hub.lng + radius * Math.cos(angle) });
    }
  }
  return points;
}
