// ─────────────────────────────────────────────────────────────────────────
// Aggregated Alerts — the RIGHT-column "التنبيهات العالمية" list.
//
// This list is NOT an independent data source. It is a LIVE ROLL-UP of the exact
// same data the four left-column sections already render:
//   • الصحة            (CountryHealthEntry[] — WHO / disease.sh)
//   • الكوارث الطبيعية (DisasterEvent[]     — USGS/EMSC/GDACS/Smithsonian/NOAA/EONET)
//   • التهديدات الأمنية (CountrySecurityProfile[] — ACLED, State Dept)
//   • التغيرات الاقتصادية (EconomicIndicator[] — Alpha Vantage / World Bank / Gold)
//
// Every item keeps the SAME risk score the source card shows, so severity, colour
// and ordering here are a faithful mirror of the left sections — never a second,
// separately-computed opinion. Colour comes from the app-wide classifier
// (riskClassification.ts), exactly as each source card already uses it, so a red
// card here is a red card there. Items are ranked by score DESC across ALL four
// sections combined and capped to the most severe TOP_N.
//
// Location is resolved from each source's own real fields; coordinate-only
// disaster events are enriched asynchronously (Nominatim) — see reverseGeocode.ts.
// We never print "موقع غير محدد": worst case we show the raw coordinates.
// ─────────────────────────────────────────────────────────────────────────

import type { CountryHealthEntry } from '../healthAnalysis';
import type { DisasterEvent, Severity as DisasterSeverity } from '../naturalDisasterFeed';
import { disasterPlaceLabel } from '../naturalDisasterFeed';
import type { CountrySecurityProfile } from '../security';
import type { EconomicIndicator } from '../economy';

export type AlertCategory = 'health' | 'natural_disaster' | 'security' | 'economic';

/** How many of the most-severe items the list shows across all sections. */
export const TOP_N = 20;

export interface AggregatedAlert {
  id: string;
  category: AlertCategory;
  /** 0-100 — the SAME value the source card uses for its own severity. */
  score: number;
  /** Resolved place — a real country/city, coordinates, or (economy) market scope. Never "غير محدد". */
  location: string;
  countryCode: string; // ISO2 or ''
  /** Present only for coordinate-bearing disaster events that still need a name. */
  lat?: number;
  lng?: number;
  /** true → location currently holds fallback coordinates and can be upgraded by reverse geocoding. */
  needsGeocode?: boolean;
  /** Primary line — the event/subject. */
  title: string;
  /** Secondary line — a short human description. */
  detail: string;
  occurredAt: string | null;
  /** Real upstream source label (WHO, USGS, ACLED, Alpha Vantage…). */
  sourceLabel: string;
  url?: string | null;
  /** Discriminated back-reference so a click opens the SAME detail panel the left card does. */
  ref:
    | { kind: 'health'; entry: CountryHealthEntry }
    | { kind: 'natural_disaster'; event: DisasterEvent }
    | { kind: 'security'; profile: CountrySecurityProfile }
    | { kind: 'economic'; indicator: EconomicIndicator };
}

export interface AggregateInputs {
  healthCountries: CountryHealthEntry[];
  disasterEvents: DisasterEvent[];
  securityCountries: CountrySecurityProfile[];
  economyIndicators: EconomicIndicator[];
}

// Disaster events carry a 4-tier band, not a 0-100 number. Map each band to a
// representative score whose unified classifier band + colour EXACTLY matches the
// disaster card's own SEVERITY_COLOR (red/orange/yellow/green), so the same event
// reads identically on the left card and in this list.
const DISASTER_SEVERITY_SCORE: Record<DisasterSeverity, number> = {
  CRITICAL: 90, // → classifyRiskByScore = حرج / red   (#FF1744)
  HIGH: 65,     // → مرتفع / orange (#FF6D00)
  MODERATE: 38, // → متوسط / yellow (#FFD600)
  LOW: 12,      // → منخفض / green  (#00E676)
};

// Economic indicators have no risk score. Volatility IS the risk signal: the
// bigger the move (up OR down), the more it matters to a crisis desk. Scale the
// absolute % change into 0-100 — a routine ~1% move stays "low", a violent ~9%+
// swing reaches "critical". Deterministic, documented, never invented per-item.
function economicScore(changePercent: number): number {
  return Math.max(0, Math.min(95, Math.round(Math.abs(changePercent) * 9)));
}

// Economic indicators are markets, not places. Name the scope honestly from the
// indicator label instead of pretending a country — never "غير محدد".
function economicLocation(nameAr: string): string {
  if (nameAr.includes('السعودية')) return 'السعودية';
  if (nameAr.includes('عالمي')) return 'عالمي';
  return 'الأسواق العالمية';
}

/** Short coordinate string — the honest last-resort location, never a "unknown" placeholder. */
export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'شمالاً' : 'جنوباً';
  const ew = lng >= 0 ? 'شرقاً' : 'غرباً';
  return `${Math.abs(lat).toFixed(1)}° ${ns}، ${Math.abs(lng).toFixed(1)}° ${ew}`;
}

function fromHealth(e: CountryHealthEntry): AggregatedAlert {
  return {
    id: `health-${e.countryCode}-${e.disease}`,
    category: 'health',
    score: e.riskScore,
    location: e.country, // already an Arabic country name
    countryCode: e.countryCode,
    title: e.disease,
    detail: `احتمال تفشٍّ ${e.analysis.outbreak_forecast.probability}% · ${e.country}`,
    occurredAt: e.updatedAt ?? null,
    sourceLabel: e.sourceName ?? 'WHO',
    url: e.sourceUrl ?? null,
    ref: { kind: 'health', entry: e },
  };
}

function fromDisaster(d: DisasterEvent): AggregatedAlert {
  // Prefer the source's own place fields ("Country - Region" when a state/
  // province is known); fall back to coordinates (to be upgraded by reverse
  // geocoding), never to a blank/unknown label.
  const hasCountry = Boolean(d.country && d.country.trim());
  const place = hasCountry
    ? disasterPlaceLabel(d.country, d.city)
    : formatCoords(d.latitude, d.longitude);
  return {
    id: d.id,
    category: 'natural_disaster',
    score: DISASTER_SEVERITY_SCORE[d.severity],
    location: place,
    countryCode: d.countryCode,
    lat: d.latitude,
    lng: d.longitude,
    needsGeocode: !hasCountry && Number.isFinite(d.latitude) && Number.isFinite(d.longitude),
    title: d.title,
    detail: d.aiSummary || d.description || d.title,
    occurredAt: d.updatedAt ?? null,
    sourceLabel: d.source,
    url: d.sourceUrl ?? null,
    ref: { kind: 'natural_disaster', event: d },
  };
}

function fromSecurity(p: CountrySecurityProfile): AggregatedAlert {
  return {
    id: `security-${p.id}`,
    category: 'security',
    score: p.riskScore, // the exact number the security card shows
    location: p.country,
    countryCode: p.countryCode,
    title: p.topReasons[0] ?? 'تهديد أمني نشط',
    detail: `${p.activeIncidents} حدث نشط · ${p.country}`,
    occurredAt: p.latestUpdate ?? null,
    sourceLabel: p.sources[0]?.name ?? 'ACLED',
    ref: { kind: 'security', profile: p },
  };
}

function fromEconomy(ind: EconomicIndicator): AggregatedAlert {
  const dir = ind.changePercent >= 0 ? 'ارتفاع' : 'انخفاض';
  return {
    id: `economy-${ind.key}`,
    category: 'economic',
    score: economicScore(ind.changePercent),
    location: economicLocation(ind.nameAr),
    countryCode: '',
    title: ind.nameAr,
    detail: `${dir} ${Math.abs(ind.changePercent).toFixed(2)}${ind.unit === '%' ? ' نقطة' : '%'} · ${ind.source}`,
    occurredAt: ind.updatedAt ?? null,
    sourceLabel: ind.source,
    ref: { kind: 'economic', indicator: ind },
  };
}

/**
 * Roll the four live sections into one list, ranked by real score DESC across
 * ALL sections and capped to the most severe TOP_N. Pure function — recompute it
 * whenever any section's data changes and the list stays in live sync for free.
 */
export function aggregateAlerts(inputs: AggregateInputs): AggregatedAlert[] {
  const all: AggregatedAlert[] = [
    ...inputs.healthCountries.map(fromHealth),
    ...inputs.disasterEvents.map(fromDisaster),
    ...inputs.securityCountries.map(fromSecurity),
    ...inputs.economyIndicators.map(fromEconomy),
  ];

  return all
    .sort(
      (a, b) =>
        b.score - a.score ||
        (Date.parse(b.occurredAt ?? '') || 0) - (Date.parse(a.occurredAt ?? '') || 0),
    )
    .slice(0, TOP_N);
}
