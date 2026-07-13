import { useState, useEffect, useCallback, useMemo } from 'react';
import { Share2, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { type CountryHealthEntry } from '../services/healthAnalysis';
import { fetchHealthCountries } from '../services/healthFeed';
import { RISK_LEVEL_BAR_COLORS } from '../constants';
import {
  loadForecasts, loadForecastMeta, diseaseForecastByIso2, relativeRisk, bandFor,
  MODEL_BADGE_AR, type ResolvedForecast, type ForecastBand,
} from '../services/forecasting/forecastData';

// Outbreak-forecast trend semantics are inverted from the app's general TREND_COLOR
// (constants.ts): here RISING means the outbreak is getting worse, so it's red, and
// FALLING (improving) is green — the opposite of a generic "activity increasing" signal.
const FORECAST_TREND_ICON = { RISING: TrendingUp, FALLING: TrendingDown, STABLE: Minus };
const FORECAST_TREND_COLOR = { RISING: 'var(--danger-critical)', FALLING: 'var(--danger-low)', STABLE: 'var(--text-muted)' };

// Chronos-2 severity band → the project's existing severity palette (same reds/
// oranges/yellows used by the map's forecast layer, kept consistent here).
const BAND_COLOR: Record<ForecastBand, string> = {
  high: '#FF1744',    // red
  medium: '#FF6D00',  // orange
  low: '#FFD600',     // yellow
};

const REFRESH_MS = 10 * 60 * 1000;

interface HealthCategoryCardProps {
  onSelectCountry: (entry: CountryHealthEntry) => void;
  // Fired with the fresh list after every successful load — lets the parent
  // (App.tsx) fold real health-risk data into the sidebar's aggregate stats.
  onDataLoaded?: (countries: CountryHealthEntry[]) => void;
}

// Live global-health card. The ranked country list is fetched from real, keyless
// sources (WHO Disease Outbreak News + disease.sh). The "التوقعات الصحية الإقليمية"
// section below is driven ENTIRELY by the local Amazon Chronos-2 forecast output
// (services/forecasting/forecastData.ts → /data/forecasts.json), matched by
// event_type = disease. No mock/demo forecast values remain.
export default function HealthCategoryCard({ onSelectCountry, onDataLoaded }: HealthCategoryCardProps) {
  const [countries, setCountries] = useState<CountryHealthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [diseaseFc, setDiseaseFc] = useState<Record<string, ResolvedForecast>>({});
  const [fcGeneratedAt, setFcGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchHealthCountries();
      setCountries(data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chronos-2 disease forecasts — loaded once from the local file.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadForecasts(), loadForecastMeta()]).then(([list, meta]) => {
      if (cancelled) return;
      setDiseaseFc(diseaseForecastByIso2(list));
      setFcGeneratedAt(meta.generatedAtUtc);
    });
    return () => { cancelled = true; };
  }, []);

  // Regional forecast view = every Chronos-2 disease forecast, ranked by its peak
  // predicted value; percentages are relative-risk scores vs. the group's max.
  const forecastView = useMemo(() => {
    const items = Object.values(diseaseFc);
    if (items.length === 0) return null;
    const groupMax = Math.max(...items.map((f) => f.peak), 1);
    const rows = items
      .map((f) => ({ fc: f, relRisk: relativeRisk(f.peak, groupMax), band: bandFor(f.peak, groupMax) }))
      .sort((a, b) => b.fc.peak - a.fc.peak);
    return { rows };
  }, [diseaseFc]);

  const openForecastCountry = (iso2: string) => {
    const entry = countries.find((c) => c.countryCode === iso2);
    if (entry) onSelectCountry(entry);
  };

  return (
    <div className="region-card health-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">{countries.length}</span>
        <button className="region-icon-btn" disabled title="مشاركة"><Share2 size={13} /></button>
        <button className="region-icon-btn" onClick={load} disabled={loading} title="تحديث">
          <RefreshCw size={13} className={loading ? 'spin-icon' : undefined} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">الصحة</span>
        </div>
      </div>

      {loading && countries.length === 0 ? (
        <div className="health-card-body"><div className="widget-empty-state">جارِ جلب بيانات الصحة…</div></div>
      ) : error && countries.length === 0 ? (
        <div className="health-card-body">
          <div className="os-error-state">
            <AlertTriangle size={16} />
            <span>تعذّر الاتصال بمصادر الصحة.</span>
            <button className="os-retry-btn" onClick={load}>إعادة المحاولة</button>
          </div>
        </div>
      ) : (
        <div className="health-card-body health-card-body-list">
          <div className="health-country-list">
            {countries.map((entry) => {
              const dotColor = RISK_LEVEL_BAR_COLORS[entry.analysis.risk_level.category];
              const TrendIcon = FORECAST_TREND_ICON[entry.analysis.outbreak_forecast.trend];
              const trendColor = FORECAST_TREND_COLOR[entry.analysis.outbreak_forecast.trend];
              return (
                <button
                  key={`${entry.countryCode}-${entry.disease}`}
                  className="health-country-row"
                  onClick={() => onSelectCountry(entry)}
                >
                  <span className="health-country-dot" style={{ background: dotColor }} />
                  <span className="health-country-name">{entry.country}</span>
                  <span className="health-country-disease">{entry.disease}</span>
                  <span className="health-country-prob mono-num">
                    {entry.analysis.outbreak_forecast.probability}%
                  </span>
                  <TrendIcon size={10} style={{ color: trendColor, flexShrink: 0 }} />
                </button>
              );
            })}
          </div>

          {/* ── التوقعات الصحية الإقليمية — real Amazon Chronos-2 forecasts ── */}
          <div className="health-regional-forecast">
            <div className="health-regional-header">
              <span className="health-regional-title">التوقعات الصحية الإقليمية</span>
              <span className="health-regional-badge">{MODEL_BADGE_AR}</span>
              {fcGeneratedAt && (
                <span className="health-regional-timestamp mono-num">{fcGeneratedAt.slice(0, 10)}</span>
              )}
            </div>

            {!forecastView ? (
              <div className="widget-empty-state">لا توجد توقعات متاحة لهذه المنطقة</div>
            ) : (
              <>
                <div className="health-regional-heatmap">
                  {forecastView.rows.slice(0, 6).map((r) => (
                    <div key={r.fc.iso2} className="health-heatmap-cell" style={{ background: BAND_COLOR[r.band] }}>
                      <span className="health-heatmap-value mono-num">{r.relRisk}</span>
                      <span className="health-heatmap-metric-label">مؤشر خطر نسبي</span>
                      <span className="health-heatmap-label">{r.fc.countryAr}</span>
                    </div>
                  ))}
                </div>

                <div className="health-regional-stat">
                  <span className="mono-num">{forecastView.rows.length}</span>{' '}دولة ذات توقّع نشط · النموذج: Chronos-2
                </div>

                <div className="health-forecast-legend">
                  التوقّع للأسابيع الأربعة القادمة — القيمة المتوقعة (النطاق الأدنى–الأعلى)
                </div>

                <div className="health-watchlist">
                  {forecastView.rows.slice(0, 8).map((r) => {
                    const f = r.fc;
                    return (
                      <button key={f.iso2} className="health-prob-item" onClick={() => openForecastCountry(f.iso2)}>
                        <div className="health-prob-row">
                          <span className="health-prob-country">{f.countryAr}</span>
                          <div className="health-prob-bar-track">
                            <div className="health-prob-bar-fill" style={{ width: `${r.relRisk}%`, background: BAND_COLOR[r.band] }} />
                          </div>
                          <span className="health-prob-value mono-num" title="مؤشر خطر نسبي — نسبة إلى أعلى قيمة متوقعة في المجموعة">
                            {r.relRisk}%
                          </span>
                        </div>
                        <div className="health-forecast-weeks">
                          {f.forecast_dates.map((d, i) => (
                            <span className="health-fc-week" key={d}>
                              <span className="health-fc-date">{d.slice(5)}</span>
                              <span className="health-fc-count mono-num">{f.predicted_counts[i]}</span>
                              <span className="health-fc-range mono-num">{f.lower_bound[i]}–{f.upper_bound[i]}</span>
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
