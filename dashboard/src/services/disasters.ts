import type { GeoEvent } from '../types';
import { resilientFetch } from './resilientFetch';
import { scoreEvent, scoreToRiskLevel, getRecommendedAction } from './riskEngine';

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30';
const EMSC_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20&minmag=4.5';

const EONET_CATEGORY_TYPE: Record<string, GeoEvent['type']> = {
  wildfires: 'WILDFIRE',
  severeStorms: 'STORM',
  volcanoes: 'VOLCANO',
  floods: 'FLOOD',
  drought: 'DROUGHT',
  earthquakes: 'EARTHQUAKE',
};

async function fetchEonetEvents(): Promise<GeoEvent[]> {
  try {
    const res = await resilientFetch(EONET_URL);
    const data = await res.json();

    return (data.events as any[]).map((ev, i) => {
      const categoryId = ev.categories?.[0]?.id;
      const type = EONET_CATEGORY_TYPE[categoryId];
      if (!type) return null;

      const geometry = ev.geometry?.[ev.geometry.length - 1];
      if (!geometry) return null;
      const [lng, lat] = geometry.coordinates;

      const partial = {
        title: ev.title,
        type,
        country: '',
        countryCode: '',
        lat,
        lng,
        description: ev.description ?? ev.title,
        source: 'EONET' as const,
        timestamp: geometry.date ? new Date(geometry.date) : new Date(),
      };
      const score = scoreEvent(partial as any);
      const riskLevel = scoreToRiskLevel(score);

      return {
        id: `eonet-${ev.id}-${i}`,
        score,
        riskLevel,
        recommendedAction: getRecommendedAction(riskLevel, type),
        ...partial,
      } as GeoEvent;
    }).filter(Boolean) as GeoEvent[];
  } catch {
    return [];
  }
}

async function fetchEmscQuakes(): Promise<GeoEvent[]> {
  try {
    const res = await resilientFetch(EMSC_URL);
    const data = await res.json();

    return (data.features as any[]).map((f, i) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const region = p.flynn_region ?? 'Unknown region';

      const partial = {
        title: `M${p.mag?.toFixed(1)} Earthquake — ${region}`,
        type: 'EARTHQUAKE' as const,
        country: region,
        countryCode: '',
        lat,
        lng,
        description: `Magnitude ${p.mag} earthquake near ${region} (depth ${p.depth} km).`,
        source: 'EMSC' as const,
        timestamp: new Date(p.time),
      };
      const score = scoreEvent(partial as any);
      const riskLevel = scoreToRiskLevel(score);

      return {
        id: `emsc-${p.unid ?? f.id}-${i}`,
        score,
        riskLevel,
        recommendedAction: getRecommendedAction(riskLevel, 'EARTHQUAKE'),
        ...partial,
      } as GeoEvent;
    });
  } catch {
    return [];
  }
}

export async function fetchExtraDisasterEvents(): Promise<GeoEvent[]> {
  const [eonet, emsc] = await Promise.all([fetchEonetEvents(), fetchEmscQuakes()]);
  return [...eonet, ...emsc];
}
