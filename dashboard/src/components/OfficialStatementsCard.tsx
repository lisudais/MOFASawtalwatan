import { useEffect, useState, useCallback } from 'react';
import { Share2, RefreshCw, Landmark, Clock, AlertTriangle } from 'lucide-react';
import {
  OS_TABS,
  OS_URGENCY_LABEL_AR,
  OS_URGENCY_COLOR,
  OS_CATEGORY_LABEL_AR,
  sortStatements,
  timeAgoAr,
  type OSCategory,
  type OfficialStatement,
} from '../services/officialStatements';
import { fetchOfficialStatements } from '../services/statementsFeed';

interface OfficialStatementsCardProps {
  onSelectStatement: (s: OfficialStatement) => void;
}

// ISO 3166-1 alpha-2 → regional-indicator flag emoji (same trick used for 🇸🇦 elsewhere).
function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const REFRESH_MS = 10 * 60 * 1000; // periodic refresh every 10 minutes

// Fills the التصريحات الرسمية للدول slot in the alert-feed grid. Data is fetched
// LIVE from trusted sources (ReliefWeb + GDELT + official RSS) and enriched by
// AI for summary/category/urgency/entities — no static data. Rows open the
// shared detail popup via onSelectStatement.
export default function OfficialStatementsCard({ onSelectStatement }: OfficialStatementsCardProps) {
  const [activeCat, setActiveCat] = useState<OSCategory | null>(null);
  const [statements, setStatements] = useState<OfficialStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchOfficialStatements();
      setStatements(data);
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

  const visible = sortStatements(
    activeCat ? statements.filter((s) => s.category === activeCat) : statements
  );

  return (
    <div className="region-card statement-card">
      <div className="region-accent-bar" />

      <div className="region-card-header">
        <span className="region-count mono-num">{statements.length}</span>
        <button className="region-icon-btn" disabled title="مشاركة"><Share2 size={13} /></button>
        <button className="region-icon-btn" onClick={load} disabled={loading} title="تحديث">
          <RefreshCw size={13} className={loading ? 'spin-icon' : undefined} />
        </button>
        <span className="region-live-badge"><span className="live-pulse" /> مباشر</span>
        <div className="region-name-block">
          <span className="region-name-ar">التصريحات الرسمية للدول</span>
        </div>
      </div>

      <div className="statement-card-body">
        <div className="os-filter" role="tablist">
          {OS_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={(tab.category ?? null) === activeCat}
              className={`os-chip${(tab.category ?? null) === activeCat ? ' active' : ''}`}
              onClick={() => setActiveCat(tab.category)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && statements.length === 0 ? (
          <div className="widget-empty-state">جارِ جلب التصريحات الرسمية…</div>
        ) : error && statements.length === 0 ? (
          <div className="os-error-state">
            <AlertTriangle size={16} />
            <span>تعذّر الاتصال بالمصادر الرسمية.</span>
            <button className="os-retry-btn" onClick={load}>إعادة المحاولة</button>
          </div>
        ) : (
          <div className="os-list">
            {visible.map((s) => {
              const color = OS_URGENCY_COLOR[s.urgency];
              return (
                <button
                  key={s.id}
                  type="button"
                  className="os-row"
                  style={{ borderInlineStartColor: color }}
                  onClick={() => onSelectStatement(s)}
                >
                  <div className="os-row-top">
                    <span className="os-flag">{flagEmoji(s.countryCode)}</span>
                    {s.country && <span className="os-country">{s.country}</span>}
                    <span className="os-authority"><Landmark size={9} /> {s.authority}</span>
                    <span
                      className="os-severity"
                      style={{ color, borderColor: color, background: `${color}1A` }}
                    >
                      {OS_URGENCY_LABEL_AR[s.urgency]}
                    </span>
                  </div>
                  <div className="os-title">{s.title}</div>
                  <div className="os-row-meta">
                    <span className="os-cat">{OS_CATEGORY_LABEL_AR[s.category]}</span>
                    <span className="os-src-tag">{s.sourceApi}</span>
                    <span className="os-time"><Clock size={9} /> {timeAgoAr(s.publishedAt)}</span>
                  </div>
                </button>
              );
            })}

            {visible.length === 0 && (
              <div className="widget-empty-state">لا توجد تصريحات ضمن هذا التصنيف.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
