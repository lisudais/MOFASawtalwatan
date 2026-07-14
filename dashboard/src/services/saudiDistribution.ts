// ─────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the "السعوديين خارج المملكة" mock distribution.
//
// Every place that shows Saudi presence reads from HERE, so the numbers can
// never disagree:
//   • the sidebar total (السعوديين خارج المملكة) = SAUDIS_ABROAD_TOTAL
//   • the sidebar breakdown                       = saudiCountriesRanked()
//   • the world map's distribution layer           = allSaudiPoints()
//   • each consulate's counter + its map points    = saudiPointsForCountry(iso2)
//
// Design: each country has a TOTAL (unequal — big-diaspora states hold the vast
// majority) split across a few real city points weighted by size. A point's
// `count` is its share of the country total; the largest point absorbs the
// rounding remainder so a country's points ALWAYS sum to its total exactly, and
// the grand total is therefore EXACTLY SAUDIS_ABROAD_TOTAL_TARGET (2,847,650).
// Illustrative demo data — NOT official statistics.
// ─────────────────────────────────────────────────────────────────────────

/** The published total shown in the sidebar. Every point count rolls up to it. */
export const SAUDIS_ABROAD_TOTAL_TARGET = 2_847_650;

export interface SaudiPoint {
  countryCode: string;
  countryAr: string;
  cityAr: string;
  lat: number;
  lng: number;
  /** People represented by this single map point. */
  count: number;
}

interface CityDef { ar: string; lat: number; lng: number; w: number }
interface CountryDef { ar: string; total: number; cities: CityDef[] }

// total = the country's whole Saudi community; cities.w = relative split weights.
// Big diaspora states (tens–hundreds of thousands) get 2–4 city points; smaller
// states get a single central point — so the map stays readable, never crowded.
const DIST: Record<string, CountryDef> = {
  AE: { ar: 'الإمارات', total: 612340, cities: [
    { ar: 'دبي', lat: 25.2048, lng: 55.2708, w: 55 }, { ar: 'أبوظبي', lat: 24.4539, lng: 54.3773, w: 30 }, { ar: 'الشارقة', lat: 25.3463, lng: 55.4209, w: 15 } ] },
  EG: { ar: 'مصر', total: 458220, cities: [
    { ar: 'القاهرة', lat: 30.0444, lng: 31.2357, w: 55 }, { ar: 'الإسكندرية', lat: 31.2001, lng: 29.9187, w: 25 }, { ar: 'الجيزة', lat: 30.0131, lng: 31.2089, w: 20 } ] },
  US: { ar: 'الولايات المتحدة', total: 341890, cities: [
    { ar: 'نيويورك', lat: 40.7128, lng: -74.0060, w: 35 }, { ar: 'لوس أنجلوس', lat: 34.0522, lng: -118.2437, w: 25 }, { ar: 'هيوستن', lat: 29.7604, lng: -95.3698, w: 22 }, { ar: 'واشنطن', lat: 38.9072, lng: -77.0369, w: 18 } ] },
  BH: { ar: 'البحرين', total: 287450, cities: [
    { ar: 'المنامة', lat: 26.2285, lng: 50.5860, w: 65 }, { ar: 'الرفاع', lat: 26.1300, lng: 50.5550, w: 35 } ] },
  GB: { ar: 'المملكة المتحدة', total: 198760, cities: [
    { ar: 'لندن', lat: 51.5074, lng: -0.1278, w: 55 }, { ar: 'مانشستر', lat: 53.4808, lng: -2.2426, w: 25 }, { ar: 'برمنغهام', lat: 52.4862, lng: -1.8904, w: 20 } ] },
  KW: { ar: 'الكويت', total: 165000, cities: [
    { ar: 'مدينة الكويت', lat: 29.3759, lng: 47.9774, w: 60 }, { ar: 'حولي', lat: 29.3326, lng: 48.0289, w: 40 } ] },
  TR: { ar: 'تركيا', total: 156330, cities: [
    { ar: 'إسطنبول', lat: 41.0082, lng: 28.9784, w: 55 }, { ar: 'أنقرة', lat: 39.9334, lng: 32.8597, w: 25 }, { ar: 'بورصة', lat: 40.1826, lng: 29.0665, w: 20 } ] },
  QA: { ar: 'قطر', total: 148000, cities: [
    { ar: 'الدوحة', lat: 25.2854, lng: 51.5310, w: 70 }, { ar: 'الريان', lat: 25.2919, lng: 51.4244, w: 30 } ] },
  JO: { ar: 'الأردن', total: 132000, cities: [
    { ar: 'عمّان', lat: 31.9539, lng: 35.9106, w: 55 }, { ar: 'الزرقاء', lat: 32.0728, lng: 36.0876, w: 25 }, { ar: 'إربد', lat: 32.5556, lng: 35.8500, w: 20 } ] },
  MY: { ar: 'ماليزيا', total: 96500, cities: [
    { ar: 'كوالالمبور', lat: 3.1390, lng: 101.6869, w: 60 }, { ar: 'جوهور باهرو', lat: 1.4927, lng: 103.7414, w: 25 }, { ar: 'بينانغ', lat: 5.4141, lng: 100.3288, w: 15 } ] },
  OM: { ar: 'عُمان', total: 55380, cities: [
    { ar: 'مسقط', lat: 23.5880, lng: 58.3829, w: 70 }, { ar: 'صلالة', lat: 17.0151, lng: 54.0924, w: 30 } ] },
  CA: { ar: 'كندا', total: 30000, cities: [
    { ar: 'تورنتو', lat: 43.6532, lng: -79.3832, w: 60 }, { ar: 'أوتاوا', lat: 45.4215, lng: -75.6972, w: 40 } ] },
  LB: { ar: 'لبنان', total: 22000, cities: [{ ar: 'بيروت', lat: 33.8938, lng: 35.5018, w: 1 }] },
  ID: { ar: 'إندونيسيا', total: 18000, cities: [{ ar: 'جاكرتا', lat: -6.2088, lng: 106.8456, w: 1 }] },
  SD: { ar: 'السودان', total: 16000, cities: [{ ar: 'الخرطوم', lat: 15.5007, lng: 32.5599, w: 1 }] },
  PK: { ar: 'باكستان', total: 13000, cities: [
    { ar: 'كراتشي', lat: 24.8607, lng: 67.0011, w: 55 }, { ar: 'إسلام آباد', lat: 33.6844, lng: 73.0479, w: 45 } ] },
  DE: { ar: 'ألمانيا', total: 12500, cities: [
    { ar: 'برلين', lat: 52.5200, lng: 13.4050, w: 55 }, { ar: 'ميونخ', lat: 48.1351, lng: 11.5820, w: 45 } ] },
  IQ: { ar: 'العراق', total: 11000, cities: [{ ar: 'بغداد', lat: 33.3152, lng: 44.3661, w: 1 }] },
  YE: { ar: 'اليمن', total: 9000, cities: [
    { ar: 'عدن', lat: 12.7855, lng: 45.0187, w: 45 }, { ar: 'صنعاء', lat: 15.3694, lng: 44.1910, w: 35 }, { ar: 'المكلا', lat: 14.5426, lng: 49.1242, w: 20 } ] },
  AU: { ar: 'أستراليا', total: 8500, cities: [
    { ar: 'سيدني', lat: -33.8688, lng: 151.2093, w: 60 }, { ar: 'ملبورن', lat: -37.8136, lng: 144.9631, w: 40 } ] },
  FR: { ar: 'فرنسا', total: 7000, cities: [{ ar: 'باريس', lat: 48.8566, lng: 2.3522, w: 1 }] },
  IN: { ar: 'الهند', total: 6500, cities: [
    { ar: 'مومباي', lat: 19.0760, lng: 72.8777, w: 55 }, { ar: 'نيودلهي', lat: 28.6139, lng: 77.2090, w: 45 } ] },
  SY: { ar: 'سوريا', total: 5500, cities: [{ ar: 'دمشق', lat: 33.5138, lng: 36.2765, w: 1 }] },
  MA: { ar: 'المغرب', total: 4500, cities: [{ ar: 'الدار البيضاء', lat: 33.5731, lng: -7.5898, w: 1 }] },
  TH: { ar: 'تايلاند', total: 3800, cities: [{ ar: 'بانكوك', lat: 13.7563, lng: 100.5018, w: 1 }] },
  CN: { ar: 'الصين', total: 3200, cities: [
    { ar: 'شنغهاي', lat: 31.2304, lng: 121.4737, w: 55 }, { ar: 'بكين', lat: 39.9042, lng: 116.4074, w: 45 } ] },
  TN: { ar: 'تونس', total: 2600, cities: [{ ar: 'تونس', lat: 36.8065, lng: 10.1815, w: 1 }] },
  IT: { ar: 'إيطاليا', total: 2100, cities: [{ ar: 'روما', lat: 41.9028, lng: 12.4964, w: 1 }] },
  BD: { ar: 'بنغلاديش', total: 1900, cities: [{ ar: 'دكا', lat: 23.8103, lng: 90.4125, w: 1 }] },
  NG: { ar: 'نيجيريا', total: 1500, cities: [{ ar: 'لاغوس', lat: 6.5244, lng: 3.3792, w: 1 }] },
  PS: { ar: 'فلسطين', total: 1400, cities: [{ ar: 'رام الله', lat: 31.9038, lng: 35.2034, w: 1 }] },
  PH: { ar: 'الفلبين', total: 1400, cities: [{ ar: 'مانيلا', lat: 14.5995, lng: 120.9842, w: 1 }] },
  SG: { ar: 'سنغافورة', total: 1300, cities: [{ ar: 'سنغافورة', lat: 1.3521, lng: 103.8198, w: 1 }] },
  ZA: { ar: 'جنوب أفريقيا', total: 1250, cities: [{ ar: 'جوهانسبرغ', lat: -26.2041, lng: 28.0473, w: 1 }] },
  NL: { ar: 'هولندا', total: 1200, cities: [{ ar: 'أمستردام', lat: 52.3676, lng: 4.9041, w: 1 }] },
  JP: { ar: 'اليابان', total: 1100, cities: [{ ar: 'طوكيو', lat: 35.6762, lng: 139.6503, w: 1 }] },
  KE: { ar: 'كينيا', total: 1000, cities: [{ ar: 'نيروبي', lat: -1.2921, lng: 36.8219, w: 1 }] },
  BR: { ar: 'البرازيل', total: 950, cities: [{ ar: 'ساو باولو', lat: -23.5505, lng: -46.6333, w: 1 }] },
  CH: { ar: 'سويسرا', total: 950, cities: [{ ar: 'جنيف', lat: 46.2044, lng: 6.1432, w: 1 }] },
  IR: { ar: 'إيران', total: 900, cities: [{ ar: 'طهران', lat: 35.6892, lng: 51.3890, w: 1 }] },
  KR: { ar: 'كوريا الجنوبية', total: 850, cities: [{ ar: 'سول', lat: 37.5665, lng: 126.9780, w: 1 }] },
  MV: { ar: 'المالديف', total: 800, cities: [{ ar: 'ماليه', lat: 4.1755, lng: 73.5093, w: 1 }] },
  SE: { ar: 'السويد', total: 780, cities: [{ ar: 'ستوكهولم', lat: 59.3293, lng: 18.0686, w: 1 }] },
  RU: { ar: 'روسيا', total: 700, cities: [{ ar: 'موسكو', lat: 55.7558, lng: 37.6173, w: 1 }] },
  ET: { ar: 'إثيوبيا', total: 620, cities: [{ ar: 'أديس أبابا', lat: 9.0320, lng: 38.7469, w: 1 }] },
  IE: { ar: 'إيرلندا', total: 600, cities: [{ ar: 'دبلن', lat: 53.3498, lng: -6.2603, w: 1 }] },
  NZ: { ar: 'نيوزيلندا', total: 480, cities: [{ ar: 'أوكلاند', lat: -36.8509, lng: 174.7645, w: 1 }] },
  BE: { ar: 'بلجيكا', total: 470, cities: [{ ar: 'بروكسل', lat: 50.8503, lng: 4.3517, w: 1 }] },
  MX: { ar: 'المكسيك', total: 430, cities: [{ ar: 'مكسيكو سيتي', lat: 19.4326, lng: -99.1332, w: 1 }] },
};

// Split each country's total across its city points by weight; the largest
// point absorbs the rounding remainder so the country's points sum to its total
// EXACTLY (and therefore the grand total is exact too).
function buildPointsFor(code: string, def: CountryDef): SaudiPoint[] {
  const sumW = def.cities.reduce((s, c) => s + c.w, 0);
  const raw = def.cities.map((c) => Math.round((def.total * c.w) / sumW));
  const diff = def.total - raw.reduce((s, n) => s + n, 0);
  // Largest-weight city takes the remainder (keeps every point ≥ its rounded share).
  let biggest = 0;
  for (let i = 1; i < def.cities.length; i++) if (def.cities[i].w > def.cities[biggest].w) biggest = i;
  raw[biggest] += diff;
  return def.cities.map((c, i) => ({
    countryCode: code, countryAr: def.ar, cityAr: c.ar, lat: c.lat, lng: c.lng, count: raw[i],
  }));
}

const POINTS: SaudiPoint[] = Object.entries(DIST).flatMap(([code, def]) => buildPointsFor(code, def));
const COUNT_BY_COUNTRY: Record<string, number> = {};
for (const p of POINTS) COUNT_BY_COUNTRY[p.countryCode] = (COUNT_BY_COUNTRY[p.countryCode] ?? 0) + p.count;

/** Grand total across every map point — equals SAUDIS_ABROAD_TOTAL_TARGET by construction. */
export const SAUDIS_ABROAD_TOTAL = POINTS.reduce((s, p) => s + p.count, 0);

/** Every distribution point on the world map. */
export function allSaudiPoints(): SaudiPoint[] {
  return POINTS;
}

/** The points inside one country (its consulate map shows exactly these). */
export function saudiPointsForCountry(iso2: string): SaudiPoint[] {
  const code = (iso2 ?? '').toUpperCase();
  return POINTS.filter((p) => p.countryCode === code);
}

/** A country's total = the sum of its points. Consulate counter reads THIS. */
export function saudiCountForCountry(iso2: string): number {
  return COUNT_BY_COUNTRY[(iso2 ?? '').toUpperCase()] ?? 0;
}

/**
 * Marker radius (px) for a point, scaled by its count so a bigger community
 * reads as a bigger dot. sqrt scale keeps the largest hubs from dwarfing the
 * map while small communities stay visible; clamped to a sensible band.
 */
export function saudiPointRadius(count: number, minR = 5, maxR = 26): number {
  const ref = 340000; // ≈ the largest single-city share (Dubai)
  const r = minR + (maxR - minR) * Math.sqrt(Math.min(1, count / ref));
  return Math.round(r * 10) / 10;
}

/** Countries ranked by community size (drives the sidebar breakdown). */
export function saudiCountriesRanked(): { countryCode: string; countryAr: string; count: number }[] {
  return Object.entries(DIST)
    .map(([code, def]) => ({ countryCode: code, countryAr: def.ar, count: COUNT_BY_COUNTRY[code] ?? def.total }))
    .sort((a, b) => b.count - a.count);
}
