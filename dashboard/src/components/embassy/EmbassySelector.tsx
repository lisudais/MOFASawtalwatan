import { useMemo, useState } from 'react';
import { Building2, Search, MapPin, ArrowRight, ShieldAlert } from 'lucide-react';
import { EMBASSIES, MISSION_TYPE_AR, getCurrentAccess, canAccessEmbassy, type EmbassyConfig } from '../../services/embassies';

interface EmbassySelectorProps {
  onSelect: (embassy: EmbassyConfig) => void;
  onBack: () => void;
}

const STATUS_AR = { ACTIVE: 'نشطة', SUSPENDED: 'معلّقة' } as const;

/** "قنصلية" / "قنصليتان" / "N قنصليات" for a country's grouped consulate card. */
function consulateCountLabel(cities: string[] | undefined): string {
  const n = cities?.length ?? 1;
  if (n <= 1) return 'قنصلية';
  if (n === 2) return 'قنصليتان';
  return `${n} قنصليات`;
}

// Searchable consulate list — grouped by country (one card per country, its
// cities listed on a sub-line). Uses the shared .panel / .panel-header / badge
// design language so it reads as part of the same platform.
export default function EmbassySelector({ onSelect, onBack }: EmbassySelectorProps) {
  const [query, setQuery] = useState('');
  const access = getCurrentAccess();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMBASSIES;
    return EMBASSIES.filter((e) =>
      [
        e.nameAr, e.nameEn, e.hostCountry, e.hostCountryAr, e.cityAr,
        MISSION_TYPE_AR[e.missionType], STATUS_AR[e.status], e.riskLevelAr,
        ...(e.consulateCitiesAr ?? []),
      ].some((field) => field.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="embassy-selector-page" dir="rtl">
      <div className="panel embassy-selector-panel">
        <div className="panel-header" dir="rtl">
          <Building2 size={14} />
          <span>القنصليات</span>
          <span className="panel-header-ar">CONSULATES</span>
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
                  <span className="embassy-row-name">
                    {embassy.hostCountryAr}
                    <span className="embassy-consulate-badge">
                      {MISSION_TYPE_AR[embassy.missionType]}
                      {(embassy.consulateCitiesAr?.length ?? 1) > 1 && ` · ${consulateCountLabel(embassy.consulateCitiesAr)}`}
                    </span>
                  </span>
                  <span className="embassy-row-meta">
                    <MapPin size={10} /> {(embassy.consulateCitiesAr ?? [embassy.cityAr]).join(' · ')}
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
