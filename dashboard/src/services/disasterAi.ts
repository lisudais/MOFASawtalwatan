// gpt-oss analysis for a natural-disaster event.
//
// The model NEVER invents events or facts. It receives ONLY the real fields
// fetched from the source (type, magnitude, location, original title/描述) and
// produces an Arabic reading of them:
//   • analysis        → تحليل موجز للوضع
//   • aiSummary       → جملة واحدة قصيرة جدًا
//   • recommendation  → توصية عملية
// It also serves the Arabization goal: the source text is English, and the
// model returns everything in Arabic. Uses the project's local Ollama; falls
// back to a deterministic Arabic template built from the structured fields.

import { ND_TYPE_LABEL_AR, ND_RISK_LABEL_AR, type NaturalDisaster } from './naturalDisasters';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface DisasterAnalysis {
  analysis: string;
  aiSummary: string;
  recommendation: string;
  aiEnriched: boolean;
}

const RISK_RECOMMENDATION_AR: Record<NaturalDisaster['risk'], string> = {
  HIGH:   'يُنصح بأخذ أقصى درجات الحيطة والابتعاد عن المنطقة المتأثرة ومتابعة تعليمات الجهات الرسمية.',
  MEDIUM: 'يُنصح بالمتابعة المستمرة وأخذ الحذر عند التواجد في المنطقة المتأثرة.',
  LOW:    'الوضع تحت المراقبة ولا يستدعي إجراءات عاجلة حالياً.',
};

// Deterministic Arabic reading of the structured fields (no source English text).
export function heuristicDisaster(d: NaturalDisaster): DisasterAnalysis {
  const typeAr = ND_TYPE_LABEL_AR[d.type];
  const where = d.country ? ` قرب ${d.country}` : '';
  const mag = d.value ? ` بقوة ${d.value}` : '';
  return {
    analysis: `تسجيل ${typeAr}${mag}${where} وفق مصدر ${d.source}. مستوى الخطورة المقدّر: ${ND_RISK_LABEL_AR[d.risk]}.`,
    aiSummary: `${typeAr} — خطورة ${ND_RISK_LABEL_AR[d.risk]}${d.country ? ` (${d.country})` : ''}.`,
    recommendation: RISK_RECOMMENDATION_AR[d.risk],
    aiEnriched: false,
  };
}

function buildPrompt(d: NaturalDisaster): string {
  const lines: (string | null)[] = [
    'أنت محلل استخبارات كوارث طبيعية محترف. تكتب بأسلوب تقارير رسمية دقيقة، وليس وصفاً عاماً.',
    '',
    '## البيانات المتاحة (لا تخترع أي معلومة غير موجودة فيها):',
    `نوع الكارثة: ${ND_TYPE_LABEL_AR[d.type]}`,
    d.value ? `القوة/الشدة: ${d.value}` : 'القوة/الشدة: غير محددة',
    d.country ? `الدولة: ${d.country}` : null,
    `العنوان الأصلي (من المصدر ${d.source}): ${d.title}`,
    d.description ? `الوصف الأصلي: ${d.description}` : null,
    '',
    '## استخراج الموقع (مهم جداً):',
    '- افحصي العنوان الأصلي (title) والوصف (description) بدقة لاستخراج **اسم المدينة أو المنطقة المحددة** إن وُجدت مذكورة فيهما (حتى لو كانت بالإنجليزية بالمصدر الأصلي) - مثال: لو العنوان يذكر "KEPULAUAN TALAUD, INDONESIA"، استخرجي "جزر تالاود" كموقع محدد، وليس فقط "إندونيسيا"',
    '- **إذا وجدتِ اسم مدينة/منطقة محددة**: اكتبيها مدمجة مع الدولة بصيغة طبيعية ("جزر تالاود، إندونيسيا") ضمن التحليل مباشرة',
    '- **إذا لم يوجد أي اسم منطقة محددة بالبيانات**: لا تكتبي أي إشارة لذلك إطلاقاً (ممنوع كتابة "غير محدد" أو "منطقة غير معروفة" أو أي عبارة مشابهة) - فقط اكتبي التحليل بالدولة وحدها دون الإشارة لغياب التفاصيل الجغرافية الدقيقة',
    '',
    '## أسلوب الكتابة (أقوى وأكثر احترافية):',
    '- استخدمي لغة تقارير استخباراتية مباشرة وحازمة، ليست وصفية عامة',
    '- كل جملة تحمل معلومة فعلية أو تقييماً محدداً، وليست حشواً',
    '- تجنبي الصيغ الضعيفة مثل "قد يسبب" أو "من المحتمل أن" إلا إذا كانت الشدة فعلاً غير مؤكدة من البيانات - إذا كانت القوة/الشدة عالية بوضوح من الرقم المعطى، اكتبي بصيغة جزم مباشرة',
    '- اربطي الشدة (value) برقم فعلي بالتحليل نفسه، لا تكتفي بوصف عام ("زلزال متوسط" وحدها ضعيفة - اكتبي "زلزال بقوة [X] درجة" مدمجاً بالجملة)',
    '',
    '## أعد JSON صارم فقط بهذا الشكل، دون أي نص إضافي:',
    '{',
    '  "analysis": "تحليل عربي حازم ومحدد (جملتان كحد أقصى)، يذكر الموقع الدقيق إن وُجد، والقوة الفعلية، والتأثير المحتمل على المنطقة - مبني فقط على المعطيات أعلاه",',
    '  "aiSummary": "جملة عربية واحدة قصيرة جداً وحازمة، تلخص الحدث برقم أو حقيقة محددة",',
    '  "recommendation": "توصية عملية واحدة محددة وقابلة للتنفيذ فوراً، وليست عامة"',
    '}',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export async function analyzeDisaster(d: NaturalDisaster): Promise<DisasterAnalysis> {
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
      signal: AbortSignal.timeout(90000),
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
