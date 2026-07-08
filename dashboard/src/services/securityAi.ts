// AI summary for a security profile.
//
// The model NEVER invents threats or events. It is given ONLY the already-
// computed scores and the real advisory-derived risk list, and asked to:
//   • summarize the current security situation (Arabic)
//   • identify the main contributing risks
// Uses the project's local Ollama; falls back to a deterministic template built
// straight from the profile data when the model is unavailable.

import {
  CATEGORY_LABEL_AR, THREAT_LABEL_AR, CATEGORY_ORDER,
  type SecurityProfile,
} from './security';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface SecuritySummary {
  summary: string;
  drivers: string[]; // main contributing risks (Arabic labels)
  aiEnriched: boolean;
}

// Top contributing categories (excluding the generic "security" posture),
// highest score first — used both for the heuristic and as AI input.
function topDrivers(p: SecurityProfile): string[] {
  return CATEGORY_ORDER
    .filter((c) => c !== 'security')
    .map((c) => ({ c, v: p.categories[c] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .filter((d) => d.v >= 40)
    .map((d) => CATEGORY_LABEL_AR[d.c]);
}

function heuristic(p: SecurityProfile): SecuritySummary {
  const drivers = topDrivers(p);
  const driversText = drivers.length ? `أبرز المخاطر: ${drivers.join('، ')}.` : '';
  const summary =
    `الوضع الأمني في ${p.country} مُصنّف «${THREAT_LABEL_AR[p.level]}» بمؤشر ${p.overall}/100، ` +
    `استناداً إلى تحذيرات السفر الأمريكية (${p.advisoryLabel}). ${driversText}`.trim();
  return { summary, drivers, aiEnriched: false };
}

function buildPrompt(p: SecurityProfile): string {
  const cats = CATEGORY_ORDER.map((c) => `${CATEGORY_LABEL_AR[c]}: ${p.categories[c]}`).join('، ');
  const threats = p.currentThreats.map((t) => t.title).join('، ') || 'لا يوجد';
  return [
    'أنت محلل أمني. لا تخترع أي حادثة أو تهديد غير مذكور في البيانات التالية.',
    `الدولة: ${p.country}`,
    `المؤشر الأمني العام: ${p.overall}/100 (التصنيف: ${THREAT_LABEL_AR[p.level]}).`,
    `مستوى تحذير السفر الأمريكي: ${p.advisoryLabel}.`,
    `درجات الفئات: ${cats}.`,
    `المخاطر المذكورة رسمياً: ${threats}.`,
    '',
    'اكتب بالعربية الفصحى:',
    '- summary: تلخيص للوضع الأمني الحالي وأهم أسباب ارتفاع/انخفاض المؤشر، جملتان بحد أقصى، دون اختلاق.',
    '- drivers: مصفوفة قصيرة بأهم المخاطر المساهمة (من الفئات أعلاه فقط).',
    '',
    'أعد JSON صارم فقط: {"summary":"...","drivers":["..."]}',
  ].join('\n');
}

export async function summarizeSecurity(p: SecurityProfile): Promise<SecuritySummary> {
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
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return heuristic(p);
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) return heuristic(p);
    return {
      summary: parsed.summary.trim(),
      drivers: Array.isArray(parsed.drivers)
        ? parsed.drivers.filter((d: any) => typeof d === 'string')
        : topDrivers(p),
      aiEnriched: true,
    };
  } catch {
    return heuristic(p);
  }
}

// Synchronous heuristic — used as the immediate default before AI resolves.
export function heuristicSummary(p: SecurityProfile): SecuritySummary {
  return heuristic(p);
}
