import { useEffect, useState, useCallback } from 'react';
import { Share2, RefreshCw, TrendingUp, TrendingDown, Clock, AlertTriangle } from 'lucide-react';
import PriceSparkline from './charts/PriceSparkline';
import { getEconomicIndicators, type EconomicIndicator } from '../services/economy';

interface EconomyCategoryCardProps {
  onSelectIndicator: (ind: EconomicIndicator) => void;
}

const UP_COLOR = '#00E676';   // --danger-low
const DOWN_COLOR = '#FF6D00'; // --danger-high (orange, less alarming than critical red)

function timeAgoAr(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

function fmtValue(v: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: v < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

const REFRESH_MS = 4 * 60 * 60 * 1000; // 4h — matches the service cache / AV limit

// Fills the التغيرات الاقتصادية slot. Live data from Alpha Vantage (primary,
// oil/gas/gold/USD-SAR) with automatic World Bank fallback (keyless macro
// indicators). No mock: on total failure it shows the shared error state.
export default function EconomyCategoryCard({ onSelectIndicator }: EconomyCategoryCardProps) {
  const [indicators, setIndicators] = useState<EconomicIndicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setIndicators(await getEconomicIndicators());
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

  return (
    <div className="region-card economy-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">{indicators.length}</span>
        <button className="region-icon-btn" disabled title="مشاركة"><Share2 size={13} /></button>
        <button className="region-icon-btn" onClick={load} disabled={loading} title="تحديث">
          <RefreshCw size={13} className={loading ? 'spin-icon' : undefined} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">التغيرات الاقتصادية</span>
        </div>
      </div>

      <div className="economy-card-body">
        {loading && indicators.length === 0 ? (
          <div className="widget-empty-state">جارِ جلب المؤشرات الاقتصادية…</div>
        ) : error && indicators.length === 0 ? (
          <div className="os-error-state">
            <AlertTriangle size={16} />
            <span>البيانات الاقتصادية غير متاحة حاليًا — تعذّر جلبها من المصدر الحقيقي.</span>
            <button className="os-retry-btn" onClick={load}>إعادة المحاولة</button>
          </div>
        ) : (
          indicators.map((ind) => {
            const up = ind.changePercent >= 0;
            const color = up ? UP_COLOR : DOWN_COLOR;
            const Arrow = up ? TrendingUp : TrendingDown;
            return (
              <button type="button" className="eco-block" key={ind.key} onClick={() => onSelectIndicator(ind)}>
                <div className="eco-block-head">
                  <span className="eco-name">{ind.nameAr}</span>
                  <span className="eco-unit">{ind.unit}</span>
                  <span className="eco-delta" style={{ color }}>
                    <Arrow size={11} />
                    {up ? '+' : ''}{ind.changePercent.toFixed(2)}{ind.unit === '%' ? '' : '%'}
                  </span>
                </div>

                <div className="eco-block-main">
                  <span className="eco-value mono-num">{fmtValue(ind.value)}</span>
                  <div className="eco-spark">
                    <PriceSparkline values={ind.trend} color={color} />
                  </div>
                </div>

                <div className="eco-updated">
                  <Clock size={9} /> المصدر: {ind.source} · آخر تحديث {timeAgoAr(new Date(ind.updatedAt))}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
