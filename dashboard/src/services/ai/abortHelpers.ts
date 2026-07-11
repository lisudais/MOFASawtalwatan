// Combines the AI service's own request timeout with an external cancellation
// signal (from useAiAnalysis) so opening a different country/event actually
// aborts the in-flight fetch, not just discards its eventual result.
export function withTimeout(signal: AbortSignal | undefined, timeoutMs = 90000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, signal]);
  return signal;
}
