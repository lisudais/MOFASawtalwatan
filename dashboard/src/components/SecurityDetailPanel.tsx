import { useEffect, useState } from 'react';
import { X, Clock, ExternalLink, ShieldAlert, History, Sparkles, Users, Radio } from 'lucide-react';
import {
  FACTOR_ORDER, FACTOR_LABEL_AR, FACTOR_WEIGHT_PCT, RISK_LABEL_AR,
  scoreColor, timeAgoAr, formatDateTimeAr,
  type CountrySecurityProfile, type Severity,
} from '../services/security';
import { summarizeSecurity, heuristicSummary, securityAiCacheKey } from '../services/securityAi';
import { getSaudiPresence } from '../services/mockData';
import { useAiAnalysis } from '../services/ai/useAiAnalysis';
import AiProgressiveLine from './AiProgressiveLine';
import SafeSourceLink from './SafeSourceLink';

interface SecurityDetailPanelProps {
  profile: CountrySecurityProfile | null;
  onClose: () => void;
}

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const SEVERITY_LABEL_AR: Record<Severity, string> = {
  LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع', CRITICAL: 'حرج',
};

// Slide-in map overlay for a country's ACLED-derived security profile —
// reuses the same .health-detail-* shell (overlay slot, borders, glow,
// slide-in, RTL) as the other detail popups. Content: risk score, the five
// weighted ACLED factors, current threats, event timeline, an AI summary +
// top reasons, and the source link.
export default function SecurityDetailPanel({ profile, onClose }: SecurityDetailPanelProps) {
  const [displayed, setDisplayed] = useState<CountrySecurityProfile | null>(null);

  useEffect(() => {
    if (profile) setDisplayed(profile);
  }, [profile]);

  // Country profile (score, factors, threats, timeline) renders instantly
  // from `displayed` above; the AI summary is a non-blocking upgrade. Same
  // country reopened within 10 minutes reuses the cached summary.
  const { result: ai, loading: aiLoading, loadingMessage } = useAiAnalysis({
    key: profile ? securityAiCacheKey(profile) : null,
    input: profile,
    heuristic: heuristicSummary,
    fetcher: (p, signal) => summarizeSecurity(p, signal),
  });

  const isOpen = profile !== null;
  const p = displayed;
  const color = p ? scoreColor(p.riskScore) : 'var(--text-muted)';
  // Mock Saudi presence — resolves for EVERY country (no "غير متوفر").
  const presence = p ? getSaudiPresence(p.countryCode) : null;

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

            {/* Country info + big risk score */}
            <div className="sec-detail-hero">
              <span className="sec-detail-flag">{flagEmoji(p.countryCode)}</span>
              <div className="sec-detail-score-block">
                <div className="sec-detail-score mono-num" style={{ color }}>
                  {p.riskScore}<span className="sec-detail-score-max"> / 100</span>
                </div>
                <div className="sec-detail-level" style={{ color }}>مستوى الخطر: {RISK_LABEL_AR[p.riskLevel]}</div>
              </div>
              <div className="sec-detail-updated"><Clock size={10} /> {timeAgoAr(new Date(p.latestUpdate))}</div>
            </div>
            <div className="sec-bar-track lg">
              <div className="sec-bar-fill" style={{ width: `${p.riskScore}%`, background: color }} />
            </div>

            {/* Quick stats */}
            <div className="sec-saudi-grid">
              <div className="sec-saudi-box"><span className="sec-saudi-val mono-num">{p.activeIncidents}</span><span className="sec-saudi-lbl">حدث نشط</span></div>
              <div className="sec-saudi-box"><span className="sec-saudi-val mono-num">{p.fatalities}</span><span className="sec-saudi-lbl">قتيل</span></div>
              <div className="sec-saudi-box"><span className="sec-saudi-val mono-num">{p.sourceCount}</span><span className="sec-saudi-lbl">مصدر بيانات</span></div>
            </div>

            {/* Weighted factor breakdown */}
            <div className="health-detail-section">
              <div className="health-detail-section-title-standalone">تفصيل العوامل الموزونة</div>
              <div className="sec-breakdown">
                {FACTOR_ORDER.map((f) => {
                  const v = p.factors[f];
                  const cc = scoreColor(v);
                  return (
                    <div key={f} className="sec-cat-row">
                      <span className="sec-cat-label">{FACTOR_LABEL_AR[f]} <span className="sec-cat-weight">({FACTOR_WEIGHT_PCT[f]}%)</span></span>
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
                <div className="sec-saudi-box"><span className="sec-saudi-val mono-num">{(presence?.residents ?? 0).toLocaleString('ar-SA')}</span><span className="sec-saudi-lbl">مقيمون</span></div>
                <div className="sec-saudi-box"><span className="sec-saudi-val mono-num">{(presence?.visitors ?? 0).toLocaleString('ar-SA')}</span><span className="sec-saudi-lbl">زوّار</span></div>
                <div className="sec-saudi-box"><span className="sec-saudi-val mono-num">{(presence?.visaHolders ?? 0).toLocaleString('ar-SA')}</span><span className="sec-saudi-lbl">حاملو تأشيرات</span></div>
              </div>
              <div className="sec-note">أرقام التواجد السعودي تقديرية (بيانات تجريبية) وليست إحصاءات رسمية.</div>
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
                      <SafeSourceLink key={i} className="sec-tl-item" href={e.url} fallbackHint={e.source}>
                        <span className="sec-tl-dot" style={{ background: sc }} />
                        <div className="sec-tl-body">
                          <div className="sec-tl-title">{e.title}</div>
                          <div className="sec-tl-meta">
                            {formatDateTimeAr(new Date(e.date))} · المصدر: {e.source}
                          </div>
                        </div>
                      </SafeSourceLink>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI summary + top reasons */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-ai-badge">{ai?.aiEnriched ? 'ذكاء اصطناعي' : 'تلقائي'}</span>
                <span className="health-detail-section-title"><Sparkles size={11} style={{ marginInlineEnd: 4, verticalAlign: '-1px' }} />ملخص الوضع الأمني</span>
              </div>
              <div className="dz-detail-text">{ai?.summary}</div>
              {ai && ai.drivers.length > 0 && (
                <div className="sec-drivers">
                  {ai.drivers.map((d) => <span key={d} className="sec-driver-chip">{d}</span>)}
                </div>
              )}
              {aiLoading && <AiProgressiveLine message={loadingMessage} />}
            </div>

            {/* Sources */}
            {p.sources.length > 0 && (
              <div className="health-detail-section">
                <div className="health-detail-section-header">
                  <Radio size={11} style={{ color, marginInlineStart: 'auto' }} />
                  <span className="health-detail-section-title-standalone">المصادر الأصلية ({p.sources.length})</span>
                </div>
                <div className="sec-sources">
                  {p.sources.map((s, i) => (
                    <SafeSourceLink key={i} className="sec-source-link" href={s.url} fallbackHint={s.name}>
                      <ExternalLink size={11} /> {s.name}
                    </SafeSourceLink>
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
