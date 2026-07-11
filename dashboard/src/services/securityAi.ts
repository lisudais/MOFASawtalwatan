// AI summary for a country's ACLED-derived security profile.
//
// The model NEVER invents threats or events. It is given ONLY the already-
// computed weighted factors and topReasons (see securityCore.mjs) — never the
// raw ACLED records — and asked to:
//   • summarize the current security situation (Arabic)
//   • restate the top reasons behind the score, in the model's own words
// Uses the project's local Ollama; falls back to a deterministic template
// built straight from topReasons when the model is unavailable.

import {
  RISK_LABEL_AR, FACTOR_LABEL_AR,
  type CountrySecurityProfile,
} from './security';
import { withTimeout } from './ai/abortHelpers';

// Cache key for the shared 10-minute AI cache (services/ai/cache.ts).
export const securityAiCacheKey = (p: CountrySecurityProfile) => p.countryCode;

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface SecuritySummary {
  summary: string;
  drivers: string[]; // top reasons behind the score (Arabic), up to 3
  aiEnriched: boolean;
}

const RISK_ADVICE_AR: Record<CountrySecurityProfile['riskLevel'], string> = {
  CRITICAL: 'يُنصح بتجنب السفر إلى المناطق المتأثرة ومتابعة التحديثات الرسمية أولاً بأول.',
  HIGH: 'يُنصح المسافرون بتجنب المناطق المتأثرة ومتابعة التحديثات الرسمية.',
  MEDIUM: 'يُنصح بالحذر ومتابعة التحديثات الرسمية قبل السفر.',
  LOW: 'الوضع تحت المراقبة ولا يستدعي إجراءات استثنائية حالياً.',
};

function heuristic(p: CountrySecurityProfile): SecuritySummary {
  const reasons = p.topReasons;
  const reasonsText = reasons.length ? `${reasons.join('، ')} تشير إلى خطر أمني ${RISK_LABEL_AR[p.riskLevel]}.` : `الوضع الأمني مصنّف ${RISK_LABEL_AR[p.riskLevel]}.`;
  const summary = `${reasonsText} ${RISK_ADVICE_AR[p.riskLevel]}`.trim();
  return { summary, drivers: reasons, aiEnriched: false };
}

function buildPrompt(p: CountrySecurityProfile): string {
  const factorsText = Object.entries(p.factors)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${FACTOR_LABEL_AR[k as keyof typeof FACTOR_LABEL_AR]}: ${v}`)
    .join('، ');
  const threats = p.currentThreats.map((t) => t.title).join('، ') || 'لا يوجد';
  return [
    'أنت محلل أمني. لا تخترع أي حادثة أو تهديد غير مذكور في البيانات التالية.',
    `الدولة: ${p.country}`,
    `المؤشر الأمني: ${p.riskScore}/100 (التصنيف: ${RISK_LABEL_AR[p.riskLevel]}).`,
    `أسباب المؤشر (مرتبة): ${p.topReasons.join('، ') || 'لا يوجد'}.`,
    `تفصيل العوامل الموزونة: ${factorsText || 'لا يوجد'}.`,
    `عدد الحوادث النشطة: ${p.activeIncidents}. عدد الضحايا (القتلى): ${p.fatalities}.`,
    `المخاطر المذكورة رسمياً: ${threats}.`,
    `آخر تحديث: ${p.latestUpdate}.`,
    '',
    'اكتب بالعربية الفصحى:',
    '- summary: جملتان كحد أقصى تلخصان الوضع الأمني الحالي وتوصية عملية للمسافرين، مبنية فقط على البيانات أعلاه.',
    '- drivers: أعد نفس "أسباب المؤشر" أعلاه بصياغتك، دون إضافة سبب غير مذكور فيها.',
    '',
    'أعد JSON صارم فقط: {"summary":"...","drivers":["..."]}',
  ].join('\n');
}

export async function summarizeSecurity(p: CountrySecurityProfile, signal?: AbortSignal): Promise<SecuritySummary> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: buildPrompt(p) }],
        stream: false,
        format: 'json',
      }),
      signal: withTimeout(signal),
    });
    if (!res.ok) return heuristic(p);
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) return heuristic(p);
    return {
      summary: parsed.summary.trim(),
      drivers: Array.isArray(parsed.drivers)
        ? parsed.drivers.filter((d: any) => typeof d === 'string')
        : p.topReasons,
      aiEnriched: true,
    };
  } catch {
    return heuristic(p);
  }
}

// Synchronous heuristic — used as the immediate default before AI resolves.
export function heuristicSummary(p: CountrySecurityProfile): SecuritySummary {
  return heuristic(p);
}
