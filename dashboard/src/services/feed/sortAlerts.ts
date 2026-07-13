// Single source of truth for ordering crisis-alert lists by severity.
//
// Every alert/disaster-event list in the app (the Global Alert Feed and the
// country-scoped Consular feed, which reuse the SAME GlobalAlertFeed component,
// plus the consulate disaster sub-list) orders through THIS function — so the
// rule lives in one place, not copy-pasted per component.
//
// Ordering rule (most-dangerous first):
//   1. severity_score  — DESCENDING (the real Stage-5 score, corroboration-aware
//                        after the UNCORROBORATED_CAP fix). This is the primary
//                        key: the list is a severity ranking, not a timeline.
//   2. recency         — most recent first, to break score ties sensibly.
//   3. duplicate/report count — more corroborated/repeated events first.
//   4. id              — final deterministic tiebreak so equal items never
//                        "jump" between renders.
//
// IMPORTANT (avoid stale ordering): callers must sort the CURRENT scored data.
// In the feed this happens inside a useMemo keyed on `cards`, so when the fast
// (provisional, capped) run is replaced by the full run, the memo recomputes and
// the list re-sorts on the corrected scores — the order is never frozen on an
// old/default score.
//
// This is NOT the citizen-requests priority order (عاجلة/مرتفعة/عادية); that is
// a separate ordinal sort and must not use this function.

export interface SortAlertsOptions<T> {
  /** Severity score accessor. Default: `item.score`. */
  scoreOf?: (a: T) => number;
  /** Recency as epoch ms (larger = newer). Default: `Date.parse(item.occurredAt)`. */
  timeOf?: (a: T) => number;
  /** Optional duplicate/report-count tiebreak (larger first), e.g. reportCount. */
  countOf?: (a: T) => number;
  /** Stable final tiebreak id. Default: `item.id`. */
  idOf?: (a: T) => string;
}

/** Shape the default accessors expect; overridable per call via options. */
interface DefaultAlertShape {
  score: number;
  occurredAt?: string | null;
  id?: string;
}

/**
 * Returns a NEW array ordered most-severe first. Pure and stable — the input is
 * not mutated, and equal items keep a deterministic order across renders.
 */
export function sortAlertsBySeverity<T>(
  alerts: readonly T[],
  options: SortAlertsOptions<T> = {},
): T[] {
  const scoreOf = options.scoreOf ?? ((a) => (a as unknown as DefaultAlertShape).score ?? 0);
  const timeOf =
    options.timeOf ??
    ((a) => {
      const t = (a as unknown as DefaultAlertShape).occurredAt;
      return t ? Date.parse(t) : Number.NEGATIVE_INFINITY;
    });
  const idOf = options.idOf ?? ((a) => (a as unknown as DefaultAlertShape).id ?? '');
  const { countOf } = options;

  return [...alerts].sort((a, b) => {
    // 1) severity_score, highest first
    const byScore = scoreOf(b) - scoreOf(a);
    if (byScore !== 0) return byScore;

    // 2) most recent first (missing time sorts last). Guarded so two missing
    //    times (both -Infinity) compare equal instead of producing NaN.
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== tb) return tb - ta;

    // 3) higher duplicate/report count first, when the caller provides it
    if (countOf) {
      const byCount = countOf(b) - countOf(a);
      if (byCount !== 0) return byCount;
    }

    // 4) deterministic final tiebreak
    const ia = idOf(a);
    const ib = idOf(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}
