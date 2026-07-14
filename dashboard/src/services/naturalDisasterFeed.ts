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

/**
 * The place label for a disaster row: "Country - Region" when a sub-national
 * region (state/province, or a locality from the quake sources) is known and
 * differs from the country, otherwise just the country. Region text is shown
 * as-is (Arabic or English) and never dropped. Returns '' when there is no
 * country at all — callers then fall back to coordinates. This is the single
 * place both the disaster list and the aggregated feed format location, so the
 * two never disagree.
 */
export function disasterPlaceLabel(country: string, region: string | null): string {
  const c = (country ?? '').trim();
  const r = (region ?? '').trim();
  if (c && r && r.toLowerCase() !== c.toLowerCase()) return `${c} - ${r}`;
  return c;
}

const LATIN = /[A-Za-z]/;

// Arabic names for the common offshore/oceanic regions that USGS/EMSC name in
// English (they have no ISO country, so they never resolve to an Arabic name).
// Keyword-matched against the raw place string so the UI never shows Latin text.
const OFFSHORE_REGION_AR: [RegExp, string][] = [
  [/loyalty\s*islands/i, 'جزر لويالتي'],
  [/bismarck\s*sea/i, 'بحر بسمارك'],
  [/banda\s*sea/i, 'بحر باندا'],
  [/molucca\s*sea/i, 'بحر مولوكا'],
  [/celebes\s*sea/i, 'بحر سيليبس'],
  [/philippine\s*sea/i, 'بحر الفلبين'],
  [/south\s*sandwich/i, 'جزر ساندويتش الجنوبية'],
  [/mid-?atlantic\s*ridge/i, 'حيد وسط الأطلسي'],
  [/(pacific-?antarctic|east\s*pacific)\s*ri(dge|se)/i, 'حيد شرق المحيط الهادئ'],
  [/reykjanes\s*ridge/i, 'حيد ريكيانِس'],
  [/carlsberg\s*ridge/i, 'حيد كارلسبرغ'],
  [/kermadec/i, 'جزر كيرماديك'],
  [/kuril/i, 'جزر الكوريل'],
  [/mariana/i, 'جزر ماريانا'],
  [/aleutian/i, 'جزر ألوشيان'],
  [/ascension/i, 'جزيرة أسنشن'],
  [/\bfiji\b/i, 'جزر فيجي'],
  [/\btonga\b/i, 'تونغا'],
  [/\bpacific\b/i, 'المحيط الهادئ'],
  [/\batlantic\b/i, 'المحيط الأطلسي'],
  [/indian\s*ocean/i, 'المحيط الهندي'],
];

/** Translate a recognised offshore/oceanic region name to Arabic, else null. */
function translateOffshoreAr(text: string): string | null {
  for (const [re, ar] of OFFSHORE_REGION_AR) if (re.test(text)) return ar;
  return null;
}

/** Short Arabic coordinate string — the honest last resort, never a placeholder. */
function coordsAr(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'شمالاً' : 'جنوباً';
  const ew = lng >= 0 ? 'شرقاً' : 'غرباً';
  return `${Math.abs(lat).toFixed(1)}° ${ns}، ${Math.abs(lng).toFixed(1)}° ${ew}`;
}

/**
 * Place label for a disaster row, resolved from the event's OWN real fields —
 * never a repeated generic placeholder. Order of preference:
 *   1. "Country - Region" when both are known (e.g. "إندونيسيا - Merapi").
 *   2. Country alone when there's no specific region.
 *   3. The region alone when there's no resolved country (an offshore sea/ridge,
 *      translated to Arabic when we recognise it, else its real name).
 *   4. Short coordinates when nothing else is known.
 * A region carrying a real name (a volcano like "Etna", a locality) is kept even
 * when it's Latin text — showing the real, DISTINCT name beats collapsing every
 * row to one placeholder. Recognised offshore regions are still Arabised.
 */
export function disasterPlaceAr(
  d: Pick<DisasterEvent, 'country' | 'city' | 'latitude' | 'longitude'>,
): string {
  const c = (d.country ?? '').trim();
  let r = (d.city ?? '').trim();
  // Arabise a known ocean/ridge region; otherwise keep the real region name.
  if (r && LATIN.test(r)) r = translateOffshoreAr(r) ?? r;
  const hasCountry = Boolean(c) && c !== 'غير محدد';
  if (hasCountry && r && r.toLowerCase() !== c.toLowerCase()) return `${c} - ${r}`;
  if (hasCountry) return c;
  if (r) return r;
  if (Number.isFinite(d.latitude) && Number.isFinite(d.longitude) && (d.latitude || d.longitude)) {
    return coordsAr(d.latitude, d.longitude);
  }
  return '';
}

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
