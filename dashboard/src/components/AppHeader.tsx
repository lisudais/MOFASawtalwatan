import type { ReactNode } from 'react';
import { ShieldAlert, ArrowRight } from 'lucide-react';

export interface AppHeaderProps {
  /** Primary system title, e.g. "مركز الأزمات والطوارئ". */
  title: string;
  /** Secondary line under the title, e.g. the embassy + host country. Optional. */
  subtitle?: string;
  /** When set, renders a small back arrow at the start (right in RTL). */
  onBack?: () => void;
  /** Status pill under the title — same shape everywhere, colour by variant. */
  statusBadge?: { label: string; variant: 'live' | 'limited' | 'default' };
  /** Buttons pinned to the end (left in RTL). */
  actions?: ReactNode;
  /** Last refresh time — rendered at the end, formatted in ar-SA. */
  lastUpdated?: Date | null;
}

function StatusBadge({ badge }: { badge: NonNullable<AppHeaderProps['statusBadge']> }) {
  return (
    <span className={`app-header-badge app-header-badge--${badge.variant}`}>
      {badge.variant === 'live' && <span className="app-header-badge-pulse" />}
      {badge.variant === 'limited' && <ShieldAlert size={10} />}
      {badge.label}
    </span>
  );
}

/**
 * Shared header shell for every screen (main dashboard + every embassy). The
 * frame — brand block, centered title, end actions, tri-colour separator — is
 * identical everywhere; only the props change. RTL is fixed on the header
 * itself so the layout is the same regardless of the parent's direction:
 * brand at the start (right), actions at the end (left).
 */
export default function AppHeader({
  title,
  subtitle,
  onBack,
  statusBadge,
  actions,
  lastUpdated,
}: AppHeaderProps) {
  return (
    <header className="header app-header" dir="rtl">
      {/* Brand — optional back arrow + logo, fixed to the start (right in RTL). */}
      <div className="app-header-brand">
        {onBack && (
          <button type="button" className="app-header-back" onClick={onBack} aria-label="رجوع">
            <ArrowRight size={16} />
          </button>
        )}
        <div className="logo-block">
          <img src="/mofa-logo.svg" alt="وزارة الخارجية" height={36} />
        </div>
      </div>

      {/* Center — title, subtitle, status badge (in that order). */}
      <div className="app-header-center">
        <h1 className="app-header-title">{title}</h1>
        {subtitle && <span className="app-header-subtitle">{subtitle}</span>}
        {statusBadge && <StatusBadge badge={statusBadge} />}
      </div>

      {/* End — actions + last updated, pinned to the end (left in RTL). */}
      <div className="app-header-end">
        {actions}
        {lastUpdated && (
          <span className="header-updated">
            آخر تحديث {lastUpdated.toLocaleTimeString('ar-SA')}
          </span>
        )}
      </div>
    </header>
  );
}
