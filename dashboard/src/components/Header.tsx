import { Building2 } from 'lucide-react';

interface HeaderProps {
  lastUpdated: Date | null;
  /** Main dashboard only — renders the "السفارات والبعثات" entry point. */
  onOpenEmbassies?: () => void;
}

export default function Header({ lastUpdated, onOpenEmbassies }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo-block">
          <img src="/mofa-logo.svg" alt="MOFA" height={36} />
        </div>
        {onOpenEmbassies && (
          <button type="button" className="header-nav-btn" onClick={onOpenEmbassies}>
            <Building2 size={13} />
            السفارات والبعثات
          </button>
        )}
      </div>

      <div className="header-center">
        <div className="system-title-block">
          <span className="system-name-ar">مركز الأزمات والطوارئ</span>
        </div>
        <div className="system-badge">
          <span className="live-dot">
            <span className="live-pulse" />
            LIVE
          </span>
        </div>
      </div>

      <div className="header-right">
        {lastUpdated && (
          <span className="header-updated">
            آخر تحديث {lastUpdated.toLocaleTimeString('ar-SA')}
          </span>
        )}
      </div>
    </header>
  );
}
