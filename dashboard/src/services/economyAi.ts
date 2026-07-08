// gpt-oss "why did it move?" analysis for an economic indicator.
//
// The model receives ONLY the real figures for the indicator and is asked to
// explain the likely reason for the current move. It must not invent a specific
// event: when no direct news is available it reasons from general market
// patterns and returns confidence:"LOW". Uses the project's local Ollama; falls
// back to a deterministic template. Results are cached per indicator key.

import type { EconomicIndicator } from './economy';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export interface EconomyReason {
  reason_summary: string;
  market_context: string;
  confidence: Confidence;
  aiEnriched: boolean;
}

const SYSTEM_PROMPT = `أنت محلل اقتصادي متخصص في أسواق السلع والعملات. لا تخترع أي معلومة غير مذكورة بالبيانات التالية.

السلعة/المؤشر: {commodity_name}
السعر الحالي: {current_price}
نسبة التغيير اليوم: {change_percent}
السعر قبل 7 أيام: {price_7d_ago}
آخر 3 عناوين أخبار اقتصادية متعلقة (إن توفرت): {news_headlines}

بناءً على هذي البيانات فقط، أعد تحليلاً موجزاً يوضح السبب المحتمل للتغيير الحالي. إذا لم تتوفر أخبار مرتبطة، اعتمدي على نمط السوق العام (تقلبات معتادة، عوامل جيوسياسية معروفة مؤثرة على هذا النوع من السلع بشكل عام) دون اختراع حدث محدد غير مؤكد.

أعد JSON صارم فقط:
{
  "reason_summary": "جملة واحدة قصيرة (أقل من 15 كلمة) تشرح السبب المرجّح للتغيير الحالي",
  "market_context": "جملة واحدة إضافية عن السياق العام للسوق حالياً (أقل من 12 كلمة)",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

function fillPrompt(ind: EconomicIndicator, news: string): string {
  const price7d = ind.trend.length >= 2 ? String(ind.trend[0]) : 'غير متوفر';
  return SYSTEM_PROMPT
    .replace('{commodity_name}', ind.nameAr)
    .replace('{current_price}', `${ind.value} ${ind.unit}`)
    .replace('{change_percent}', `${ind.changePercent >= 0 ? '+' : ''}${ind.changePercent}${ind.unit === '%' ? '' : '%'}`)
    .replace('{price_7d_ago}', price7d)
    .replace('{news_headlines}', news || 'غير متوفرة');
}

function heuristic(ind: EconomicIndicator): EconomyReason {
  const up = ind.changePercent >= 0;
  const dir = up ? 'ارتفاع' : 'تراجع';
  return {
    reason_summary: `${dir} ضمن تقلبات السوق المعتادة وعوامل العرض والطلب لهذا الأصل.`,
    market_context: 'حركة اعتيادية دون حدث مؤكد محدد.',
    confidence: 'LOW',
    aiEnriched: false,
  };
}

const VALID: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];
const cache = new Map<string, EconomyReason>();

export function heuristicReason(ind: EconomicIndicator): EconomyReason {
  return heuristic(ind);
}

export async function analyzeEconomy(ind: EconomicIndicator, newsHeadlines = ''): Promise<EconomyReason> {
  const cached = cache.get(ind.key);
  if (cached) return cached;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: fillPrompt(ind, newsHeadlines) }],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return heuristic(ind);
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    if (typeof parsed?.reason_summary !== 'string' || !parsed.reason_summary.trim()) return heuristic(ind);
    const result: EconomyReason = {
      reason_summary: parsed.reason_summary.trim(),
      market_context: typeof parsed.market_context === 'string' ? parsed.market_context.trim() : '',
      confidence: VALID.includes(parsed.confidence) ? parsed.confidence : 'LOW',
      aiEnriched: true,
    };
    cache.set(ind.key, result);
    return result;
  } catch {
    return heuristic(ind);
  }
}
