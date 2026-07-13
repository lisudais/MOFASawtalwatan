// Frontend client for the Global Alert Feed pipeline (Stages 1-6).
//
// The browser calls ONLY our own /api/feed proxy, which runs the real pipeline
// server-side and returns card DTOs. No LLM call is made from the client.

import type { EventType } from './types';

export interface FeedCard {
  id: string;
  /** ISO2, or null when Stage 2 could not resolve a watchlist country. */
  country: string | null;
  /**
   * Display-only location string, resolved server-side by the deterministic
   * (non-AI) location resolver — never invented, always grounded in the
   * source's own place text, real coordinates (reverse-geocoded), or a
   * clearly-stated country. Falls back to "موقع غير محدد" only when none of
   * those yielded a confident result. Independent of `country` (which stays
   * the classifier's watchlist-constrained ISO2, used for grouping/scoring) —
   * `location` can name a real, more specific or off-watchlist place.
   */
  location: string;
  eventType: EventType;
  score: number;
  tier: 1 | 2 | null;
  tags: ('unconfirmed' | 'corroborated' | 'official')[];
  sources: string[];
  reportCount: number;
  /** Stage 6 sentence. Never null in practice — the template always fills in. */
  summary: string | null;
  aiGenerated: boolean;
  occurredAt: string | null;
  url: string | null;
  /**
   * Original GeoEvent['type'] of the first geophysical member (EARTHQUAKE, FLOOD,
   * STORM…). Lets the card restore its per-type icon. null for security /
   * statement / GDELT clusters, which have no GeoEvent behind them.
   */
  geoType: string | null;
  breakdown: {
    band: string;
    bandReason: string;
    capApplied: { cap: number; reason: string } | null;
    ceilingNote: string | null;
    corroborationBonus: number;
  };
  signalIds: string[];
  /**
   * true when produced by the FAST tier: no Stage 2 classification, no Stage 4
   * pairwise corroboration, no Stage 6 AI summary. Such a score is conservative —
   * uncorroborated, therefore capped — and is replaced when the full run lands.
   */
  provisional?: boolean;
}

export interface FeedCardsResponse {
  ok: boolean;
  cards: FeedCard[];
  degraded: boolean;
  sourceStatus: Record<string, { ok: boolean; count: number; error?: string }>;
  stats?: {
    signals: number;
    clusters: number;
    corroborated: number;
    maxScore: number;
    aiSummaries: number;
    templatedSummaries: number;
  };
  cached?: boolean;
  provisional?: boolean;
  /** Only on /api/feed/fast: whether the AI-scored run is already cached. */
  fullReady?: boolean;
  error?: string;
}

/**
 * FAST tier: deterministic stages only. Resolves in ~2s and paints immediately.
 * Requesting it also warms the full run server-side, in the background.
 */
export async function fetchFastFeedCards(): Promise<FeedCardsResponse> {
  const res = await fetch('/api/feed/fast', { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`/api/feed/fast responded ${res.status}`);
  return (await res.json()) as FeedCardsResponse;
}

/** Cheap poll: has the expensive AI-scored run finished warming? */
export async function fetchFeedStatus(): Promise<{ fullReady: boolean }> {
  const res = await fetch('/api/feed/status', { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return { fullReady: false };
  return (await res.json()) as { fullReady: boolean };
}

/**
 * FULL tier: Stages 1-6 including every LLM call. Measured at ~530s cold, instant
 * off the 5-minute server cache. Only call this once `fullReady` is true — the
 * generous timeout exists for the case where it isn't.
 */
export async function fetchFeedCards(): Promise<FeedCardsResponse> {
  const res = await fetch('/api/feed', { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`/api/feed responded ${res.status}`);
  return (await res.json()) as FeedCardsResponse;
}
