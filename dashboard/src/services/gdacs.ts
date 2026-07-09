import type { GeoEvent } from '../types';
import { resilientFetch } from './resilientFetch';
import { scoreEvent, scoreToRiskLevel, getRecommendedAction } from './riskEngine';

const GDACS_RSS = 'https://api.allorigins.win/raw?url=https://www.gdacs.org/xml/rss.xml';

function parseRSSItem(item: Element): Partial<GeoEvent> | null {
  const get = (tag: string) => item.querySelector(tag)?.textContent?.trim() ?? '';

  const title = get('title');
  const pubDate = get('pubDate');
  const description = get('description');
  const countryEl = item.querySelector('[localName="country"]');
  const country = countryEl?.textContent?.trim() ?? '';
  const latStr = get('geo\\:lat');
  const lngStr = get('geo\\:long');
  const lat = parseFloat(latStr) || 0;
  const lng = parseFloat(lngStr) || 0;

  let type: GeoEvent['type'] = 'FLOOD';
  const t = title.toLowerCase();
  if (t.includes('earthquake') || t.includes('eq ')) type = 'EARTHQUAKE';
  else if (t.includes('cyclone') || t.includes('hurricane') || t.includes('typhoon') || t.includes('tc ')) type = 'STORM';
  else if (t.includes('volcano') || t.includes('vo ')) type = 'VOLCANO';
  else if (t.includes('drought') || t.includes('dr ')) type = 'DROUGHT';
  else if (t.includes('wildfire') || t.includes('fire')) type = 'WILDFIRE';

  if (!title) return null;

  return {
    title,
    type,
    country: country || 'Unknown',
    countryCode: '',
    lat,
    lng,
    description: description.replace(/<[^>]+>/g, '').substring(0, 200),
    source: 'GDACS',
    timestamp: pubDate ? new Date(pubDate) : new Date(),
  };
}

export async function fetchGDACSEvents(): Promise<GeoEvent[]> {
  try {
    const res = await resilientFetch(GDACS_RSS, { timeoutMs: 25000 });
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const items = Array.from(doc.querySelectorAll('item'));

    return items.slice(0, 20).map((item, i) => {
      const partial = parseRSSItem(item);
      if (!partial) return null;
      const score = scoreEvent(partial as any);
      const riskLevel = scoreToRiskLevel(score);
      return {
        id: `gdacs-${i}-${Date.now()}`,
        score,
        riskLevel,
        recommendedAction: getRecommendedAction(riskLevel, partial.type!),
        countryCode: partial.countryCode || '',
        ...partial,
      } as GeoEvent;
    }).filter(Boolean) as GeoEvent[];
  } catch {
    return [];
  }
}
