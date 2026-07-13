// Single shared loader for the LOCAL XGBoost outbreak-forecast output.
//
// Source of truth: /data/outbreak_forecast.json (synced from
// disease_ml/output/outbreak_forecast.json). Each record is the calibrated
// probability of a disease outbreak in the next 4 weeks for one country+disease.
// No external API, no fabricated values, no probability rescaling. The DISPLAY
// risk bands are base-rate-aware (the outbreak base rate is ~4.3%); the official
// binary alert threshold stays at 0.73 and is kept separate from the display.

import { lookupCountry } from '../countryNames';

export const OUTBREAK_MODEL = 'XGBoost Outbreak Classifier';
export const OUTBREAK_MODEL_AR = 'محرك التنبؤ بالتفشي';
export const OUTBREAK_SOURCE_AR = 'توقعات مبنية على أنماط وبائية تاريخية';
export const FORECAST_HORIZON_AR = '٤ أسابيع';
export const OFFICIAL_THRESHOLD = 0.73;
/** Countries at/above this probability get a visible map marker. */
export const MARKER_THRESHOLD = 0.05;

// Base-rate-aware DISPLAY bands (visual only — probabilities are NOT rescaled).
export type RiskLevel = 'Very Low' | 'Low' | 'Elevated' | 'High Monitoring' | 'Outbreak Alert';

/** Risk-level → the required 5-colour scale (green → dark red). */
export const RISK_COLOR: Record<RiskLevel, string> = {
  'Very Low': '#00E676',        // green
  Low: '#FFD600',               // yellow
  Elevated: '#FF6D00',          // orange
  'High Monitoring': '#FF1744', // red
  'Outbreak Alert': '#B71C1C',  // dark red
};

// ── UI risk BANDS (interpretation only — computed straight from the calibrated
// probability, never rescaled). The official binary alert threshold stays 0.73.
// These bands drive the card + map colours so 4% reads Green, not Yellow.
export type RiskBandKey = 'very_low' | 'low' | 'monitor' | 'elevated' | 'high' | 'alert';
export interface RiskBand {
  key: RiskBandKey;
  ar: string;
  en: string;
  color: string;
}
const RISK_BANDS: RiskBand[] = [
  { key: 'very_low', ar: 'منخفض جدًا',    en: 'Very Low',       color: '#00C853' }, // green
  { key: 'low',      ar: 'منخفض',          en: 'Low',            color: '#64DD17' }, // light green
  { key: 'monitor',  ar: 'يحتاج مراقبة',   en: 'Monitor',        color: '#FFD600' }, // yellow
  { key: 'elevated', ar: 'مرتفع للمراقبة', en: 'Elevated',       color: '#FF9100' }, // orange
  { key: 'high',     ar: 'خطر مرتفع',      en: 'High',           color: '#FF1744' }, // red
  { key: 'alert',    ar: 'إنذار تفشٍ',      en: 'Outbreak Alert', color: '#B71C1C' }, // dark red
];

/** Map a calibrated probability (0..1) to its display band. */
export function riskBandFor(p: number): RiskBand {
  if (p >= OFFICIAL_THRESHOLD) return RISK_BANDS[5]; // >= 0.73
  if (p >= 0.50) return RISK_BANDS[4];
  if (p >= 0.30) return RISK_BANDS[3];
  if (p >= 0.15) return RISK_BANDS[2];
  if (p >= 0.05) return RISK_BANDS[1];
  return RISK_BANDS[0];
}

/** Risk score out of 10, straight from the calibrated probability. */
export function riskScore10(p: number): number {
  return Math.max(0, Math.min(10, Math.round(p * 10)));
}

/** Ordered band list (green → dark red) for the 0–10 scale bar. */
export const RISK_BAND_SCALE = RISK_BANDS;

/** Regional-activity label from the recent-affected-neighbours count. */
export function regionalActivityAr(affectedNeighboursRecent: number | null | undefined): string {
  const n = affectedNeighboursRecent || 0;
  if (n >= 3) return 'مرتفع';
  if (n >= 1) return 'متوسط';
  return 'منخفض';
}

/**
 * Deterministic operator recommendations (≤4 bullets) — never LLM-decided.
 * Depend only on probability (band), risk level, and recent regional activity.
 * Emergency actions appear ONLY at/above the official alert threshold (0.73).
 */
export function recommendationsFor(f: { probability: number; regional: OutbreakRegional }): string[] {
  const band = riskBandFor(f.probability);
  const regionActive = (f.regional?.affected_neighbours_recent || 0) > 0;
  const out: string[] = [];

  switch (band.key) {
    case 'very_low':
    case 'low':
      out.push('متابعة تحديثات منظمة الصحة العالمية بشكل دوري.');
      out.push(regionActive
        ? 'مراقبة أي تغير في النشاط الوبائي الإقليمي.'
        : 'مراجعة أي تحذيرات صحية جديدة تخص الدولة.');
      out.push('لا يوجد ما يستدعي رفع مستوى الإنذار حالياً.');
      break;
    case 'monitor':
      out.push('متابعة أوثق لتحديثات منظمة الصحة العالمية.');
      out.push('مراقبة تطور النشاط الوبائي خلال الأسابيع القادمة.');
      if (regionActive) out.push('متابعة النشاط في الدول المجاورة.');
      out.push('مراجعة أي تحذيرات صحية جديدة.');
      break;
    case 'elevated':
      out.push('تكثيف متابعة تحديثات منظمة الصحة العالمية.');
      out.push('رصد أي ارتفاع في النشاط الوبائي المحلي أو الإقليمي.');
      if (regionActive) out.push('تقييم النشاط في الدول المجاورة عن كثب.');
      out.push('إبقاء الجهات المعنية على اطلاع بالمستجدات.');
      break;
    case 'high':
      out.push('مراقبة مكثفة لتحديثات منظمة الصحة العالمية.');
      out.push('التنسيق المسبق مع الجهات الصحية والبعثة المعنية.');
      out.push('رصد أي مؤشرات على تصاعد النشاط الوبائي.');
      if (regionActive) out.push('متابعة النشاط الإقليمي عن كثب.');
      break;
    case 'alert':
      out.push('تفعيل إجراءات الاستجابة والتنسيق العاجل مع الجهات الصحية.');
      out.push('التواصل الفوري مع البعثة المعنية.');
      out.push('مراقبة مستمرة لتحديثات منظمة الصحة العالمية.');
      out.push('تقييم الحاجة إلى تحذيرات سفر أو إجراءات وقائية.');
      break;
    default:
      out.push('متابعة تحديثات منظمة الصحة العالمية بشكل دوري.');
  }
  return out.slice(0, 4);
}

export interface OutbreakFactors {
  weeks_since_last_outbreak: number | null;
  season: string | null;
  seasonal_match: boolean;
  historical_peak_deaths: number | null;
  disease_category: string | null;
  recent_growth_rate: number | null;
  rolling_mean_4w: number | null;
  rolling_mean_8w: number | null;
  neighbouring_active: number | null;
  regional_cases: number | null;
  active_outbreak: number;
  feature_completeness: number;
  calibrated_probability: number;
}

export interface OutbreakHistory {
  historical_outbreak_count: number;
  last_outbreak_date: string | null;
  months_since_last_outbreak: number | null;
  outbreaks_last_5_years: number;
  average_interval_months: number | null;
  max_historical_cases: number | null;
  max_historical_deaths: number | null;
  timeline: string[];
}

export interface OutbreakRegional {
  neighbouring_countries: string[] | null;
  neighbouring_count: number;
  affected_neighbours_recent: number;
  neighbouring_active_now: number | null;
  regional_cases: number | null;
}

export interface OutbreakForecast {
  country: string;
  disease: string;
  disease_category: string | null;
  prediction_date: string;
  forecast_horizon: string;
  forecast_period_start: string;             // FUTURE — labeled forecast date
  forecast_period_end: string;               // FUTURE — labeled forecast date
  prediction_generation_date: string;
  probability: number;                       // calibrated 0..1, NOT rescaled
  display_risk_level: RiskLevel;
  display_risk_level_ar: string;
  official_alert: boolean;                   // probability >= 0.73
  official_threshold: number;
  base_rate: number;
  probability_vs_base_rate_ratio: number;
  absolute_risk_difference_from_base_rate: number;
  base_rate_comparison_ar: string;
  base_rate_comparison_en: string;
  country_disease_base_rate: number | null;
  historical_comparison_ratio: number | null;
  trend: 'Increasing' | 'Stable' | 'Decreasing';
  confidence: 'Low' | 'Medium' | 'High';
  model_used: string;
  explanation_ar: string;
  explanation_en: string;
  explanation_factors: OutbreakFactors;
  history: OutbreakHistory;
  regional: OutbreakRegional;
}

export interface ResolvedOutbreak extends OutbreakForecast {
  iso2: string;
  countryAr: string;
}

export interface ModelInfo {
  model_name: string;
  prediction_type: string;
  prediction_type_en: string;
  calibration: string;
  training_date: string | null;
  model_version: string;
}

export interface OutbreakMeta {
  base_rate: number;
  official_threshold: number;
  dataset_last_update: string | null;             // = source_data_last_observed_date
  source_data_last_observed_date: string | null;  // latest real WHO-DON report date (<= today)
  prediction_generation_date: string | null;      // when the forecast was generated
  forecast_period_start: string | null;           // FUTURE — start of the 4-week horizon
  forecast_period_end: string | null;             // FUTURE — end of the 4-week horizon
  generated_at_utc: string | null;
  historical_data_source: string | null;
  model_info: ModelInfo | null;
  display_note_ar: string;
  display_note_en: string;
}

export const TREND_AR: Record<OutbreakForecast['trend'], string> = {
  Increasing: 'متصاعد', Stable: 'مستقر', Decreasing: 'متراجع',
};
export const CONFIDENCE_AR: Record<OutbreakForecast['confidence'], string> = {
  High: 'عالية', Medium: 'متوسطة', Low: 'منخفضة',
};

interface Bundle { list: ResolvedOutbreak[]; meta: OutbreakMeta; }
let _cache: Promise<Bundle> | null = null;

function loadBundle(): Promise<Bundle> {
  if (!_cache) {
    _cache = fetch('/data/outbreak_forecast.json')
      .then((r) => {
        if (!r.ok) throw new Error(`outbreak_forecast.json ${r.status}`);
        return r.json();
      })
      .then((doc: Record<string, unknown>) => {
        const raw = Array.isArray(doc?.forecasts) ? (doc.forecasts as OutbreakForecast[]) : [];
        const list: ResolvedOutbreak[] = [];
        for (const f of raw) {
          if (f.model_used !== OUTBREAK_MODEL) continue;   // only the verified classifier
          const info = lookupCountry(f.country);
          if (!info) continue;                              // no verified ISO2 → skip
          list.push({ ...f, iso2: info.iso2, countryAr: info.ar });
        }
        list.sort((a, b) => b.probability - a.probability);
        const meta: OutbreakMeta = {
          base_rate: (doc?.base_rate as number) ?? 0.043,
          official_threshold: (doc?.official_threshold as number) ?? OFFICIAL_THRESHOLD,
          dataset_last_update: (doc?.dataset_last_update as string) ?? null,
          source_data_last_observed_date: (doc?.source_data_last_observed_date as string) ?? null,
          prediction_generation_date: (doc?.prediction_generation_date as string) ?? null,
          forecast_period_start: (doc?.forecast_period_start as string) ?? null,
          forecast_period_end: (doc?.forecast_period_end as string) ?? null,
          generated_at_utc: (doc?.generated_at_utc as string) ?? null,
          historical_data_source: (doc?.historical_data_source as string) ?? null,
          model_info: (doc?.model_info as ModelInfo) ?? null,
          display_note_ar: (doc?.display_note_ar as string) ?? '',
          display_note_en: (doc?.display_note_en as string) ?? '',
        };
        return { list, meta };
      })
      .catch(() => ({ list: [], meta: { base_rate: 0.043, official_threshold: OFFICIAL_THRESHOLD,
                                        dataset_last_update: null, source_data_last_observed_date: null,
                                        prediction_generation_date: null, forecast_period_start: null,
                                        forecast_period_end: null, generated_at_utc: null,
                                        historical_data_source: null, model_info: null,
                                        display_note_ar: '', display_note_en: '' } }));
  }
  return _cache;
}

export function loadOutbreakForecasts(): Promise<ResolvedOutbreak[]> {
  return loadBundle().then((b) => b.list);
}
export function loadOutbreakMeta(): Promise<OutbreakMeta> {
  return loadBundle().then((b) => b.meta);
}

/**
 * Highest-PROBABILITY forecast per ISO2 — for the map's per-country level.
 * Never averages across diseases; picks the single worst disease per country.
 */
export function topOutbreakByIso2(list: ResolvedOutbreak[]): Record<string, ResolvedOutbreak> {
  const out: Record<string, ResolvedOutbreak> = {};
  for (const f of list) {
    if (!out[f.iso2] || f.probability > out[f.iso2].probability) out[f.iso2] = f;
  }
  return out;
}
