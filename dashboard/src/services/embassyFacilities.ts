// Hospitals moved to services/hospitals.ts (live OpenStreetMap/Overpass data,
// real national boundary scoping) — this file now only holds the Saudi-
// presence scatter, which remains an explicitly-labeled representative mock.

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
