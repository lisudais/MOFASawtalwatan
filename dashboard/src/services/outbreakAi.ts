// gpt-oss "why" justification for ONE outbreak forecast.
//
// The local gpt-oss-20b model (Ollama) writes a short EPIDEMIOLOGICAL
// INTELLIGENCE justification — which factors drove the estimate — not an AI
// summary. It NEVER produces or changes the probability, never predicts a case
// count, never makes a medical claim, and never restates the probability figure.
// If the model is unavailable we fall back to a deterministic reading of the SAME
// structured values. The recommendation bullets are always deterministic (see
// recommendationsFor in outbreakForecast.ts).

import { withTimeout } from './ai/abortHelpers';
import { type ResolvedOutbreak } from './forecasting/outbreakForecast';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface OutbreakReason {
  reason_ar: string;
  aiEnriched: boolean;
}

// Deterministic intelligence-style justification built from the drivers — always
// available. Reads like an analyst note, not an AI summary; never cites a number.
export function reasonHeuristic(f: ResolvedOutbreak): OutbreakReason {
  const h = f.history;
  const recur = h.historical_outbreak_count && h.historical_outbreak_count >= 2;
  const recent = h.months_since_last_outbreak != null && h.months_since_last_outbreak <= 24;
  const stale = h.months_since_last_outbreak != null && h.months_since_last_outbreak > 60;
  const regionActive = (f.regional?.affected_neighbours_recent || 0) > 0;
  const seasonal = !!f.explanation_factors?.seasonal_match;
  const calm = f.probability < 0.15;

  const drivers: string[] = [];
  if (recur) drivers.push('تكرار ظهور المرض تاريخياً في الدولة');
  if (recent) drivers.push('تسجيل نشاط وبائي حديث نسبياً');
  else if (stale) drivers.push('طول الفترة منذ آخر نشاط وبائي مسجَّل');
  if (regionActive) drivers.push('وجود نشاط في بعض الدول المجاورة');
  if (seasonal) drivers.push('تزامن الفترة مع موسم نشاط تاريخي');

  if (calm) {
    // Low estimate — lead with the absence of elevating signals.
    const absent: string[] = [];
    if (!recur || stale) absent.push('محدودية النشاط الوبائي خلال السنوات الأخيرة');
    if (!regionActive) absent.push('غياب مؤشرات تدل على زيادة في النشاط الإقليمي');
    if (!seasonal) absent.push('عدم وجود دفعة موسمية حالية');
    const body = absent.length ? absent.join('، و') : 'محدودية المؤشرات المرتبطة بارتفاع الخطر';
    return {
      reason_ar: `يعتمد هذا التوقع على ${body}، مع استمرار المؤشرات ضمن النطاق التاريخي المعتاد.`,
      aiEnriched: false,
    };
  }

  const lead = drivers.length ? `يعتمد هذا التوقع بشكل رئيسي على ${drivers.join('، مع ')}.` :
    'يعتمد هذا التوقع على أنماط النشاط الوبائي التاريخية للمرض في الدولة.';
  const tail = regionActive
    ? ' في المقابل، لا توجد مؤشرات تدل على تسارع غير اعتيادي مقارنة بالأنماط التاريخية.'
    : ' مع بقاء وتيرة النشاط ضمن الحدود المعتادة لهذا المرض في الدولة.';
  return { reason_ar: (lead + tail).trim(), aiEnriched: false };
}

function buildPrompt(f: ResolvedOutbreak): string {
  const h = f.history;
  const lines: (string | null)[] = [
    'أنت محلل استخبارات وبائية. اكتب مبرراً تحليلياً موجزاً يوضح العوامل التي دفعت النموذج لهذا التقدير.',
    '',
    '## القواعد:',
    '- ثلاث جمل قصيرة كحد أقصى، بأسلوب تقرير استخباراتي مباشر لا يشبه ملخص ذكاء اصطناعي.',
    '- ركّز على العوامل الأكثر تأثيراً (التكرار التاريخي، حداثة النشاط، النشاط الإقليمي، الموسمية، فترة التكرار).',
    '- لا تذكر رقم الاحتمال إطلاقاً، ولا تكرره.',
    '- لا تذكر التعلم الآلي أو النماذج أو المعايرة.',
    '- بلا حشو ولا عبارات عامة، ولا توصيات، ولا ادعاءات طبية.',
    '- أجب بالعربية فقط.',
    '',
    '## العوامل المتاحة:',
    `المرض: ${f.disease}`,
    `الدولة: ${f.country}`,
    `عدد التفشيات التاريخية: ${h.historical_outbreak_count ?? 'غير متوفر'}`,
    h.months_since_last_outbreak != null ? `الأشهر منذ آخر تفشٍ: ${h.months_since_last_outbreak}` : 'الأشهر منذ آخر تفشٍ: غير متوفر',
    h.average_interval_months != null ? `متوسط فترة التكرار (أشهر): ${h.average_interval_months}` : 'متوسط فترة التكرار: غير متوفر',
    `إشارة موسمية: ${f.explanation_factors?.seasonal_match ? 'نشاط تاريخي مرتفع في هذا الموسم' : 'لا يوجد نمط موسمي بارز'}`,
    `دول مجاورة متأثرة مؤخراً: ${f.regional?.affected_neighbours_recent ?? 0}`,
    '',
    '## أعد JSON صارم فقط: {"reason_ar": "..."}',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

const S = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function explainOutbreak(f: ResolvedOutbreak, signal?: AbortSignal): Promise<OutbreakReason> {
  const fb = reasonHeuristic(f);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: buildPrompt(f) }],
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
    const reason_ar = S(parsed?.reason_ar);
    return reason_ar ? { reason_ar, aiEnriched: true } : fb;
  } catch {
    return fb;
  }
}
