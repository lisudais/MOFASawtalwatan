// Stage 1 adapter — broad GDELT catch-all, via our own /api/gdelt-feed proxy.
//
// This is the pipeline's only source of genuinely unstructured signal, and the
// sole reason Stage 2's classifier exists. Every article arrives with
// eventType: null and country: null — the constrained classifier resolves both
// against the watchlist enum, and emits null rather than guessing.

import type { AdapterResult, RawSignal, SignalSource } from '../types';

const ENDPOINT = '/api/gdelt-feed';

/**
 * The proxy's COLD path is slow by construction, and measured:
 *   • two sequential upstream queries (broad + tier2), 5s-spaced by the rate limiter
 *   • GDELT's TCP connect alone takes 10-14s, retried up to 4x on 429/timeout
 *   • observed end-to-end: 98.7s cold, 142.8s worst case; ~0ms warm (5min cache)
 *
 * The old 25s budget was shorter than the cold path, so on any cache miss this
 * adapter aborted, GDELT contributed zero signals, and — because the abort was
 * caught and reported as a source failure rather than surfaced — the feed simply
 * had fewer cards. Exactly the silent-failure class this pipeline exists to kill.
 *
 * Blocking the UI is not a concern: this adapter runs ONLY in ingest.ts's SLOW
 * tier (`ingestGdelt`), which streams in behind `ingestFast`. Nothing waits on it.
 */
const GDELT_TIMEOUT_MS = Number(import.meta.env.VITE_GDELT_TIMEOUT_MS ?? 180_000);

interface Article {
  url: string;
  title: string;
  domain: string | null;
  language: string | null;
  seenAt: string;
}
interface GdeltFeedResponse {
  ok?: boolean;
  httpStatus?: number;
  articles?: Article[];
  error?: string;
  cached?: boolean;
}

function toSignal(a: Article): RawSignal {
  return {
    // The article URL is GDELT's stable identity.
    id: `GDELT:${a.url}`,
    source: 'GDELT',
    tier: null,
    ingestedAt: new Date().toISOString(),
    occurredAt: a.seenAt,
    rawText: a.title, // GDELT ArtList gives no body — title is all we have
    country: null,    // ← Stage 2 resolves. Never inferred from `domain`.
    authorityCountry: null,
    eventType: null,  // ← Stage 2 resolves
    coords: null,
    // rawText already doubles as the location resolver's text source here.
    placeText: null,
    geoType: null,
    severityHint: null,
    url: a.url,
    sourceDomain: a.domain, // Stage 3 matches this against the Tier-2 outlet list
    provenance: { fetchedFrom: ENDPOINT, httpStatus: 200, ok: true },
  };
}

export async function ingestGdeltBroad(): Promise<AdapterResult> {
  const sourceKeys: SignalSource[] = ['GDELT'];
  let httpStatus: number | null = null;

  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(GDELT_TIMEOUT_MS) });
    httpStatus = res.status;

    if (!res.ok) {
      return {
        signals: [],
        sourceKeys,
        status: { ok: false, httpStatus, count: 0, error: `${ENDPOINT} responded ${res.status}` },
      };
    }

    const data = (await res.json()) as GdeltFeedResponse;

    // The proxy answers 200 even when GDELT itself failed, so the upstream's
    // own `ok` flag — not the HTTP status — decides health here.
    if (data.ok !== true) {
      return {
        signals: [],
        sourceKeys,
        status: { ok: false, httpStatus, count: 0, error: data.error ?? 'gdelt upstream reported ok:false' },
      };
    }

    const signals = (data.articles ?? []).map(toSignal);
    const byId = new Map(signals.map((s) => [s.id, s]));
    const deduped = [...byId.values()];

    return {
      signals: deduped,
      sourceKeys,
      status: { ok: true, httpStatus, count: deduped.length },
    };
  } catch (err) {
    return {
      signals: [],
      sourceKeys,
      status: { ok: false, httpStatus, count: 0, error: String(err) },
    };
  }
}
