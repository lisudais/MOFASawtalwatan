// Multi-hazard — GDACS (Global Disaster Alert and Coordination System, run by
// the EU Joint Research Centre / UNOCHA). Its structured event API aggregates
// several of our preferred sources under one roof and tags which one produced
// each event:
//   VO (volcano)   -> Darwin VAAC (joint Smithsonian/USGS-adjacent aviation watch)
//   TC (cyclone)   -> JTWC
//   FL (flood)     -> GLOFAS (Copernicus Global Flood Awareness System)
//   WF (wildfire)  -> GWIS (Copernicus Global Wildfire Information System)
// so this one adapter covers the "JTWC" and "Copernicus Emergency" preferred
// sources for hurricanes/floods/wildfires, and complements the direct
// Smithsonian GVP feed for volcanoes.
import { resilientFetch } from '../resilientFetch';
import { lookupCountry, lookupRegion } from '../countryNames';
import { corsProxy } from './proxy';
import { severityFromGdacsAlertLevel } from './severity';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent, DisasterType } from './types';

const GDACS_API =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=VO;FL;WF;TC';

const GDACS_TYPE: Record<string, DisasterType> = {
  VO: 'VOLCANO',
  FL: 'FLOOD',
  WF: 'WILDFIRE',
  TC: 'HURRICANE',
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

// How far back a *finished* GDACS event still counts as "currently relevant".
// GDACS only flags the single ongoing episode as iscurrent=true, so floods and
// cyclones (which have defined end dates) almost never pass that flag even when
// they ended days ago. We therefore also keep events that are ongoing or ended
// within this window — otherwise the flood/cyclone/volcano filters show nothing
// despite GDACS carrying real, recent events for them.
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/** Keep an event if GDACS marks it current, or it ended within RECENT_MS. */
function isRecentlyActive(p: any, now: number): boolean {
  if (String(p?.iscurrent) === 'true') return true;
  const end = Date.parse(p?.todate ?? p?.fromdate ?? '');
  return Number.isFinite(end) && now - end <= RECENT_MS;
}

export async function fetchGdacsEvents(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(corsProxy(GDACS_API), { timeoutMs: 25000 });
    const data = await res.json();
    const feats = (data.features ?? []) as any[];
    const now = Date.now();

    return feats
      .filter((f) => isRecentlyActive(f.properties, now))
      .map((f): DisasterEvent | null => {
        const p = f.properties;
        const type = GDACS_TYPE[p.eventtype];
        if (!type) return null;

        const coords = f.geometry?.coordinates ?? [0, 0];
        const [lng, lat] = coords;
        const countryRaw = (p.country || '').split(',')[0].trim();
        const info = lookupCountry(countryRaw);
        const severity = severityFromGdacsAlertLevel(p.alertlevel);
        const countryAr = info?.ar ?? (countryRaw || 'غير محدد');
        const sourceName: string = p.source || 'GDACS';
        // Surface the state/province when the event name/description names one,
        // so same-country events are distinguishable (e.g. wildfires by state).
        const region = lookupRegion(`${p.name ?? ''} ${p.description ?? ''}`);

        return {
          id: `gdacs-${p.eventtype}-${p.eventid}-${p.episodeid}`,
          disasterType: type,
          country: countryAr,
          countryCode: info?.iso2 ?? '',
          city: region,
          latitude: lat,
          longitude: lng,
          severity,
          title: p.name || p.description || `${type} event`,
          description: p.htmldescription ? stripHtml(p.htmldescription) : (p.description ?? ''),
          source: `GDACS / ${sourceName}`,
          sourceUrl: p.url?.report ?? null,
          updatedAt: new Date(p.datemodified || p.fromdate || Date.now()).toISOString(),
          aiSummary: buildAiSummary({ disasterType: type, country: countryAr, severity }),
        };
      })
      .filter((e): e is DisasterEvent => e !== null);
  } catch {
    return [];
  }
}
