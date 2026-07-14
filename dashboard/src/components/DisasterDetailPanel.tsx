import { useEffect, useState } from 'react';
import { X, MapPin, Clock, Activity, Mountain, Wind, CloudRain, Flame, Radio, Sparkles, ExternalLink } from 'lucide-react';
import {
  DISASTER_TYPE_LABEL_AR,
  SEVERITY_LABEL_AR,
  SEVERITY_COLOR,
  disasterPlaceAr,
  type DisasterEvent,
  type DisasterType,
} from '../services/naturalDisasterFeed';
import { analyzeDisaster, heuristicDisaster } from '../services/disasterAi';
import { useAiAnalysis } from '../services/ai/useAiAnalysis';
import AiProgressiveLine from './AiProgressiveLine';
import SafeSourceLink from './SafeSourceLink';

interface DisasterDetailPanelProps {
  disaster: DisasterEvent | null;
  onClose: () => void;
}

const TYPE_ICON: Record<DisasterType, React.ElementType> = {
  EARTHQUAKE: Activity,
  VOLCANO:    Mountain,
  HURRICANE:  Wind,
  FLOOD:      CloudRain,
  WILDFIRE:   Flame,
};

// Arabic relative-time label, e.g. "منذ 15 دقيقة".
function timeAgoAr(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

// Slide-in map overlay for a selected natural-disaster event — deliberately
// reuses the same .health-detail-* shell as HealthCountryDetailPanel (same
// overlay slot, borders, glow, slide-in and RTL layout) so it reads as a
// native part of the dashboard. Content is disaster-specific: which places are
// hit and the original source link. This is NOT a traveler alert — no
// send-notification action here. Keeps the last-opened disaster rendered
// while closing so the slide-out doesn't blank mid-animation.
export default function DisasterDetailPanel({ disaster, onClose }: DisasterDetailPanelProps) {
  const [displayed, setDisplayed] = useState<DisasterEvent | null>(null);

  useEffect(() => {
    if (disaster) setDisplayed(disaster);
  }, [disaster]);

  // Event data (title/country/severity/etc.) renders immediately from
  // `displayed` above — the AI call below only ever upgrades the analysis
  // text, it never blocks the rest of the panel. Same event reopened within
  // 10 minutes reuses the cached analysis with no network call; opening a
  // different event cancels whatever gpt-oss request was still in flight.
  const { result: ai, loading: aiLoading, loadingMessage } = useAiAnalysis({
    key: disaster?.id,
    input: disaster,
    heuristic: heuristicDisaster,
    fetcher: (d, signal) => analyzeDisaster(d, signal),
  });

  const isOpen = disaster !== null;
  const color = displayed ? SEVERITY_COLOR[displayed.severity] : 'var(--text-muted)';
  const TypeIcon = displayed ? TYPE_ICON[displayed.disasterType] : Activity;

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
              {disasterPlaceAr(displayed) && <span className="health-detail-country">{disasterPlaceAr(displayed)}</span>}
              {displayed.countryCode && <span className="health-detail-code-badge">{displayed.countryCode}</span>}
            </div>

            <div className="health-detail-disease-block">
              <div className="health-detail-disease-name">
                <TypeIcon size={13} style={{ verticalAlign: '-2px', marginInlineEnd: 5, color }} />
                {DISASTER_TYPE_LABEL_AR[displayed.disasterType]}
              </div>
              <div className="health-detail-disease-definition">{displayed.title}</div>
            </div>

            {/* تحليل الوضع — تحليل gpt-oss مبني على بيانات المصدر الحقيقية */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-risk-pill" style={{ borderColor: color, color }}>
                  الخطورة · {SEVERITY_LABEL_AR[displayed.severity]}
                </span>
                <span className="health-detail-ai-badge">
                  <Clock size={9} style={{ verticalAlign: '-1px', marginInlineEnd: 3 }} />
                  {timeAgoAr(displayed.updatedAt)}
                </span>
                <span className="health-detail-section-title">
                  <Sparkles size={11} style={{ marginInlineEnd: 4, verticalAlign: '-1px' }} />
                  تحليل الوضع
                </span>
              </div>
              <div className="health-detail-section-header">
                <span className="health-detail-ai-badge">{ai?.aiEnriched ? 'gpt-oss' : 'تلقائي'}</span>
                <span className="health-detail-subheading" style={{ marginInlineStart: 'auto' }}>الوضع الحالي</span>
              </div>
              <div className="dz-detail-text">{ai?.analysis ?? displayed.description}</div>
              <div className="dz-detail-summary"><Sparkles size={10} /> {ai?.aiSummary ?? displayed.aiSummary}</div>
              {aiLoading && <AiProgressiveLine message={loadingMessage} />}
            </div>

            {/* الأماكن المتضررة — only when the source provides a region/place */}
            {displayed.city && (
              <div className="health-detail-section">
                <div className="health-detail-section-title-standalone">الأماكن المتضررة</div>
                <div className="dz-detail-region">
                  <MapPin size={11} style={{ color, flexShrink: 0 }} />
                  <span>المنطقة المتأثرة: <strong>{displayed.city}</strong></span>
                </div>
              </div>
            )}

            {/* التوصيات / التنبيهات — بالعربية من gpt-oss (بديل استدلالي عند غياب النموذج) */}
            {ai?.recommendation && (
              <div className="health-detail-section">
                <div className="health-detail-recommend-title" style={{ color }}>التوصيات / التنبيهات</div>
                <div className="health-detail-recommend-box">{ai.recommendation}</div>
              </div>
            )}

            {/* المصدر */}
            <div className="dz-detail-source">
              <Radio size={11} style={{ flexShrink: 0 }} /> المصدر: {displayed.source}
              <SafeSourceLink href={displayed.sourceUrl} fallbackHint={displayed.source} className="dz-detail-source-link">
                <ExternalLink size={10} /> عرض التقرير الأصلي
              </SafeSourceLink>
            </div>
          </>
        )}
      </div>
    </>
  );
}
