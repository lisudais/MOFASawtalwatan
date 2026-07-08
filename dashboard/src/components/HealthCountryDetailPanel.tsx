import { useEffect, useState } from 'react';
import { X, Send, ExternalLink, Loader2, Sparkles, AlertTriangle, Globe, ShieldAlert, ClipboardList } from 'lucide-react';
import type { CountryHealthEntry } from '../services/healthAnalysis';
import { analyzeHealthOutbreak, type HealthAiAnalysis, type HealthRisk, type HealthConfidence } from '../services/healthAi';
import { RISK_LEVEL_BAR_COLORS, RISK_LABEL_AR } from '../constants';

interface HealthCountryDetailPanelProps {
  country: CountryHealthEntry | null;
  onClose: () => void;
}

type Status = 'loading' | 'ready' | 'unavailable';

const RISK_COLOR: Record<HealthRisk, string> = {
  CRITICAL: RISK_LEVEL_BAR_COLORS.CRITICAL,
  HIGH: RISK_LEVEL_BAR_COLORS.HIGH,
  MEDIUM: RISK_LEVEL_BAR_COLORS.MEDIUM,
  LOW: RISK_LEVEL_BAR_COLORS.LOW,
};
const CONFIDENCE_LABEL: Record<HealthConfidence, string> = { HIGH: 'ثقة عالية', MEDIUM: 'ثقة متوسطة', LOW: 'تقدير عام' };

// Health detail overlay. The country list (HealthCategoryCard) is fed by REAL
// WHO Disease Outbreak News data (services/healthFeed.ts). When a country is
// opened here, its raw WHO data is sent to the local gpt-oss model
// (services/healthAi.ts) which returns the full Arabic risk analysis rendered
// below. While the model runs we show a loading state; if it is unavailable we
// show the raw WHO data with a clear warning (never a fabricated analysis).
export default function HealthCountryDetailPanel({ country, onClose }: HealthCountryDetailPanelProps) {
  const [displayed, setDisplayed] = useState<CountryHealthEntry | null>(null);
  const [ai, setAi] = useState<HealthAiAnalysis | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!country) return;
    setDisplayed(country);
    setSent(false);
    setAi(null);
    setStatus('loading');
    let cancelled = false;
    // → send the real WHO data to gpt-oss and render its output (or fall back).
    analyzeHealthOutbreak(country).then((result) => {
      if (cancelled) return;
      if (result) { setAi(result); setStatus('ready'); }
      else setStatus('unavailable');
    });
    return () => { cancelled = true; };
  }, [country]);

  const isOpen = country !== null;
  const d = displayed;
  const color = ai ? RISK_COLOR[ai.riskLevel] : RISK_LEVEL_BAR_COLORS[d?.analysis.risk_level.category ?? 'LOW'];

  return (
    <>
      <div className={`health-detail-backdrop${isOpen ? ' open' : ''}`} onClick={onClose} />
      <div className={`health-detail-panel${isOpen ? ' open' : ''}`}>
        {d && (
          <>
            <div className="health-detail-topbar">
              <button className="health-detail-close" onClick={onClose} title="إغلاق"><X size={15} /></button>
              <span className="health-detail-country">{d.country}</span>
              <span className="health-detail-code-badge">{d.countryCode || '—'}</span>
            </div>

            {/* Real WHO/disease.sh identity (not AI) */}
            <div className="health-detail-disease-block">
              <div className="health-detail-disease-name">{d.disease}</div>
              {status === 'ready' && ai && (
                <div className="health-detail-disease-definition">{ai.diseaseType}</div>
              )}
            </div>

            {/* ── LOADING: gpt-oss is generating the analysis ── */}
            {status === 'loading' && (
              <div className="health-ai-loading">
                <Loader2 size={18} className="spin-icon" />
                <span>جارِ توليد التحليل بواسطة الذكاء الاصطناعي…</span>
              </div>
            )}

            {/* ── READY: gpt-oss analysis of the real WHO data ── */}
            {status === 'ready' && ai && (
              <>
                <div className="health-detail-section">
                  <div className="health-detail-section-header">
                    <span className="health-detail-risk-pill" style={{ borderColor: color, color }}>
                      {RISK_LABEL_AR[ai.riskLevel]}
                    </span>
                    <span className="health-detail-ai-badge">gpt-oss</span>
                    <span className="eco-confidence" style={{ color: ai.confidence === 'LOW' ? 'var(--text-muted)' : 'var(--saudi-gold-light)' }}>
                      {CONFIDENCE_LABEL[ai.confidence]}
                    </span>
                    <span className="health-detail-section-title">
                      <Sparkles size={11} style={{ marginInlineEnd: 4, verticalAlign: '-1px' }} />تحليل الوضع
                    </span>
                  </div>
                  <div className="health-detail-status-text">{ai.summary}</div>
                </div>

                <div className="health-detail-section">
                  <div className="health-ai-field">
                    <Globe size={11} style={{ color }} />
                    <span className="health-ai-label">المنطقة المتأثرة</span>
                    <span className="health-ai-value">{ai.affectedRegion}</span>
                  </div>
                  {ai.saudiImpact && (
                    <div className="health-ai-field top">
                      <ShieldAlert size={11} style={{ color }} />
                      <span className="health-ai-label">أثر على المواطنين</span>
                      <span className="health-ai-value">{ai.saudiImpact}</span>
                    </div>
                  )}
                </div>

                {ai.recommendedSteps && (
                  <div className="health-detail-section">
                    <div className="health-detail-recommend-title" style={{ color }}>
                      <ClipboardList size={11} style={{ marginInlineEnd: 4, verticalAlign: '-1px' }} />الإجراءات الموصى بها
                    </div>
                    <div className="health-detail-recommend-box">{ai.recommendedSteps}</div>
                  </div>
                )}

                {ai.sources.length > 0 && (
                  <div className="health-detail-section">
                    <div className="health-detail-section-title-standalone">المصادر المستخدمة</div>
                    <div className="dz-place-chips">
                      {ai.sources.map((s) => <span key={s} className="dz-place-chip">{s}</span>)}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── UNAVAILABLE: model down → raw WHO data + warning (no fake analysis) ── */}
            {status === 'unavailable' && (
              <>
                <div className="health-ai-warning">
                  <AlertTriangle size={13} /> تحليل الذكاء الاصطناعي غير متاح حالياً — يُعرض النص الأصلي من المصدر.
                </div>
                {d.sourceTitle && (
                  <div className="health-detail-section">
                    <div className="health-detail-section-title-standalone">العنوان الأصلي</div>
                    <div className="health-detail-status-text">{d.sourceTitle}</div>
                  </div>
                )}
                {d.sourceText && (
                  <div className="health-detail-section">
                    <div className="health-detail-section-title-standalone">التفاصيل الأصلية</div>
                    <div className="health-detail-status-text">{d.sourceText}</div>
                  </div>
                )}
              </>
            )}

            {/* Saudi presence — no real per-country dataset (allowed mock exception) */}
            <div className="health-detail-section">
              <div className="health-detail-section-title">التواجد السعودي في {d.country}</div>
              <div className="health-detail-presence-grid">
                <div className="health-detail-presence-box">
                  <div className="health-detail-presence-value">غير متوفر</div>
                  <div className="health-detail-presence-label">حاملو التأشيرات</div>
                </div>
                <div className="health-detail-presence-box">
                  <div className={`health-detail-presence-value${d.saudiTravelersCount > 0 ? ' mono-num' : ''}`}>
                    {d.saudiTravelersCount > 0 ? d.saudiTravelersCount.toLocaleString('ar-SA') : 'غير متوفر'}
                  </div>
                  <div className="health-detail-presence-label">مسافر مسجل</div>
                </div>
              </div>
            </div>

            {/* Real source link (WHO / disease.sh) */}
            {d.sourceUrl && (
              <a className="os-source-link" href={d.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} />
                المصدر الأصلي · {d.sourceName ?? 'المصدر'}
              </a>
            )}

            <button
              className="health-detail-send-btn"
              style={{ background: color }}
              onClick={() => setSent(true)}
              disabled={sent || status === 'loading'}
            >
              <Send size={13} />
              {sent ? 'تم الإرسال' : 'أرسل إشعاراً للمواطنين'}
            </button>
          </>
        )}
      </div>
    </>
  );
}
