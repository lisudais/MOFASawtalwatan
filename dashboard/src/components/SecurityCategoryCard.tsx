import { useEffect, useState, useCallback } from 'react';
import { Share2, RefreshCw, Clock, AlertTriangle, Info } from 'lucide-react';
import {
  fetchSecurityFeed,
  scoreColor,
  THREAT_LABEL_AR,
  timeAgoAr,
  type SecurityProfile,
  type SecurityFeed,
} from '../services/security';

interface SecurityCategoryCardProps {
  onSelectSecurity: (p: SecurityProfile) => void;
}

function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const REFRESH_MS = 5 * 60 * 1000;

// Fills the التهديدات الأمنية slot in the alert-feed grid. Live per-country
// security scores computed on the backend from official sources, ordered by
// highest threat. Rows open the shared detail popup via onSelectSecurity.
export default function SecurityCategoryCard({ onSelectSecurity }: SecurityCategoryCardProps) {
  const [profiles, setProfiles] = useState<SecurityProfile[]>([]);
  const [statuses, setStatuses] = useState<SecurityFeed['statuses'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const feed = await fetchSecurityFeed();
      setProfiles(feed.profiles);
      setStatuses(feed.statuses);
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
    <div className="region-card security-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">{profiles.length}</span>
        <button className="region-icon-btn" disabled title="مشاركة"><Share2 size={13} /></button>
        <button className="region-icon-btn" onClick={load} disabled={loading} title="تحديث">
          <RefreshCw size={13} className={loading ? 'spin-icon' : undefined} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">التهديدات الأمنية</span>
        </div>
      </div>

      <div className="security-card-body">
        {loading && profiles.length === 0 ? (
          <div className="widget-empty-state">جارِ تحليل المؤشرات الأمنية…</div>
        ) : error && profiles.length === 0 ? (
          <div className="os-error-state">
            <AlertTriangle size={16} />
            <span>تعذّر الاتصال بالمصادر الأمنية.</span>
            <button className="os-retry-btn" onClick={load}>إعادة المحاولة</button>
          </div>
        ) : (
          <div className="sec-list">
            {/* Source-config warnings — the section still works on the other real
                sources; these only note which extra feeds are inactive. */}
            {statuses && !statuses.acled.configured && (
              <div className="sec-config-warning">
                <Info size={12} /> ACLED غير مُهيّأ. أضِف بيانات اعتماد ACLED لتفعيل بيانات أحداث النزاع.
              </div>
            )}
            {statuses && !statuses.reliefweb.configured && (
              <div className="sec-config-warning">
                <Info size={12} /> اسم تطبيق ReliefWeb مفقود. أضِف VITE_RELIEFWEB_APP_NAME لتفعيل بيانات ReliefWeb.
              </div>
            )}
            {profiles.map((p) => {
              const color = scoreColor(p.overall);
              return (
                <button key={p.id} type="button" className="sec-row" onClick={() => onSelectSecurity(p)}>
                  <div className="sec-row-top">
                    <span className="sec-flag">{flagEmoji(p.countryCode)}</span>
                    <span className="sec-country">{p.country}</span>
                    <span className="sec-level" style={{ color, borderColor: color, background: `${color}1A` }}>
                      {THREAT_LABEL_AR[p.level]}
                    </span>
                    <span className="sec-score mono-num" style={{ color }}>{p.overall}</span>
                  </div>
                  <div className="sec-bar-track">
                    <div className="sec-bar-fill" style={{ width: `${p.overall}%`, background: color }} />
                  </div>
                  <div className="sec-row-meta">
                    <span className="sec-time"><Clock size={9} /> {timeAgoAr(new Date(p.lastUpdated))}</span>
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
