import { Building2 } from 'lucide-react';
import AppHeader from './AppHeader';

interface HeaderProps {
  lastUpdated: Date | null;
  /** Main dashboard only — renders the "السفارات والبعثات" entry point. */
  onOpenEmbassies?: () => void;
}

/**
 * Main-dashboard header. A thin preset over the shared {@link AppHeader}: same
 * frame as every embassy screen, only the title / LIVE badge / entry-point
 * action differ.
 */
export default function Header({ lastUpdated, onOpenEmbassies }: HeaderProps) {
  return (
    <AppHeader
      title="مركز الأزمات والطوارئ"
      statusBadge={{ label: 'LIVE', variant: 'live' }}
      lastUpdated={lastUpdated}
      actions={
        onOpenEmbassies && (
          <button type="button" className="header-nav-btn" onClick={onOpenEmbassies}>
            <Building2 size={13} />
            السفارات والبعثات
          </button>
        )
      }
    />
  );
}
