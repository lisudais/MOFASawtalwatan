// Security Threats panel — types, display config, and the frontend feed.
//
// The browser calls ONLY our backend proxy (/api/security), which fetches
// ACLED — the ONLY data source — per country and computes a weighted 0-100
// risk score server-side (netlify/lib/securityCore.mjs). No ReliefWeb, GDELT,
// or travel-advisory feed is used. Nothing is invented here or there; AI
// (see securityAi.ts) only summarizes it.

import { classifyRiskByScore } from './riskClassification';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ThreatItem { title: string; severity: Severity; time: string; source: string; url: string }
export interface TimelineItem { date: string; title: string; severity: Severity; source: string; url: string }
export interface SourceLink { name: string; url: string }

// The five ACLED-derived weighted factors behind riskScore (30/25/20/15/10).
export interface SecurityFactors {
  volume: number;
  fatalities: number;
  severity: number;
  recency: number;
  intensity: number;
}

export interface CountrySecurityProfile {
  id: string;
  country: string;      // Arabic name
  countryEn: string;
  countryCode: string;  // ISO 3166-1 alpha-2
  riskScore: number;      // 0-100, weighted — deterministic, never LLM-decided
  riskLevel: RiskLevel;
  activeIncidents: number;  // ACLED events + GDELT headline matches in the recent window
  fatalities: number;       // total ACLED-reported fatalities in the window
  sourceCount: number;      // U.S. State Dept (always) + ACLED/GDELT when they contributed
  latestUpdate: string;     // ISO — most recent contributing signal (advisory, ACLED, or GDELT)
  factors: SecurityFactors;
  topReasons: string[];     // Arabic, up to 3, ranked by factor weight
  currentThreats: ThreatItem[];
  timeline: TimelineItem[];
  sources: SourceLink[];
}

export const FACTOR_ORDER: (keyof SecurityFactors)[] = [
  'volume', 'fatalities', 'severity', 'recency', 'intensity',
];
// Must mirror netlify/lib/securityCore.mjs's own FACTOR_LABEL_AR exactly —
// that's where topReasons' strings come from; this is what labels the same
// five factors in the breakdown UI.
export const FACTOR_LABEL_AR: Record<keyof SecurityFactors, string> = {
  volume: 'عدد الأحداث النشطة',
  fatalities: 'الضحايا (القتلى)',
  severity: 'شدة تحذير السفر الرسمي',
  recency: 'حداثة الأحداث',
  intensity: 'كثافة النزاع المسلح',
};
export const FACTOR_WEIGHT_PCT: Record<keyof SecurityFactors, number> = {
  volume: 30, fatalities: 25, severity: 20, recency: 15, intensity: 10,
};

export const RISK_LABEL_AR: Record<RiskLevel, string> = {
  LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع', CRITICAL: 'حرج',
};

// Green → Yellow → Orange → Red, matching the spec's Critical(80+)/High(60+)/Medium(40+)/Low bands.
// Delegates to the app-wide central classifier (unified 25/50/75 bands) so a
// security riskScore colours the same as the same number anywhere else.
export function scoreColor(score: number): string {
  return classifyRiskByScore(score).color;
}

export function timeAgoAr(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

export function formatDateTimeAr(date: Date): string {
  return date.toLocaleString('ar-SA-u-nu-latn', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface ApiResponse {
  countries?: CountrySecurityProfile[];
  _sources?: Record<string, { configured: boolean; ok: boolean; count: number }>;
}

const CLIENT_CACHE_MS = 10 * 60 * 1000; // mirrors the server's own cache window
let clientCache: { at: number; data: CountrySecurityProfile[] } | null = null;
let inFlight: Promise<CountrySecurityProfile[]> | null = null;

async function fetchSecurityFeedNow(): Promise<CountrySecurityProfile[]> {
  const res = await fetch('/api/security', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`security proxy responded ${res.status}`);
  const data = (await res.json()) as ApiResponse;

  const countries = data.countries ?? [];
  return [...countries].sort((a, b) => b.riskScore - a.riskScore);
}

// Single backend call. U.S. State Dept travel advisories are the REQUIRED
// backbone (free, key-less, real data with zero configuration); ACLED and
// GDELT are merged in as bonus enrichment when available (see
// netlify/lib/securityCore.mjs). If the required backbone itself fails, the
// backend throws and the proxy answers non-2xx — that's the only case that
// should surface the card's retry/unavailable state. ACLED/GDELT not being
// configured or failing is normal and never thrown here; their status is
// still always logged server-side (see netlify/lib/acled.mjs and
// securityCore.mjs) for diagnosis.
//
// Client-side layer, on top of the server's own 10-minute cache:
//   • `force` (manual refresh button, the 10-minute auto-refresh timer)
//     always hits the network — the server's own cache keeps that cheap.
//   • otherwise, a call within 10 minutes of the last successful fetch
//     reuses the in-memory result with zero network round-trip at all.
//   • concurrent callers while a request is already in flight share the
//     same promise instead of firing duplicate requests.
export async function fetchSecurityFeed(force = false): Promise<CountrySecurityProfile[]> {
  const now = Date.now();
  if (!force && clientCache && now - clientCache.at < CLIENT_CACHE_MS) {
    return clientCache.data;
  }
  if (inFlight) return inFlight;

  inFlight = fetchSecurityFeedNow()
    .then((countries) => {
      clientCache = { at: Date.now(), data: countries };
      return countries;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}
