import type { GeoEvent } from '../types';
import { scoreToRiskLevel, getRecommendedAction } from './riskEngine';

const USGS_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';

const COUNTRY_CODES: Record<string, string> = {
  Japan: 'JP', Indonesia: 'ID', Chile: 'CL', Mexico: 'MX', 'New Zealand': 'NZ',
  Turkey: 'TR', Greece: 'GR', Italy: 'IT', Philippines: 'PH', Iran: 'IR',
  Pakistan: 'PK', Afghanistan: 'AF', Nepal: 'NP', Peru: 'PE', Colombia: 'CO',
  Ecuador: 'EC', Papua: 'PG', Russia: 'RU', China: 'CN', India: 'IN',
  United: 'US', Hawaii: 'US', Alaska: 'US', California: 'US', Nevada: 'US',
  Taiwan: 'TW', Fiji: 'FJ', Tonga: 'TO', Solomon: 'SB', Vanuatu: 'VU',
};

function guessCountryCode(place: string): string {
  for (const [key, code] of Object.entries(COUNTRY_CODES)) {
    if (place.includes(key)) return code;
  }
  return '';
}

function magToScore(mag: number): number {
  if (mag >= 8.0) return 95;
  if (mag >= 7.0) return 85;
  if (mag >= 6.5) return 75;
  if (mag >= 6.0) return 65;
  if (mag >= 5.0) return 50;
  return 35;
}

export async function fetchUSGSEarthquakes(): Promise<GeoEvent[]> {
  try {
    const res = await fetch(USGS_URL, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    return (data.features as any[]).slice(0, 30).map((f, i) => {
      const props = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const mag: number = props.mag ?? 5;
      const place: string = props.place ?? '';
      const score = magToScore(mag);
      const riskLevel = scoreToRiskLevel(score);
      const countryCode = guessCountryCode(place);
      const country = place.split(', ').pop() ?? place;

      return {
        id: `usgs-${i}-${props.time}`,
        title: `M${mag.toFixed(1)} Earthquake — ${place}`,
        type: 'EARTHQUAKE' as const,
        riskLevel,
        country,
        countryCode,
        lat,
        lng,
        description: `Magnitude ${mag} earthquake at depth ${f.geometry.coordinates[2]} km near ${place}.`,
        source: 'USGS' as const,
        timestamp: new Date(props.time),
        score,
        recommendedAction: getRecommendedAction(riskLevel, 'EARTHQUAKE'),
      } as GeoEvent;
    });
  } catch {
    return [];
  }
}
