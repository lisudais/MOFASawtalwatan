import { useEffect, useMemo, useState, useCallback } from 'react';
import { Share2, RefreshCw, Activity, Mountain, Wind, CloudRain, Flame, AlertTriangle, Globe } from 'lucide-react';
import {
  fetchNaturalDisasters,
  ND_TABS,
  ND_TYPE_LABEL_AR,
  ND_RISK_LABEL_AR,
  ND_RISK_COLOR,
  sortDisasters,
  type NDType,
  type NaturalDisaster,
} from '../services/naturalDisasters';

interface DisasterCategoryCardProps {
  onSelectDisaster: (d: NaturalDisaster) => void;
}

const TYPE_ICON: Record<NDType, React.ElementType> = {
  EARTHQUAKE: Activity,
  VOLCANO:    Mountain,
  STORM:      Wind,
  FLOOD:      CloudRain,
  WILDFIRE:   Flame,
};

// ISO 3166-1 alpha-2 → regional-indicator flag emoji (same trick used for 🇸🇦 elsewhere).
function flagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const REFRESH_MS = 5 * 60 * 1000;

// Fills the الكوارث الطبيعية slot in the alert-feed grid. Data is fetched LIVE
// from the real disaster APIs (USGS + EMSC + EONET + GDACS) — no mock data.
// Rows open the shared detail popup via onSelectDisaster.
export default function DisasterCategoryCard({ onSelectDisaster }: DisasterCategoryCardProps) {
  const [activeType, setActiveType] = useState<NDType | null>(null);
  const [disasters, setDisasters] = useState<NaturalDisaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchNaturalDisasters();
      if (data.length === 0) throw new Error('no data');
      setDisasters(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const visible = useMemo(() => {
    const filtered = activeType ? disasters.filter((d) => d.type === activeType) : disasters;
    return sortDisasters(filtered);
  }, [disasters, activeType]);

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
          {ND_TABS.map((tab) => (
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
              const Icon = TYPE_ICON[d.type];
              const color = ND_RISK_COLOR[d.risk];
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
                  <span className="dz-country">{d.country || 'غير محدّد'}</span>
                  <span className="dz-type"><Icon size={9} /> {ND_TYPE_LABEL_AR[d.type]}</span>
                  {d.value && <span className="dz-value mono-num">{d.value}</span>}
                  <span className="dz-risk" style={{ color, borderColor: color, background: `${color}1A` }}>
                    {ND_RISK_LABEL_AR[d.risk]}
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
