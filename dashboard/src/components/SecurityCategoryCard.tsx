import { useEffect, useState, useCallback } from 'react';
import { Share2, RefreshCw, Clock, AlertTriangle, Radio } from 'lucide-react';
import {
  fetchSecurityFeed,
  scoreColor,
  RISK_LABEL_AR,
  timeAgoAr,
  type CountrySecurityProfile,
} from '../services/security';

interface SecurityCategoryCardProps {
  onSelectSecurity: (p: CountrySecurityProfile) => void;
  // Fired with the fresh list after every successful load (initial, manual,
  // and auto-refresh) — lets the parent keep an already-open detail panel's
  // country in sync with the latest data instead of freezing on the
  // snapshot it was opened with.
  onDataLoaded?: (countries: CountrySecurityProfile[]) => void;
}

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const REFRESH_MS = 10 * 60 * 1000;

// Fills the التهديدات الأمنية slot in the alert-feed grid. Live per-country
// risk scores computed server-side from ACLED — the ONLY data source
// (netlify/lib/securityCore.mjs) — ordered by highest risk. Rows open the
// shared detail popup via onSelectSecurity.
//
// Error handling: production always shows only the fixed unavailable
// message below — this is an MFA decision-support tool and a raw
// exception/HTTP status is never appropriate for the end user. The raw
// exception is still always console.error'd (never hidden) so it's visible
// while developing.
export default function SecurityCategoryCard({ onSelectSecurity, onDataLoaded }: SecurityCategoryCardProps) {
  const [countries, setCountries] = useState<CountrySecurityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // `force` bypasses the client-side cache (services/security.ts) — used for
  // the manual refresh button and the auto-refresh timer, both of which
  // should always hit the network; the initial mount load doesn't need to,
  // since the cache starts empty anyway.
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchSecurityFeed(force);
      setCountries(data);
      onDataLoaded?.(data);
    } catch (err) {
      console.error('[SecurityThreats] first attempt failed:', err);
      // One automatic retry before surfacing the unavailable state.
      try {
        const data = await fetchSecurityFeed(true);
        setCountries(data);
        onDataLoaded?.(data);
      } catch (err2) {
        console.error('[SecurityThreats] retry failed:', err2);
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [onDataLoaded]);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="region-card security-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">{countries.length}</span>
        <button className="region-icon-btn" disabled title="مشاركة"><Share2 size={13} /></button>
        <button className="region-icon-btn" onClick={() => load(true)} disabled={loading} title="تحديث">
          <RefreshCw size={13} className={loading ? 'spin-icon' : undefined} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">التهديدات الأمنية</span>
        </div>
      </div>

      <div className="security-card-body">
        {loading && countries.length === 0 ? (
          <div className="sec-skeleton" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="sec-skeleton-row">
                <span className="sec-skeleton-flag" />
                <span className="sec-skeleton-line" />
                <span className="sec-skeleton-score" />
              </div>
            ))}
          </div>
        ) : error && countries.length === 0 ? (
          <div className="os-error-state">
            <AlertTriangle size={16} />
            <span>تعذر تحميل بيانات التهديدات الأمنية حالياً</span>
            <button className="os-retry-btn" onClick={() => load(true)}>إعادة المحاولة</button>
          </div>
        ) : countries.length === 0 ? (
          <div className="widget-empty-state">لا توجد تهديدات أمنية نشطة حالياً</div>
        ) : (
          <div className="sec-list">
            {countries.map((p) => {
              const color = scoreColor(p.riskScore);
              return (
                <button key={p.id} type="button" className="sec-row" onClick={() => onSelectSecurity(p)}>
                  <div className="sec-row-top">
                    <span className="sec-flag">{flagEmoji(p.countryCode)}</span>
                    <span className="sec-country" title={p.country}>{p.country}</span>
                    <span className="sec-iso mono-num">{p.countryCode}</span>
                    <span className="sec-level" style={{ color, borderColor: color, background: `${color}1A` }}>
                      {RISK_LABEL_AR[p.riskLevel]}
                    </span>
                    <span className="sec-score mono-num" style={{ color }}>{p.riskScore}</span>
                  </div>
                  <div className="sec-bar-track">
                    <div className="sec-bar-fill" style={{ width: `${p.riskScore}%`, background: color }} />
                  </div>
                  <div className="sec-row-meta">
                    <span className="sec-incidents"><Radio size={9} /> {p.activeIncidents} حدث نشط</span>
                    <span className="sec-time"><Clock size={9} /> {timeAgoAr(new Date(p.latestUpdate))}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
