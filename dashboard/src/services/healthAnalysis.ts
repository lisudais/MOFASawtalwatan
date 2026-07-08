const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

// TODO: replace with the real system prompt text — this is a placeholder
// until it's supplied. Sent as an actual `system` role message on every
// request (not folded into the user message, unlike the other AI functions
// in services/aiInsight.ts). Once supplied, the prompt must also instruct
// the model to produce (added to the JSON contract below, not yet in the
// real prompt text since that text doesn't exist here yet):
//   - disease_definition: one line, <15 words, general medical definition
//     of the disease (not country-specific data).
//   - related_countries: 2-3 entries, each geographically/epidemiologically
//     plausible (not a random guess) — countries currently less affected by
//     the same disease ("current_lower"), or at plausible risk of it
//     spreading there next ("potential_future").
//   - news_digest total length must stay short enough to render in two
//     lines in the detail panel (~20-25 words combined across all items).
const HEALTH_SYSTEM_PROMPT = `TODO: PASTE THE REAL SYSTEM PROMPT HERE.`;

export type Trend = 'RISING' | 'FALLING' | 'STABLE';
export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RelatedCountryStatus = 'current_lower' | 'potential_future';

export interface HealthAnalysisResult {
  outbreak_forecast: {
    probability: number; // 0-100
    trend: Trend;
    summary: string;
  };
  risk_level: {
    score: number; // 0-100, position on the LOW→CRITICAL bar
    category: RiskCategory;
    primary_driver: string;
  };
  news_digest: string[]; // short items, <8 words each — combined total must
    // fit two lines in the detail panel (~20-25 words)
  early_warning: {
    triggered: boolean;
    message: string;
  };
  recommended_action: {
    action: string; // ministry-facing recommendation, Arabic
  };
  disease_definition: string; // one line, <15 words, general medical definition
  related_countries: {
    country: string;
    status: RelatedCountryStatus;
    note: string; // <6 words
  }[];
}

// ─── Per-country list (Health box, Part 1) ──────────────────────────────
// Wraps the existing HealthAnalysisResult shape with country identity +
// a top-level riskScore used to sort the list. No coordinates/source/last-
// updated fields — those weren't real data to begin with (all mock), so
// they're rendered from context (a generated-at timestamp, a fixed "mock
// data" source label) rather than invented per-country.
// Broad grouping for the regional forecast rollup below — deliberately a
// separate, self-contained concept from services/regions.ts (that file's
// bounding-box regions were built for lat/lng-based disaster events and
// have no Asia bucket at all, which is where most of these mock health
// countries sit; reusing it would misclassify them as "OTHER").
export type HealthRegion = 'ASIA' | 'AFRICA' | 'EUROPE' | 'AMERICAS' | 'OCEANIA';

export const HEALTH_REGION_LABEL_AR: Record<HealthRegion, string> = {
  ASIA: 'آسيا',
  AFRICA: 'أفريقيا',
  EUROPE: 'أوروبا',
  AMERICAS: 'الأمريكتان',
  OCEANIA: 'أوقيانوسيا',
};

export interface CountryHealthEntry {
  country: string;
  countryCode: string;
  region: HealthRegion;
  disease: string;
  riskScore: number; // 0-100, sort key (desc) — mirrors risk_level.score
  saudiTravelersCount: number; // Saudi-presence mock (the one allowed exception);
    // 0 when unknown for a live country → shown as "غير متوفر"
  // NOTE: `analysis` now holds only a LIGHT sort/display signal (risk_level +
  // outbreak_forecast) used to order/colour the list. The real qualitative
  // health analysis is generated on demand by the local gpt-oss model from the
  // raw WHO data below — see services/healthAi.ts + HealthCountryDetailPanel.tsx.
  analysis: HealthAnalysisResult;
  // Live-source attribution + RAW payload sent to gpt-oss (real feed only).
  sourceName?: string;
  sourceUrl?: string;
  updatedAt?: string;   // ISO
  sourceTitle?: string; // original WHO/disease.sh headline
  sourceText?: string;  // original WHO summary / real disease.sh figures
}


export interface RegionalForecast {
  topRegion: HealthRegion;
  topRegionProbability: number; // rounded avg outbreak_forecast.probability across that region's countries
  topRegionTrend: Trend; // majority trend among that region's countries
  risingRegionCount: number;
  regionCount: number;
  heatmap: { region: HealthRegion; avgRiskScore: number }[]; // sorted desc by avgRiskScore
  watchList: { country: string; countryCode: string; probability: number; trend: Trend }[]; // top 3 by probability desc
}

/**
 * Pure rollup over the existing per-country mock analyses — no invented
 * numbers, just averages/majority-votes of outbreak_forecast/risk_level
 * fields that are already there. Kept separate from any AI call, same
 * "deterministic math over real fields" split used for the disaster
 * category rollups elsewhere in the project.
 */
export function computeRegionalForecast(countries: CountryHealthEntry[]): RegionalForecast {
  const regions = Array.from(new Set(countries.map((c) => c.region)));

  const regionStats = regions.map((region) => {
    const inRegion = countries.filter((c) => c.region === region);
    const avgProbability = inRegion.reduce((s, c) => s + c.analysis.outbreak_forecast.probability, 0) / inRegion.length;
    const avgRiskScore = inRegion.reduce((s, c) => s + c.riskScore, 0) / inRegion.length;
    const risingCount = inRegion.filter((c) => c.analysis.outbreak_forecast.trend === 'RISING').length;
    const fallingCount = inRegion.filter((c) => c.analysis.outbreak_forecast.trend === 'FALLING').length;
    const trend: Trend = risingCount > inRegion.length / 2 ? 'RISING' : fallingCount > inRegion.length / 2 ? 'FALLING' : 'STABLE';
    return { region, avgProbability, avgRiskScore, trend, isRising: trend === 'RISING' };
  });

  const top = regionStats.reduce((a, b) => (b.avgProbability > a.avgProbability ? b : a));
  const watchList = [...countries]
    .sort((a, b) => b.analysis.outbreak_forecast.probability - a.analysis.outbreak_forecast.probability)
    .slice(0, 3)
    .map((c) => ({
      country: c.country,
      countryCode: c.countryCode,
      probability: c.analysis.outbreak_forecast.probability,
      trend: c.analysis.outbreak_forecast.trend,
    }));

  const heatmap = [...regionStats]
    .sort((a, b) => b.avgRiskScore - a.avgRiskScore)
    .map((r) => ({ region: r.region, avgRiskScore: Math.round(r.avgRiskScore) }));

  return {
    topRegion: top.region,
    topRegionProbability: Math.round(top.avgProbability),
    topRegionTrend: top.trend,
    risingRegionCount: regionStats.filter((r) => r.isRising).length,
    regionCount: regionStats.length,
    heatmap,
    watchList,
  };
}

/** Turns the variables object into a plain labeled list for the user-role message, e.g. "region: ...\ncurrent_cases: ...". */
function serializeVariables(variables: Record<string, unknown>): string {
  return Object.entries(variables)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

export async function fetchHealthAnalysis(
  variables: Record<string, unknown>
): Promise<HealthAnalysisResult | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: HEALTH_SYSTEM_PROMPT },
          { role: 'user', content: serializeVariables(variables) },
        ],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.message?.content;
    if (typeof content !== 'string') return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Model returned non-JSON text despite format:'json' — fail soft rather than throw.
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as HealthAnalysisResult;
  } catch {
    return null;
  }
}
