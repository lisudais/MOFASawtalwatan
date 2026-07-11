// gpt-oss analysis for a natural-disaster event.
//
// The model NEVER invents events or facts. It receives ONLY the real fields
// fetched from the source (type, country, severity, original title/description)
// and produces an Arabic reading of them:
//   • analysis        → تحليل موجز للوضع
//   • aiSummary       → جملة واحدة قصيرة جدًا (upgrades DisasterEvent.aiSummary)
//   • recommendation  → توصية عملية
// Uses the project's local Ollama; falls back to a deterministic Arabic
// template built from the structured fields (which is exactly what
// DisasterEvent.aiSummary already contains, so the fallback never blocks
// on the network).

import { DISASTER_TYPE_LABEL_AR, SEVERITY_LABEL_AR, type DisasterEvent } from './naturalDisasterFeed';
import { withTimeout } from './ai/abortHelpers';

// Sent to the LLM instead of any full article: title, country, category,
// summary (truncated), severity, date, officialSource — never the raw source page.
const MAX_SUMMARY_CHARS = 400;

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface DisasterAnalysis {
  analysis: string;
  aiSummary: string;
  recommendation: string;
  aiEnriched: boolean;
}

const SEVERITY_RECOMMENDATION_AR: Record<DisasterEvent['severity'], string> = {
  CRITICAL: 'يُنصح بأخذ أقصى درجات الحيطة والابتعاد عن المنطقة المتأثرة ومتابعة تعليمات الجهات الرسمية.',
  HIGH:     'يُنصح بالمتابعة المستمرة وأخذ الحذر عند التواجد في المنطقة المتأثرة.',
  MODERATE: 'يُنصح بالمتابعة الدورية وأخذ الاحتياطات المعتادة عند التواجد في المنطقة المتأثرة.',
  LOW:      'الوضع تحت المراقبة ولا يستدعي إجراءات عاجلة حالياً.',
};

// Deterministic Arabic reading of the structured fields (no source English text) —
// same fallback used to seed DisasterEvent.aiSummary, but with a longer analysis.
export function heuristicDisaster(d: DisasterEvent): DisasterAnalysis {
  const typeAr = DISASTER_TYPE_LABEL_AR[d.disasterType];
  const where = d.country ? ` قرب ${d.country}` : '';
  return {
    analysis: `تسجيل ${typeAr}${where} وفق مصدر ${d.source}. مستوى الخطورة المقدّر: ${SEVERITY_LABEL_AR[d.severity]}.`,
    aiSummary: d.aiSummary,
    recommendation: SEVERITY_RECOMMENDATION_AR[d.severity],
    aiEnriched: false,
  };
}

function buildPrompt(d: DisasterEvent): string {
  const lines: (string | null)[] = [
    'أنت محلل استخبارات كوارث طبيعية محترف. تكتب بأسلوب تقارير رسمية دقيقة، وليس وصفاً عاماً.',
    '',
    '## البيانات المتاحة (لا تخترع أي معلومة غير موجودة فيها):',
    `نوع الكارثة: ${DISASTER_TYPE_LABEL_AR[d.disasterType]}`,
    d.country ? `الدولة: ${d.country}` : null,
    d.city ? `المنطقة/الموقع: ${d.city}` : null,
    `مستوى الخطورة: ${SEVERITY_LABEL_AR[d.severity]}`,
    `العنوان الأصلي (من المصدر ${d.source}): ${d.title}`,
    `تاريخ التحديث: ${d.updatedAt}`,
    d.description ? `الوصف الأصلي: ${d.description.slice(0, MAX_SUMMARY_CHARS)}` : null,
    '',
    '## أسلوب الكتابة (أقوى وأكثر احترافية):',
    '- استخدمي لغة تقارير استخباراتية مباشرة وحازمة، ليست وصفية عامة',
    '- كل جملة تحمل معلومة فعلية أو تقييماً محدداً، وليست حشواً',
    '- تجنبي الصيغ الضعيفة مثل "قد يسبب" أو "من المحتمل أن" إلا إذا كانت الشدة فعلاً غير مؤكدة من البيانات',
    '',
    '## أعد JSON صارم فقط بهذا الشكل، دون أي نص إضافي:',
    '{',
    '  "analysis": "تحليل عربي حازم ومحدد (جملتان كحد أقصى)، مبني فقط على المعطيات أعلاه",',
    '  "aiSummary": "جملة عربية واحدة قصيرة جداً وحازمة، تلخص الحدث",',
    '  "recommendation": "توصية عملية واحدة محددة وقابلة للتنفيذ فوراً، وليست عامة"',
    '}',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export async function analyzeDisaster(d: DisasterEvent, signal?: AbortSignal): Promise<DisasterAnalysis> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: buildPrompt(d) }],
        stream: false,
        format: 'json',
      }),
      signal: withTimeout(signal),
    });
    if (!res.ok) return heuristicDisaster(d);
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    if (typeof parsed?.analysis !== 'string' || !parsed.analysis.trim()) return heuristicDisaster(d);
    const fb = heuristicDisaster(d);
    return {
      analysis: parsed.analysis.trim(),
      aiSummary: typeof parsed.aiSummary === 'string' && parsed.aiSummary.trim() ? parsed.aiSummary.trim() : fb.aiSummary,
      recommendation: typeof parsed.recommendation === 'string' && parsed.recommendation.trim() ? parsed.recommendation.trim() : fb.recommendation,
      aiEnriched: true,
    };
  } catch {
    return heuristicDisaster(d);
  }
}
