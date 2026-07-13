import { useState, useEffect, useCallback } from 'react';
import { Share2, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { type CountryHealthEntry } from '../services/healthAnalysis';
import { fetchHealthCountries } from '../services/healthFeed';
import { RISK_LEVEL_BAR_COLORS } from '../constants';
import OutbreakDetailCard from './OutbreakDetailCard';
import {
  loadOutbreakForecasts, loadOutbreakMeta, riskBandFor, TREND_AR, CONFIDENCE_AR,
  OUTBREAK_MODEL_AR, OFFICIAL_THRESHOLD,
  type ResolvedOutbreak, type OutbreakMeta,
} from '../services/forecasting/outbreakForecast';

// Live-health-list trend colours (this list is the WHO/disease.sh feed, separate
// from the ML outbreak forecast below).
const FORECAST_TREND_ICON = { RISING: TrendingUp, FALLING: TrendingDown, STABLE: Minus };
const FORECAST_TREND_COLOR = { RISING: 'var(--danger-critical)', FALLING: 'var(--danger-low)', STABLE: 'var(--text-muted)' };

const REFRESH_MS = 10 * 60 * 1000;
const TOP_N = 10;

interface HealthCategoryCardProps {
  onSelectCountry: (entry: CountryHealthEntry) => void;
  onDataLoaded?: (countries: CountryHealthEntry[]) => void;
}

// Global-health card. Top: the live ranked country list (WHO Disease Outbreak
// News + disease.sh). Bottom: the OUTBREAK FORECAST section, driven entirely by
// the local XGBoost outbreak classifier — probability of an outbreak in the next
// 4 weeks per country + disease. Display bands are base-rate-aware; the official
// 0.73 alert threshold is kept separate. Probabilities are shown, never rescaled.
export default function HealthCategoryCard({ onSelectCountry, onDataLoaded }: HealthCategoryCardProps) {
  const [countries, setCountries] = useState<CountryHealthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [outbreaks, setOutbreaks] = useState<ResolvedOutbreak[]>([]);
  const [fcMeta, setFcMeta] = useState<OutbreakMeta | null>(null);
  const [selected, setSelected] = useState<ResolvedOutbreak | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOutbreakForecasts(), loadOutbreakMeta()]).then(([list, meta]) => {
      if (cancelled) return;
      setOutbreaks(list);
      setFcMeta(meta);
    });
    return () => { cancelled = true; };
  }, []);

  const pct = (p: number) => Math.round(p * 100);
  // Bar shows proximity to the official 0.73 alert (visual only) — the % label is
  // always the real calibrated probability.
  const barW = (p: number) => Math.min(100, Math.round((p / OFFICIAL_THRESHOLD) * 100));
  const shown = showAll ? outbreaks : outbreaks.slice(0, TOP_N);

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

          {/* ── أعلى توقعات التفشي — XGBoost outbreak classifier ── */}
          <div className="health-regional-forecast">
            <div className="health-regional-header">
              <span className="health-regional-title">أعلى توقعات التفشي خلال 4 أسابيع</span>
              <span className="health-regional-badge">{OUTBREAK_MODEL_AR}</span>
            </div>

            {outbreaks.length === 0 ? (
              <div className="widget-empty-state">لا توجد توقعات متاحة</div>
            ) : (
              <>
                <div className="health-watchlist">
                  {shown.map((f) => (
                    <button
                      key={`${f.country}-${f.disease}`}
                      className="health-prob-item"
                      onClick={() => setSelected(f)}
                    >
                      <div className="health-prob-row">
                        <span className="outbreak-risk-dot" style={{ background: riskBandFor(f.probability).color }} />
                        <span className="health-prob-country">{f.countryAr} · {f.disease}</span>
                        <div className="health-prob-bar-track">
                          <div className="health-prob-bar-fill" style={{ width: `${barW(f.probability)}%`, background: riskBandFor(f.probability).color }} />
                        </div>
                        <span className="health-prob-value mono-num">{pct(f.probability)}%</span>
                      </div>
                      <div className="outbreak-meta">
                        <span className="outbreak-risk-chip" style={{ color: riskBandFor(f.probability).color, borderColor: riskBandFor(f.probability).color }}>
                          {riskBandFor(f.probability).ar}
                        </span>
                        <span>{f.probability_vs_base_rate_ratio}× المعدل الأساسي</span>
                        <span>الاتجاه: {TREND_AR[f.trend]}</span>
                        <span>الثقة: {CONFIDENCE_AR[f.confidence]}</span>
                      </div>
                      <div className="outbreak-expl">{f.base_rate_comparison_ar}</div>
                    </button>
                  ))}
                </div>

                {outbreaks.length > TOP_N && (
                  <button type="button" className="outbreak-viewall" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'عرض أعلى 10 فقط' : `عرض كل التوقعات (${outbreaks.length})`}
                  </button>
                )}

                {fcMeta?.display_note_ar && (
                  <div className="outbreak-note">{fcMeta.display_note_ar}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {selected && <OutbreakDetailCard f={selected} meta={fcMeta} onClose={() => setSelected(null)} />}
    </div>
  );
}
