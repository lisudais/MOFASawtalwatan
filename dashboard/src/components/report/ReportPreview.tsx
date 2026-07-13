import { useEffect, useMemo, useState } from 'react';
import { X, Download, Loader2, RefreshCw } from 'lucide-react';
import ReportDocument from './ReportDocument';
import { buildReportSections, type ReportInputs } from '../../services/reportData';
import { generateReportSummaries } from '../../services/reportSummary';
import { exportReportPdf, reportFileName } from '../../services/exportPdf';

/**
 * Preview + export shell around the A4 {@link ReportDocument}.
 *
 * The report is a SNAPSHOT: on open (and on an explicit refresh) it captures the
 * dashboard data at that instant and writes the five sections from it. It does
 * NOT re-render itself when the dashboard's live data changes in the background.
 * Instead, if the underlying data has moved on since the snapshot, a small bar
 * offers to prepare an updated copy — regenerating with the same flow.
 *
 * User-facing copy never names the underlying model.
 */

/** Lightweight fingerprint of the inputs — counts + aggregate values — so a real
 *  background data change is detected without deep-comparing the whole payload. */
function fingerprint(inp: ReportInputs): string {
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  return [
    inp.events.length,
    inp.healthCountries.length,
    inp.securityCountries.length,
    inp.economyIndicators.length,
    sum(inp.events.map((e) => e.score)),
    sum(inp.securityCountries.map((c) => c.riskScore)),
    sum(inp.healthCountries.map((c) => c.riskScore)),
    sum(inp.economyIndicators.map((i) => Math.round(i.value))),
  ].join('|');
}

export default function ReportPreview({ inputs, onClose }: { inputs: ReportInputs; onClose: () => void }) {
  // The frozen data + timestamp the current report was built from. Set once at
  // open; only an explicit "refresh" re-captures them.
  const [snapshot, setSnapshot] = useState<ReportInputs>(inputs);
  const [now, setNow] = useState<Date>(() => new Date());

  const [summaries, setSummaries] = useState<Partial<Record<string, string>>>({});
  const [progress, setProgress] = useState({ done: 0, total: 5 });
  const [generating, setGenerating] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  // Regenerate whenever the SNAPSHOT changes (open + explicit refresh only).
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      setSummaries({});
      setGenerating(true);
      const sections = buildReportSections(snapshot);
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
  }, [snapshot]);

  // Has the live dashboard data moved on since this snapshot was taken?
  const snapshotFp = useMemo(() => fingerprint(snapshot), [snapshot]);
  const hasUpdate = !generating && fingerprint(inputs) !== snapshotFp;

  function refreshFromLiveData() {
    setSnapshot(inputs);     // re-capture current data → triggers regeneration
    setNow(new Date());      // re-date the report to this refresh
  }

  async function handleDownload() {
    const el = document.getElementById('report-doc');
    if (!el) return;
    setExportError(false);
    setExporting(true);
    try {
      await exportReportPdf(el, reportFileName(now));
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
          {generating ? 'جاري تحليل البيانات وإعداد التقرير…' : 'معاينة التقرير — جاهز للتحميل'}
        </span>
        <div className="report-toolbar-actions">
          <button
            type="button"
            className="report-btn"
            onClick={handleDownload}
            disabled={generating || exporting}
            title={generating ? 'يُفعّل بعد اكتمال إعداد التقرير' : 'تحميل التقرير بصيغة PDF'}
          >
            {exporting ? <Loader2 size={13} className="spin-icon" /> : <Download size={13} />}
            {exporting ? 'جاري التحميل…' : 'تحميل PDF'}
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
          الذكاء الاصطناعي يجهّز لك الملخص… ({progress.done}/{progress.total})
        </div>
      )}

      {hasUpdate && (
        <div className="report-note report-note--update" dir="rtl">
          <span>صار هناك تحديث في المعلومات — هل تريد تجهيز نسخة محدثة؟</span>
          <button type="button" className="report-btn report-btn--sm" onClick={refreshFromLiveData}>
            <RefreshCw size={12} />
            تحديث التقرير
          </button>
        </div>
      )}

      {exportError && (
        <div className="report-note report-note--error" dir="rtl">
          تعذّر إنشاء ملف PDF. حاول مرة أخرى.
        </div>
      )}

      <ReportDocument now={now} summaries={summaries} />
    </div>
  );
}
