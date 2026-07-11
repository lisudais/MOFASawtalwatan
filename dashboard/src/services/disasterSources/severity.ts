import type { DisasterEvent, Severity } from './types';

export const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };

export const SEVERITY_LABEL_AR: Record<Severity, string> = {
  CRITICAL: 'حرجة',
  HIGH: 'مرتفعة',
  MODERATE: 'متوسطة',
  LOW: 'منخفضة',
};

// Reuses the dashboard's existing danger palette (RISK_COLORS) so this module
// reads consistently with every other severity badge in the app.
export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: '#FF1744',
  HIGH: '#FF6D00',
  MODERATE: '#FFD600',
  LOW: '#00E676',
};

// Highest severity first, then most-recently-updated within a level.
export function sortBySeverity(list: DisasterEvent[]): DisasterEvent[] {
  return [...list].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function severityFromMagnitude(mag: number): Severity {
  if (mag >= 7) return 'CRITICAL';
  if (mag >= 6) return 'HIGH';
  if (mag >= 5) return 'MODERATE';
  return 'LOW';
}

// USGS PAGER alert level — a real, authoritative severity signal when present
// (most sub-5.0 quakes don't get one, hence the nullable return).
export function severityFromUsgsAlert(alert: string | null | undefined): Severity | null {
  switch (alert) {
    case 'red': return 'CRITICAL';
    case 'orange': return 'HIGH';
    case 'yellow': return 'MODERATE';
    case 'green': return 'LOW';
    default: return null;
  }
}

// GDACS's own 3-tier alert (Green/Orange/Red) collapsed into our 4-tier scale.
// Green is GDACS's lowest published tier — treated as MODERATE, not LOW, since
// GDACS only lists events that already cleared its monitoring threshold.
export function severityFromGdacsAlertLevel(level: string | undefined): Severity {
  if (level === 'Red') return 'CRITICAL';
  if (level === 'Orange') return 'HIGH';
  return 'MODERATE';
}

// NOAA/JTWC storm classification + max sustained wind (knots).
export function severityFromStormClassification(classification: string | undefined, intensityKt: number): Severity {
  const c = (classification ?? '').toUpperCase();
  if (c === 'HU' && intensityKt >= 96) return 'CRITICAL'; // Category 3+
  if (c === 'HU' || intensityKt >= 64) return 'HIGH';
  if (c === 'TS' || intensityKt >= 34) return 'MODERATE';
  return 'LOW';
}

// Smithsonian GVP weekly reports carry no numeric magnitude — read the report
// text for explicit severity signals instead of guessing.
export function severityFromVolcanoText(text: string): Severity {
  const t = text.toLowerCase();
  if (/\bevacuat|\bvei\s?[4-9]|explosive eruption|fatalit/.test(t)) return 'HIGH';
  if (/\bunrest\b|\belevated\b|\bminor\b|\bweak\b/.test(t)) return 'LOW';
  return 'MODERATE';
}
