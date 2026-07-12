import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Search, MapPin, ChevronDown, ShieldAlert } from 'lucide-react';
import {
  EMBASSIES, MISSION_TYPE_AR, getCurrentAccess, canAccessEmbassy,
  type EmbassyConfig,
} from '../../services/embassies';

const STATUS_AR = { ACTIVE: 'نشطة', SUSPENDED: 'معلّقة' } as const;

// Header dropdown listing Saudi EMBASSIES only (consulates/permanent missions
// stay in the registry for direct routes, but are not offered here). Selecting
// one navigates STRAIGHT to /missions/:id (no intermediate page). Permission
// is checked per row here AND again at the route + data layer.
export default function MissionsDropdown() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const access = getCurrentAccess();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EMBASSIES.filter((m) => {
      if (m.missionType !== 'EMBASSY') return false;
      if (!q) return true;
      return [m.nameAr, m.nameEn, m.hostCountry, m.hostCountryAr, m.city, m.cityAr]
        .some((f) => f.toLowerCase().includes(q));
    });
  }, [query]);

  // Keep the keyboard highlight inside the list as it shrinks.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else { setQuery(''); setHighlight(0); }
  }, [open]);

  function selectMission(m: EmbassyConfig) {
    if (!canAccessEmbassy(access, m.id)) return;
    setOpen(false);
    window.location.hash = `#/missions/${m.id}`;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && filtered[highlight]) {
      e.preventDefault();
      selectMission(filtered[highlight]);
    }
  }

  // Keep the highlighted row visible while arrowing through the list.
  useEffect(() => {
    listRef.current
      ?.querySelectorAll('.missions-dd-row')[highlight]
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  return (
    <div className="missions-dd-root" ref={rootRef} dir="rtl" onKeyDown={onKeyDown}>
      <button
        type="button"
        className={`header-nav-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Building2 size={13} />
        السفارات والبعثات
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s ease' }} />
      </button>

      {open && (
        <div className="missions-dd-panel" role="dialog" aria-label="اختيار بعثة دبلوماسية">
          <div className="embassy-search-row">
            <Search size={13} />
            <input
              ref={inputRef}
              className="embassy-search-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              placeholder="ابحث بالبعثة أو الدولة أو المدينة…"
              aria-label="بحث عن بعثة"
            />
          </div>

          <div className="missions-dd-list" role="listbox" aria-label="البعثات" ref={listRef}>
            {filtered.map((m, i) => {
              const allowed = canAccessEmbassy(access, m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`embassy-row missions-dd-row${i === highlight ? ' highlighted' : ''}`}
                  disabled={!allowed}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => selectMission(m)}
                  title={allowed ? 'فتح لوحة عمليات البعثة' : 'لا تملك صلاحية الوصول لهذه البعثة'}
                >
                  <div className="embassy-row-main">
                    <span className="embassy-row-name">{m.nameAr}</span>
                    <span className="embassy-row-meta">
                      <MapPin size={10} /> {m.hostCountryAr} · {m.cityAr} · {MISSION_TYPE_AR[m.missionType]}
                    </span>
                  </div>
                  <span className={`embassy-status-chip${m.status === 'ACTIVE' ? ' active' : ''}`}>
                    {STATUS_AR[m.status]}
                  </span>
                  <span className="embassy-risk-chip">
                    <ShieldAlert size={10} /> {m.riskLevelAr}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="widget-empty-state">لا توجد بعثات مطابقة لبحثك.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
