// Global Alert Feed — Stage 1 (DETECTION) fan-out.
//
// Produces RawSignal[] + an honest per-source health map. Nothing here scores,
// classifies, corroborates or summarizes: those are Stages 2-6.
//
// Two invariants this module enforces, both of which the data-source audit
// found broken elsewhere in the codebase:
//
//   1. `ok` is derived from the real HTTP status / the upstream's own ok flag —
//      never from a promise merely settling. `catch { return [] }` turns a 403
//      into a fulfilled promise, which is why /api/statements currently reports
//      ReliefWeb as `ok: true, count: 0` while it is in fact 403-ing.
//
//   2. Failures are surfaced, not swallowed. `degraded` and `sourceStatus` are
//      part of the result, so the UI can say "GDACS is down" instead of quietly
//      rendering fewer cards.
//
// Dedup here is EXACT-ID ONLY. Semantic dedup across sources is Stage 4's job;
// collapsing it now would destroy the corroboration evidence Stage 5 scores on.
//
// ── Two-phase (deferred) ingest ──────────────────────────────────────────────
// GDELT's TCP connect takes 10-14s and its rate limiter forces retries, so a
// cold /api/gdelt-feed call was measured at 30-105s. Blocking the feed on that
// is unacceptable, and warming the cache on server start would hide outages.
// So ingestion is split:
//
//   FAST  — geophysical + security + statements. Resolves in ~1-2s.
//   SLOW  — the broad GDELT catch-all. Streams in whenever it lands.
//
// Callers render the fast batch immediately and merge the slow batch on arrival.

import { ingestGeophysical } from './adapters/geophysical';
import { ingestSecurity } from './adapters/security';
import { ingestStatements } from './adapters/statements';
import { ingestGdeltBroad } from './adapters/gdeltBroad';
import type { AdapterResult, IngestResult, RawSignal, SourceStatus } from './types';

/** Newest first. Presentational ordering only — no ranking, no truncation. */
function byRecency(a: RawSignal, b: RawSignal): number {
  return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
}

function collect(results: AdapterResult[]): IngestResult {
  const sourceStatus: Record<string, SourceStatus> = {};
  for (const r of results) {
    // An adapter may cover several SignalSource keys (e.g. /api/security fans
    // out to STATE_DEPT + ACLED + GDELT). We report it under one label so the
    // status map mirrors the actual fetch boundary rather than implying we
    // probed each upstream independently.
    sourceStatus[r.sourceKeys.join('+')] = r.status;
  }

  const byId = new Map<string, RawSignal>();
  for (const s of results.flatMap((r) => r.signals)) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }

  return {
    signals: [...byId.values()].sort(byRecency),
    sourceStatus,
    degraded: Object.values(sourceStatus).some((s) => !s.ok),
    ingestedAt: new Date().toISOString(),
  };
}

/** FAST tier. Everything except the broad GDELT catch-all. */
export async function ingestFast(): Promise<IngestResult> {
  const [geo, security, statements] = await Promise.all([
    ingestGeophysical(),
    ingestSecurity(),
    ingestStatements(),
  ]);
  return collect([...geo, security, statements]);
}

/** SLOW tier. The broad GDELT catch-all, on its own timeline. */
export async function ingestGdelt(): Promise<IngestResult> {
  return collect([await ingestGdeltBroad()]);
}

export interface StreamHandlers {
  /** Fires once, fast. Render this immediately. */
  onFast: (result: IngestResult) => void;
  /** Fires once GDELT lands (or fails). Merge into what onFast produced. */
  onSlow: (result: IngestResult) => void;
}

/**
 * Kicks off both tiers. Resolves when BOTH have settled, but `onFast` has
 * already fired long before that. Neither callback ever receives a rejection —
 * a dead source arrives as `ok: false` in `sourceStatus`.
 */
export async function ingestStreaming({ onFast, onSlow }: StreamHandlers): Promise<void> {
  const fast = ingestFast().then((r) => { onFast(r); return r; });
  const slow = ingestGdelt().then((r) => { onSlow(r); return r; });
  await Promise.all([fast, slow]);
}

/**
 * Convenience: both tiers, one result. Use only where latency doesn't matter
 * (scripts, tests). The UI should use ingestStreaming.
 */
export async function ingestSignals(): Promise<IngestResult> {
  const [fast, slow] = await Promise.all([ingestFast(), ingestGdelt()]);
  return {
    signals: [...fast.signals, ...slow.signals].sort(byRecency),
    sourceStatus: { ...fast.sourceStatus, ...slow.sourceStatus },
    degraded: fast.degraded || slow.degraded,
    ingestedAt: new Date().toISOString(),
  };
}
