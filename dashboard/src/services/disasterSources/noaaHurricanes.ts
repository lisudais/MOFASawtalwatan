// Hurricanes / Cyclones / Typhoons — NOAA National Hurricane Center.
// CurrentStorms.json lists only presently-active systems (Atlantic + East/Central
// Pacific), so no extra "active" filtering is needed here. JTWC (the other
// preferred source, covering the Pacific/Indian Ocean basins NHC doesn't) is
// covered via gdacsEvents.ts, which tags its cyclone entries with source "JTWC".
import { resilientFetch } from '../resilientFetch';
import { corsProxy } from './proxy';
import { severityFromStormClassification } from './severity';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent } from './types';

const NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

const CLASSIFICATION_LABEL: Record<string, string> = {
  HU: 'Hurricane',
  TS: 'Tropical Storm',
  TD: 'Tropical Depression',
  PTC: 'Potential Tropical Cyclone',
};

function parseCoord(raw: string | undefined, axis: 'lat' | 'lng'): number {
  if (!raw) return 0;
  const m = raw.match(/^([\d.]+)([NSEW])$/i);
  if (!m) return parseFloat(raw) || 0;
  const value = parseFloat(m[1]);
  const sign = /[SW]/i.test(m[2]) ? -1 : 1;
  return axis === 'lat' ? value * sign : value * sign;
}

function normalizeStorm(s: any): DisasterEvent | null {
  const name: string = s.name || s.binNumber || 'Unnamed Storm';
  const classification: string = s.classification ?? '';
  const label = CLASSIFICATION_LABEL[classification] ?? 'Storm';
  const intensity = Number(s.intensity) || 0;
  const lat = typeof s.latitudeNumeric === 'number' ? s.latitudeNumeric : parseCoord(s.latitude, 'lat');
  const lng = typeof s.longitudeNumeric === 'number' ? s.longitudeNumeric : parseCoord(s.longitude, 'lng');
  const severity = severityFromStormClassification(classification, intensity);

  return {
    id: `nhc-${s.id ?? name}`,
    disasterType: 'HURRICANE',
    country: '',
    countryCode: '',
    city: null,
    latitude: lat,
    longitude: lng,
    severity,
    title: `${label} ${name}`,
    description: `${label} ${name} — max sustained winds ${intensity} kt, pressure ${s.pressure ?? '—'} mb.`,
    source: 'NOAA NHC',
    sourceUrl: s.publicAdvisory?.url ?? 'https://www.nhc.noaa.gov/',
    updatedAt: s.lastUpdate ? new Date(s.lastUpdate).toISOString() : new Date().toISOString(),
    aiSummary: buildAiSummary({
      disasterType: 'HURRICANE',
      country: '',
      severity,
      detail: `(${name}، رياح ${intensity} عقدة)`,
    }),
  };
}

export async function fetchNoaaHurricanes(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(corsProxy(NHC_URL), { timeoutMs: 20000 });
    const data = await res.json();
    const storms = (data.activeStorms ?? []) as any[];
    return storms.map(normalizeStorm).filter((e): e is DisasterEvent => e !== null);
  } catch {
    return [];
  }
}
