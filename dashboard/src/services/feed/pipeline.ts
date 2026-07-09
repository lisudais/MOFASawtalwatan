// Global Alert Feed — Stages 1-6 orchestration.
//
//   1 DETECTION      ingest.ts        no AI
//   2 CLASSIFICATION classify.ts      AI, think:low, grammar-constrained
//   2b COUNTRY PASS  classify.ts      AI, think:low, only on kept null-country signals
//   3 ROUTING        routing.ts       no AI, static config
//   4 CORROBORATION  corroborate.ts   Phase A no AI; Phase B AI, grammar-constrained
//   5 SCORING        score.ts         no AI, deterministic, auditable
//   6 SUMMARY        summarize.ts     AI, think:low, grammar-constrained + verified
//
// Nothing here renders. The feed still uses the legacy GeoEvent path in App.tsx
// until the UI contract for ScoredCluster + ClusterSummary is settled.

import { ingestFast, ingestGdelt } from './ingest';
import { classifySignals, type ClassifyResult } from './classify';
import { applyRouting, type RoutingResult } from './routing';
import { corroborateSignals, type CorroborateResult } from './corroborate';
import { scoreClusters, type ScoreResult } from './score';
import { summarizeClusters, DEFAULT_SUMMARY_LIMIT, type SummarizeResult } from './summarize';
import type { IngestResult, RawSignal } from './types';

export interface PipelineResult {
  ingest: IngestResult;
  classify: ClassifyResult;
  routing: RoutingResult;
  corroborate: CorroborateResult;
  score: ScoreResult;
  summarize: SummarizeResult;
  /** Signals as they entered Stage 5, tier stamped and country resolved. */
  signals: RawSignal[];
}

export interface RunOptions {
  /** Skip the slow GDELT tier. Useful for a fast first paint. */
  includeGdelt?: boolean;
  /** Cap on signals entering Stage 2. Guards against a 250-article GDELT burst. */
  maxSignals?: number;
  /** How many top-scoring clusters get an LLM summary. The rest get the template. */
  summaryLimit?: number;
  /** Skip Stage 6 entirely (it is the slowest stage). */
  summarize?: boolean;
}

/**
 * Runs Stages 1-6. Never throws: every stage reports its own failures in its
 * result object (sourceStatus, failed[], capApplied, …) rather than aborting.
 */
export async function runPipeline({
  includeGdelt = true,
  maxSignals,
  summaryLimit = DEFAULT_SUMMARY_LIMIT,
  summarize = true,
}: RunOptions = {}): Promise<PipelineResult> {
  const fast = await ingestFast();
  const slow = includeGdelt ? await ingestGdelt() : null;

  const ingest: IngestResult = slow
    ? {
        signals: [...fast.signals, ...slow.signals],
        sourceStatus: { ...fast.sourceStatus, ...slow.sourceStatus },
        degraded: fast.degraded || slow.degraded,
        ingestedAt: new Date().toISOString(),
      }
    : fast;

  // Truncation is a real loss of coverage, so it is bounded and visible rather
  // than implicit: callers pass maxSignals deliberately.
  const input = maxSignals ? ingest.signals.slice(0, maxSignals) : ingest.signals;

  const classify = await classifySignals(input);
  const routing = applyRouting(classify.classified);
  const corroborate = await corroborateSignals(routing.routed);
  const score = scoreClusters(corroborate.clusters, routing.routed);

  const summarizeResult = summarize
    ? await summarizeClusters(score.scored, routing.routed, summaryLimit)
    : { summaries: new Map(), stats: { clusters: score.scored.length, aiAttempted: 0, aiAccepted: 0, rejectedEvidence: 0, rejectedNumber: 0, templated: 0 } };

  return { ingest, classify, routing, corroborate, score, summarize: summarizeResult, signals: routing.routed };
}

/* ── Fast tier ───────────────────────────────────────────────────────────────
   The full pipeline is ~530s cold (Stage 2 classification + ~70 Stage 4 pair
   calls + Stage 6 summaries). That cannot sit in front of a page load.

   `runPipelineFast` produces renderable cards in ~2s by skipping every stage
   that calls a model:

     Stage 1   ingestFast()  — geophysical + security + statements, no GDELT
     Stage 2   SKIPPED       — unstructured signals are dropped, not guessed
     Stage 3   applyRouting  — deterministic already
     Stage 4   Phase A only  — no pairing, so every signal is its own cluster
     Stage 5   scoreClusters — deterministic already
     Stage 6   template only — no LLM call

   The result is CONSERVATIVE, never optimistic:
     • no confirmed pairs ⇒ no corroboration ⇒ Stage 5 caps rather than bonuses
     • dropped unstructured signals ⇒ fewer cards, never wrong ones
   A fast card's score can only under-state the full pipeline's, never over-state
   it. The client replaces these cards when the full run lands. */
export async function runPipelineFast({ maxSignals }: { maxSignals?: number } = {}): Promise<PipelineResult> {
  const ingest = await ingestFast();

  // The SAME cap the full tier applies, so the card count does not visibly jump
  // when the AI-scored set replaces this one. Applied to the ingest population
  // before filtering, exactly as runPipeline does.
  const capped = maxSignals ? ingest.signals.slice(0, maxSignals) : ingest.signals;

  // Signals whose eventType is already known from their source. Statements and
  // GDELT articles need Stage 2 and are simply absent from the fast tier — a
  // missing card is safe; a mislabeled one is not.
  const structured = capped.filter((s) => s.eventType !== null);

  const classify: ClassifyResult = {
    classified: structured,
    dropped: [],
    unmatched: [],
    failed: [],
    stats: {
      inspected: ingest.signals.length,
      alreadyStructured: structured.length,
      classified: 0,
      dropped: 0,
      unmatched: 0,
      countryRejected: 0,
      lowConfidence: 0,
      countryPassAttempted: 0,
      countryPassResolved: 0,
    },
  };

  const routing = applyRouting(structured);
  const corroborate = await corroborateSignals(routing.routed, { usePhaseB: false });
  const score = scoreClusters(corroborate.clusters, routing.routed);
  // limit 0 ⇒ every cluster gets the deterministic template, zero LLM calls.
  const summarizeResult = await summarizeClusters(score.scored, routing.routed, 0);

  return { ingest, classify, routing, corroborate, score, summarize: summarizeResult, signals: routing.routed };
}
