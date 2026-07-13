// Stage 1 adapter — official statements, via our own /api/statements proxy.
//
// TRAP, verified live: the API's `countryCode` is the ISSUING AUTHORITY, not the
// subject. The current payload is 12× 'GB' and 12× '' — because
// "Guidance: Timor-Leste: medical facilities" is tagged GB (the FCDO published
// it), not TL. Merging on that field would make the feed claim the UK has a
// dozen alerts.
//
// So: countryCode → authorityCountry, and `country` (the subject) stays null.
// Stage 2's constrained classifier resolves the subject from rawText against
// the watchlist enum, and emits null rather than guessing. This is precisely the
// unstructured case Stage 2 exists for.
//
// We call /api/statements DIRECTLY rather than services/statementsFeed.ts,
// because that module runs statementAi.enrichStatements() — a second LLM pass
// producing an `urgency` field that would compete with Stage 5's score. The
// Official Statements card keeps using it, unchanged.

import type { AdapterResult, RawSignal, SignalSource, SourceStatus } from '../types';

const ENDPOINT = '/api/statements';

interface Statement {
  id: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  sourceApi: string; // 'ReliefWeb' | 'GDELT' | 'RSS'
  fullText: string;
  countryCode: string; // ← the AUTHORITY, not the subject
}
interface StatementsApiResponse {
  statements?: Statement[];
  sources?: Record<string, { ok?: boolean; count?: number }>;
  degraded?: boolean;
}

function sourceOf(sourceApi: string): SignalSource {
  const s = sourceApi.toLowerCase();
  if (s.includes('reliefweb')) return 'RELIEFWEB';
  if (s.includes('gdelt')) return 'GDELT';
  return 'RSS';
}

function toSignal(s: Statement): RawSignal {
  const source = sourceOf(s.sourceApi);
  const body = [s.title, s.fullText].filter(Boolean).join('\n\n');
  return {
    id: `${source}:${s.id}`,
    source,
    tier: null,
    ingestedAt: new Date().toISOString(),
    occurredAt: s.publishedAt,
    rawText: body || null, // Stage 2 input
    country: null,         // ← subject unknown until Stage 2. Never the authority.
    authorityCountry: s.countryCode || null,
    eventType: null,       // ← needs Stage 2 classification
    coords: null,
    // rawText already doubles as the location resolver's text source here.
    placeText: null,
    geoType: null,
    severityHint: null,    // the API's `urgency` is LLM-derived; not a source fact
    url: s.sourceUrl || null,
    sourceDomain: null,
    provenance: { fetchedFrom: ENDPOINT, httpStatus: 200, ok: true },
  };
}

export async function ingestStatements(): Promise<AdapterResult> {
  const sourceKeys: SignalSource[] = ['RELIEFWEB', 'RSS', 'GDELT'];
  let httpStatus: number | null = null;

  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(20000) });
    httpStatus = res.status;

    if (!res.ok) {
      return {
        signals: [],
        sourceKeys,
        status: { ok: false, httpStatus, count: 0, error: `${ENDPOINT} responded ${res.status}` },
      };
    }

    const data = (await res.json()) as StatementsApiResponse;
    const signals = (data.statements ?? []).map(toSignal);

    const byId = new Map(signals.map((s) => [s.id, s]));
    const deduped = [...byId.values()];

    // The backend already computes `degraded` and a per-upstream `sources` map.
    // The Statements card throws both away (audit finding). We surface them.
    const notes: string[] = [];
    for (const [name, s] of Object.entries(data.sources ?? {})) {
      if (s.ok === false) notes.push(`${name}: upstream failed`);
      else if ((s.count ?? 0) === 0) notes.push(`${name}: reachable but contributed 0 rows`);
    }
    if (data.degraded) notes.unshift('backend reports degraded=true');

    const status: SourceStatus = {
      ok: true,
      httpStatus,
      count: deduped.length,
      error: notes.length > 0 ? notes.join('; ') : undefined,
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
