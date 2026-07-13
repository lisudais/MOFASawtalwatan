// Report prose writer — turns each section's raw figures into an official,
// written paragraph via the project's LOCAL gpt-oss model (Ollama). This is the
// ONLY place the report's sentences are authored; reportData.ts supplies facts.
//
// Invoked ONLY on user click ("تصدير التقرير") — never on a timer or in the
// background — and once per section (five separate calls). Plain-text output is
// requested (not JSON): the model returns a single connected paragraph.
//
// Reuses the same Ollama transport/endpoint the other AI services use; it does
// NOT modify or share state with them. If the local model is unreachable, each
// section falls back to its deterministic sentence so the PDF still renders.

import { withTimeout } from './ai/abortHelpers';
import type { SectionRaw } from './reportData';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

const SYSTEM_PROMPT =
  'أنت كاتب تقارير رسمية بوزارة الخارجية السعودية. تكتب بأسلوب حكومي رسمي مباشر، دقيق، بدون أي مبالغة أو صياغة تسويقية.';

function buildUserPrompt(sectionTitle: string, rawData: string): string {
  return [
    `البيانات المتاحة لك عن قسم ${sectionTitle}:`,
    rawData,
    '',
    'اكتب فقرة رسمية موجزة (2-4 أسطر كحد أقصى) تلخص الوضع الحالي لهذا القسم، بأسلوب تقرير حكومي مباشر. اذكر الأرقام المهمة فقط ضمن سياق الجملة (وليس كقائمة)، ولا تخترع أي معلومة غير موجودة بالبيانات المعطاة.',
    '',
    'أعد نصاً عادياً فقط (وليس JSON)، فقرة واحدة متصلة.',
  ].join('\n');
}

/**
 * One section → one official paragraph. Returns the model's plain text, or the
 * section's deterministic `fallback` if the local model can't be reached or
 * returns nothing. Never throws for transport failures — the report must render.
 */
export async function summarizeSection(section: SectionRaw, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(section.title, section.data) },
        ],
        stream: false,
        think: 'low',            // keep gpt-oss reasoning brief — this is summarization
        options: { temperature: 0.2 },
      }),
      signal: withTimeout(signal, 90_000),
    });
    if (!res.ok) return section.fallback;
    const data = await res.json();
    const text = data?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return section.fallback;
    return text.trim();
  } catch {
    return section.fallback;
  }
}

/**
 * Runs the five section summaries SEQUENTIALLY (one local-model call at a time —
 * kinder to a single-GPU Ollama than five parallel requests). `onSection` fires
 * after each completes so the UI can show progress and fill the sheet live.
 * Returns a key → paragraph map.
 */
export async function generateReportSummaries(
  sections: SectionRaw[],
  onSection?: (key: string, text: string, done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < sections.length; i++) {
    if (signal?.aborted) break;
    const s = sections[i];
    const text = await summarizeSection(s, signal);
    out[s.key] = text;
    onSection?.(s.key, text, i + 1, sections.length);
  }
  return out;
}
