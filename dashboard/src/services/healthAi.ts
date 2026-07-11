// gpt-oss analysis for a health outbreak.
//
// Sends the RAW WHO Disease Outbreak News data (title + summary + country +
// disease + date), or the real disease.sh figures, to the local gpt-oss model
// and asks it to produce the full Arabic risk analysis. The model must analyse
// ONLY the provided real data — it must not invent outbreaks, countries,
// numbers, or recommendations. Uses the project's existing Ollama env vars.
//
// There is NO deterministic/heuristic fallback here: if the model is
// unavailable this returns null, and the UI shows the raw WHO data with an
// "AI analysis unavailable" warning (never a fabricated analysis).

import type { CountryHealthEntry } from './healthAnalysis';
import { withTimeout } from './ai/abortHelpers';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

// Sent to the LLM instead of the full WHO article body.
const MAX_SUMMARY_CHARS = 400;

export type HealthRisk = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type HealthConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

// The AI-generated analysis rendered in the Health detail panel.
export interface HealthAiAnalysis {
  riskLevel: HealthRisk;      // مستوى الخطورة
  summary: string;            // ملخص عربي قصير
  affectedRegion: string;     // الدولة/المنطقة المتأثرة
  diseaseType: string;        // نوع المرض/التفشّي
  saudiImpact: string;        // الأثر المحتمل على المواطنين/حاملي التأشيرات
  recommendedSteps: string;   // الإجراءات الموصى بها
  confidence: HealthConfidence;
  sources: string[];          // المصادر المستخدمة فعلاً
}

const VALID_RISK: HealthRisk[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VALID_CONF: HealthConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];

// Cache key for the shared 10-minute AI cache (services/ai/cache.ts) — same
// outbreak identity (country|disease) re-opened within the window reuses the
// stored analysis with no network call.
export const healthAiCacheKey = (e: CountryHealthEntry) => `${e.countryCode || e.country}|${e.disease}`;

function buildPrompt(e: CountryHealthEntry): string {
  return [
    'أنت محلل صحي وبائي محترف. حلّل حصراً بيانات منظمة الصحة العالمية التالية،',
    'ولا تخترع أي مرض أو دولة أو رقم أو توصية غير موجودة فيها. اكتب كل المخرجات بالعربية الفصحى.',
    '',
    'بيانات المصدر الحقيقية (ملخص مُختصر، وليس المقال الكامل):',
    `- المرض: ${e.disease}`,
    `- الدولة/المنطقة: ${e.country}`,
    `- العنوان الأصلي: ${e.sourceTitle ?? ''}`,
    `- ملخص الوضع: ${(e.sourceText ?? '').slice(0, MAX_SUMMARY_CHARS)}`,
    `- المصدر الرسمي: ${e.sourceName ?? ''}`,
    `- تاريخ التحديث: ${e.updatedAt ?? ''}`,
    '',
    'أعد JSON صارم فقط بهذا الشكل، دون أي نص إضافي:',
    '{',
    '  "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW",',
    '  "summary": "ملخص عربي قصير جداً للوضع الحالي (جملة أو جملتان)",',
    '  "affectedRegion": "الدولة أو المنطقة المتأثرة كما وردت بالبيانات",',
    '  "diseaseType": "نوع المرض أو التفشّي",',
    '  "saudiImpact": "الأثر المحتمل على المواطنين السعوديين أو حاملي التأشيرات بناءً على طبيعة المرض والموقع فقط، دون اختراع أرقام",',
    '  "recommendedSteps": "الإجراء العملي التالي الموصى به (جملة قصيرة)",',
    '  "confidence": "HIGH|MEDIUM|LOW",',
    '  "sources": ["أسماء المصادر المستخدمة فعلاً من البيانات أعلاه فقط"]',
    '}',
  ].join('\n');
}

// Sends the real WHO data to gpt-oss. Returns null on any failure (model down,
// non-JSON, invalid shape) so the caller can fall back to raw data + warning.
export async function analyzeHealthOutbreak(entry: CountryHealthEntry, signal?: AbortSignal): Promise<HealthAiAnalysis | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: buildPrompt(entry) }],
        stream: false,
        format: 'json',
      }),
      signal: withTimeout(signal),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);

    if (!VALID_RISK.includes(parsed?.riskLevel)) return null;
    if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) return null;

    const result: HealthAiAnalysis = {
      riskLevel: parsed.riskLevel,
      summary: parsed.summary.trim(),
      affectedRegion: typeof parsed.affectedRegion === 'string' ? parsed.affectedRegion.trim() : entry.country,
      diseaseType: typeof parsed.diseaseType === 'string' ? parsed.diseaseType.trim() : entry.disease,
      saudiImpact: typeof parsed.saudiImpact === 'string' ? parsed.saudiImpact.trim() : '',
      recommendedSteps: typeof parsed.recommendedSteps === 'string' ? parsed.recommendedSteps.trim() : '',
      confidence: VALID_CONF.includes(parsed?.confidence) ? parsed.confidence : 'LOW',
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((s: any) => typeof s === 'string')
        : [entry.sourceName ?? ''].filter(Boolean),
    };
    return result;
  } catch {
    return null;
  }
}
