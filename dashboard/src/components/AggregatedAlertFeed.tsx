import { useMemo } from 'react';
import {
  Radar, Zap, AlertTriangle, ChevronLeft, MapPin, Clock,
  HeartPulse, Crosshair, TrendingUp, TrendingDown, Activity, Mountain, Wind, CloudRain, Flame,
} from 'lucide-react';
import { classifyRiskByScore } from '../services/riskClassification';
import { useReverseGeocodedAlerts } from '../services/feed/reverseGeocode';
import type { AggregatedAlert, AlertCategory } from '../services/feed/aggregateAlerts';
import type { DisasterType } from '../services/naturalDisasterFeed';

interface AggregatedAlertFeedProps {
  alerts: AggregatedAlert[];
  loading: boolean;
  selectedId: string | null;
  onSelectAlert: (alert: AggregatedAlert) => void;
  titleAr?: string;
}

// Severity colour + word come from the app-wide central classifier — the SAME one
// each left-column source card uses — so a score reads identically on both sides.
const scoreColor = (score: number): string => classifyRiskByScore(score).color;
const severityWord = (score: number): string => classifyRiskByScore(score).labelAr;

const CATEGORY_AR: Record<AlertCategory, string> = {
  health: 'صحي',
  natural_disaster: 'كارثة طبيعية',
  security: 'أمني',
  economic: 'اقتصادي',
};

const DISASTER_ICON: Record<DisasterType, React.ElementType> = {
  EARTHQUAKE: Activity,
  VOLCANO: Mountain,
  HURRICANE: Wind,
  FLOOD: CloudRain,
  WILDFIRE: Flame,
};

function iconFor(alert: AggregatedAlert): React.ElementType {
  switch (alert.ref.kind) {
    case 'health': return HeartPulse;
    case 'security': return Crosshair;
    case 'economic': return alert.ref.indicator.changePercent >= 0 ? TrendingUp : TrendingDown;
    case 'natural_disaster': return DISASTER_ICON[alert.ref.event.disasterType] ?? AlertTriangle;
  }
}

/** Arabic relative time with correct number/noun agreement. */
function timeAgoAr(iso: string | null): string {
  if (!iso) return 'غير متاح';
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  function unit(n: number, one: string, two: string, few: string, many: string): string {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }
  if (mins < 60) return `منذ ${unit(mins, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${unit(hrs, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const days = Math.floor(hrs / 24);
  return `منذ ${unit(days, 'يوم', 'يومين', 'أيام', 'يوم')}`;
}

// Right column of the dashboard. A LIVE roll-up of the four left sections
// (health / natural disasters / security / economy), ranked by real risk score
// across all of them and capped to the most severe. Same scores, same colours,
// same detail panels as the left cards — this is a summary of them, not a
// separate feed. See services/feed/aggregateAlerts.ts.
export default function AggregatedAlertFeed({
  alerts, loading, selectedId, onSelectAlert, titleAr = 'التنبيهات العالمية',
}: AggregatedAlertFeedProps) {
  // Upgrade coordinate-only disaster locations to real country names as they resolve.
  const enriched = useReverseGeocodedAlerts(alerts);

  const empty = !loading && enriched.length === 0;

  return (
    <div className="panel alert-feed alert-feed-rtl">
      <div className="panel-header" dir="rtl">
        <Radar size={14} />
        <span className="feed-header-title-ar">{titleAr}</span>
        <span className="panel-badge">{enriched.length}</span>
      </div>

      <div className="feed-list case-detail-scrollable">
        {loading && enriched.length === 0 && (
          <div className="widget-empty-state">جارٍ تجميع التنبيهات من الأقسام…</div>
        )}
        {empty && (
          <div className="widget-empty-state">لا توجد تنبيهات متاحة حاليًا.</div>
        )}

        {enriched.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            selected={selectedId === alert.id}
            onSelect={() => onSelectAlert(alert)}
          />
        ))}
      </div>
    </div>
  );
}

interface AlertRowProps {
  alert: AggregatedAlert;
  selected: boolean;
  onSelect: () => void;
}

function AlertRow({ alert, selected, onSelect }: AlertRowProps) {
  const color = useMemo(() => scoreColor(alert.score), [alert.score]);
  const Icon = iconFor(alert);

  return (
    <div className="feed-group">
      <div
        dir="rtl"
        className={`feed-item${selected ? ' selected' : ''}`}
        style={{ borderLeftColor: color }}
        onClick={onSelect}
      >
        <div className="feed-icon-wrap" style={{ color }}>
          <Icon size={16} />
        </div>

        <div className="feed-body">
          {/* location (real country/city/coords) + source category */}
          <div className="feed-title">
            {alert.location}
            <span className="feed-eventtype"> · {CATEGORY_AR[alert.category]}</span>
          </div>

          {/* short event description */}
          <div className="feed-summary">{alert.title}</div>

          {/* place · source */}
          <div className="feed-meta">
            <span className="feed-country">
              <MapPin size={9} /> {alert.location}
            </span>
            <span className="feed-source" dir="ltr">{alert.sourceLabel}</span>
          </div>

          {/* severity badge + score bar + number — same classifier as the source card */}
          <div className="feed-score-row">
            <span
              className="risk-badge"
              style={{ background: color + '22', color, border: `1px solid ${color}` }}
            >
              {alert.score >= 76 && <Zap size={9} />}
              {severityWord(alert.score)}
            </span>
            <div className="score-bar">
              <div className="score-fill" style={{ width: `${alert.score}%`, background: color }} />
            </div>
            <span className="score-num" style={{ color }}>{alert.score}</span>
          </div>

          {/* detail · time · link */}
          <div className="feed-meta">
            <span className="feed-tag">{alert.detail}</span>
            <span className="feed-time">
              <Clock size={9} />
              {timeAgoAr(alert.occurredAt)}
            </span>
          </div>
        </div>

        {alert.score >= 76 ? (
          <div className="critical-indicator">
            <AlertTriangle size={14} color="#FF1744" />
          </div>
        ) : (
          <ChevronLeft size={14} className="feed-chevron" />
        )}
      </div>
    </div>
  );
}
