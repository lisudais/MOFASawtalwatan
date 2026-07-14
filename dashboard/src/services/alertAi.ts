// gpt-oss ministry recommendation for ONE alert shown in AlertDetailsPanel.
//
// The recommendation is ALWAYS present: we start from a deterministic,
// severity-based default (so the field can never read "غير متاح"), then try to
// upgrade it with a short gpt-oss recommendation built only from the alert's real
// structured fields. Any failure (model offline, bad/empty output, timeout) keeps
// the deterministic default. gpt-oss never invents facts and never changes the
// severity — it only words the guidance.

import { withTimeout } from './ai/abortHelpers';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export type SeverityBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Deterministic fallback — one per unified severity band. Always non-empty.
export function severityRecommendationAr(band: SeverityBand): string {
  switch (band) {
    case 'CRITICAL': return 'يُنصح بتجنب المنطقة كلياً والتواصل الفوري مع السفارة/القنصلية.';
    case 'HIGH':     return 'توخّي الحذر الشديد، وتجنّب الأماكن المزدحمة، ومتابعة تحديثات السفارة.';
    case 'MEDIUM':   return 'متابعة الوضع عن كثب والالتزام بالإجراءات الاحترازية العامة.';
    default:         return 'لا توجد إجراءات إضافية مطلوبة حالياً، الوضع مستقر.';
  }
}

export interface AlertRecInput {
  typeAr: string;
  placeAr: string;
  severityAr: string;
  band: SeverityBand;
  headline?: string;
  description?: string;
}

function buildPrompt(inp: AlertRecInput): string {
  const lines: (string | null)[] = [
    'أنت مستشار سلامة في وزارة الخارجية. اكتب توصية عملية واحدة موجزة للمواطنين بخصوص هذا التنبيه.',
    '',
    '## قواعد:',
    '- جملة أو جملتان قصيرتان كحد أقصى، بأسلوب رسمي مباشر.',
    '- اعتمد فقط على المعطيات أدناه ولا تخترع أي معلومة.',
    '- توصية قابلة للتنفيذ (ماذا يفعل المواطن) تتناسب مع مستوى الخطورة.',
    '- بالعربية فقط.',
    '',
    '## المعطيات:',
    `نوع التنبيه: ${inp.typeAr}`,
    `الموقع: ${inp.placeAr}`,
    `مستوى الخطورة: ${inp.severityAr}`,
    inp.headline ? `العنوان: ${inp.headline}` : null,
    inp.description ? `الوصف: ${inp.description.slice(0, 400)}` : null,
    '',
    '## أعد JSON صارم فقط: {"recommendation": "..."}',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export async function recommendAlert(inp: AlertRecInput, signal?: AbortSignal): Promise<string> {
  const fb = severityRecommendationAr(inp.band);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: buildPrompt(inp) }],
        stream: false,
        format: 'json',
        think: 'low',
        options: { temperature: 0 },
      }),
      signal: withTimeout(signal),
    });
    if (!res.ok) return fb;
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    const rec = typeof parsed?.recommendation === 'string' ? parsed.recommendation.trim() : '';
    return rec || fb;
  } catch {
    return fb;
  }
}
