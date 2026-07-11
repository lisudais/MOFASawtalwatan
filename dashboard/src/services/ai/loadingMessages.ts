import { useEffect, useState } from 'react';

// Cycled while an AI request is in flight, so the wait reads as progress
// rather than a stalled UI (the panel's real data is already visible under it).
export const AI_LOADING_MESSAGES_AR = [
  'جارٍ قراءة التقارير الرسمية…',
  'استخراج أهم النتائج…',
  'توليد التوصيات الذكية…',
];

export function useProgressiveLoadingMessage(
  active: boolean,
  messages: readonly string[] = AI_LOADING_MESSAGES_AR,
  intervalMs = 1400
): string {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!active) { setI(0); return; }
    const id = setInterval(() => setI((n) => (n + 1) % messages.length), intervalMs);
    return () => clearInterval(id);
  }, [active, messages, intervalMs]);

  return messages[i];
}
