// Editable Alert Message writer — composes the citizen-facing alert text for a
// selected event (health / disaster / security) via the project's LOCAL
// gpt-oss:20b model (Ollama). Replaces the old flat template
// ("تنبيه وزارة الخارجية: خطر متوسط في مالي.") with a real, official, actionable
// message.
//
// Called ONLY when a detail panel opens (and on explicit "regenerate") — never
// on a timer. Result is cached in the shared 10-minute AI cache keyed by the
// event's identity, so reopening the same event reuses it instead of re-calling
// the model. If the model is unreachable, `heuristicAlertMessage` (the old
// template) is returned so the field is never empty. Plain Arabic text out — no
// JSON, no markdown.

import { withTimeout } from './ai/abortHelpers';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface AlertMessageInput {
  eventTypeAr: string;      // نوع الحدث (زلزال/تفشٍّ/نزاع…)
  location: string;         // الدولة/المنطقة تحديدًا
  riskLevelAr: string;      // مستوى الخطورة (منخفض/متوسط/مرتفع/حرج)
  riskScore: number;        // 0-100
  description: string;      // وصف الحدث الفعلي من المصدر
  saudiCount: number;       // عدد السعوديين المتواجدين بالمنطقة
  recommendedAction: string; // الإجراء الموصى به إن وُجد ('' إن لم يوجد)
}

const SYSTEM_PROMPT =
  'أنت كاتب رسائل تنبيه رسمية بوزارة الخارجية السعودية، موجهة مباشرة للمواطنين السعوديين المتواجدين بمنطقة الحدث. ' +
  'تكتب بأسلوب حكومي رسمي، حازم وواضح، وليس عامًا أو مبهمًا.\n\n' +
  'اكتب رسالة تنبيه رسمية واحدة (3-4 أسطر كحد أقصى) تشمل:\n' +
  '1. تحديد واضح لنوع الخطر ومكانه (اسم المنطقة/الدولة تحديدًا، وليس عامًا).\n' +
  '2. وصف موجز لطبيعة الخطر الفعلي (ليس فقط "خطر متوسط" بل ماذا يعني ذلك عمليًا — مثل تصاعد الاشتباكات المسلحة أو ارتفاع حاد في الإصابات).\n' +
  '3. توجيه فعلي ومحدد للمواطنين (خطوة عملية يجب اتخاذها فورًا).\n' +
  '4. توجيه المواطنين للتواصل مع أقرب سفارة أو قنصلية سعودية للاستفسار أو طلب المساعدة — دون اختراع أرقام هاتف أو عناوين بريد إلكتروني أو روابط محددة.\n\n' +
  'لا تستخدم صياغة عامة فضفاضة؛ كل جملة يجب أن تحمل معلومة أو توجيهًا فعليًا. ' +
  'لا تخترع أي تفاصيل غير موجودة بالبيانات المعطاة (لا أرقام تواصل، ولا أسماء جهات، ولا إحصاءات) — وإذا لم يتوفر إجراء موصى به محدد، استنتج توجيهًا عامًا مناسبًا لمستوى الخطورة نفسه (حذر/تجنب/إخلاء حسب الشدة). ' +
  'أعد نصًا عربيًا رسميًا فقط، جاهزًا للاستخدام مباشرة بحقل الرسالة، بدون أي تنسيق إضافي (لا markdown، لا علامات اقتباس).';

function buildUserPrompt(inp: AlertMessageInput): string {
  return [
    'بيانات الحدث:',
    `نوع الحدث: ${inp.eventTypeAr}`,
    `الدولة/المنطقة: ${inp.location}`,
    `مستوى الخطورة: ${inp.riskLevelAr} (الدرجة: ${inp.riskScore}/100)`,
    `وصف الحدث: ${inp.description?.trim() || 'غير متوفر'}`,
    `عدد السعوديين المتواجدين بالمنطقة: ${inp.saudiCount.toLocaleString('en-US')}`,
    `الإجراء الموصى به (إن وُجد): ${inp.recommendedAction?.trim() || 'غير محدد'}`,
  ].join('\n');
}

/** Deterministic identity for caching: same event id + score → same message. */
export function alertMessageCacheKey(cardId: string, score: number): string {
  return `alert-msg|${cardId}|${score}`;
}

/** Old flat template — kept as the offline fallback so the field is never empty. */
export function heuristicAlertMessage(inp: AlertMessageInput): string {
  const action = inp.recommendedAction?.trim();
  return `تنبيه وزارة الخارجية: خطر ${inp.riskLevelAr} في ${inp.location}.${action ? ` ${action}` : ''}`.trim();
}

/**
 * Compose the official alert message via gpt-oss. Returns the model's plain text,
 * or the heuristic fallback if the local model is unreachable / returns nothing.
 * Never throws for transport failures — the message field must always populate.
 */
export async function composeAlertMessage(inp: AlertMessageInput, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(inp) },
        ],
        stream: false,
        think: 'low',
        options: { temperature: 0.3, num_predict: 400 },
      }),
      signal: withTimeout(signal, 90_000),
    });
    if (!res.ok) return heuristicAlertMessage(inp);
    const data = await res.json();
    const text = data?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return heuristicAlertMessage(inp);
    // Strip any stray quotes/backticks the model might add despite the instruction.
    return text.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  } catch {
    return heuristicAlertMessage(inp);
  }
}
