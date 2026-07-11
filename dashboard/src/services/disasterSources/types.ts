// Unified shape for the Natural Disasters module — every source adapter in
// this folder (USGS, EMSC, GDACS, Smithsonian GVP, NOAA NHC, NASA EONET)
// normalizes into exactly this contract so the UI never has to branch on
// where an event came from.

export type DisasterType = 'EARTHQUAKE' | 'VOLCANO' | 'HURRICANE' | 'FLOOD' | 'WILDFIRE';

export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface DisasterEvent {
  id: string;
  disasterType: DisasterType;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2, '' when unresolved — drives the flag emoji in the UI
  city: string | null;
  latitude: number;
  longitude: number;
  severity: Severity;
  title: string;
  description: string;
  source: string;
  sourceUrl: string | null;
  updatedAt: string; // ISO 8601
  aiSummary: string; // Arabic, one sentence
}
