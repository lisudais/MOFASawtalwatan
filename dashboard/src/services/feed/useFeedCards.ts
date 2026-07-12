// Shared client hook for the Global Alert Feed pipeline (Stages 1-6).
//
// One fetch orchestration, used by BOTH the global feed (no filter) and the
// consular feed (host-country filter). The country filter is a thin layer over
// identical /api/feed results — never a second data source, never a duplicated
// fetch. All real sources (EONET, USGS, EMSC, GDACS, ACLED, ReliefWeb) run
// server-side behind /api/feed exactly as before; this only narrows the output.

import { useEffect, useMemo, useState } from 'react';
import { fetchFastFeedCards, fetchFeedStatus, fetchFeedCards, type FeedCard } from './feedCards';
import { filterByCountry } from '../countryFilter';

/**
 * Restrict cards to a set of ISO2 country codes. Thin wrapper over the shared
 * `filterByCountry` primitive (also used by the embassy citizen-requests
 * list) — this is the feed-specific call site, not a second implementation.
 */
export function filterFeedCardsByCountry(
  cards: FeedCard[],
  countryFilter?: readonly string[] | null,
): FeedCard[] {
  return filterByCountry(cards, (c) => c.country, countryFilter);
}

export interface UseFeedCardsResult {
  cards: FeedCard[];
  loading: boolean;
  error: boolean;
}

/**
 * Progressive load: /api/feed/fast paints in ~2s, then the AI-scored /api/feed
 * run is swapped in the moment it warms (polled via /api/feed/status). Pass
 * `countryFilter` (ISO2 codes) to receive only that country's cards; omit it for
 * the global feed. No LLM call is ever made from the client.
 */
export function useFeedCards(countryFilter?: readonly string[] | null): UseFeedCardsResult {
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;

    async function loadFull() {
      try {
        const full = await fetchFeedCards();
        if (cancelled || !full.ok) return;
        setCards(full.cards);
        setError(false);
      } catch {
        // The fast cards stay on screen; the next refresh retries.
      }
    }

    async function start() {
      try {
        const fast = await fetchFastFeedCards();
        if (cancelled) return;
        setCards(fast.cards);
        setError(!fast.ok);
        setLoading(false);

        if (fast.fullReady) { loadFull(); return; }

        // The background warm is running server-side. Poll cheaply for it.
        pollId = setInterval(async () => {
          if (cancelled) return;
          const { fullReady } = await fetchFeedStatus();
          if (!fullReady) return;
          clearInterval(pollId);
          loadFull();
        }, 15_000);
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    }

    start();
    const refresh = setInterval(start, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      if (pollId) clearInterval(pollId);
    };
  }, []);

  // Stable memo key so a fresh array literal from the caller doesn't thrash.
  const filterKey = countryFilter ? [...countryFilter].sort().join(',') : '';
  const filtered = useMemo(
    () => filterFeedCardsByCountry(cards, countryFilter),
    // filterKey captures countryFilter's contents; cards is the fetched list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, filterKey],
  );

  return { cards: filtered, loading, error };
}
