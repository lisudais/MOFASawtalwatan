interface HeaderProps {
  lastUpdated: Date | null;
}

export default function Header({ lastUpdated }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo-block">
          <img src="/mofa-logo.svg" alt="MOFA" height={36} />
        </div>
      </div>

      <div className="header-center">
        <div className="system-title-block">
          <span className="system-name-ar">مركز الأزمات والطوارئ</span>
          <span className="system-name-en">MFA Crisis &amp; Emergency Center</span>
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
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>
    </header>
  );
}
