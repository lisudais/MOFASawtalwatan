// Natural Disasters module — LIVE data only, from official/internationally
// trusted sources:
//
//   Earthquakes         USGS + EMSC
//   Volcanoes           Smithsonian GVP (joint w/ USGS Volcano Hazards) + GDACS/Darwin VAAC
//   Hurricanes/Cyclones NOAA NHC + GDACS/JTWC
//   Floods              GDACS/GLOFAS (Copernicus) + NASA EONET
//   Wildfires           GDACS/GWIS (Copernicus) + NASA EONET (FIRMS-derived hotspots)
//
// NASA FIRMS itself isn't called directly: its API requires a registered
// MAP_KEY (like AlphaVantage/ACLED elsewhere in this project) which isn't
// configured, and its raw CSV is per-hotspot points with no country/event
// grouping, so a real integration needs geocoding this project doesn't have.
// Set VITE_FIRMS_MAP_KEY later to wire it in — until then wildfire coverage
// comes from GDACS/GWIS + EONET's own FIRMS-sourced hotspot clusters, so
// nothing is mocked in the meantime.
//
// Every event is normalized to the DisasterEvent contract, deduplicated,
// restricted to currently-active events, sorted Critical → High → Moderate →
// Low (ties broken by most-recently-updated), and capped to the latest
// events per category. A failing source never blocks the others; if every
// source for a category is down, that category simply returns no events.

import { fetchUsgsEarthquakes } from './disasterSources/usgsQuakes';
import { fetchEmscQuakes } from './disasterSources/emscQuakes';
import { fetchGdacsEvents } from './disasterSources/gdacsEvents';
import { fetchSmithsonianVolcanoes } from './disasterSources/smithsonianVolcanoes';
import { fetchNoaaHurricanes } from './disasterSources/noaaHurricanes';
import { fetchEonetSupplement } from './disasterSources/eonetSupplement';
import { sortBySeverity } from './disasterSources/severity';
import type { DisasterEvent, DisasterType } from './disasterSources/types';

export type { DisasterEvent, DisasterType, Severity } from './disasterSources/types';
export { SEVERITY_LABEL_AR, SEVERITY_COLOR } from './disasterSources/severity';
export { DISASTER_TYPE_LABEL_AR } from './disasterSources/aiSummary';

const LATEST_PER_CATEGORY = 15;

function dedupe(list: DisasterEvent[]): DisasterEvent[] {
  const seen = new Set<string>();
  const out: DisasterEvent[] = [];
  for (const e of list) {
    const key = `${e.disasterType}|${e.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function settledValue(r: PromiseSettledResult<DisasterEvent[]>): DisasterEvent[] {
  return r.status === 'fulfilled' ? r.value : [];
}

// Fetches every source in parallel and returns the combined, normalized,
// sorted feed. Pass `type` to restrict to one category (still fetches all
// sources — filtering only trims the result — since most adapters cover
// several categories at once).
export async function fetchDisasterEvents(type?: DisasterType): Promise<DisasterEvent[]> {
  const results = await Promise.allSettled([
    fetchUsgsEarthquakes(),
    fetchEmscQuakes(),
    fetchGdacsEvents(),
    fetchSmithsonianVolcanoes(),
    fetchNoaaHurricanes(),
    fetchEonetSupplement(),
  ]);

  let all = dedupe(results.flatMap(settledValue));
  if (type) all = all.filter((e) => e.disasterType === type);
  all = sortBySeverity(all);

  const byType = new Map<DisasterType, DisasterEvent[]>();
  for (const e of all) {
    const bucket = byType.get(e.disasterType) ?? [];
    if (bucket.length < LATEST_PER_CATEGORY) bucket.push(e);
    byType.set(e.disasterType, bucket);
  }

  return sortBySeverity([...byType.values()].flat());
}
