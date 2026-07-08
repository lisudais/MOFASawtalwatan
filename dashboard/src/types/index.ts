export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';

export interface GeoEvent {
  id: string;
  title: string;
  type: 'EARTHQUAKE' | 'FLOOD' | 'STORM' | 'VOLCANO' | 'CONFLICT' | 'TERROR' | 'CIVIL_UNREST' | 'DISEASE' | 'DROUGHT' | 'WILDFIRE';
  riskLevel: RiskLevel;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  description: string;
  source: 'GDACS' | 'USGS' | 'RELIEFWEB' | 'ACLED' | 'MOCK' | 'EONET' | 'EMSC';
  timestamp: Date;
  affectedArea?: string;
  casualties?: number;
  score: number; // 0-100 risk score from engine
  recommendedAction: string;
}

export interface Traveler {
  id: string;
  nameAr: string;
  nameEn: string;
  passportNumber: string;
  destination: string;
  countryCode: string;
  lat: number;
  lng: number;
  arrivalDate: Date;
  departureDate: Date;
  phone: string;
  status: 'ACTIVE' | 'ALERTED' | 'EVACUATED' | 'SAFE';
  alerts: string[];
}

export interface Notification {
  id: string;
  travelerId: string;
  travelerName: string;
  eventId: string;
  eventTitle: string;
  riskLevel: RiskLevel;
  message: string;
  messageAr: string;
  aiSuggestion: string;
  aiSuggestionAr: string;
  actionSteps: string[];
  actionStepsAr: string[];
  timestamp: Date;
  sent: boolean;
}

export interface RiskAssessment {
  country: string;
  countryCode: string;
  overallRisk: RiskLevel;
  score: number;
  events: GeoEvent[];
  travelersAtRisk: number;
  recommendation: string;
  recommendationAr: string;
}

export interface DashboardStats {
  totalEvents: number;
  criticalEvents: number;
  affectedCountries: number;
  travelersAtRisk: number;
  notificationsSent: number;
  activeAlerts: number;
}

export interface CommodityQuote {
  symbol: string;
  nameEn: string;
  nameAr: string;
  price: number;
  changePercent: number;
  currency: string;
}

export interface HealthSnapshot {
  activeCases: number;
  todayCases: number;
  deaths: number;
  todayDeaths: number;
  affectedCountries: number;
  updatedAt: Date;
  topCountries: { country: string; countryCode: string; cases: number; todayCases: number }[];
}

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  seenDate: Date;
}

export interface PricePoint {
  date: Date;
  value: number;
}

export interface VolumePoint {
  date: Date;
  count: number;
}

export type InsightHighlightKind = 'RISK' | 'TREND' | 'CAUSE' | 'ACTION';

export interface InsightHighlight {
  kind: InsightHighlightKind;
  text: string;
}

export interface AiInsight {
  riskLevel: RiskLevel;
  highlights: InsightHighlight[];
  sources: string[];
  generatedAt: Date;
}

export interface CategoryInsight {
  summary: string;
  trend: 'RISING' | 'STABLE' | 'FALLING';
  severityFlag: boolean;
}

export interface CategoryInsightsResult {
  categories: Record<string, CategoryInsight>;
  forecast: string;
  correlation: string | null;
  priorityAlert: string | null;
  generatedAt: string; // ISO string (kept serializable for localStorage caching)
}

export interface SituationReport {
  assessment: string;
  likelyCause: string;
  recommendation: string;
  prediction: string | null; // only ever non-null when real historical signal exists
  trend: 'RISING' | 'STABLE' | 'FALLING';
  generatedAt: string; // ISO string
}

export interface CountryPresence {
  country: string;
  countryCode: string;
  count: number;
  percentage: number;
  color: string;
}

export interface SaudisAbroadData {
  total: number;
  countries: CountryPresence[]; // top countries, sorted descending
  otherCount: number;
  otherPercentage: number;
  otherColor: string;
}
