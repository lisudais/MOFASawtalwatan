import { Activity } from 'lucide-react';
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
  onSelectStatement: (s: OfficialStatement) => void;
  onSelectSecurity: (p: CountrySecurityProfile) => void;
  onSecurityDataLoaded?: (countries: CountrySecurityProfile[]) => void;
  onSelectIndicator: (ind: EconomicIndicator) => void;
}

// Every category box is wired to real content now — see HealthCategoryCard.tsx /
// DisasterCategoryCard.tsx / EconomyCategoryCard.tsx / OfficialStatementsCard.tsx /
// SecurityCategoryCard.tsx. The previous geographic-region grouping
// (services/regions.ts, RegionAlertCard.tsx) is unlinked from this section but
// left in place, unused, in case it's wanted elsewhere later.
export default function AlertFeed({ onSelectCountry, onHealthDataLoaded, onSelectDisaster, onSelectStatement, onSelectSecurity, onSecurityDataLoaded, onSelectIndicator }: AlertFeedProps) {
  return (
    <div className="panel alert-feed">
      <div className="panel-header">
        <Activity size={14} />
        <span className="panel-header-ar">تغذية التنبيهات</span>
      </div>
      <div className="alert-feed-region-grid">
        <HealthCategoryCard onSelectCountry={onSelectCountry} onDataLoaded={onHealthDataLoaded} />
        <DisasterCategoryCard onSelectDisaster={onSelectDisaster} />
        <EconomyCategoryCard onSelectIndicator={onSelectIndicator} />
        <OfficialStatementsCard onSelectStatement={onSelectStatement} />
        <SecurityCategoryCard onSelectSecurity={onSelectSecurity} onDataLoaded={onSecurityDataLoaded} />
      </div>
    </div>
  );
}
