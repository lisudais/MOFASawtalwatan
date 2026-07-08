// Frontend feed for official statements.
//
// The browser calls ONLY our own backend proxy (/api/statements) — never GDELT,
// RSS or ReliefWeb directly. The backend already merges every trusted source,
// removes duplicates, sorts newest-first, and preserves each item's original
// source URL + publishing authority (see netlify/lib/statementsCore.mjs).
//
// Here we only: parse the response, then enrich each item with AI-derived
// metadata (summary / category / urgency / entities). The original fields are
// never modified.

import type { OfficialStatement, OSSourceApi } from './officialStatements';
import { enrichStatements } from './statementAi';

const ENDPOINT = '/api/statements';

// Normalized item as it arrives from the backend (publishedAt is an ISO string
// on the wire; parsed to Date here).
export interface RawStatement {
  id: string;
  title: string;
  authority: string;
  publishedAt: Date;
  sourceName: string;
  sourceUrl: string;
  sourceApi: OSSourceApi;
  fullText: string;
  country: string;
  countryCode: string;
}

interface ApiResponse {
  statements: (Omit<RawStatement, 'publishedAt'> & { publishedAt: string })[];
  sources?: Record<string, { ok: boolean; count: number }>;
  degraded?: boolean;
}

// Fetches the merged feed from our backend and enriches it. Throws on transport
// failure or an empty feed so the card can render its error state. Partial
// source outages are handled server-side (remaining sources still return).
export async function fetchOfficialStatements(): Promise<OfficialStatement[]> {
  const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`statements proxy responded ${res.status}`);

  const data = (await res.json()) as ApiResponse;
  const raw: RawStatement[] = (data.statements ?? []).map((s) => ({
    ...s,
    publishedAt: new Date(s.publishedAt),
  }));

  if (raw.length === 0) throw new Error('لا توجد تصريحات من المصادر');

  const enrichment = await enrichStatements(raw);

  return raw.map((r, i) => {
    const e = enrichment[i];
    return {
      id: r.id,
      title: r.title,
      authority: r.authority,
      publishedAt: r.publishedAt,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      sourceApi: r.sourceApi,
      fullText: r.fullText,
      country: r.country,
      countryCode: r.countryCode,
      urgency: e.urgency,
      category: e.category,
      aiSummary: e.aiSummary,
      countries: e.countries,
      regions: e.regions,
      aiEnriched: e.aiEnriched,
    } as OfficialStatement;
  });
}
