import { useEffect, useState } from 'react';
import { X, Clock, ExternalLink, ShieldAlert, History, Sparkles, Users } from 'lucide-react';
import {
  CATEGORY_ORDER, CATEGORY_LABEL_AR, THREAT_LABEL_AR,
  scoreColor, timeAgoAr, formatDateTimeAr,
  type SecurityProfile, type Severity,
} from '../services/security';
import { summarizeSecurity, heuristicSummary, type SecuritySummary } from '../services/securityAi';

interface SecurityDetailPanelProps {
  profile: SecurityProfile | null;
  onClose: () => void;
}

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const SEVERITY_LABEL_AR: Record<Severity, string> = {
  LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع', CRITICAL: 'حرج',
};

// Slide-in map overlay for a country's security profile — reuses the same
// .health-detail-* shell (overlay slot, borders, glow, slide-in, RTL) as the
// other detail popups. Content: overall score, category breakdown, Saudi
// presence, current threats, event timeline, an AI summary, and source links.
export default function SecurityDetailPanel({ profile, onClose }: SecurityDetailPanelProps) {
  const [displayed, setDisplayed] = useState<SecurityProfile | null>(null);
  const [ai, setAi] = useState<SecuritySummary | null>(null);

  useEffect(() => {
    if (!profile) return;
    setDisplayed(profile);
    setAi(heuristicSummary(profile)); // instant default…
    let cancelled = false;
    summarizeSecurity(profile).then((r) => { if (!cancelled) setAi(r); }); // …upgraded by AI when available
    return () => { cancelled = true; };
  }, [profile]);

  const isOpen = profile !== null;
  const p = displayed;
  const color = p ? scoreColor(p.overall) : 'var(--text-muted)';

  return (
    <>
      <div className={`health-detail-backdrop${isOpen ? ' open' : ''}`} onClick={onClose} />
      <div className={`health-detail-panel${isOpen ? ' open' : ''}`}>
        {p && (
          <>
            <div className="health-detail-topbar">
              <button className="health-detail-close" onClick={onClose} title="إغلاق"><X size={15} /></button>
              <span className="health-detail-country">{p.country}</span>
              <span className="health-detail-code-badge">{p.countryCode}</span>
            </div>

            {/* Country info + big overall score */}
            <div className="sec-detail-hero">
              <span className="sec-detail-flag">{flagEmoji(p.countryCode)}</span>
              <div className="sec-detail-score-block">
                <div className="sec-detail-score mono-num" style={{ color }}>
                  {p.overall}<span className="sec-detail-score-max"> / 100</span>
                </div>
                <div className="sec-detail-level" style={{ color }}>مستوى الخطر: {THREAT_LABEL_AR[p.level]}</div>
              </div>
              <div className="sec-detail-updated"><Clock size={10} /> {timeAgoAr(new Date(p.lastUpdated))}</div>
            </div>
            <div className="sec-bar-track lg">
              <div className="sec-bar-fill" style={{ width: `${p.overall}%`, background: color }} />
            </div>

            {/* Threat breakdown */}
            <div className="health-detail-section">
              <div className="health-detail-section-title-standalone">تفصيل المخاطر</div>
              <div className="sec-breakdown">
                {CATEGORY_ORDER.map((c) => {
                  const v = p.categories[c];
                  const cc = scoreColor(v);
                  return (
                    <div key={c} className="sec-cat-row">
                      <span className="sec-cat-label">{CATEGORY_LABEL_AR[c]}</span>
                      <div className="sec-cat-track">
                        <div className="sec-cat-fill" style={{ width: `${v}%`, background: cc }} />
                      </div>
                      <span className="sec-cat-value mono-num">{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Saudi citizens */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <Users size={12} style={{ color, marginInlineStart: 'auto' }} />
                <span className="health-detail-section-title-standalone">المواطنون السعوديون</span>
              </div>
              <div className="sec-saudi-grid">
                <div className="sec-saudi-box"><span className="sec-saudi-val">غير متوفر</span><span className="sec-saudi-lbl">مقيمون</span></div>
                <div className="sec-saudi-box"><span className="sec-saudi-val">غير متوفر</span><span className="sec-saudi-lbl">زوّار</span></div>
                <div className="sec-saudi-box"><span className="sec-saudi-val">غير متوفر</span><span className="sec-saudi-lbl">حاملو تأشيرات</span></div>
              </div>
              <div className="sec-note">بيانات التواجد السعودي غير متوفرة من المصادر العامة.</div>
            </div>

            {/* Current threats */}
            {p.currentThreats.length > 0 && (
              <div className="health-detail-section">
                <div className="health-detail-section-header">
                  <ShieldAlert size={12} style={{ color, marginInlineStart: 'auto' }} />
                  <span className="health-detail-section-title-standalone">التهديدات النشطة</span>
                </div>
                <div className="sec-threat-list">
                  {p.currentThreats.map((t, i) => {
                    const sc = scoreColor(t.severity === 'CRITICAL' ? 90 : t.severity === 'HIGH' ? 65 : t.severity === 'MEDIUM' ? 45 : 20);
                    return (
                      <div key={i} className="sec-threat-item">
                        <span className="sec-threat-sev" style={{ color: sc, borderColor: sc, background: `${sc}1A` }}>
                          {SEVERITY_LABEL_AR[t.severity]}
                        </span>
                        <span className="sec-threat-title">{t.title}</span>
                        <span className="sec-threat-meta">
                          {new Date(t.time).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' })} · المصدر: {t.source}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Timeline */}
            {p.timeline.length > 0 && (
              <div className="health-detail-section">
                <div className="health-detail-section-header">
                  <History size={12} style={{ color, marginInlineStart: 'auto' }} />
                  <span className="health-detail-section-title-standalone">التسلسل الزمني للأحداث</span>
                </div>
                <div className="sec-timeline">
                  {p.timeline.slice(0, 8).map((e, i) => {
                    const sc = scoreColor(e.severity === 'CRITICAL' ? 90 : e.severity === 'HIGH' ? 65 : e.severity === 'MEDIUM' ? 45 : 20);
                    return (
                      <a key={i} className="sec-tl-item" href={e.url} target="_blank" rel="noopener noreferrer">
                        <span className="sec-tl-dot" style={{ background: sc }} />
                        <div className="sec-tl-body">
                          <div className="sec-tl-title">{e.title}</div>
                          <div className="sec-tl-meta">
                            {formatDateTimeAr(new Date(e.date))} · المصدر: {e.source}
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI summary */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-ai-badge">{ai?.aiEnriched ? 'AI' : 'تلقائي'}</span>
                <span className="health-detail-section-title"><Sparkles size={11} style={{ marginInlineEnd: 4, verticalAlign: '-1px' }} />ملخص الوضع الأمني</span>
              </div>
              <div className="dz-detail-text">{ai?.summary}</div>
              {ai && ai.drivers.length > 0 && (
                <div className="sec-drivers">
                  {ai.drivers.map((d) => <span key={d} className="sec-driver-chip">{d}</span>)}
                </div>
              )}
            </div>

            {/* Sources */}
            {p.sources.length > 0 && (
              <div className="health-detail-section">
                <div className="health-detail-section-title-standalone">المصادر الأصلية</div>
                <div className="sec-sources">
                  {p.sources.map((s, i) => (
                    <a key={i} className="sec-source-link" href={s.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={11} /> {s.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
