import { RefreshCw, Sparkles, Zap, Search, ArrowRight, Telescope } from 'lucide-react';
import { TREND_ICON, TREND_COLOR, TREND_LABEL_AR } from '../constants';
import type { SituationReport } from '../types';

interface AiSituationReportCardProps {
  report: SituationReport | null | undefined;
  isFetching: boolean;
  isError: boolean;
  onRefresh: () => void;
}

export default function AiSituationReportCard({ report, isFetching, isError, onRefresh }: AiSituationReportCardProps) {
  return (
    <div className="situation-report-card">
      <div className="situation-report-header">
        <span className="ai-generated-badge"><Sparkles size={10} /> AI Generated</span>
        {report && (
          <span className="situation-report-trend" style={{ color: TREND_COLOR[report.trend] }}>
            {(() => { const TrendIcon = TREND_ICON[report.trend]; return <TrendIcon size={12} />; })()}
            {TREND_LABEL_AR[report.trend]}
          </span>
        )}
        <button className="situation-report-refresh" onClick={onRefresh} disabled={isFetching} title="تحديث التحليل الآن">
          <RefreshCw size={12} className={isFetching ? 'spin-icon' : ''} />
        </button>
      </div>

      {isFetching && !report && (
        <div className="widget-empty-state">جاري إعداد تقرير الموقف بواسطة gpt-oss:20b…</div>
      )}

      {isError && !report && (
        <div className="ai-insight-error">تعذر إنشاء تقرير الموقف — تأكد من تشغيل Ollama محليًا.</div>
      )}

      {report && (
        <div className="situation-report-body" key={report.generatedAt}>
          <div className="situation-report-line">
            <Zap size={12} className="situation-report-line-icon assessment" />
            {report.assessment}
          </div>
          <div className="situation-report-line">
            <Search size={12} className="situation-report-line-icon cause" />
            {report.likelyCause}
          </div>
          <div className="situation-report-line recommendation">
            <ArrowRight size={12} className="situation-report-line-icon action" />
            <strong>{report.recommendation}</strong>
          </div>
          {report.prediction && (
            <div className="situation-report-line">
              <Telescope size={12} className="situation-report-line-icon prediction" />
              {report.prediction}
              <span className="estimate-tag">تقديري</span>
            </div>
          )}
          <div className="situation-report-timestamp">
            آخر تحديث: {new Date(report.generatedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}
    </div>
  );
}
