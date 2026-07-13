import { useEffect, useRef, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import ReportDocument from './ReportDocument';
import { buildReportSections, type ReportInputs } from '../../services/reportData';
import { generateReportSummaries } from '../../services/reportSummary';
import { exportReportPdf, reportFileName } from '../../services/exportPdf';

/**
 * Preview + export shell around the A4 {@link ReportDocument}. On open it runs
 * the five gpt-oss section summaries (one local-model call each, sequentially),
 * filling the sheet live as each completes. "تحميل PDF" enables once all five
 * are ready and then rasterizes the sheet to a dated A4 PDF.
 *
 * All model calls happen HERE, only on this user-initiated open — never on a
 * timer or in the background.
 */
export default function ReportPreview({ inputs, onClose }: { inputs: ReportInputs; onClose: () => void }) {
  // Fixed at open — the report is dated to this instant.
  const nowRef = useRef(new Date());
  const [summaries, setSummaries] = useState<Partial<Record<string, string>>>({});
  const [progress, setProgress] = useState({ done: 0, total: 5 });
  const [generating, setGenerating] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      setGenerating(true);
      const sections = buildReportSections(inputs);
      setProgress({ done: 0, total: sections.length });
      await generateReportSummaries(
        sections,
        (key, text, done, total) => {
          if (cancelled) return;
          setSummaries((prev) => ({ ...prev, [key]: text }));
          setProgress({ done, total });
        },
        ctrl.signal,
      );
      if (!cancelled) setGenerating(false);
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [inputs]);

  async function handleDownload() {
    const el = document.getElementById('report-doc');
    if (!el) return;
    setExportError(false);
    setExporting(true);
    try {
      await exportReportPdf(el, reportFileName(nowRef.current));
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="معاينة التقرير">
      <div className="report-toolbar" dir="rtl">
        <span className="report-toolbar-title">
          {generating ? 'جارٍ إعداد التقرير عبر gpt-oss…' : 'معاينة التقرير — جاهز للتحميل'}
        </span>
        <div className="report-toolbar-actions">
          <button
            type="button"
            className="report-btn"
            onClick={handleDownload}
            disabled={generating || exporting}
            title={generating ? 'يُفعّل بعد اكتمال صياغة الأقسام' : 'تحميل التقرير بصيغة PDF'}
          >
            {exporting ? <Loader2 size={13} className="spin-icon" /> : <Download size={13} />}
            {exporting ? 'جارٍ التحميل…' : 'تحميل PDF'}
          </button>
          <button type="button" className="report-btn" onClick={onClose}>
            <X size={13} />
            إغلاق
          </button>
        </div>
      </div>

      {generating && (
        <div className="report-note report-note--progress" dir="rtl">
          <Loader2 size={13} className="spin-icon" />
          جارٍ صياغة الأقسام رسميًا عبر نموذج gpt-oss المحلي… ({progress.done}/{progress.total})
        </div>
      )}
      {exportError && (
        <div className="report-note report-note--error" dir="rtl">
          تعذّر إنشاء ملف PDF. حاول مرة أخرى.
        </div>
      )}

      <ReportDocument now={nowRef.current} summaries={summaries} />
    </div>
  );
}
