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
import { lookupCountry } from '../countryNames';
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

export async function fetchGdacsEvents(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(corsProxy(GDACS_API), { timeoutMs: 25000 });
    const data = await res.json();
    const feats = (data.features ?? []) as any[];

    return feats
      .filter((f) => String(f.properties?.iscurrent) === 'true')
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

        return {
          id: `gdacs-${p.eventtype}-${p.eventid}-${p.episodeid}`,
          disasterType: type,
          country: countryAr,
          countryCode: info?.iso2 ?? '',
          city: null,
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
