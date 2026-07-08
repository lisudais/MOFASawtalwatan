import { useState, useEffect, useCallback } from 'react';
import { Share2, RefreshCw, TrendingUp, TrendingDown, Minus, Siren, AlertTriangle } from 'lucide-react';
import {
  computeRegionalForecast,
  HEALTH_REGION_LABEL_AR,
  type CountryHealthEntry,
  type Trend,
} from '../services/healthAnalysis';
import { fetchHealthCountries } from '../services/healthFeed';
import { RISK_LEVEL_BAR_COLORS } from '../constants';

// Outbreak-forecast trend semantics are inverted from the app's general TREND_COLOR
// (constants.ts): here RISING means the outbreak is getting worse, so it's red, and
// FALLING (improving) is green — the opposite of a generic "activity increasing" signal.
const FORECAST_TREND_ICON = { RISING: TrendingUp, FALLING: TrendingDown, STABLE: Minus };
const FORECAST_TREND_COLOR = { RISING: 'var(--danger-critical)', FALLING: 'var(--danger-low)', STABLE: 'var(--text-muted)' };

const TIMELINE_COLORS: Record<Trend, [string, string, string]> = {
  RISING: ['var(--text-muted)', 'var(--danger-medium)', 'var(--danger-critical)'],
  FALLING: ['var(--text-muted)', 'var(--danger-low)', 'var(--danger-low)'],
  STABLE: ['var(--text-muted)', 'var(--text-muted)', 'var(--text-muted)'],
};

function heatColor(avgRiskScore: number): string {
  if (avgRiskScore >= 75) return RISK_LEVEL_BAR_COLORS.CRITICAL;
  if (avgRiskScore >= 50) return RISK_LEVEL_BAR_COLORS.HIGH;
  if (avgRiskScore >= 25) return RISK_LEVEL_BAR_COLORS.MEDIUM;
  return RISK_LEVEL_BAR_COLORS.LOW;
}

const REFRESH_MS = 10 * 60 * 1000;

interface HealthCategoryCardProps {
  onSelectCountry: (entry: CountryHealthEntry) => void;
}

// Live global-health card. Data is fetched from real, keyless sources
// (WHO Disease Outbreak News + disease.sh) — see services/healthFeed.ts. The
// ranked country list + regional predictive rollup are rendered from it. The
// detail panel is opened by the parent (App.tsx) via onSelectCountry.
export default function HealthCategoryCard({ onSelectCountry }: HealthCategoryCardProps) {
  const [countries, setCountries] = useState<CountryHealthEntry[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchHealthCountries();
      setCountries(data);
      setGeneratedAt(new Date());
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

  const anyTriggered = countries.some((c) => c.analysis.early_warning.triggered);
  const regional = countries.length > 0 ? computeRegionalForecast(countries) : null;

  return (
    <div className="region-card health-card">
      <div className="region-accent-bar" />

      {anyTriggered && (
        <div className="health-early-warning-badge" title="تنبيه مبكر نشط لإحدى الدول">
          <Siren size={9} />
        </div>
      )}

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

          {regional && (
            <div className="health-regional-forecast">
              <div className="health-regional-header">
                <span className="health-regional-title">التوقعات الصحية الإقليمية</span>
                <span className="health-regional-badge">تحليل تنبؤي</span>
                {generatedAt && (
                  <span className="health-regional-timestamp mono-num">
                    {generatedAt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              <div className="health-regional-heatmap">
                {regional.heatmap.map((r) => (
                  <div key={r.region} className="health-heatmap-cell" style={{ background: heatColor(r.avgRiskScore) }}>
                    <span className="health-heatmap-value mono-num">{r.avgRiskScore}</span>
                    <span className="health-heatmap-metric-label">مؤشر الخطر</span>
                    <span className="health-heatmap-label">{HEALTH_REGION_LABEL_AR[r.region]}</span>
                  </div>
                ))}
              </div>

              <div className="health-regional-stat">
                <span className="mono-num">{regional.risingRegionCount}</span>
                {' '}من {regional.regionCount} مناطق في تصاعد
              </div>

              <div className="health-regional-forecast-line">
                احتمالية ارتفاع الإصابات في <strong>{HEALTH_REGION_LABEL_AR[regional.topRegion]}</strong>
                {' '}خلال الأسبوع القادم: <span className="mono-num">{regional.topRegionProbability}%</span>
              </div>

              <div className="health-watchlist">
                {regional.watchList.map((w) => {
                  const [c0, c7, c14] = TIMELINE_COLORS[w.trend];
                  return (
                    <button
                      key={w.countryCode || w.country}
                      className="health-prob-item"
                      onClick={() => {
                        const entry = countries.find((c) => c.countryCode === w.countryCode && c.country === w.country);
                        if (entry) onSelectCountry(entry);
                      }}
                    >
                      <div className="health-prob-row">
                        <span className="health-prob-country">{w.country}</span>
                        <div className="health-prob-bar-track">
                          <div className="health-prob-bar-fill" style={{ width: `${w.probability}%` }} />
                        </div>
                        <span className="health-prob-value mono-num">{w.probability}%</span>
                      </div>
                      <div className="health-mini-timeline">
                        <span className="health-mini-timeline-line" style={{ background: `linear-gradient(90deg, ${c0}, ${c7}, ${c14})` }} />
                        <span className="health-mini-timeline-dot" style={{ insetInlineStart: '0%', background: c0 }} />
                        <span className="health-mini-timeline-dot" style={{ insetInlineStart: '50%', background: c7 }} />
                        <span className="health-mini-timeline-dot" style={{ insetInlineStart: '100%', background: c14 }} />
                        <span className="health-mini-timeline-label" style={{ insetInlineStart: '0%' }}>الآن</span>
                        <span className="health-mini-timeline-label health-mini-timeline-label-mid" style={{ insetInlineStart: '50%' }}>+7 أيام</span>
                        <span className="health-mini-timeline-label health-mini-timeline-label-end" style={{ insetInlineStart: '100%' }}>+14 يوم</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
