/**
 * Official-letter-styled A4 summary of the command center's five sections.
 *
 * SKELETON STAGE: header, dates, footer and the five section titles are final;
 * each section body renders `summaries[key]` when provided, otherwise a
 * placeholder. Nothing here fetches or calls the model — the parent gathers the
 * data, runs the gpt-oss summarizer, and passes the finished paragraphs in.
 *
 * Visual identity mirrors a real MOFA letter: pure-white sheet, near-black
 * serif Arabic text, thin neutral/green rules — NOT the dashboard's dark theme.
 * The centered mark is the project's real `mofa-logo.svg`, matching the
 * reference letter image.
 */

export interface ReportSectionSpec {
  key: string;
  title: string;
}

/** The five sections, in the exact order the report must present them. */
export const REPORT_SECTIONS: ReportSectionSpec[] = [
  { key: 'health', title: 'الصحة' },
  { key: 'disasters', title: 'الكوارث الطبيعية' },
  { key: 'security', title: 'التهديدات الأمنية' },
  { key: 'top-countries', title: 'الدول الأكثر خطورة (تجميعي)' },
  { key: 'economy', title: 'التغيرات الاقتصادية' },
];

/** Gregorian + Umm-al-Qura Hijri, e.g. "13 يوليو 2026م / 27 محرم 1448هـ". */
export function formatReportDate(now: Date): string {
  const greg = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
  const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
  return `${greg}م / ${hijri}هـ`;
}

export interface ReportDocumentProps {
  /** Export timestamp — defaults to now; the report reflects this instant. */
  now?: Date;
  /** Finished per-section paragraphs, keyed by section key. Absent → placeholder. */
  summaries?: Partial<Record<string, string>>;
}

export default function ReportDocument({ now = new Date(), summaries }: ReportDocumentProps) {
  return (
    <article className="report-doc" id="report-doc" dir="rtl">
      {/* ── Official header ─────────────────────────────────────────────── */}
      <header className="report-head">
        <div className="report-logos">
          <img src="/mofa-logo.svg" alt="وزارة الخارجية — المملكة العربية السعودية" className="report-logo-main" />
        </div>
        <div className="report-rule report-rule--neutral" />

        <h1 className="report-title">ملخص مركز الأزمات والاستخبارات العالمية</h1>
        <div className="report-date">{formatReportDate(now)}</div>
        <div className="report-rule report-rule--green" />
      </header>

      {/* ── Five sections ───────────────────────────────────────────────── */}
      <main className="report-body">
        {REPORT_SECTIONS.map((s, i) => {
          const text = summaries?.[s.key];
          return (
            <section className="report-section" key={s.key}>
              <h2 className="report-section-title">
                <span className="report-section-num">{i + 1}</span>
                <span>{s.title}</span>
              </h2>
              <div className="report-rule report-rule--thin" />
              {text ? (
                <p className="report-section-content">{text}</p>
              ) : (
                <p className="report-section-content report-placeholder">
                  — يُربط محتوى هذا القسم بالبيانات الفعلية ويُصاغ عبر gpt-oss بعد اعتماد التصميم —
                </p>
              )}
            </section>
          );
        })}
      </main>

      {/* ── Official footer ─────────────────────────────────────────────── */}
      <footer className="report-foot">
        <div className="report-rule report-rule--green" />
        <div className="report-foot-name">مركز الأزمات والاستخبارات العالمية</div>
        <div className="report-foot-web">WWW.MOFA.GOV.SA</div>
      </footer>
    </article>
  );
}
