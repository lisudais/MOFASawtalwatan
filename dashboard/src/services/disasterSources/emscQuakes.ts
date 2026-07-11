// Earthquakes — EMSC (seismicportal.eu), direct fetch (CORS-open, no proxy needed).
// Cross-network coverage of USGS: EMSC often reports European/Mediterranean/Asian
// events faster or with different magnitudes, so both feeds run in parallel.
import { resilientFetch } from '../resilientFetch';
import { lookupCountry } from '../countryNames';
import { severityFromMagnitude } from './severity';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent } from './types';

const EMSC_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=25&minmag=4.5';

function parseRegion(region: string): { city: string | null; country: string } {
  const parts = region.split(',');
  const country = parts.pop()!.trim();
  const city = parts.length > 0 ? parts.join(',').trim() : null;
  return { city, country };
}

export async function fetchEmscQuakes(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(EMSC_URL);
    const data = await res.json();

    return (data.features as any[]).map((f): DisasterEvent => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const mag: number = p.mag ?? 0;
      const region: string = p.flynn_region ?? 'Unknown region';
      const { city, country } = parseRegion(region);
      const info = lookupCountry(country);
      const severity = severityFromMagnitude(mag);
      const countryAr = info?.ar ?? (country || 'غير محدد');

      return {
        id: `emsc-${p.unid ?? f.id}`,
        disasterType: 'EARTHQUAKE',
        country: countryAr,
        countryCode: info?.iso2 ?? '',
        city,
        latitude: lat,
        longitude: lng,
        severity,
        title: `M${mag.toFixed(1)} Earthquake — ${region}`,
        description: `Magnitude ${mag} earthquake near ${region} (depth ${p.depth} km).`,
        source: 'EMSC',
        sourceUrl: `https://www.seismicportal.eu/eventdetails.html?id=${p.unid ?? f.id}`,
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
