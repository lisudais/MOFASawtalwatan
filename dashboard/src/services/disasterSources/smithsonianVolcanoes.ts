// Volcanoes — Smithsonian Global Volcanism Program's Weekly Volcanic Activity
// Report, a joint Smithsonian/USGS Volcano Hazards Program product (see the
// feed's own <title>), so this single feed covers both preferred sources.
import { resilientFetch } from '../resilientFetch';
import { lookupCountry } from '../countryNames';
import { corsProxy } from './proxy';
import { severityFromVolcanoText } from './severity';
import { buildAiSummary } from './aiSummary';
import type { DisasterEvent } from './types';

const GVP_RSS = 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml';

function normalizeItem(item: Element, index: number): DisasterEvent | null {
  const get = (tag: string) => item.querySelector(tag)?.textContent?.trim() ?? '';

  // e.g. "Etna (Italy) - Report for 2 July-8 July 2026 - New Eruptive Activity"
  const title = get('title');
  if (!title) return null;
  const m = title.match(/^(.+?)\s*\(([^)]+)\)/);
  const volcano = (m ? m[1] : title).trim();
  const countryRaw = (m ? m[2] : '').trim();
  const info = lookupCountry(countryRaw);
  const countryAr = info?.ar ?? (countryRaw || 'غير محدد');

  const description = stripHtml(get('description')).slice(0, 500);
  const pubDate = get('pubDate');
  const guid = item.querySelector('guid')?.textContent?.trim() || null;
  const pointRaw = get('georss\\:point');
  const [latStr, lngStr] = pointRaw.split(/\s+/);
  const lat = parseFloat(latStr) || 0;
  const lng = parseFloat(lngStr) || 0;
  const severity = severityFromVolcanoText(`${title} ${description}`);

  return {
    id: `gvp-${index}-${volcano}`.toLowerCase().replace(/\s+/g, '-'),
    disasterType: 'VOLCANO',
    country: countryAr,
    countryCode: info?.iso2 ?? '',
    city: volcano || null,
    latitude: lat,
    longitude: lng,
    severity,
    title,
    description: description || title,
    source: 'Smithsonian GVP / USGS Volcano Hazards',
    sourceUrl: guid,
    updatedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    aiSummary: buildAiSummary({ disasterType: 'VOLCANO', country: countryAr, severity, detail: `(${volcano})` }),
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function fetchSmithsonianVolcanoes(): Promise<DisasterEvent[]> {
  try {
    const res = await resilientFetch(corsProxy(GVP_RSS), { timeoutMs: 25000 });
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    return items
      .map((item, i) => normalizeItem(item, i))
      .filter((e): e is DisasterEvent => e !== null);
  } catch {
    return [];
  }
}
