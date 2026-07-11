import SaudisAbroadSection from './SaudisAbroadSection';
import SidebarStatsGrid from './SidebarStatsGrid';
import AlertFeed from './AlertFeed';
import type { GeoEvent, Traveler, DashboardStats } from '../types';
import type { CountryHealthEntry } from '../services/healthAnalysis';
import type { DisasterEvent } from '../services/naturalDisasterFeed';
import type { OfficialStatement } from '../services/officialStatements';
import type { CountrySecurityProfile } from '../services/security';
import type { EconomicIndicator } from '../services/economy';

interface IntelSidebarProps {
  events: GeoEvent[];
  travelers: Traveler[];
  stats: DashboardStats;
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
  onSelectCountry: (entry: CountryHealthEntry) => void;
  onHealthDataLoaded?: (countries: CountryHealthEntry[]) => void;
  onSelectDisaster: (d: DisasterEvent) => void;
  onSelectStatement: (s: OfficialStatement) => void;
  onSelectSecurity: (p: CountrySecurityProfile) => void;
  onSecurityDataLoaded?: (countries: CountrySecurityProfile[]) => void;
  onSelectIndicator: (ind: EconomicIndicator) => void;
}

// Sidebar rebuild in progress. SaudisAbroadSection, SidebarStatsGrid, and now
// AlertFeed (redesigned as a regional card grid — see RegionAlertCard.tsx and
// services/regions.ts) are rebuilt so far. The rest of the original sections
// (Natural Disasters, Economic Watch, Global Health Watch, News Analysis) are
// re-added one at a time in later phases, reusing the existing data-fetching
// logic untouched — see DisasterWidget.tsx, EconomyWidget.tsx, HealthWidget.tsx,
// NewsWidget.tsx (currently unreferenced, not deleted).
export default function IntelSidebar({ events, travelers: _travelers, stats, selectedEvent, onSelectEvent, onSelectCountry, onHealthDataLoaded, onSelectDisaster, onSelectStatement, onSelectSecurity, onSecurityDataLoaded, onSelectIndicator }: IntelSidebarProps) {
  return (
    <div className="intel-sidebar">
      <SaudisAbroadSection />
      <SidebarStatsGrid stats={stats} />
      <AlertFeed events={events} selectedEvent={selectedEvent} onSelectEvent={onSelectEvent} onSelectCountry={onSelectCountry} onHealthDataLoaded={onHealthDataLoaded} onSelectDisaster={onSelectDisaster} onSelectStatement={onSelectStatement} onSelectSecurity={onSelectSecurity} onSecurityDataLoaded={onSecurityDataLoaded} onSelectIndicator={onSelectIndicator} />
    </div>
  );
}
