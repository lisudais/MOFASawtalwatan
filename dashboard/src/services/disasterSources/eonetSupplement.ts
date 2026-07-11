// Supplementary coverage — NASA EONET (Earth Observatory Natural Event
// Tracker). Direct fetch (CORS-open, no proxy needed). Its wildfire category
// is itself largely populated from NASA FIRMS/MODIS-VIIRS satellite hotspot
// detections, so this also stands in for a direct FIRMS integration (which
// needs a registered MAP_KEY we don't have — see naturalDisasterFeed.ts).
// status=open already restricts the feed to currently-active events.
import { resilientFetch } from '../resilientFetch';
import { lookupCountry } from '../countryNames';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent, DisasterType } from './types';

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30';

const EONET_CATEGORY_TYPE: Record<string, DisasterType> = {
  wildfires: 'WILDFIRE',
  severeStorms: 'HURRICANE',
  volcanoes: 'VOLCANO',
  floods: 'FLOOD',
};

export async function fetchEonetSupplement(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(EONET_URL);
    const data = await res.json();

    return (data.events as any[])
      .map((ev): DisasterEvent | null => {
        const categoryId = ev.categories?.[0]?.id;
        const type = EONET_CATEGORY_TYPE[categoryId];
        if (!type) return null;

        const geometry = ev.geometry?.[ev.geometry.length - 1];
        if (!geometry) return null;
        const [lng, lat] = geometry.coordinates;
        const info = lookupCountry(ev.title);
        const countryAr = info?.ar ?? '';
        // EONET carries no magnitude/alert data of its own to grade severity by.
        const severity = 'MODERATE' as const;

        return {
          id: `eonet-${ev.id}`,
          disasterType: type,
          country: countryAr,
          countryCode: info?.iso2 ?? '',
          city: null,
          latitude: lat,
          longitude: lng,
          severity,
          title: ev.title,
          description: ev.description || ev.title,
          source: `NASA EONET${ev.sources?.[0]?.id ? ` / ${ev.sources[0].id}` : ''}`,
          sourceUrl: ev.sources?.[0]?.url ?? null,
          updatedAt: geometry.date ? new Date(geometry.date).toISOString() : new Date().toISOString(),
          aiSummary: buildAiSummary({ disasterType: type, country: countryAr, severity }),
        };
      })
      .filter((e): e is DisasterEvent => e !== null);
  } catch {
    return [];
  }
}
