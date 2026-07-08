import type { AiInsight, CategoryInsight, CategoryInsightsResult, InsightHighlightKind, RiskLevel, SituationReport } from '../types';
import type { RateComparison, RegionCount, AnomalyResult } from './analytics/disasterStats';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

const VALID_LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SAFE'];
const VALID_TRENDS: CategoryInsight['trend'][] = ['RISING', 'STABLE', 'FALLING'];
const VALID_HIGHLIGHT_KINDS: InsightHighlightKind[] = ['RISK', 'TREND', 'CAUSE', 'ACTION'];

async function callOllamaJson(prompt: string): Promise<any | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.message.content);
  } catch {
    return null;
  }
}

function buildPrompt(domainLabel: string, dataSummary: string, sourceNames: string[]): string {
  return [
    'أنت محلل مخاطر جيوسياسية واقتصادية.',
    `المجال: ${domainLabel}`,
    'استند حصريًا إلى البيانات التالية، ولا تفترض أي معلومة غير مذكورة هنا:',
    dataSummary,
    '',
    `مصادر البيانات المتاحة هي فقط: ${sourceNames.join('، ')}. استخدم هذه الأسماء بالضبط في حقل sources ولا تخترع أي مصدر آخر.`,
    '',
    'بدلاً من فقرة تحليلية طويلة، لخّص التحليل في نقاط قصيرة جدًا وسهلة القراءة (كل نقطة أقل من 10 كلمات)، كل نقطة مصنّفة بأحد الأنواع التالية، بالترتيب، مرة واحدة فقط لكل نوع:',
    '- RISK: أهم خطر حالي',
    '- TREND: الاتجاه الحالي (تصاعد/استقرار/تراجع) ولماذا',
    '- CAUSE: السبب الأكثر احتمالاً',
    '- ACTION: إجراء عملي محدد موصى به',
    '',
    'اكتب كل نص "text" بالعربية الفصحى فقط، مهما كانت لغة البيانات أعلاه.',
    '',
    'أعد JSON صارم فقط، بدون أي نص إضافي وبدون Markdown، بالضبط بهذا الشكل:',
    '{"riskLevel":"CRITICAL|HIGH|MEDIUM|LOW","highlights":[{"kind":"RISK","text":"نص عربي"},{"kind":"TREND","text":"نص عربي"},{"kind":"CAUSE","text":"نص عربي"},{"kind":"ACTION","text":"نص عربي"}],"sources":["..."]}',
  ].join('\n');
}

export async function fetchAiInsight(
  domainLabel: string,
  dataSummary: string,
  sourceNames: string[]
): Promise<AiInsight | null> {
  const parsed = await callOllamaJson(buildPrompt(domainLabel, dataSummary, sourceNames));
  if (!parsed) return null;
  if (!VALID_LEVELS.includes(parsed.riskLevel)) return null;
  if (!Array.isArray(parsed.highlights)) return null;

  const highlights = parsed.highlights.filter(
    (h: any) => h && VALID_HIGHLIGHT_KINDS.includes(h.kind) && typeof h.text === 'string'
  );
  if (highlights.length === 0) return null;

  return {
    riskLevel: parsed.riskLevel,
    highlights,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    generatedAt: new Date(),
  };
}

function buildCategoryPrompt(categories: string[], dataSummary: string, sourceNames: string[]): string {
  return [
    'أنت محلل مخاطر استخباراتي متخصص في الكوارث الطبيعية. لديك عدة فئات ضمن مجال واحد.',
    '',
    'المجال: الكوارث الطبيعية',
    `الفئات: ${categories.join('، ')}`,
    '',
    'استند حصريًا إلى البيانات التالية لكل فئة (العدد الحالي، آخر 24 ساعة، والـ24 ساعة',
    'قبلها، ومستوى الخطورة CRITICAL/HIGH/MEDIUM/LOW لكل حدث ضمن الفئة). لا تفترض أي',
    'معلومة غير مذكورة:',
    dataSummary,
    '',
    `مصادر البيانات المتاحة هي فقط: ${sourceNames.join('، ')}.`,
    '',
    '## قواعد الأولوية (مهم جداً):',
    '1. **الأحداث الحرجة (CRITICAL) لها الأولوية المطلقة** في الملخص، حتى لو كانت',
    '   فئتها قليلة العدد. حدث CRITICAL واحد أهم من 50 حدث LOW.',
    '2. **البيانات الأحدث (آخر 6-12 ساعة) لها وزن أكبر بكثير** من بيانات الـ24 ساعة',
    '   الأقدم. لا تعامل الفترتين بتساوي — إذا حدث تصعيد حاد بالساعات الأخيرة، هذا',
    '   أهم من نمط مستقر امتد على يوم كامل.',
    '3. تجاهل الفئات المستقرة تماماً (STABLE بدون أي CRITICAL) بجملة مختصرة جداً،',
    '   ووفّر التفصيل للفئات المتصاعدة أو الحرجة.',
    '',
    '## لكل فئة، أعد:',
    '- جملة قصيرة جدًا (أقل من 12 كلمة) تصف الوضع **الحالي فعلياً** (ليس تكرار الرقم)،',
    '  تذكر إن وجد: أعلى حدث خطورة بالفئة ومكانه، واتجاه الساعات الأخيرة تحديداً',
    '- "trend": RISING / FALLING / STABLE — مبني على مقارنة آخر 6-12 ساعة تحديداً،',
    '  ليس المعدل العام',
    '- "severity_flag": true إذا كانت الفئة تحوي أي حدث CRITICAL، وإلا false',
    '',
    '## أعد أيضًا:',
    '- "forecast": جملة تلخص التوقع للـ 24 ساعة القادمة، **مبنية فقط على الفئات',
    '  اللي فيها severity_flag=true أو RISING**، وتذكر أكثر فئة تستحق المتابعة الآن',
    '  بالاسم',
    '- "correlation": علاقة سببية أو زمنية واضحة بين فئتين إن وُجدت من نفس البيانات',
    '  المعطاة فقط (مثال: تزامن ارتفاع فئتين بنفس المنطقة الجغرافية)، وإلا null.',
    '  لا تخترع علاقة غير مدعومة بالأرقام.',
    '- "priority_alert": إن وجدت فئة واحدة تستحق انتباه فوري الآن (CRITICAL + RISING',
    '  معاً)، اذكر اسمها بالتحديد، وإلا null',
    '',
    'اكتب كل النصوص (summary لكل فئة، forecast، correlation) بالعربية الفصحى فقط.',
    '',
    'أعد JSON صارم فقط بدون أي نص خارج الـ JSON:',
    '{',
    '  "categories": {',
    `    ${categories.map((c) => `"${c}": {"summary": "...", "trend": "...", "severity_flag": true|false}`).join(',\n    ')},`,
    '  },',
    '  "forecast": "...",',
    '  "correlation": "..."|null,',
    '  "priority_alert": "..."|null',
    '}',
  ].join('\n');
}

export async function fetchCategoryInsights(
  categories: string[],
  dataSummary: string,
  sourceNames: string[]
): Promise<CategoryInsightsResult | null> {
  const parsed = await callOllamaJson(buildCategoryPrompt(categories, dataSummary, sourceNames));
  if (!parsed || typeof parsed.categories !== 'object') return null;

  const result: Record<string, CategoryInsight> = {};
  for (const category of categories) {
    const entry = parsed.categories[category];
    if (!entry || typeof entry.summary !== 'string' || !VALID_TRENDS.includes(entry.trend)) continue;
    result[category] = { summary: entry.summary, trend: entry.trend, severityFlag: entry.severity_flag === true };
  }
  if (Object.keys(result).length === 0) return null;

  return {
    categories: result,
    forecast: typeof parsed.forecast === 'string' ? parsed.forecast : '',
    correlation: typeof parsed.correlation === 'string' ? parsed.correlation : null,
    priorityAlert: typeof parsed.priority_alert === 'string' ? parsed.priority_alert : null,
    generatedAt: new Date().toISOString(),
  };
}

export interface SituationReportStats {
  categoryLabelAr: string;
  rate: RateComparison;
  topRegions: RegionCount[];
  anomaly: AnomalyResult;
  windowDays: number;
}

function buildSituationReportPrompt(stats: SituationReportStats, sourceNames: string[]): string {
  const { categoryLabelAr, rate, topRegions, anomaly, windowDays } = stats;

  const changeLine = rate.isNewActivity
    ? 'نشاط جديد لم يكن موجودًا في الفترة السابقة'
    : rate.percentChange === null
      ? 'لا يوجد نشاط في الفترتين'
      : `تغيّر ${rate.percentChange >= 0 ? '+' : ''}${rate.percentChange}%`;

  const anomalyLine = anomaly.insufficientData
    ? 'غير محدد — لا يوجد سجل تاريخي كافٍ بعد لتقييم ذلك إحصائيًا'
    : anomaly.isAnomaly
      ? `نعم، خارج النمط الطبيعي (الانحراف المعياري z=${anomaly.zScore}، المتوسط التاريخي ${anomaly.mean})`
      : `لا، ضمن النمط الطبيعي (الانحراف المعياري z=${anomaly.zScore}, المتوسط التاريخي ${anomaly.mean})`;

  const regionsLine = topRegions.length > 0
    ? topRegions.map((r) => `${r.country} (${r.count})`).join('، ')
    : 'لا توجد بيانات كافية عن المناطق';

  const dataBlock = [
    `البيانات التالية عن ${categoryLabelAr} خلال آخر ${windowDays} أيام:`,
    `- عدد الأحداث: ${rate.current} (مقارنة بـ ${rate.previous} بالفترة السابقة، ${changeLine})`,
    `- المناطق الأكثر تأثراً: ${regionsLine}`,
    `- هل هذا خارج النمط الطبيعي: ${anomalyLine}`,
  ].join('\n');

  const predictionInstruction = anomaly.insufficientData
    ? 'لا يوجد سجل تاريخي كافٍ بعد — أعد "prediction": null، لا تخترع توقعًا بدون بيانات كافية.'
    : 'أعد أيضًا "prediction": توقعًا قصيرًا جدًا (سطر واحد، أقل من 10 كلمات) لما قد يحدث خلال الأيام القادمة استنادًا فقط للأرقام أعلاه.';

  return [
    dataBlock,
    '',
    `مصادر البيانات المتاحة هي فقط: ${sourceNames.join('، ')}. لا تخترع مصدرًا آخر ولا تذكر مصادر لم تُدرج هنا.`,
    '',
    'بناءً على هذه الأرقام فقط (لا تخترع معلومات إضافية)، اكتب 3 حقول:',
    '1. assessment: تقييم الوضع الحالي (طبيعي/غير طبيعي ولماذا رقميًا)',
    '2. likelyCause: السبب الأكثر احتمالاً بناءً على الموسم والمنطقة الجغرافية',
    '3. recommendation: توصية عملية محددة وقابلة للتنفيذ (وليست عامة)',
    '',
    predictionInstruction,
    '',
    '## قيود الطول (صارمة جداً):',
    '- "assessment": جملة واحدة فقط، أقل من 10 كلمات.',
    '- "likelyCause": جملة واحدة فقط، أقل من 10 كلمات، بدون شرح جيولوجي أو علمي مطول.',
    '- "recommendation": جملة واحدة فقط، أقل من 12 كلمة، إجراء محدد فقط بدون تبرير.',
    '- ممنوع الفقرات. كل حقل سطر واحد فقط.',
    '- لا تكرر الأرقام (العدد، المؤشر) التي تظهر أصلاً بالواجهة — افترض المستخدم شايفها، ركّز على "ماذا يعني هذا" فقط.',
    '',
    'اكتب بالعربية الفصحى، بأسلوب تقارير الاستخبارات الرسمية، بدون مقدمات إنشائية.',
    'حدد أيضًا الاتجاه العام: RISING إذا كان الوضع يزداد سوءًا أو نشاطًا، FALLING إذا كان يتراجع، STABLE إذا لم يتغير جوهريًا.',
    '',
    'أعد JSON صارم فقط، بدون أي نص إضافي وبدون Markdown، بالضبط بهذا الشكل:',
    '{"assessment":"سطر واحد بالعربية","likelyCause":"سطر واحد بالعربية","recommendation":"سطر واحد بالعربية","prediction":"..."|null,"trend":"RISING|STABLE|FALLING"}',
  ].join('\n');
}

export async function fetchSituationReport(
  stats: SituationReportStats,
  sourceNames: string[]
): Promise<SituationReport | null> {
  const parsed = await callOllamaJson(buildSituationReportPrompt(stats, sourceNames));
  if (!parsed) return null;
  if (typeof parsed.assessment !== 'string' || typeof parsed.likelyCause !== 'string' || typeof parsed.recommendation !== 'string') return null;
  if (!VALID_TRENDS.includes(parsed.trend)) return null;

  return {
    assessment: parsed.assessment,
    likelyCause: parsed.likelyCause,
    recommendation: parsed.recommendation,
    prediction: typeof parsed.prediction === 'string' ? parsed.prediction : null,
    trend: parsed.trend,
    generatedAt: new Date().toISOString(),
  };
}
