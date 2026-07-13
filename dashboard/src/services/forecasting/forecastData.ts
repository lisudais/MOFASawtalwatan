// Single shared loader + matching for the LOCAL Amazon Chronos-2 forecast output.
//
// Source of truth: /data/forecasts.json (synced from forecasting/output/ by
// scripts/sync-forecasts.mjs). NO FastAPI, NO external API, NO fabricated data.
// Only records with model_used === 'chronos-2' are ever surfaced. Both the
// health card and the map's forecast layer consume THIS module — the JSON is
// fetched and parsed once here, never duplicated.

import { lookupCountry } from '../countryNames';

export const MODEL_NAME = 'Chronos-2';
export const MODEL_BADGE_AR = 'مدعوم بنموذج Chronos-2';
export const FORECAST_SOURCE_AR = 'توقعات مبنية على نموذج Chronos-2 وبيانات تاريخية';

/** One forecast record, exactly as produced by run_forecast.py. */
export interface ChronosForecast {
  country: string;            // English canonical name (from the model output)
  event_type: string;         // e.g. DISEASE_OUTBREAK, EARTHQUAKE, FLOOD…
  historical_dates: string[];
  historical_counts: number[];
  forecast_dates: string[];   // next 4 week-start dates
  predicted_counts: number[]; // median
  lower_bound: number[];
  upper_bound: number[];
  horizon_weeks: number;
  model_used: string;         // MUST be 'chronos-2'
  interpretation?: string;
}

/** A forecast resolved to an ISO2 code + Arabic name + peak value. */
export interface ResolvedForecast extends ChronosForecast {
  iso2: string;
  countryAr: string;
  /** Highest predicted value across the next 4 weeks — drives severity. */
  peak: number;
}

/** Arabic labels for the model's event types (health card + map popups). */
export const FORECAST_EVENT_TYPE_AR: Record<string, string> = {
  DISEASE_OUTBREAK: 'تفشٍّ وبائي',
  EARTHQUAKE: 'زلزال',
  FLOOD: 'فيضان',
  STORM: 'عاصفة',
  VOLCANO: 'بركان',
  TSUNAMI: 'تسونامي',
  WILDFIRE: 'حريق غابات',
  DROUGHT: 'جفاف',
};

export interface ForecastMeta { generatedAtUtc: string | null; modelId: string | null; }
interface ForecastBundle { list: ResolvedForecast[]; meta: ForecastMeta; }

let _cache: Promise<ForecastBundle> | null = null;

function _load(): Promise<ForecastBundle> {
  if (!_cache) {
    _cache = fetch('/data/forecasts.json')
      .then((r) => {
        if (!r.ok) throw new Error(`forecasts.json ${r.status}`);
        return r.json();
      })
      .then((doc: { forecasts?: ChronosForecast[]; generated_at_utc?: string; model_id?: string; model_used?: string }) => {
        const raw = Array.isArray(doc?.forecasts) ? doc.forecasts : [];
        const list: ResolvedForecast[] = [];
        for (const f of raw) {
          if (f.model_used !== 'chronos-2') continue;            // real Chronos-2 only
          const info = lookupCountry(f.country);
          if (!info) continue;                                    // no verified ISO2 → skip
          const peak = f.predicted_counts.length ? Math.max(...f.predicted_counts) : 0;
          list.push({ ...f, iso2: info.iso2, countryAr: info.ar, peak });
        }
        return { list, meta: { generatedAtUtc: doc?.generated_at_utc ?? null, modelId: doc?.model_id ?? null } };
      })
      .catch(() => ({ list: [], meta: { generatedAtUtc: null, modelId: null } })); // never mock
  }
  return _cache;
}

/** Fetch + parse + validate the local forecast file, once (memoised). */
export function loadForecasts(): Promise<ResolvedForecast[]> {
  return _load().then((b) => b.list);
}

/** Metadata (generation time, model id) from the same single fetch. */
export function loadForecastMeta(): Promise<ForecastMeta> {
  return _load().then((b) => b.meta);
}

/** Highest-peak forecast per ISO2 across ALL event types — for the map layer. */
export function topForecastByIso2(list: ResolvedForecast[]): Record<string, ResolvedForecast> {
  const out: Record<string, ResolvedForecast> = {};
  for (const f of list) {
    if (!out[f.iso2] || f.peak > out[f.iso2].peak) out[f.iso2] = f;
  }
  return out;
}

/** Highest-peak DISEASE forecast per ISO2 — for the health card (event_type = disease). */
export function diseaseForecastByIso2(list: ResolvedForecast[]): Record<string, ResolvedForecast> {
  const out: Record<string, ResolvedForecast> = {};
  for (const f of list) {
    if (f.event_type !== 'DISEASE_OUTBREAK') continue;
    if (!out[f.iso2] || f.peak > out[f.iso2].peak) out[f.iso2] = f;
  }
  return out;
}

/**
 * Relative risk score (0–100): the record's predicted value normalized against
 * the HIGHEST forecast value in the displayed group. This is a *relative* rank,
 * NOT a probability — always label it as such in the UI.
 *   relativeRisk(value, groupMax) = round(100 * value / groupMax)
 */
export function relativeRisk(value: number, groupMax: number): number {
  if (groupMax <= 0) return 0;
  return Math.round((value / groupMax) * 100);
}

export type ForecastBand = 'low' | 'medium' | 'high';

/**
 * Severity band by thirds of the displayed group's range:
 *   low    → value in the lowest third  (near 0)
 *   medium → middle third
 *   high   → highest third
 */
export function bandFor(value: number, groupMax: number): ForecastBand {
  if (groupMax <= 0) return 'low';
  const r = value / groupMax;
  return r <= 1 / 3 ? 'low' : r <= 2 / 3 ? 'medium' : 'high';
}
