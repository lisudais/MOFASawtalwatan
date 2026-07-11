import { useMemo, useState } from 'react';
import { Building2, Search, MapPin, ArrowRight, ShieldAlert } from 'lucide-react';
import { EMBASSIES, getCurrentAccess, canAccessEmbassy, type EmbassyConfig } from '../../services/embassies';

interface EmbassySelectorProps {
  onSelect: (embassy: EmbassyConfig) => void;
  onBack: () => void;
}

const MISSION_TYPE_AR = { EMBASSY: 'سفارة', CONSULATE: 'قنصلية' } as const;
const STATUS_AR = { ACTIVE: 'نشطة', SUSPENDED: 'معلّقة' } as const;

// Searchable embassy list — the entry gate to every embassy sub-dashboard.
// Uses the shared .panel / .panel-header / badge design language so it reads
// as part of the same platform, not a separate product.
export default function EmbassySelector({ onSelect, onBack }: EmbassySelectorProps) {
  const [query, setQuery] = useState('');
  const access = getCurrentAccess();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMBASSIES;
    return EMBASSIES.filter((e) =>
      [
        e.nameAr, e.nameEn, e.hostCountry, e.hostCountryAr, e.city, e.cityAr,
        MISSION_TYPE_AR[e.missionType], STATUS_AR[e.status], e.riskLevelAr,
      ].some((field) => field.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="embassy-selector-page" dir="rtl">
      <div className="panel embassy-selector-panel">
        <div className="panel-header" dir="rtl">
          <Building2 size={14} />
          <span>السفارات والبعثات</span>
          <span className="panel-header-ar">EMBASSIES &amp; MISSIONS</span>
          <span className="panel-badge">{filtered.length}</span>
        </div>

        <div className="embassy-search-row">
          <Search size={13} />
          <input
            className="embassy-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الدولة أو المدينة أو الحالة…"
            autoFocus
            aria-label="بحث عن سفارة"
          />
        </div>

        <div className="embassy-list">
          {filtered.map((embassy) => {
            const allowed = canAccessEmbassy(access, embassy.id);
            return (
              <button
                key={embassy.id}
                type="button"
                className="embassy-row"
                onClick={() => allowed && onSelect(embassy)}
                disabled={!allowed}
                title={allowed ? 'فتح لوحة عمليات السفارة' : 'لا تملك صلاحية الوصول لهذه السفارة'}
              >
                <div className="embassy-row-main">
                  <span className="embassy-row-name">{embassy.nameAr}</span>
                  <span className="embassy-row-meta">
                    <MapPin size={10} /> {embassy.hostCountryAr} · {embassy.cityAr} · {MISSION_TYPE_AR[embassy.missionType]}
                  </span>
                </div>
                <span className={`embassy-status-chip${embassy.status === 'ACTIVE' ? ' active' : ''}`}>
                  {STATUS_AR[embassy.status]}
                </span>
                <span className="embassy-risk-chip">
                  <ShieldAlert size={10} /> {embassy.riskLevelAr}
                </span>
                <ArrowRight size={14} className="embassy-row-arrow" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="widget-empty-state">لا توجد سفارات مطابقة لبحثك.</div>
          )}
        </div>

        <button type="button" className="embassy-back-link" onClick={onBack}>
          العودة إلى اللوحة الرئيسية
        </button>
      </div>
    </div>
  );
}
