import MissionsDropdown from './embassy/MissionsDropdown';

interface HeaderProps {
  lastUpdated: Date | null;
  /** Main dashboard only — renders the "السفارات والبعثات" dropdown. */
  missionsMenu?: boolean;
}

export default function Header({ lastUpdated, missionsMenu }: HeaderProps) {
  return (
    <header className="header">
      {/* Physical LEFT side — last-updated + the missions dropdown. */}
      <div className="header-left">
        {missionsMenu && <MissionsDropdown />}
        {lastUpdated && (
          <span className="header-updated">
            آخر تحديث {lastUpdated.toLocaleTimeString('ar-SA')}
          </span>
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

      {/* Physical RIGHT side — the MOFA logo, matching every other page. */}
      <div className="header-right">
        <div className="logo-block">
          <img src="/mofa-logo.svg" alt="وزارة الخارجية" height={36} />
        </div>
      </div>
    </header>
  );
}
