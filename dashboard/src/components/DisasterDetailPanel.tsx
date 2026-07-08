import { useEffect, useState } from 'react';
import { X, MapPin, Clock, Timer, Activity, Mountain, Wind, CloudRain, Flame, Radio, Sparkles } from 'lucide-react';
import {
  ND_TYPE_LABEL_AR,
  ND_RISK_LABEL_AR,
  ND_RISK_COLOR,
  timeAgoAr,
  type NaturalDisaster,
  type NDType,
} from '../services/naturalDisasters';
import { analyzeDisaster, heuristicDisaster, type DisasterAnalysis } from '../services/disasterAi';

interface DisasterDetailPanelProps {
  disaster: NaturalDisaster | null;
  onClose: () => void;
}

const TYPE_ICON: Record<NDType, React.ElementType> = {
  EARTHQUAKE: Activity,
  VOLCANO:    Mountain,
  STORM:      Wind,
  FLOOD:      CloudRain,
  WILDFIRE:   Flame,
};

// Slide-in map overlay for a selected natural-disaster event — deliberately
// reuses the same .health-detail-* shell as HealthCountryDetailPanel (same
// overlay slot, borders, glow, slide-in and RTL layout) so it reads as a
// native part of the dashboard. Content is disaster-specific: which places are
// hit and how long the incident is expected to last. This is NOT a traveler
// alert — no send-notification action here. Keeps the last-opened disaster
// rendered while closing so the slide-out doesn't blank mid-animation.
export default function DisasterDetailPanel({ disaster, onClose }: DisasterDetailPanelProps) {
  const [displayed, setDisplayed] = useState<NaturalDisaster | null>(null);
  const [ai, setAi] = useState<DisasterAnalysis | null>(null);

  useEffect(() => {
    if (!disaster) return;
    setDisplayed(disaster);
    setAi(heuristicDisaster(disaster)); // instant Arabic default…
    let cancelled = false;
    analyzeDisaster(disaster).then((r) => { if (!cancelled) setAi(r); }); // …upgraded by gpt-oss
    return () => { cancelled = true; };
  }, [disaster]);

  const isOpen = disaster !== null;
  const color = displayed ? ND_RISK_COLOR[displayed.risk] : 'var(--text-muted)';
  const TypeIcon = displayed ? TYPE_ICON[displayed.type] : Activity;

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
              <span className="health-detail-country">{displayed.country}</span>
              <span className="health-detail-code-badge">{displayed.countryCode}</span>
            </div>

            <div className="health-detail-disease-block">
              <div className="health-detail-disease-name">
                <TypeIcon size={13} style={{ verticalAlign: '-2px', marginInlineEnd: 5, color }} />
                {ND_TYPE_LABEL_AR[displayed.type]}{displayed.value ? ` · ${displayed.value}` : ''}
              </div>
              <div className="health-detail-disease-definition">{displayed.title}</div>
            </div>

            {/* تحليل الوضع — تحليل gpt-oss مبني على بيانات المصدر الحقيقية */}
            <div className="health-detail-section">
              <div className="health-detail-section-header">
                <span className="health-detail-risk-pill" style={{ borderColor: color, color }}>
                  الخطورة · {ND_RISK_LABEL_AR[displayed.risk]}
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
              {ai?.aiSummary && <div className="dz-detail-summary"><Sparkles size={10} /> {ai.aiSummary}</div>}
            </div>

            {/* الأماكن المتضررة — only when the source provides a region/places */}
            {(displayed.city || (displayed.affectedPlaces && displayed.affectedPlaces.length > 0)) && (
              <div className="health-detail-section">
                <div className="health-detail-section-title-standalone">الأماكن المتضررة</div>
                {displayed.city && (
                  <div className="dz-detail-region">
                    <MapPin size={11} style={{ color, flexShrink: 0 }} />
                    <span>المنطقة المتأثرة: <strong>{displayed.city}</strong></span>
                  </div>
                )}
                {displayed.affectedPlaces && displayed.affectedPlaces.length > 0 && (
                  <div className="dz-place-chips">
                    {displayed.affectedPlaces.map((place) => (
                      <span key={place} className="dz-place-chip">{place}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* المدة المتوقعة — only if the source provides it (these APIs don't) */}
            {displayed.expectedDuration && (
              <div className="health-detail-section">
                <div className="health-detail-section-title-standalone">المدة المتوقعة</div>
                <div className="dz-detail-duration">
                  <Timer size={13} style={{ color, flexShrink: 0 }} />
                  <span>{displayed.expectedDuration}</span>
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
            </div>
          </>
        )}
      </div>
    </>
  );
}
