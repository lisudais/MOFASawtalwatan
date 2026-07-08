// AI enrichment for official statements.
//
// The model NEVER writes or alters the statement itself — title, body, source,
// time and link stay exactly as fetched. AI is used ONLY to derive metadata:
//   • summarize   → aiSummary (Arabic, does not replace the original text)
//   • classify    → category (أمني/سياسي/اقتصادي/إنساني/صحي)
//   • estimate    → urgency  (عاجل/مرتفع/متوسط/منخفض)
//   • extract     → mentioned countries + affected regions
//
// Uses the project's local Ollama (same convention as aiInsight.ts). If the
// model is unavailable, a deterministic keyword heuristic fills the same fields
// so the section always works — items then carry aiEnriched=false.

import type { OSCategory, OSUrgency } from './officialStatements';
import type { RawStatement } from './statementsFeed';

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'gpt-oss:20b';

export interface Enrichment {
  category: OSCategory;
  urgency: OSUrgency;
  aiSummary: string;
  countries: string[];
  regions: string[];
  aiEnriched: boolean;
}

const VALID_CATEGORIES: OSCategory[] = ['SECURITY', 'POLITICAL', 'ECONOMIC', 'HUMANITARIAN', 'HEALTH'];
const VALID_URGENCIES: OSUrgency[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

/* ─── Heuristic fallback (no model available) ────────────────────────── */
const CATEGORY_KEYWORDS: Record<OSCategory, string[]> = {
  SECURITY: ['security', 'military', 'attack', 'troops', 'defen', 'terror', 'armed', 'strike', 'أمن', 'عسكري', 'هجوم', 'دفاع', 'إرهاب', 'قوات', 'اشتباك'],
  HEALTH: ['health', 'disease', 'outbreak', 'virus', 'pandemic', 'who', 'vaccine', 'صحة', 'وباء', 'فيروس', 'تفشي', 'لقاح', 'مرض'],
  ECONOMIC: ['econom', 'trade', 'oil', 'gas', 'sanction', 'investment', 'market', 'currency', 'اقتصاد', 'تجارة', 'نفط', 'غاز', 'عقوبات', 'استثمار', 'سوق'],
  HUMANITARIAN: ['humanitarian', 'aid', 'refugee', 'relief', 'displac', 'famine', 'shelter', 'إنساني', 'مساعدات', 'لاجئ', 'إغاثة', 'نزوح', 'مجاعة', 'إيواء'],
  POLITICAL: ['diploma', 'talks', 'summit', 'election', 'agreement', 'relations', 'دبلوماسي', 'مباحثات', 'قمة', 'انتخاب', 'اتفاق', 'علاقات', 'سياسي'],
};
const URGENT_WORDS = ['urgent', 'breaking', 'emergency', 'immediate', 'evacuat', 'عاجل', 'طارئ', 'فوري', 'إخلاء'];
const HIGH_WORDS = ['escalat', 'condemn', 'warn', 'conflict', 'attack', 'crisis', 'تصعيد', 'إدانة', 'تحذير', 'أزمة', 'هجوم', 'تنديد'];

// Arabic country names we can detect inside text (reuse for entity extraction).
const KNOWN_COUNTRIES_AR = [
  'السعودية', 'الإمارات', 'قطر', 'الكويت', 'البحرين', 'عُمان', 'اليمن', 'العراق', 'الأردن',
  'لبنان', 'سوريا', 'فلسطين', 'مصر', 'السودان', 'ليبيا', 'تونس', 'الجزائر', 'المغرب',
  'إيران', 'تركيا', 'إسرائيل', 'الولايات المتحدة', 'روسيا', 'الصين', 'أوكرانيا',
];

function heuristicEnrich(raw: RawStatement): Enrichment {
  const text = `${raw.title} ${raw.fullText}`.toLowerCase();

  let category: OSCategory = 'POLITICAL';
  let best = 0;
  for (const cat of VALID_CATEGORIES) {
    const hits = CATEGORY_KEYWORDS[cat].reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
    if (hits > best) { best = hits; category = cat; }
  }

  let urgency: OSUrgency = 'MEDIUM';
  if (URGENT_WORDS.some((w) => text.includes(w))) urgency = 'URGENT';
  else if (HIGH_WORDS.some((w) => text.includes(w))) urgency = 'HIGH';

  const source = raw.fullText || raw.title;
  const firstSentence = source.split(/(?<=[.!?۔؟])\s/)[0] ?? source;
  const aiSummary = firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence;

  const countries = KNOWN_COUNTRIES_AR.filter((c) => `${raw.title} ${raw.fullText}`.includes(c));

  return { category, urgency, aiSummary, countries, regions: [], aiEnriched: false };
}

/* ─── Model path (batched Ollama call) ───────────────────────────────── */
function buildPrompt(items: RawStatement[]): string {
  const list = items
    .map((s, i) => `[${i}] الدولة: ${s.country || 'غير محددة'} | العنوان: ${s.title}${s.fullText ? ` | النص: ${s.fullText.slice(0, 600)}` : ''}`)
    .join('\n');

  return [
    'أنت محلل تصنيف للتصريحات الرسمية الحكومية والدبلوماسية.',
    'لا تكتب أو تعدّل نص أي تصريح. مهمتك فقط تحليل البيانات التالية.',
    'لكل عنصر بالقائمة أعد:',
    '- summary: ملخص عربي قصير جدًا (أقل من 20 كلمة) للتصريح، دون اختلاق معلومات غير موجودة.',
    '- category: واحدة فقط من: SECURITY | POLITICAL | ECONOMIC | HUMANITARIAN | HEALTH',
    '- urgency: واحدة فقط من: URGENT | HIGH | MEDIUM | LOW',
    '- countries: مصفوفة بأسماء الدول المذكورة في النص (بالعربية).',
    '- regions: مصفوفة بالمناطق أو المدن المتأثرة المذكورة (بالعربية)، أو مصفوفة فارغة.',
    '',
    'العناصر:',
    list,
    '',
    'أعد JSON صارم فقط بهذا الشكل بالضبط، دون أي نص إضافي أو Markdown:',
    '{"items":[{"i":0,"summary":"...","category":"POLITICAL","urgency":"MEDIUM","countries":["..."],"regions":["..."]}]}',
  ].join('\n');
}

async function callOllama(items: RawStatement[]): Promise<Map<number, Enrichment> | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: buildPrompt(items) }],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    if (!Array.isArray(parsed?.items)) return null;

    const map = new Map<number, Enrichment>();
    for (const entry of parsed.items) {
      const i = Number(entry?.i);
      if (!Number.isInteger(i)) continue;
      const category = VALID_CATEGORIES.includes(entry.category) ? entry.category : 'POLITICAL';
      const urgency = VALID_URGENCIES.includes(entry.urgency) ? entry.urgency : 'MEDIUM';
      if (typeof entry.summary !== 'string' || !entry.summary.trim()) continue;
      map.set(i, {
        category,
        urgency,
        aiSummary: entry.summary.trim(),
        countries: Array.isArray(entry.countries) ? entry.countries.filter((c: any) => typeof c === 'string') : [],
        regions: Array.isArray(entry.regions) ? entry.regions.filter((r: any) => typeof r === 'string') : [],
        aiEnriched: true,
      });
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

// Enrich a batch: try the model once, then fill any gaps with the heuristic.
export async function enrichStatements(items: RawStatement[]): Promise<Enrichment[]> {
  if (items.length === 0) return [];
  const aiMap = await callOllama(items);
  return items.map((raw, i) => aiMap?.get(i) ?? heuristicEnrich(raw));
}
