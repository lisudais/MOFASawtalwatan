import type { DisasterType, Severity } from './types';
import { SEVERITY_LABEL_AR } from './severity';

export const DISASTER_TYPE_LABEL_AR: Record<DisasterType, string> = {
  EARTHQUAKE: 'زلزال',
  VOLCANO: 'بركان',
  HURRICANE: 'إعصار',
  FLOOD: 'سيول وفيضانات',
  WILDFIRE: 'حريق',
};

// Deterministic, one-sentence Arabic reading of the structured fields — never
// invents facts beyond what the source provided (type / country / severity /
// an optional short detail like magnitude or storm name).
export function buildAiSummary(fields: {
  disasterType: DisasterType;
  country: string;
  severity: Severity;
  detail?: string;
}): string {
  const typeAr = DISASTER_TYPE_LABEL_AR[fields.disasterType];
  const sevAr = SEVERITY_LABEL_AR[fields.severity];
  const detail = fields.detail ? ` ${fields.detail}` : '';
  const where = fields.country ? ` في ${fields.country}` : '';
  return `${typeAr}${detail}${where} بخطورة ${sevAr}.`;
}
