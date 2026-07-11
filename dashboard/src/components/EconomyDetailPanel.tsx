import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, Sparkles, Info, Clock } from 'lucide-react';
import PriceSparkline from './charts/PriceSparkline';
import type { EconomicIndicator } from '../services/economy';
import { analyzeEconomy, heuristicReason, economyAiCacheKey, type EconomyReason } from '../services/economyAi';
import { useAiAnalysis } from '../services/ai/useAiAnalysis';
import AiProgressiveLine from './AiProgressiveLine';

interface EconomyDetailPanelProps {
  indicator: EconomicIndicator | null;
  onClose: () => void;
}

const UP_COLOR = '#00E676';
const DOWN_COLOR = '#FF6D00';

const CONFIDENCE_LABEL: Record<EconomyReason['confidence'], string> = {
  HIGH: 'ثقة عالية', MEDIUM: 'ثقة متوسطة', LOW: 'تقدير عام',
};

function timeAgoAr(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

// Slide-in overlay explaining WHY an economic indicator moved — reuses the same
// .health-detail-* shell as the other detail popups. The gpt-oss reason is
// grounded only in the real figures; when it's a general inference (no direct
// news) confidence is LOW and a subtle "تقدير عام" marker is shown.
export default function EconomyDetailPanel({ indicator, onClose }: EconomyDetailPanelProps) {
  const [displayed, setDisplayed] = useState<EconomicIndicator | null>(null);

  useEffect(() => {
    if (indicator) setDisplayed(indicator);
  }, [indicator]);

  // Value/change/sparkline render instantly from `displayed` above; the
  // gpt-oss reason is a non-blocking upgrade. Same indicator reopened within
  // 10 minutes reuses the cached reason.
  const { result: reason, loading: aiLoading, loadingMessage } = useAiAnalysis({
    key: indicator ? economyAiCacheKey(indicator) : null,
    input: indicator,
    heuristic: heuristicReason,
    fetcher: (ind, signal) => analyzeEconomy(ind, '', signal),
  });

  const isOpen = indicator !== null;
  const d = displayed;
  const up = d ? d.changePercent >= 0 : true;
  const color = up ? UP_COLOR : DOWN_COLOR;
  const Arrow = up ? TrendingUp : TrendingDown;
  const isLow = reason?.confidence === 'LOW';

  return (
    <>
      <div className={`health-detail-backdrop${isOpen ? ' open' : ''}`} onClick={onClose} />
      <div className={`health-detail-panel${isOpen ? ' open' : ''}`}>
        {d && (
          <>
            <div className="health-detail-topbar">
              <button className="health-detail-close" onClick={onClose} title="إغلاق"><X size={15} /></button>
              <span className="health-detail-country">{d.nameAr}</span>
              <span className="health-detail-code-badge">{d.unit}</span>
            </div>

            {/* Current value + change + sparkline */}
            <div className="eco-detail-hero">
              <span className="eco-detail-value mono-num">
                {d.value.toLocaleString('en-US', { minimumFractionDigits: d.value < 10 ? 2 : 0, maximumFractionDigits: 2 })}
              </span>
              <span className="eco-detail-delta" style={{ color }}>
                <Arrow size={13} />{up ? '+' : ''}{d.changePercent.toFixed(2)}{d.unit === '%' ? '' : '%'}
              </span>
            </div>
            {d.trend.length >= 2 && (
              <div className="eco-detail-spark"><PriceSparkline values={d.trend} color={color} height={44} /></div>
            )}

            {/* gpt-oss: reason for the move */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-ai-badge">{reason?.aiEnriched ? 'gpt-oss' : 'تلقائي'}</span>
                {reason && (
                  <span
                    className="eco-confidence"
                    style={{ color: isLow ? 'var(--text-muted)' : 'var(--saudi-gold-light)' }}
                    title={isLow ? 'تقدير عام غير مرتبط بحدث مؤكد' : undefined}
                  >
                    {isLow && <Info size={9} style={{ verticalAlign: '-1px', marginInlineEnd: 2 }} />}
                    {CONFIDENCE_LABEL[reason.confidence]}
                  </span>
                )}
                <span className="health-detail-section-title">
                  <Sparkles size={11} style={{ marginInlineEnd: 4, verticalAlign: '-1px' }} />
                  سبب التغيّر
                </span>
              </div>
              <div className="dz-detail-text">{reason?.reason_summary}</div>
              {reason?.market_context && (
                <div className="eco-detail-context">{reason.market_context}</div>
              )}
              {aiLoading && <AiProgressiveLine message={loadingMessage} />}
            </div>

            {/* Source */}
            <div className="dz-detail-source">
              <Clock size={11} style={{ flexShrink: 0 }} /> المصدر: {d.source} · آخر تحديث {timeAgoAr(new Date(d.updatedAt))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
