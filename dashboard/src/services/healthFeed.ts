// Live health feed for the الصحة card — NO mock data.
//
// Single source, keyless and CORS-open (callable straight from the browser):
//   • WHO Disease Outbreak News API  → diverse, current official outbreaks
//     (Ebola, cholera, Nipah, yellow fever…). https://www.who.int/api/news
// If it fails, fetchHealthCountries() throws (→ the card's error/retry state).
//
// disease.sh (per-country COVID) was removed on purpose: it no longer carries a
// live COVID signal — `todayCases` and `critical` are 0 for every country, and
// only a frozen cumulative `active` total remains. Run through the scoring
// formula that made every COVID country collapse to the same saturated score
// (10 + capped-45 + 0 + 0 = 55), which read as fabricated data. Rather than
// invent a signal that isn't in the source, we drop the source entirely.
//
// All analytical fields are derived DETERMINISTICALLY from the real WHO data
// (severity of the named disease, recency of the report).
// Nothing is invented; the model is not used to fabricate outbreaks.

import { lookupCountry } from './countryNames';
import {
  type CountryHealthEntry,
  type HealthRegion,
  type HealthAnalysisResult,
  type RiskCategory,
  type Trend,
} from './healthAnalysis';

const WHO_DON_URL =
  'https://www.who.int/api/news/diseaseoutbreaknews?$top=25&$orderby=PublicationDateAndTime%20desc';
const TIMEOUT = 9000;

/* ─── ISO2 → coarse health region (for the regional rollup) ──────────── */
const ISO2_REGION: Record<string, HealthRegion> = {
  SA: 'ASIA', AE: 'ASIA', QA: 'ASIA', KW: 'ASIA', BH: 'ASIA', OM: 'ASIA', YE: 'ASIA',
  IQ: 'ASIA', IR: 'ASIA', JO: 'ASIA', LB: 'ASIA', SY: 'ASIA', PS: 'ASIA', TR: 'ASIA',
  IN: 'ASIA', PK: 'ASIA', BD: 'ASIA', NP: 'ASIA', LK: 'ASIA', AF: 'ASIA', CN: 'ASIA',
  JP: 'ASIA', KR: 'ASIA', KP: 'ASIA', ID: 'ASIA', MY: 'ASIA', PH: 'ASIA', VN: 'ASIA',
  TH: 'ASIA', MM: 'ASIA', KH: 'ASIA', MN: 'ASIA', TW: 'ASIA', PG: 'ASIA',
  EG: 'AFRICA', SD: 'AFRICA', SS: 'AFRICA', LY: 'AFRICA', TN: 'AFRICA', DZ: 'AFRICA',
  MA: 'AFRICA', MR: 'AFRICA', SO: 'AFRICA', DJ: 'AFRICA', NG: 'AFRICA', ET: 'AFRICA',
  KE: 'AFRICA', TZ: 'AFRICA', ZA: 'AFRICA', MZ: 'AFRICA', MG: 'AFRICA', ML: 'AFRICA',
  NE: 'AFRICA', TD: 'AFRICA', CD: 'AFRICA', CF: 'AFRICA', BF: 'AFRICA', CM: 'AFRICA',
  GB: 'EUROPE', FR: 'EUROPE', DE: 'EUROPE', IT: 'EUROPE', ES: 'EUROPE', PT: 'EUROPE',
  GR: 'EUROPE', IS: 'EUROPE', NO: 'EUROPE', RU: 'EUROPE', UA: 'EUROPE',
  US: 'AMERICAS', CA: 'AMERICAS', MX: 'AMERICAS', GT: 'AMERICAS', HN: 'AMERICAS',
  SV: 'AMERICAS', NI: 'AMERICAS', CR: 'AMERICAS', PA: 'AMERICAS', HT: 'AMERICAS',
  CU: 'AMERICAS', DO: 'AMERICAS', CO: 'AMERICAS', VE: 'AMERICAS', EC: 'AMERICAS',
  PE: 'AMERICAS', BO: 'AMERICAS', CL: 'AMERICAS', AR: 'AMERICAS', BR: 'AMERICAS', PY: 'AMERICAS',
  AU: 'OCEANIA', NZ: 'OCEANIA', FJ: 'OCEANIA', TO: 'OCEANIA', VU: 'OCEANIA', SB: 'OCEANIA',
};
function regionForIso2(iso2: string): HealthRegion {
  return ISO2_REGION[iso2.toUpperCase()] ?? 'AFRICA';
}

/* ─── Disease knowledge (factual, not invented): Arabic name + baseline
   severity (0-100) + a one-line general medical definition ─────────────── */
interface DiseaseInfo { ar: string; base: number; def: string }
const DISEASES: { keys: string[]; info: DiseaseInfo }[] = [
  { keys: ['ebola'], info: { ar: 'إيبولا', base: 88, def: 'حمى نزفية فيروسية شديدة الفتك تنتقل بمخالطة سوائل الجسم' } },
  { keys: ['marburg'], info: { ar: 'فيروس ماربورغ', base: 88, def: 'حمى نزفية فيروسية نادرة وعالية الفتك شبيهة بالإيبولا' } },
  { keys: ['nipah'], info: { ar: 'فيروس نيباه', base: 82, def: 'عدوى فيروسية حيوانية المنشأ تسبب التهاب دماغ حاداً' } },
  { keys: ['cholera'], info: { ar: 'الكوليرا', base: 70, def: 'عدوى بكتيرية معوية تنتقل عبر مياه أو طعام ملوث' } },
  { keys: ['mers', 'middle east respiratory'], info: { ar: 'متلازمة الشرق الأوسط التنفسية', base: 75, def: 'عدوى فيروسية تنفسية حيوانية المنشأ مرتبطة بالإبل' } },
  { keys: ['lassa'], info: { ar: 'حمى لاسا', base: 68, def: 'حمى نزفية فيروسية تنتقل عبر القوارض في غرب أفريقيا' } },
  { keys: ['yellow fever'], info: { ar: 'الحمى الصفراء', base: 66, def: 'مرض فيروسي ينقله البعوض ويصيب الكبد' } },
  { keys: ['mpox', 'monkeypox'], info: { ar: 'جدري القردة', base: 60, def: 'عدوى فيروسية تسبب طفحاً جلدياً وحمى، تنتقل بالمخالطة' } },
  { keys: ['avian influenza', 'h5n1', 'bird flu'], info: { ar: 'أنفلونزا الطيور', base: 72, def: 'عدوى فيروسية تصيب الطيور وقد تنتقل للإنسان بالمخالطة' } },
  { keys: ['influenza', 'flu'], info: { ar: 'الأنفلونزا', base: 50, def: 'عدوى تنفسية فيروسية موسمية تنتقل بالرذاذ' } },
  { keys: ['measles'], info: { ar: 'الحصبة', base: 55, def: 'عدوى فيروسية شديدة العدوى تسبب طفحاً وحمى' } },
  { keys: ['dengue'], info: { ar: 'حمى الضنك', base: 58, def: 'مرض فيروسي ينقله البعوض يسبب حمى وآلام مفاصل حادة' } },
  { keys: ['polio', 'poliomyelitis'], info: { ar: 'شلل الأطفال', base: 60, def: 'عدوى فيروسية تصيب الجهاز العصبي وقد تسبب شللاً' } },
  { keys: ['hantavirus'], info: { ar: 'فيروس هانتا', base: 66, def: 'عدوى فيروسية تنتقل عبر القوارض وتصيب الرئة أو الكلى' } },
  { keys: ['diphtheria'], info: { ar: 'الدفتيريا', base: 60, def: 'عدوى بكتيرية تنفسية خطيرة يمكن الوقاية منها بالتطعيم' } },
  { keys: ['plague'], info: { ar: 'الطاعون', base: 78, def: 'عدوى بكتيرية شديدة تنتقل عبر البراغيث أو الرذاذ' } },
  { keys: ['chikungunya'], info: { ar: 'شيكونغونيا', base: 52, def: 'مرض فيروسي ينقله البعوض يسبب حمى وآلام مفاصل' } },
  { keys: ['covid', 'sars-cov-2', 'coronavirus'], info: { ar: 'كوفيد-19', base: 45, def: 'عدوى تنفسية فيروسية تنتقل بالرذاذ والمخالطة' } },
];
const GENERIC_DISEASE: DiseaseInfo = { ar: 'تفشٍّ وبائي', base: 50, def: 'حدث تفشٍّ معدٍ قيد المتابعة من منظمة الصحة العالمية' };

function matchDisease(text: string): DiseaseInfo {
  const s = text.toLowerCase();
  for (const d of DISEASES) if (d.keys.some((k) => s.includes(k))) return d.info;
  return GENERIC_DISEASE;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function categoryFor(score: number): RiskCategory {
  return score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
}
function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 999 : (Date.now() - t) / 86_400_000;
}

/* ─── Source 1 · WHO Disease Outbreak News (primary, diverse) ─────────── */
async function fetchWhoDon(): Promise<CountryHealthEntry[]> {
  const res = await fetch(WHO_DON_URL, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`WHO DON ${res.status}`);
  const data = await res.json();
  const items: any[] = Array.isArray(data?.value) ? data.value : [];

  return items.map((it) => {
    const title: string = it.Title ?? '';
    const disease = matchDisease(title + ' ' + (it.Summary ?? ''));
    // Country is the trailing segment after the last " - " / ", "; fall back to
    // scanning the whole title (handles odd dashes / encodings). Entries with no
    // resolvable country (e.g. "… - Global", clade descriptions) are dropped —
    // this is a country-ranked card.
    const tail = title.split(/\s[-–—]\s|,\s/).pop()?.trim() ?? '';
    const info = lookupCountry(tail) ?? lookupCountry(title);
    if (!info) return null;
    const country = info.ar;
    const iso2 = info.iso2;
    const pub: string = it.PublicationDateAndTime ?? it.PublicationDate ?? new Date().toISOString();
    const dOld = daysSince(pub);
    const recency = dOld <= 14 ? 12 : dOld <= 30 ? 4 : dOld <= 60 ? -6 : -15;
    const score = clamp(Math.round(disease.base + recency), 5, 97);
    const cat = categoryFor(score);
    const trend: Trend = dOld <= 14 && score >= 60 ? 'RISING' : dOld > 60 ? 'FALLING' : 'STABLE';
    const url = it.ItemDefaultUrl
      ? `https://www.who.int${it.ItemDefaultUrl}`
      : it.UrlName
        ? `https://www.who.int/emergencies/disease-outbreak-news/item/${it.UrlName}`
        : 'https://www.who.int/emergencies/disease-outbreak-news';

    // LIGHT signal only — used to order/colour the list. The qualitative
    // analysis (summary, recommendation, Saudi impact…) is NOT built here; it is
    // generated by gpt-oss from the raw WHO fields (sourceTitle/sourceText).
    const analysis: HealthAnalysisResult = {
      outbreak_forecast: { probability: score, trend, summary: '' },
      risk_level: { score, category: cat, primary_driver: disease.ar },
      news_digest: [],
      early_warning: { triggered: score >= 70 && dOld <= 21, message: '' },
      recommended_action: { action: '' },
      disease_definition: '',
      related_countries: [],
    };

    return {
      country, countryCode: iso2, region: regionForIso2(iso2),
      disease: disease.ar, riskScore: score, saudiTravelersCount: 0, analysis,
      sourceName: 'منظمة الصحة العالمية (WHO)', sourceUrl: url, updatedAt: pub,
      sourceTitle: title,                       // raw WHO headline → gpt-oss
      sourceText: it.Summary ?? it.Overview ?? '', // raw WHO summary → gpt-oss
    } as CountryHealthEntry;
  }).filter((e): e is CountryHealthEntry => e !== null);
}

// Orchestrator: WHO DON only — de-dupe, sort, cap. Throws (→ card error/retry
// state) if WHO fails or returns nothing usable. No mock fallback is ever used.
export async function fetchHealthCountries(): Promise<CountryHealthEntry[]> {
  const list = await fetchWhoDon();

  const seen = new Set<string>();
  const deduped: CountryHealthEntry[] = [];
  for (const e of list) {
    const key = `${e.countryCode || e.country}|${e.disease}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  if (deduped.length === 0) throw new Error('تعذّر جلب بيانات الصحة من المصادر');

  deduped.sort((a, b) => b.riskScore - a.riskScore);
  return deduped.slice(0, 15);
}
