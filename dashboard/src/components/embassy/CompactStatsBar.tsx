import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface CompactStat {
  key: string;
  icon: LucideIcon;
  value: number | string;
  /** Short inline label, e.g. "مسجّلون". */
  label: string;
  /** Full description — shown as a tooltip on hover/click, not a permanent line. */
  description: string;
  /** Status colour (green/orange/red) matching the stat's own thresholds. */
  color: string;
  /** Unused by rendering now (no more UI badge for mock/demo figures); kept
   *  on the type so callers that still set it don't need a signature change. */
  demo?: boolean;
}

// Compact horizontal stat bar (Intelligence-Terminal style): merged numbers, no
// large separate cards. Each stat colour-codes its own value; the full
// description appears as a tooltip on hover OR click (click toggles it, for
// touch), never as a permanent caption.
export default function CompactStatsBar({ stats }: { stats: CompactStat[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="compact-stats-bar" dir="rtl">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.key}
            type="button"
            className={`compact-stat${openKey === s.key ? ' open' : ''}`}
            title={s.description}
            aria-label={`${s.label}: ${s.value}. ${s.description}`}
            onClick={() => setOpenKey((k) => (k === s.key ? null : s.key))}
          >
            <Icon size={13} style={{ color: s.color }} />
            <span className="compact-stat-num mono-num" style={{ color: s.color }}>{s.value}</span>
            <span className="compact-stat-label">{s.label}</span>
            <span className="compact-stat-tip" role="tooltip">{s.description}</span>
          </button>
        );
      })}
    </div>
  );
}
