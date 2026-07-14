import { useEffect, useMemo, useState, useCallback } from 'react';
import { Share2, RefreshCw, Activity, Mountain, Wind, CloudRain, Flame, AlertTriangle, Globe } from 'lucide-react';
import {
  fetchDisasterEvents,
  DISASTER_TYPE_LABEL_AR,
  SEVERITY_LABEL_AR,
  SEVERITY_COLOR,
  disasterPlaceAr,
  type DisasterType,
  type DisasterEvent,
} from '../services/naturalDisasterFeed';

interface DisasterCategoryCardProps {
  onSelectDisaster: (d: DisasterEvent) => void;
  /** Read-only mirror of the latest load — lets the dashboard roll the live
   *  disaster events into the aggregated right-column feed without a second fetch. */
  onDataLoaded?: (events: DisasterEvent[]) => void;
}

const TYPE_ICON: Record<DisasterType, React.ElementType> = {
  EARTHQUAKE: Activity,
  VOLCANO:    Mountain,
  HURRICANE:  Wind,
  FLOOD:      CloudRain,
  WILDFIRE:   Flame,
};

const TABS: { key: string; label: string; type: DisasterType | null }[] = [
  { key: 'ALL',        label: 'الكل',      type: null },
  { key: 'EARTHQUAKE', label: 'الزلازل',   type: 'EARTHQUAKE' },
  { key: 'VOLCANO',    label: 'البراكين',  type: 'VOLCANO' },
  { key: 'HURRICANE',  label: 'الأعاصير',  type: 'HURRICANE' },
  { key: 'FLOOD',      label: 'الأمطار',   type: 'FLOOD' },
  { key: 'WILDFIRE',   label: 'الحرائق',   type: 'WILDFIRE' },
];

// ISO 3166-1 alpha-2 → regional-indicator flag emoji (same trick used for 🇸🇦 elsewhere).
function flagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Pull a human-readable magnitude out of the title when present (earthquakes).
function parseMagnitude(title: string): string | undefined {
  const m = title.match(/\bM\s?(\d+(?:\.\d+)?)/i);
  return m ? `M ${m[1]}` : undefined;
}

const REFRESH_MS = 5 * 60 * 1000;

// Fills the الكوارث الطبيعية slot in the alert-feed grid. Data is fetched LIVE
// from real disaster APIs — USGS + EMSC (earthquakes), Smithsonian GVP + GDACS
// (volcanoes), NOAA NHC + GDACS/JTWC (hurricanes), GDACS/GLOFAS + EONET (floods),
// GDACS/GWIS + EONET (wildfires). No mock data. Rows open the shared detail
// popup via onSelectDisaster.
export default function DisasterCategoryCard({ onSelectDisaster, onDataLoaded }: DisasterCategoryCardProps) {
  const [activeType, setActiveType] = useState<DisasterType | null>(null);
  const [disasters, setDisasters] = useState<DisasterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchDisasterEvents();
      if (data.length === 0) throw new Error('no data');
      setDisasters(data);
      onDataLoaded?.(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [onDataLoaded]);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const visible = useMemo(
    () => (activeType ? disasters.filter((d) => d.disasterType === activeType) : disasters),
    [disasters, activeType]
  );

  return (
    <div className="region-card disaster-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">{disasters.length}</span>
        <button className="region-icon-btn" disabled title="مشاركة"><Share2 size={13} /></button>
        <button className="region-icon-btn" onClick={load} disabled={loading} title="تحديث">
          <RefreshCw size={13} className={loading ? 'spin-icon' : undefined} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">الكوارث الطبيعية</span>
        </div>
      </div>

      <div className="disaster-card-body">
        <div className="dz-filter" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={(tab.type ?? null) === activeType}
              className={`dz-chip${(tab.type ?? null) === activeType ? ' active' : ''}`}
              onClick={() => setActiveType(tab.type)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && disasters.length === 0 ? (
          <div className="widget-empty-state">جارِ جلب بيانات الكوارث…</div>
        ) : error && disasters.length === 0 ? (
          <div className="os-error-state">
            <AlertTriangle size={16} />
            <span>تعذّر الاتصال بمصادر الكوارث.</span>
            <button className="os-retry-btn" onClick={load}>إعادة المحاولة</button>
          </div>
        ) : (
          <div className="dz-list">
            {visible.map((d) => {
              const Icon = TYPE_ICON[d.disasterType];
              const color = SEVERITY_COLOR[d.severity];
              const magnitude = d.disasterType === 'EARTHQUAKE' ? parseMagnitude(d.title) : undefined;
              return (
                <button
                  key={d.id}
                  type="button"
                  className="dz-row"
                  style={{ borderInlineStartColor: color }}
                  title={d.title}
                  onClick={() => onSelectDisaster(d)}
                >
                  {d.countryCode.length === 2
                    ? <span className="dz-flag">{flagEmoji(d.countryCode)}</span>
                    : <Globe size={12} className="dz-flag-icon" />}
                  <span className="dz-country">{disasterPlaceAr(d) || d.title}</span>
                  <span className="dz-type"><Icon size={9} /> {DISASTER_TYPE_LABEL_AR[d.disasterType]}</span>
                  {magnitude && <span className="dz-value mono-num">{magnitude}</span>}
                  <span className="dz-risk" style={{ color, borderColor: color, background: `${color}1A` }}>
                    {SEVERITY_LABEL_AR[d.severity]}
                  </span>
                </button>
              );
            })}

            {visible.length === 0 && (
              <div className="widget-empty-state">لا توجد كوارث نشطة ضمن هذا التصنيف حالياً.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
