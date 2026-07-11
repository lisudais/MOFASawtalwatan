// Earthquakes — USGS (earthquake.usgs.gov), direct fetch (CORS-open, no proxy needed).
import { resilientFetch } from '../resilientFetch';
import { lookupCountry } from '../countryNames';
import { severityFromMagnitude, severityFromUsgsAlert } from './severity';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent } from './types';

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';

// USGS place strings look like "41 km S of Sarangani, Philippines" or just
// "Philippines" — strip the leading distance/bearing to get a city-ish name.
function parsePlace(place: string): { city: string | null; country: string } {
  const parts = place.split(',');
  const country = (parts.length > 1 ? parts.pop() : parts[0])!.trim();
  const head = parts.join(',').trim();
  if (!head) return { city: null, country };
  const m = head.match(/^\d+\s*km\s+[NSEW]+\s+of\s+(.+)$/i);
  return { city: (m ? m[1] : head).trim(), country };
}

export async function fetchUsgsEarthquakes(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(USGS_URL);
    const data = await res.json();

    return (data.features as any[]).map((f): DisasterEvent => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const mag: number = p.mag ?? 0;
      const place: string = p.place ?? '';
      const { city, country } = parsePlace(place);
      const info = lookupCountry(country);
      const severity = severityFromUsgsAlert(p.alert) ?? severityFromMagnitude(mag);
      const countryAr = info?.ar ?? (country || 'غير محدد');

      return {
        id: `usgs-${p.code ?? f.id}`,
        disasterType: 'EARTHQUAKE',
        country: countryAr,
        countryCode: info?.iso2 ?? '',
        city,
        latitude: lat,
        longitude: lng,
        severity,
        title: p.title ?? `M ${mag.toFixed(1)} Earthquake — ${place}`,
        description: `Magnitude ${mag} earthquake at depth ${f.geometry.coordinates[2]} km near ${place}.`,
        source: 'USGS',
        sourceUrl: p.url ?? null,
        updatedAt: new Date(p.time).toISOString(),
        aiSummary: buildAiSummary({
          disasterType: 'EARTHQUAKE',
          country: countryAr,
          severity,
          detail: `بقوة ${mag.toFixed(1)} درجة`,
        }),
      };
    });
  } catch {
    return [];
  }
}
