// Official State Statements — types, display config, and helpers for the
// التصريحات الرسمية للدول card.
//
// IMPORTANT: this module holds NO statement data. The browser fetches the
// merged feed from our own backend proxy (/api/statements — see
// netlify/lib/statementsCore.mjs), consumed via statementsFeed.ts. The original
// title, source, publish time and source link come DIRECTLY from the source and
// are never AI-generated. AI (see statementAi.ts) is used ONLY to enrich each
// item: summarize, classify, estimate urgency, and extract countries/regions.

export type OSUrgency = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type OSCategory = 'SECURITY' | 'POLITICAL' | 'ECONOMIC' | 'HUMANITARIAN' | 'HEALTH';
export type OSSourceApi = 'ReliefWeb' | 'GDELT' | 'RSS';

export interface OfficialStatement {
  id: string;

  // ── Straight from the source/API — never AI-generated ──────────────
  title: string;          // العنوان الأصلي للتصريح
  authority: string;      // الجهة المصدِرة (اسم المصدر الرسمي)
  publishedAt: Date;      // وقت النشر من المصدر
  sourceName: string;     // اسم المصدر
  sourceUrl: string;      // رابط المصدر الأصلي
  sourceApi: OSSourceApi; // قناة الاكتشاف/المصدر
  fullText: string;       // النص الأصلي كما ورد من المصدر (قد يكون فارغًا لمصادر الاكتشاف)
  country: string;        // الدولة المُصدِرة (من المصدر)
  countryCode: string;    // ISO 3166-1 alpha-2 (flag), from source; '' if unknown

  // ── AI-derived enrichment only (see statementAi.ts) ────────────────
  urgency: OSUrgency;     // تقدير الاستعجال بالذكاء الاصطناعي
  category: OSCategory;   // التصنيف بالذكاء الاصطناعي
  aiSummary: string;      // ملخص الذكاء الاصطناعي (لا يستبدل النص الأصلي)
  countries: string[];    // الدول المذكورة (استخراج)
  regions: string[];      // المناطق المتأثرة (استخراج)
  aiEnriched: boolean;    // true إذا أنتج النموذج التحليل، false إذا استُخدم البديل الاستدلالي
}

export const OS_URGENCY_LABEL_AR: Record<OSUrgency, string> = {
  URGENT: 'عاجل',
  HIGH:   'مرتفع',
  MEDIUM: 'متوسط',
  LOW:    'منخفض',
};

// Urgency colors reuse the palette's danger hues (kept as hex so an alpha
// suffix like `${color}1A` yields a valid translucent badge fill).
export const OS_URGENCY_COLOR: Record<OSUrgency, string> = {
  URGENT: '#FF1744', // --danger-critical
  HIGH:   '#FF6D00', // --danger-high
  MEDIUM: '#FFD600', // --danger-medium
  LOW:    '#00E676', // --danger-low
};

export const OS_CATEGORY_LABEL_AR: Record<OSCategory, string> = {
  SECURITY:     'أمني',
  POLITICAL:    'سياسي',
  ECONOMIC:     'اقتصادي',
  HUMANITARIAN: 'إنساني',
  HEALTH:       'صحي',
};

// Filter tabs — "الكل" first (category: null).
export const OS_TABS: { key: string; label: string; category: OSCategory | null }[] = [
  { key: 'ALL',          label: 'الكل',    category: null },
  { key: 'POLITICAL',    label: 'سياسي',  category: 'POLITICAL' },
  { key: 'SECURITY',     label: 'أمني',   category: 'SECURITY' },
  { key: 'ECONOMIC',     label: 'اقتصادي', category: 'ECONOMIC' },
  { key: 'HUMANITARIAN', label: 'إنساني', category: 'HUMANITARIAN' },
  { key: 'HEALTH',       label: 'صحي',    category: 'HEALTH' },
];

const OS_URGENCY_RANK: Record<OSUrgency, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Automatic ordering: highest urgency first, then most-recently-published.
export function sortStatements(list: OfficialStatement[]): OfficialStatement[] {
  return [...list].sort(
    (a, b) =>
      OS_URGENCY_RANK[a.urgency] - OS_URGENCY_RANK[b.urgency] ||
      b.publishedAt.getTime() - a.publishedAt.getTime()
  );
}

// Arabic relative-time label, e.g. "منذ 20 دقيقة".
export function timeAgoAr(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

// Full publish date + time in Arabic, e.g. "٧ يوليو ٢٠٢٦، ١٤:٣٠".
export function formatDateTimeAr(date: Date): string {
  return date.toLocaleString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
