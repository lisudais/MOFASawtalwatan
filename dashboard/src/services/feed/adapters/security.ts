// Stage 1 adapter — security signals, via our own /api/security proxy.
//
// CRITICAL: a SecurityProfile is a COUNTRY AGGREGATE, not an event. It carries
// `overall: 0-100`, `level`, and `categories`, all computed server-side. Merging
// that into the feed would import a second scoring system and break the Stage 5
// rule that scoring happens in exactly one deterministic place.
//
// So we DECOMPOSE each profile into its event-shaped members and throw the
// aggregate away:
//   profile.currentThreats[] → one signal each  (the dated incidents)
//   profile.timeline[]       → one signal each  (advisory updates + headlines)
// `overall` / `level` / `categories` / `reasons` are never read.
//
// We call /api/security DIRECTLY rather than services/security.ts, because that
// module also fetches ReliefWeb client-side and shapes data for the Security
// Threats card. That card keeps consuming it, unchanged.

import type { AdapterResult, RawSignal, SignalSource, SourceStatus } from '../types';

const ENDPOINT = '/api/security';

// Only the fields we actually read. Anything else on the profile is ignored.
interface ProfileMember {
  title: string;
  severity: string;
  source: string;
  url: string;
}
interface Profile {
  countryCode: string;
  currentThreats: (ProfileMember & { time: string })[];
  timeline: (ProfileMember & { date: string })[];
}
interface SecurityApiResponse {
  profiles?: Profile[];
  sources?: Record<string, { configured?: boolean; ok?: boolean; count?: number }>;
}

// The backend attributes each member to a named source. Map it to a
// SignalSource so Stage 3 can assign the right tier. Unrecognized attributions
// fall back to STATE_DEPT, which is the profile's structural backbone.
function sourceOf(memberSource: string): SignalSource {
  const s = memberSource.toLowerCase();
  if (s.includes('acled')) return 'ACLED';
  if (s.includes('gdelt')) return 'GDELT';
  return 'STATE_DEPT';
}

function toSignal(
  countryCode: string,
  member: ProfileMember,
  occurredAt: string,
  kind: 'threat' | 'timeline'
): RawSignal {
  const source = sourceOf(member.source);
  return {
    // Stable across refetches: country + kind + title + timestamp.
    id: `${source}:${countryCode}:${kind}:${member.title}:${occurredAt}`,
    source,
    tier: null,
    ingestedAt: new Date().toISOString(),
    occurredAt,
    // Title only — the API carries no body. Stage 6 may summarize from it;
    // Stage 2 need not classify it, since eventType is already known.
    rawText: member.title,
    country: countryCode || null,
    authorityCountry: null,
    eventType: 'security',
    coords: null, // /api/security gives no coordinates. We never fabricate one.
    geoType: null,
    severityHint: member.severity || null, // 'CRITICAL' | 'HIGH' | … verbatim
    url: member.url || null,
    sourceDomain: null,
    provenance: { fetchedFrom: ENDPOINT, httpStatus: 200, ok: true },
  };
}

export async function ingestSecurity(): Promise<AdapterResult> {
  const sourceKeys: SignalSource[] = ['STATE_DEPT', 'ACLED', 'GDELT'];
  let httpStatus: number | null = null;

  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(20000) });
    httpStatus = res.status;

    // ok derives from HTTP status, not from the promise resolving. This is the
    // exact defect the audit found: a 403 that resolves is still a failure.
    if (!res.ok) {
      return {
        signals: [],
        sourceKeys,
        status: { ok: false, httpStatus, count: 0, error: `${ENDPOINT} responded ${res.status}` },
      };
    }

    const data = (await res.json()) as SecurityApiResponse;
    const profiles = data.profiles ?? [];

    const signals: RawSignal[] = [];
    for (const p of profiles) {
      for (const t of p.currentThreats ?? []) {
        signals.push(toSignal(p.countryCode, t, t.time, 'threat'));
      }
      for (const t of p.timeline ?? []) {
        signals.push(toSignal(p.countryCode, t, t.date, 'timeline'));
      }
    }

    // Exact-id dedup only. Cross-source dedup is Stage 4's job — collapsing it
    // here would destroy the corroboration signal Stage 5 needs.
    const byId = new Map(signals.map((s) => [s.id, s]));
    const deduped = [...byId.values()];

    // Surface the backend's own per-upstream flags, which the Security card
    // currently reads only partially (`configured`, never `ok`).
    const upstream = data.sources ?? {};
    const status: SourceStatus = {
      ok: true,
      httpStatus,
      count: deduped.length,
      error: describeUpstream(upstream),
    };

    return { signals: deduped, sourceKeys, status };
  } catch (err) {
    return {
      signals: [],
      sourceKeys,
      status: { ok: false, httpStatus, count: 0, error: String(err) },
    };
  }
}

// Turns the backend `sources` map into a human-readable degradation note.
// Returns undefined when every upstream is healthy and contributing.
function describeUpstream(
  sources: Record<string, { configured?: boolean; ok?: boolean; count?: number }>
): string | undefined {
  const notes: string[] = [];
  for (const [name, s] of Object.entries(sources)) {
    if (s.configured === false) notes.push(`${name}: not configured`);
    else if (s.ok === false) notes.push(`${name}: upstream failed`);
    else if ((s.count ?? 0) === 0) notes.push(`${name}: reachable but contributed 0 rows`);
  }
  return notes.length > 0 ? notes.join('; ') : undefined;
}
