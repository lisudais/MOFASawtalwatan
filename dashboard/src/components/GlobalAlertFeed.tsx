import { useEffect, useRef } from 'react';
import type { GeoEvent, RiskLevel } from '../types';
import { RISK_COLORS, TYPE_ICON, TYPE_LABEL_AR } from '../constants';
import { Radar, Zap, AlertTriangle, ChevronLeft, MapPin, Clock } from 'lucide-react';

interface GlobalAlertFeedProps {
  events: GeoEvent[];
  /** Right-sidebar-only selection — never shared with the left sidebar's state. */
  selectedAlert: GeoEvent | null;
  onSelectAlert: (e: GeoEvent) => void;
}

const PRIORITY: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, SAFE: 4 };

// Short Arabic severity words for this feed's compact badge (distinct from the
// longer RISK_LABEL_AR used elsewhere in the dashboard, which stays untouched).
const SEVERITY_LABEL_AR: Record<RiskLevel, string> = {
  CRITICAL: 'حرج',
  HIGH: 'مرتفع',
  MEDIUM: 'متوسط',
  LOW: 'منخفض',
  SAFE: 'آمن',
};

// Arabic place names for countries/regions that show up in the live feeds.
// Falls back to the raw English string when a place isn't in this list, so
// unknown live-feed locations still render (just not translated).
const PLACE_NAME_AR: Record<string, string> = {
  'Saudi Arabia': 'المملكة العربية السعودية',
  'Sudan': 'السودان',
  'Mali': 'مالي',
  'Ethiopia': 'إثيوبيا',
  'Pakistan': 'باكستان',
  'DR Congo': 'الكونغو الديمقراطية',
  'Vietnam': 'فيتنام',
  'Bangladesh': 'بنغلاديش',
  'New Zealand': 'نيوزيلندا',
  'Greece': 'اليونان',
  'Reykjanes Ridge': 'ريكيانس ريدج',
};

const EARTHQUAKE_TITLE_RE = /^M([\d.]+)\s+Earthquake\s*[—-]\s*(.+)$/i;

function isArabicText(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

function arabicPlace(event: GeoEvent): string {
  if (PLACE_NAME_AR[event.country]) return PLACE_NAME_AR[event.country];
  for (const [en, ar] of Object.entries(PLACE_NAME_AR)) {
    if (event.country.includes(en) || event.title.includes(en)) return ar;
  }
  return event.country;
}

function arabicTitle(event: GeoEvent): string {
  if (isArabicText(event.title)) return event.title;

  const eqMatch = event.title.match(EARTHQUAKE_TITLE_RE);
  if (eqMatch) {
    const [, mag, place] = eqMatch;
    return `زلزال بقوة ${mag} في ${PLACE_NAME_AR[place] ?? place}`;
  }

  return `${TYPE_LABEL_AR[event.type]} — ${arabicPlace(event)}`;
}

// Arabic relative time with correct number/noun agreement
// (دقيقة/دقيقتين/دقائق, ساعة/ساعتين/ساعات, يوم/يومين/أيام).
function timeAgoAr(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));

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

// Right column of the dashboard. Renders the real GeoEvent feed (GDACS / USGS /
// EONET / EMSC) as clickable severity-ranked cards; clicking one selects it and
// opens the right-side details overlay (see AlertDetailsPanel.tsx). The selected
// state lives in its own App-level state, independent of the left sidebar.
export default function GlobalAlertFeed({ events, selectedAlert, onSelectAlert }: GlobalAlertFeedProps) {
  const sorted = [...events].sort(
    (a, b) => PRIORITY[a.riskLevel] - PRIORITY[b.riskLevel] || b.timestamp.getTime() - a.timestamp.getTime()
  );

  // Keyed by event.id — the same stable identity the map markers and the
  // details panel use. Lets a marker click reveal its matching card.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!selectedAlert) return;
    rowRefs.current.get(selectedAlert.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedAlert]);

  return (
    <div className="panel alert-feed alert-feed-rtl">
      <div className="panel-header" dir="rtl">
        <Radar size={14} />
        <span className="feed-header-title-ar">التنبيهات العالمية</span>
        <span className="feed-header-title-en">GLOBAL ALERT FEED</span>
        <span className="panel-badge">{events.length}</span>
      </div>

      <div className="feed-list">
        {sorted.map((event) => {
          const color = RISK_COLORS[event.riskLevel];
          const isSelected = selectedAlert?.id === event.id;
          const Icon = TYPE_ICON[event.type] ?? AlertTriangle;
          const place = arabicPlace(event);

          return (
            <div
              key={event.id}
              ref={(el) => {
                if (el) rowRefs.current.set(event.id, el);
                else rowRefs.current.delete(event.id);
              }}
              dir="rtl"
              className={`feed-item${isSelected ? ' selected' : ''}`}
              style={{ borderLeftColor: color }}
              onClick={() => onSelectAlert(event)}
            >
              <div className="feed-icon-wrap" style={{ color }}>
                <Icon size={16} />
              </div>
              <div className="feed-body">
                <div className="feed-title">{arabicTitle(event)}</div>
                <div className="feed-meta">
                  {place && (
                    <span className="feed-country">
                      <MapPin size={9} /> {place}
                    </span>
                  )}
                  <span className="feed-source" dir="ltr">{event.source}</span>
                  <span className="feed-time">
                    <Clock size={9} />
                    {timeAgoAr(event.timestamp)}
                  </span>
                </div>
                <div className="feed-score-row">
                  <span className="risk-badge" style={{ background: color + '22', color, border: `1px solid ${color}` }}>
                    {event.riskLevel === 'CRITICAL' && <Zap size={9} />}
                    {SEVERITY_LABEL_AR[event.riskLevel]}
                  </span>
                  <div className="score-bar">
                    <div className="score-fill" style={{ width: `${event.score}%`, background: color }} />
                  </div>
                  <span className="score-num" style={{ color }}>{event.score}</span>
                </div>
              </div>
              {event.riskLevel === 'CRITICAL' ? (
                <div className="critical-indicator">
                  <AlertTriangle size={14} color="#FF1744" />
                </div>
              ) : (
                <ChevronLeft size={14} className="feed-chevron" />
              )}
            </div>
          );
        })}

        {events.length === 0 && (
          <div className="widget-empty-state">لا توجد تنبيهات متاحة حاليًا.</div>
        )}
      </div>
    </div>
  );
}
