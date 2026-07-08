import { Bell, BellOff } from 'lucide-react';

interface HeaderProps {
  notificationCount: number;
  lastUpdated: Date | null;
  pushEnabled: boolean;
  onEnablePush: () => void;
}

export default function Header({ notificationCount, lastUpdated, pushEnabled, onEnablePush }: HeaderProps) {
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
        <button className={`header-btn${pushEnabled ? ' active' : ''}`} onClick={onEnablePush}>
          {pushEnabled ? <Bell size={13} /> : <BellOff size={13} />}
          {pushEnabled ? 'Alerts On' : 'Enable Alerts'}
        </button>
        <div className="header-notif-badge">
          <Bell size={15} />
          {notificationCount > 0 && <span className="header-notif-count">{notificationCount}</span>}
        </div>
      </div>
    </header>
  );
}
