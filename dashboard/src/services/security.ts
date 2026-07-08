// Security Threats panel — types, display config, and the frontend feed.
//
// The browser calls ONLY our backend proxy (/api/security). The overall score
// and per-category scores are COMPUTED server-side from official sources
// (U.S. State Dept advisories + GDELT) — never invented, never taken raw from a
// single API. AI (see securityAi.ts) is used only to summarize/explain.

export type ThreatLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ThreatItem { title: string; severity: Severity; time: string; source: string; url: string }
export interface TimelineItem { date: string; title: string; severity: Severity; source: string; url: string }
export interface SourceLink { name: string; url: string }

export type SecurityCategory =
  | 'security' | 'terrorism' | 'civilUnrest' | 'militaryConflict'
  | 'crime' | 'naturalDisasters' | 'healthRisks' | 'economicRisks';

export interface SecurityProfile {
  id: string;
  country: string;
  countryEn: string;
  countryCode: string;
  overall: number;
  level: ThreatLevel;
  advisoryLevel: number;
  advisoryLabel: string;
  categories: Record<SecurityCategory, number>;
  reasons: SecurityCategory[];
  currentThreats: ThreatItem[];
  timeline: TimelineItem[];
  sources: SourceLink[];
  lastUpdated: string; // ISO
}

// Order + Arabic labels for the threat breakdown.
export const CATEGORY_ORDER: SecurityCategory[] = [
  'security', 'terrorism', 'civilUnrest', 'militaryConflict',
  'crime', 'naturalDisasters', 'healthRisks', 'economicRisks',
];
export const CATEGORY_LABEL_AR: Record<SecurityCategory, string> = {
  security:         'الأمن',
  terrorism:        'الإرهاب',
  civilUnrest:      'الاضطرابات المدنية',
  militaryConflict: 'النزاعات العسكرية',
  crime:            'الجريمة',
  naturalDisasters: 'الكوارث الطبيعية',
  healthRisks:      'المخاطر الصحية',
  economicRisks:    'المخاطر الاقتصادية',
};

export const THREAT_LABEL_AR: Record<ThreatLevel, string> = {
  LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع', CRITICAL: 'حرج',
};

// Green → Yellow → Orange → Red by score (kept as hex so `${c}1A` alpha works).
export function scoreColor(score: number): string {
  if (score >= 75) return '#FF1744'; // CRITICAL — red
  if (score >= 55) return '#FF6D00'; // HIGH — orange
  if (score >= 30) return '#FFD600'; // MEDIUM — yellow
  return '#00E676';                  // LOW — green
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
  return date.toLocaleString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export interface SourceStatus { configured: boolean; ok: boolean; count: number }
export interface SecurityFeed {
  profiles: SecurityProfile[];
  statuses: {
    stateDept: SourceStatus;
    gdelt: SourceStatus;
    acled: SourceStatus;      // from backend (credentials never reach the browser)
    reliefweb: SourceStatus;  // fetched here (public appname, CORS-open)
  };
}

interface ApiResponse {
  profiles: SecurityProfile[];
  sources?: Record<string, { configured?: boolean; ok: boolean; count: number }>;
}

/* ─── ReliefWeb (frontend) — humanitarian/security reports ───────────────
   ReliefWeb v2 is CORS-open and its appname is a public identifier, so it is
   fetched directly here using the approved appname from the environment. If the
   appname is missing the feed is "not configured" and the UI shows a warning —
   never mock data. */
const RELIEFWEB_APP = import.meta.env.VITE_RELIEFWEB_APP_NAME as string | undefined;

// One ReliefWeb report → normalised security event (same shape the section uses).
interface RwEvent {
  id: string; title: string; country: string; countryIso3: string;
  date: string; severity: Severity; summary: string;
  source: 'ReliefWeb'; sourceUrl: string; category: 'humanitarian-security';
}

async function fetchReliefWeb(): Promise<{ configured: boolean; ok: boolean; events: RwEvent[] }> {
  if (!RELIEFWEB_APP) return { configured: false, ok: false, events: [] };
  const params = [
    `appname=${encodeURIComponent(RELIEFWEB_APP)}`,
    'profile=list', 'preset=latest', 'limit=40',
    'filter[field]=format.name', 'filter[value]=News and Press Release',
    'query[value]=conflict OR security OR attack OR violence OR clashes OR displacement',
    'fields[include][]=title', 'fields[include][]=url', 'fields[include][]=date.created',
    'fields[include][]=primary_country.name', 'fields[include][]=primary_country.iso3',
  ].join('&');
  try {
    const res = await fetch(`https://api.reliefweb.int/v2/reports?${params}`, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return { configured: true, ok: false, events: [] }; // e.g. 403 unapproved appname
    const data = await res.json();
    const events: RwEvent[] = (data?.data ?? []).map((item: any) => {
      const f = item.fields ?? {};
      return {
        id: `rw-${item.id}`,
        title: (f.title ?? '').trim(),
        country: f.primary_country?.name ?? '',
        countryIso3: f.primary_country?.iso3 ?? '',
        date: f.date?.created ?? new Date().toISOString(),
        severity: 'MEDIUM' as Severity, // ReliefWeb has no fatalities field → neutral, not invented
        summary: '',
        source: 'ReliefWeb' as const,
        sourceUrl: f.url ?? `https://reliefweb.int/node/${item.id}`,
        category: 'humanitarian-security' as const,
      };
    }).filter((e: RwEvent) => e.title && e.country);
    return { configured: true, ok: true, events };
  } catch {
    return { configured: true, ok: false, events: [] };
  }
}

// Fold ReliefWeb events into the matching country profiles (by English name).
function mergeReliefWeb(profiles: SecurityProfile[], events: RwEvent[]): void {
  const byName = new Map(profiles.map((p) => [p.countryEn.toLowerCase(), p]));
  for (const e of events) {
    const p = byName.get(e.country.toLowerCase());
    if (!p) continue;
    p.timeline.push({ date: e.date, title: e.title, severity: e.severity, source: 'ReliefWeb', url: e.sourceUrl });
    if (!p.sources.some((s) => s.name.startsWith('ReliefWeb'))) {
      p.sources.push({ name: 'ReliefWeb (تقارير إنسانية/أمنية)', url: 'https://reliefweb.int/updates' });
    }
  }
  for (const p of profiles) p.timeline.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
}

const emptyStatus = (): SourceStatus => ({ configured: false, ok: false, count: 0 });

// Combined feed: backend profiles (U.S. State Dept + GDELT + ACLED) enriched
// with ReliefWeb events, plus per-source status for the UI warnings. Throws on
// transport failure / empty feed so the card shows its error state. No mock.
export async function fetchSecurityFeed(): Promise<SecurityFeed> {
  const [secRes, rw] = await Promise.all([
    fetch('/api/security', { signal: AbortSignal.timeout(15000) }),
    fetchReliefWeb(),
  ]);
  if (!secRes.ok) throw new Error(`security proxy responded ${secRes.status}`);
  const data = (await secRes.json()) as ApiResponse;
  const profiles = data.profiles ?? [];
  if (profiles.length === 0) throw new Error('لا توجد بيانات أمنية من المصادر');

  mergeReliefWeb(profiles, rw.events);
  profiles.sort((a, b) => b.overall - a.overall);

  const s = data.sources ?? {};
  const toStatus = (x?: { configured?: boolean; ok: boolean; count: number }): SourceStatus =>
    x ? { configured: x.configured ?? true, ok: x.ok, count: x.count } : emptyStatus();

  return {
    profiles,
    statuses: {
      stateDept: toStatus(s['U.S. State Dept']),
      gdelt: toStatus(s.GDELT),
      acled: toStatus(s.ACLED),
      reliefweb: { configured: rw.configured, ok: rw.ok, count: rw.events.length },
    },
  };
}
