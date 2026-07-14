import type { GeoEvent } from '../types';
import type { CountryHealthEntry } from '../services/healthAnalysis';
import type { DisasterEvent } from '../services/naturalDisasterFeed';
import type { OfficialStatement } from '../services/officialStatements';
import type { CountrySecurityProfile } from '../services/security';
import type { EconomicIndicator } from '../services/economy';
import HealthCategoryCard from './HealthCategoryCard';
import DisasterCategoryCard from './DisasterCategoryCard';
import EconomyCategoryCard from './EconomyCategoryCard';
import OfficialStatementsCard from './OfficialStatementsCard';
import SecurityCategoryCard from './SecurityCategoryCard';

interface AlertFeedProps {
  events: GeoEvent[];
  selectedEvent: GeoEvent | null;
  onSelectEvent: (e: GeoEvent) => void;
  onSelectCountry: (entry: CountryHealthEntry) => void;
  onHealthDataLoaded?: (countries: CountryHealthEntry[]) => void;
  onSelectDisaster: (d: DisasterEvent) => void;
  onDisasterDataLoaded?: (events: DisasterEvent[]) => void;
  onSelectStatement: (s: OfficialStatement) => void;
  onSelectSecurity: (p: CountrySecurityProfile) => void;
  onSecurityDataLoaded?: (countries: CountrySecurityProfile[]) => void;
  onSelectIndicator: (ind: EconomicIndicator) => void;
  onEconomyDataLoaded?: (indicators: EconomicIndicator[]) => void;
}

// Every category box is wired to real content now — see HealthCategoryCard.tsx /
// DisasterCategoryCard.tsx / EconomyCategoryCard.tsx / OfficialStatementsCard.tsx /
// SecurityCategoryCard.tsx. The previous geographic-region grouping
// (services/regions.ts, RegionAlertCard.tsx) is unlinked from this section but
// left in place, unused, in case it's wanted elsewhere later.
export default function AlertFeed({ onSelectCountry, onHealthDataLoaded, onSelectDisaster, onDisasterDataLoaded, onSelectStatement, onSelectSecurity, onSecurityDataLoaded, onSelectIndicator, onEconomyDataLoaded }: AlertFeedProps) {
  return (
    <div className="panel alert-feed">
      <div className="alert-feed-region-grid">
        <HealthCategoryCard onSelectCountry={onSelectCountry} onDataLoaded={onHealthDataLoaded} />
        <DisasterCategoryCard onSelectDisaster={onSelectDisaster} onDataLoaded={onDisasterDataLoaded} />
        <EconomyCategoryCard onSelectIndicator={onSelectIndicator} onDataLoaded={onEconomyDataLoaded} />
        <OfficialStatementsCard onSelectStatement={onSelectStatement} />
        <SecurityCategoryCard onSelectSecurity={onSelectSecurity} onDataLoaded={onSecurityDataLoaded} />
      </div>
    </div>
  );
}
