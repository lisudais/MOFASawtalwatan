import { useEffect, useRef, useState } from 'react';
import { getCachedAi, setCachedAi } from './cache';
import { useProgressiveLoadingMessage } from './loadingMessages';

interface UseAiAnalysisOptions<TInput, TResult> {
  // Identity of "the same country/event" — drives both the 10-minute cache
  // and cancellation (changing key aborts any request for the previous one).
  // null/undefined means nothing is selected.
  key: string | null | undefined;
  input: TInput | null;
  // Instant synchronous default shown the moment `input` changes, before the
  // AI call resolves — never leaves the UI blank/blocked. Domains with no
  // sensible default (health) omit it and get the 3-state loading/ready/
  // unavailable behavior instead.
  heuristic?: (input: TInput) => TResult;
  // The real AI call. MUST pass `signal` into its fetch so cancellation is a
  // real aborted network request, not just a discarded result.
  fetcher: (input: TInput, signal: AbortSignal) => Promise<TResult | null>;
}

interface UseAiAnalysisResult<TResult> {
  result: TResult | null;
  loading: boolean;
  loadingMessage: string;
  // Settled with no heuristic and the fetcher returned null (model down) —
  // mirrors the existing Health panel's "unavailable" state.
  unavailable: boolean;
}

export function useAiAnalysis<TInput, TResult>({
  key,
  input,
  heuristic,
  fetcher,
}: UseAiAnalysisOptions<TInput, TResult>): UseAiAnalysisResult<TResult> {
  const [result, setResult] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // A new country/event was opened — cancel whatever was still in flight
    // for the previous one instead of letting it resolve into a stale panel.
    controllerRef.current?.abort();

    if (!input || key == null) {
      // Nothing selected (e.g. the panel is closing). Deliberately leave the
      // previous result in place — the panel keeps rendering its last data
      // while it slides out, exactly like the panels' own `displayed` state.
      setLoading(false);
      return;
    }

    const cached = getCachedAi<TResult>(key);
    if (cached) {
      // Same country/event within the 10-minute window — reuse it, no network call.
      setResult(cached);
      setLoading(false);
      setUnavailable(false);
      return;
    }

    setResult(heuristic ? heuristic(input) : null);
    setUnavailable(false);
    setLoading(true);

    const controller = new AbortController();
    controllerRef.current = controller;

    fetcher(input, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        if (r !== null) {
          setResult(r);
          setCachedAi(key, r);
        } else if (!heuristic) {
          setUnavailable(true);
        }
      })
      .catch(() => { /* aborted, or the fetcher's own catch already returned a fallback */ })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, input]);

  const loadingMessage = useProgressiveLoadingMessage(loading);
  return { result, loading, loadingMessage, unavailable };
}
