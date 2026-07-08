import { useEffect, useState } from 'react';
import { X, Landmark, Clock, ExternalLink, Globe } from 'lucide-react';
import {
  OS_URGENCY_LABEL_AR,
  OS_URGENCY_COLOR,
  OS_CATEGORY_LABEL_AR,
  formatDateTimeAr,
  type OfficialStatement,
} from '../services/officialStatements';

interface OfficialStatementDetailPanelProps {
  statement: OfficialStatement | null;
  onClose: () => void;
}

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Slide-in map overlay for a selected official statement — reuses the same
// .health-detail-* shell as the health/disaster popups (same overlay slot,
// borders, glow, slide-in animation, size and RTL layout). Content is
// statement-specific. The title, publish time, full text and source link are
// shown exactly as received from the source; the AI summary/classification/
// extracted entities are clearly labeled as derived, never as the statement.
export default function OfficialStatementDetailPanel({ statement, onClose }: OfficialStatementDetailPanelProps) {
  const [displayed, setDisplayed] = useState<OfficialStatement | null>(null);

  useEffect(() => {
    if (statement) setDisplayed(statement);
  }, [statement]);

  const isOpen = statement !== null;
  const color = displayed ? OS_URGENCY_COLOR[displayed.urgency] : 'var(--text-muted)';

  return (
    <>
      <div className={`health-detail-backdrop${isOpen ? ' open' : ''}`} onClick={onClose} />
      <div className={`health-detail-panel${isOpen ? ' open' : ''}`}>
        {displayed && (
          <>
            <div className="health-detail-topbar">
              <button className="health-detail-close" onClick={onClose} title="إغلاق">
                <X size={15} />
              </button>
              <span className="health-detail-country">{displayed.country || 'تصريح رسمي'}</span>
              {displayed.countryCode && <span className="health-detail-code-badge">{displayed.countryCode}</span>}
            </div>

            <div className="health-detail-disease-block">
              <div className="os-detail-authority">
                <span className="os-detail-flag">{flagEmoji(displayed.countryCode)}</span>
                <Landmark size={12} style={{ color }} />
                {displayed.authority}
              </div>
              <div className="health-detail-disease-definition">{displayed.title}</div>
            </div>

            {/* التصنيف ومستوى الأهمية + تاريخ النشر */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-risk-pill" style={{ borderColor: color, color }}>
                  {OS_URGENCY_LABEL_AR[displayed.urgency]}
                </span>
                <span className="health-detail-ai-badge">{OS_CATEGORY_LABEL_AR[displayed.category]}</span>
                <span className="health-detail-section-title">التصنيف والأهمية</span>
              </div>
              <div className="os-detail-datetime">
                <Clock size={11} style={{ color, flexShrink: 0 }} />
                <span>تاريخ النشر: <strong>{formatDateTimeAr(displayed.publishedAt)}</strong></span>
              </div>
            </div>

            {/* النص الكامل — من المصدر مباشرة */}
            <div className="health-detail-section">
              <div className="health-detail-section-title-standalone">النص الكامل للتصريح</div>
              {displayed.fullText ? (
                <div className="os-detail-fulltext">{displayed.fullText}</div>
              ) : (
                <div className="dz-detail-text os-detail-muted">
                  النص الكامل متاح عبر المصدر الأصلي أدناه.
                </div>
              )}
            </div>

            {/* ملخص الذكاء الاصطناعي — مشتق، لا يستبدل النص الأصلي */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-ai-badge">{displayed.aiEnriched ? 'AI' : 'تلقائي'}</span>
                <span className="health-detail-section-title">ملخص مختصر</span>
              </div>
              <div className="dz-detail-text">{displayed.aiSummary}</div>
            </div>

            {/* الدول والمناطق المذكورة — استخراج */}
            {(displayed.countries.length > 0 || displayed.regions.length > 0) && (
              <div className="health-detail-section">
                <div className="health-detail-section-title-standalone">الدول والمناطق المذكورة</div>
                {displayed.countries.length > 0 && (
                  <div className="os-entity-row">
                    <Globe size={11} style={{ color, flexShrink: 0 }} />
                    <div className="os-entity-chips">
                      {displayed.countries.map((c) => <span key={c} className="os-entity-chip">{c}</span>)}
                    </div>
                  </div>
                )}
                {displayed.regions.length > 0 && (
                  <div className="os-entity-chips">
                    {displayed.regions.map((r) => <span key={r} className="os-entity-chip region">{r}</span>)}
                  </div>
                )}
              </div>
            )}

            {/* المصدر الأصلي */}
            <a className="os-source-link" href={displayed.sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} />
              المصدر الأصلي · {displayed.sourceName}
            </a>
          </>
        )}
      </div>
    </>
  );
}
