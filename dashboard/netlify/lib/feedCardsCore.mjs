// Global Alert Feed — serves the Stages 1-6 pipeline output as card DTOs.
//
// The pipeline lives in TypeScript under src/services/feed/. In dev we execute
// it through Vite's SSR loader (see vite.config.ts) rather than duplicating it,
// so the cards are produced by the real classify/route/corroborate/score/
// summarize modules and cannot drift from them.
//
// Running it server-side has three benefits over doing it in the browser:
//   • the LLM calls stay off the client (no Ollama CORS surface)
//   • one cached run serves every open tab
//   • a cold run (~3 min for 120 signals) never blocks a page load
//
// A production Netlify build would need this wired to a compiled bundle of the
// pipeline; the dev middleware is the only consumer today.

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAST_CACHE_TTL_MS = 60 * 1000;

let cache = { at: 0, payload: null };
let inFlight = null;

let fastCache = { at: 0, payload: null };
let fastInFlight = null;

/** Flattens the pipeline result into exactly what a feed card renders. */
function toCards(result) {
  const signalsById = new Map(result.signals.map((s) => [s.id, s]));

  return result.score.scored.map((sc) => {
    const members = sc.cluster.signalIds.map((id) => signalsById.get(id)).filter(Boolean);
    const summary = result.summarize.summaries.get(sc.cluster.id);

    // Most recent report in the cluster — what "time" on the card means.
    const occurredAt = members
      .map((m) => m.occurredAt)
      .sort()
      .at(-1) ?? null;

    // First member that carries a source link.
    const url = members.find((m) => m.url)?.url ?? null;

    // Original GeoEvent type of the first geophysical member, so the card can
    // render the SAME icon it always did. null for security/statement/GDELT.
    const geoType = members.find((m) => m.geoType)?.geoType ?? null;

    return {
      id: sc.cluster.id,
      country: sc.cluster.country,             // ISO2 or null
      eventType: sc.cluster.eventType,
      score: sc.score,
      tier: sc.cluster.bestTier,               // 1 | 2 | null
      tags: sc.breakdown.tags,                 // ['corroborated'|'unconfirmed', 'official'?]
      sources: sc.cluster.distinctSources,
      reportCount: members.length,
      summary: summary?.summary ?? null,
      aiGenerated: summary?.aiGenerated ?? false,
      occurredAt,
      url,
      geoType,
      // The audit trail behind the number, for a future "why is this N?" popover.
      breakdown: {
        band: sc.breakdown.band,
        bandReason: sc.breakdown.bandReason,
        capApplied: sc.breakdown.capApplied,
        ceilingNote: sc.breakdown.ceilingNote,
        corroborationBonus: sc.breakdown.corroborationBonus,
      },
      // Lets the UI map a cluster back to a legacy GeoEvent for the map/detail panel.
      signalIds: sc.cluster.signalIds,
    };
  });
}

/**
 * `runPipeline` is injected so this module stays free of Vite/TS imports.
 * Returns { ok, cards, sourceStatus, degraded, stats, cachedAt, cached }.
 * Never throws.
 */
export async function getFeedCards(runPipeline, options = {}) {
  if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const result = await runPipeline(options);
      const payload = {
        ok: true,
        cards: toCards(result),
        sourceStatus: result.ingest.sourceStatus,
        degraded: result.ingest.degraded,
        stats: {
          signals: result.ingest.signals.length,
          clusters: result.score.stats.clusters,
          corroborated: result.corroborate.stats.corroboratedClusters,
          maxScore: result.score.stats.maxScore,
          aiSummaries: result.summarize.stats.aiAccepted,
          templatedSummaries: result.summarize.stats.templated,
        },
        cachedAt: new Date().toISOString(),
        cached: false,
      };
      cache = { at: Date.now(), payload };
      return payload;
    } catch (err) {
      // Never cache a failure — that would hide the outage.
      return { ok: false, cards: [], sourceStatus: {}, degraded: true, error: String(err), cached: false };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Fast tier. Deterministic stages only (no classification, no pairwise
 * corroboration, no AI summary) — renders in ~2s. Cards are marked
 * `provisional: true` so the UI can show they are pre-AI, and because their
 * scores are conservative: uncorroborated, therefore capped rather than bonused.
 *
 * Kicks off the full run in the BACKGROUND on a cache miss, so by the time the
 * client asks for /api/feed the expensive path is already warming. Errors from
 * that background run are swallowed here on purpose — /api/feed reports them.
 */
export async function getFastFeedCards(runPipelineFast, warmFull) {
  if (fastCache.payload && Date.now() - fastCache.at < FAST_CACHE_TTL_MS) {
    return { ...fastCache.payload, cached: true };
  }
  if (fastInFlight) return fastInFlight;

  fastInFlight = (async () => {
    try {
      const result = await runPipelineFast();
      const payload = {
        ok: true,
        provisional: true,
        cards: toCards(result).map((c) => ({ ...c, provisional: true })),
        sourceStatus: result.ingest.sourceStatus,
        degraded: result.ingest.degraded,
        stats: {
          signals: result.ingest.signals.length,
          clusters: result.score.stats.clusters,
          corroborated: 0,
          maxScore: result.score.stats.maxScore,
          aiSummaries: 0,
          templatedSummaries: result.summarize.stats.templated,
        },
        cachedAt: new Date().toISOString(),
        cached: false,
      };
      fastCache = { at: Date.now(), payload };

      // Warm the full pipeline behind the response. Never awaited.
      if (typeof warmFull === 'function' && !cache.payload && !inFlight) {
        Promise.resolve(warmFull()).catch(() => {});
      }
      return payload;
    } catch (err) {
      return { ok: false, provisional: true, cards: [], sourceStatus: {}, degraded: true, error: String(err), cached: false };
    } finally {
      fastInFlight = null;
    }
  })();

  return fastInFlight;
}

/** True when a full (AI-scored) run is already cached and ready to serve. */
export function fullFeedIsReady() {
  return Boolean(cache.payload && Date.now() - cache.at < CACHE_TTL_MS);
}

export const FEED_CARDS_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
