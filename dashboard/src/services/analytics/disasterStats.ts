import type { GeoEvent, Traveler, CategoryInsight } from '../../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RateComparison {
  current: number;
  previous: number;
  percentChange: number | null; // null only when both windows are 0 (no activity to compare)
  isNewActivity: boolean;       // previous = 0, current > 0
}

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number | null;
  mean: number | null;
  stdDev: number | null;
  insufficientData: boolean;
}

export interface RegionCount {
  country: string;
  count: number;
}

const MIN_HISTORY_DAYS = 5;
const ANOMALY_Z_THRESHOLD = 1.5;

export function computeRateComparison(events: GeoEvent[], days: number): RateComparison {
  const now = Date.now();
  const current = events.filter((e) => now - e.timestamp.getTime() <= days * DAY_MS).length;
  const previous = events.filter((e) => {
    const age = now - e.timestamp.getTime();
    return age > days * DAY_MS && age <= days * 2 * DAY_MS;
  }).length;

  if (previous === 0 && current === 0) {
    return { current, previous, percentChange: null, isNewActivity: false };
  }
  if (previous === 0) {
    return { current, previous, percentChange: null, isNewActivity: true };
  }
  return {
    current,
    previous,
    percentChange: Math.round(((current - previous) / previous) * 100),
    isNewActivity: false,
  };
}

export function computeTopRegions(events: GeoEvent[], limit = 5): RegionCount[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const country = e.country || 'غير معروف';
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** dailyHistory = past days' counts, oldest first, NOT including today. */
export function computeAnomalyScore(dailyHistory: number[], todayCount: number): AnomalyResult {
  if (dailyHistory.length < MIN_HISTORY_DAYS) {
    return { isAnomaly: false, zScore: null, mean: null, stdDev: null, insufficientData: true };
  }

  const mean = dailyHistory.reduce((s, v) => s + v, 0) / dailyHistory.length;
  const variance = dailyHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyHistory.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return {
      isAnomaly: todayCount !== mean,
      zScore: null,
      mean,
      stdDev: 0,
      insufficientData: false,
    };
  }

  const zScore = (todayCount - mean) / stdDev;
  return {
    isAnomaly: Math.abs(zScore) > ANOMALY_Z_THRESHOLD,
    zScore: Math.round(zScore * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    insufficientData: false,
  };
}

/** eventCount × avgSeverityScore × proximityMultiplier (1.5 if a tracked traveler is in an affected country). */
export function computeSeverityIndex(events: GeoEvent[], travelers: Traveler[]): number {
  if (events.length === 0) return 0;
  const avgScore = events.reduce((s, e) => s + e.score, 0) / events.length;
  const affectedCountries = new Set(events.map((e) => e.countryCode).filter(Boolean));
  const proximityMultiplier = travelers.some((t) => affectedCountries.has(t.countryCode)) ? 1.5 : 1.0;
  return Math.round(events.length * avgScore * proximityMultiplier);
}

/** Real confidence proxy: how many of the known sources actually reported in this category. */
export function computeSourceCoverage(events: GeoEvent[], allSources: string[]): { count: number; total: number } {
  const present = new Set(events.map((e) => e.source));
  const count = allSources.filter((s) => present.has(s as GeoEvent['source'])).length;
  return { count, total: allSources.length };
}

export interface OverallIndexInput {
  count: number;
  avgScore: number;
  trend?: CategoryInsight['trend'];
}

export interface OverallIndex {
  value: number;
  trend: CategoryInsight['trend'];
}

/** Count-weighted average score across categories, plus a majority-vote trend from the already-known per-category trends. */
export function computeOverallIndex(categories: OverallIndexInput[]): OverallIndex {
  const totalCount = categories.reduce((s, c) => s + c.count, 0);
  const value = totalCount === 0
    ? 0
    : Math.round(categories.reduce((s, c) => s + c.count * c.avgScore, 0) / totalCount);

  const trends = categories.map((c) => c.trend).filter((t): t is CategoryInsight['trend'] => !!t);
  const rising = trends.filter((t) => t === 'RISING').length;
  const falling = trends.filter((t) => t === 'FALLING').length;
  const trend: CategoryInsight['trend'] = rising > falling ? 'RISING' : falling > rising ? 'FALLING' : 'STABLE';

  return { value, trend };
}
