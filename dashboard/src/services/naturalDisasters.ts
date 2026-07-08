// Natural Disasters section — LIVE data only.
//
// Sourced exclusively from the real disaster APIs already integrated in the
// project: USGS + EMSC (earthquakes), EONET/NASA (wildfires, storms, volcanoes,
// floods), and GDACS (multi-hazard). No mock/static data. Each GeoEvent is
// mapped into the card's shape below; fields the APIs don't provide (e.g. a
// human-authored "expected duration" or a street-level list of affected places)
// are left undefined and hidden in the UI rather than invented.

import type { GeoEvent, RiskLevel } from '../types';
import { fetchUSGSEarthquakes } from './usgs';
import { fetchExtraDisasterEvents } from './disasters';
import { fetchGDACSEvents } from './gdacs';
import { lookupCountry } from './countryNames';

export type NDType = 'EARTHQUAKE' | 'VOLCANO' | 'STORM' | 'FLOOD' | 'WILDFIRE';
export type NDRisk = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NaturalDisaster {
  id: string;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2, drives the flag emoji ('' → generic flag)
  type: NDType;
  risk: NDRisk;
  updatedAt: Date;
  title: string;        // original event title from the source
  description: string;  // original event description from the source
  source: string;       // real source name (USGS / EMSC / EONET / GDACS)

  // Present only when the source provides them — otherwise undefined + hidden.
  value?: string;             // magnitude/severity parsed from the source (e.g. "M 6.8")
  city?: string;              // affected region/area from the source
  affectedPlaces?: string[];  // specific places (APIs rarely provide → usually omitted)
  expectedDuration?: string;  // not provided by these APIs → omitted
  analysis?: string;          // = the source description (real)
  recommendation?: string;    // = deterministic advice from riskEngine (getRecommendedAction)
  aiSummary?: string;         // optional gpt-oss enrichment (not wired here)
}

// Filter tabs — order and labels per spec. `type: null` is the "الكل" tab.
export const ND_TABS: { key: string; label: string; type: NDType | null }[] = [
  { key: 'ALL',        label: 'الكل',      type: null },
  { key: 'EARTHQUAKE', label: 'الزلازل',   type: 'EARTHQUAKE' },
  { key: 'VOLCANO',    label: 'البراكين',  type: 'VOLCANO' },
  { key: 'STORM',      label: 'الأعاصير',  type: 'STORM' },
  { key: 'FLOOD',      label: 'الأمطار',   type: 'FLOOD' },
  { key: 'WILDFIRE',   label: 'الحرائق',   type: 'WILDFIRE' },
];

export const ND_TYPE_LABEL_AR: Record<NDType, string> = {
  EARTHQUAKE: 'زلزال',
  VOLCANO:    'بركان',
  STORM:      'إعصار',
  FLOOD:      'أمطار وسيول',
  WILDFIRE:   'حرائق',
};

export const ND_RISK_LABEL_AR: Record<NDRisk, string> = {
  HIGH:   'مرتفع',
  MEDIUM: 'متوسط',
  LOW:    'منخفض',
};

// Severity colors reuse the existing palette's danger hues (see RISK_COLORS /
// the --danger-* tokens) — red/yellow/green already carry "danger" meaning
// across the dashboard. Kept as hex (not var()) so an alpha suffix like
// `${color}1A` yields a valid translucent fill for the risk badge.
export const ND_RISK_COLOR: Record<NDRisk, string> = {
  HIGH:   '#FF1744', // --danger-critical
  MEDIUM: '#FFD600', // --danger-medium
  LOW:    '#00E676', // --danger-low
};

const ND_RISK_RANK: Record<NDRisk, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// Automatic ordering: highest risk first, then most-recently-updated within a level.
export function sortDisasters(list: NaturalDisaster[]): NaturalDisaster[] {
  return [...list].sort(
    (a, b) =>
      ND_RISK_RANK[a.risk] - ND_RISK_RANK[b.risk] ||
      b.updatedAt.getTime() - a.updatedAt.getTime()
  );
}

// Arabic relative-time label, e.g. "منذ 15 دقيقة".
export function timeAgoAr(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

// ─── Live mapping: GeoEvent (real API) → NaturalDisaster ────────────────
// Only the five hazard types the card exposes (drought/etc. are excluded to
// match the tab set). 5-level engine risk is collapsed to the card's 3 levels.
const CARD_TYPES: readonly string[] = ['EARTHQUAKE', 'VOLCANO', 'STORM', 'FLOOD', 'WILDFIRE'];

function riskFromLevel(level: RiskLevel): NDRisk {
  if (level === 'CRITICAL' || level === 'HIGH') return 'HIGH';
  if (level === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

// Pull a human-readable magnitude out of the source title when present
// (USGS/EMSC quakes are titled "M6.8 …"). Undefined for hazards without one.
function parseValue(e: GeoEvent): string | undefined {
  const m = e.title.match(/\bM\s?(\d+(?:\.\d+)?)/i);
  return m ? `M ${m[1]}` : undefined;
}

function toNaturalDisaster(e: GeoEvent): NaturalDisaster {
  const rawCountry = e.country && e.country !== 'Unknown' ? e.country : '';
  // Arabize + resolve a flag code from the source's location string; fall back
  // to the event title (EONET has no country field, only a titled location).
  const info = lookupCountry(rawCountry) ?? lookupCountry(e.title);
  const country = info?.ar ?? rawCountry;
  return {
    id: e.id,
    country,
    countryCode: info?.iso2 ?? e.countryCode ?? '',
    type: e.type as NDType,
    risk: riskFromLevel(e.riskLevel),
    updatedAt: e.timestamp,
    title: e.title,
    description: e.description,
    source: e.source,
    value: parseValue(e),
    city: e.affectedArea || country || undefined,
    analysis: e.description,
    recommendation: e.recommendedAction,
  };
}

// Fetches the live disaster feed from every integrated source in parallel,
// keeps only the card's hazard types, de-duplicates, and returns newest-first
// by risk. A failing source never blocks the others.
export async function fetchNaturalDisasters(): Promise<NaturalDisaster[]> {
  const [usgs, extra, gdacs] = await Promise.allSettled([
    fetchUSGSEarthquakes(),
    fetchExtraDisasterEvents(),
    fetchGDACSEvents(),
  ]);

  const events: GeoEvent[] = [
    ...(usgs.status === 'fulfilled' ? usgs.value : []),
    ...(extra.status === 'fulfilled' ? extra.value : []),
    ...(gdacs.status === 'fulfilled' ? gdacs.value : []),
  ].filter((e) => CARD_TYPES.includes(e.type));

  const seen = new Set<string>();
  const disasters: NaturalDisaster[] = [];
  for (const e of events) {
    const key = `${e.type}|${e.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    disasters.push(toNaturalDisaster(e));
  }
  return sortDisasters(disasters);
}
