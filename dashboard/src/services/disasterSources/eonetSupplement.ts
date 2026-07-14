// Supplementary coverage — NASA EONET (Earth Observatory Natural Event
// Tracker). Direct fetch (CORS-open, no proxy needed). Its wildfire category
// is itself largely populated from NASA FIRMS/MODIS-VIIRS satellite hotspot
// detections, so this also stands in for a direct FIRMS integration (which
// needs a registered MAP_KEY we don't have — see naturalDisasterFeed.ts).
// status=open already restricts the feed to currently-active events.
//
// IMPORTANT: EONET's open feed is overwhelmingly WILDFIRES (thousands of them),
// so a single `?status=open&limit=N` request returns only wildfires and starves
// volcanoes / severe storms / floods entirely. We therefore fetch each relevant
// category on its OWN endpoint with its own limit, so every type gets coverage.
import { resilientFetch } from '../resilientFetch';
import { lookupCountry, lookupRegion } from '../countryNames';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent, DisasterType } from './types';

const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3/events';

// Category slug (EONET v3 `categories[].id`) → our type, with a per-category
// limit. Fetched separately so wildfires never crowd the others out.
const EONET_CATEGORIES: { id: string; type: DisasterType; limit: number }[] = [
  { id: 'wildfires',    type: 'WILDFIRE',  limit: 12 },
  { id: 'severeStorms', type: 'HURRICANE', limit: 12 },
  { id: 'volcanoes',    type: 'VOLCANO',   limit: 12 },
  { id: 'floods',       type: 'FLOOD',     limit: 12 },
];

function mapEvent(ev: any, type: DisasterType): DisasterEvent | null {
  const geometry = ev.geometry?.[ev.geometry.length - 1];
  if (!geometry) return null;
  const [lng, lat] = geometry.coordinates;
  const info = lookupCountry(ev.title);
  const countryAr = info?.ar ?? '';
  // The state/province is usually right in the title (e.g. "…, California") but
  // was previously thrown away. Extract it so two US wildfires read as distinct
  // places instead of both showing just "الولايات المتحدة".
  const region = lookupRegion(`${ev.title ?? ''} ${ev.description ?? ''}`);
  // EONET carries no magnitude/alert data of its own to grade severity by.
  const severity = 'MODERATE' as const;

  return {
    id: `eonet-${ev.id}`,
    disasterType: type,
    country: countryAr,
    countryCode: info?.iso2 ?? '',
    city: region,
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
}

export async function fetchEonetSupplement(): Promise<DisasterEvent[]> {
  // Each category is fetched independently; a failing/empty one never blocks the
  // others (Promise.allSettled + flatMap of only the fulfilled results).
  const settled = await Promise.allSettled(
    EONET_CATEGORIES.map(async ({ id, type, limit }) => {
      const res = await resilientFetch(`${EONET_BASE}?status=open&category=${id}&limit=${limit}`);
      const data = await res.json();
      return ((data.events as any[]) ?? [])
        .map((ev) => mapEvent(ev, type))
        .filter((e): e is DisasterEvent => e !== null);
    }),
  );

  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
