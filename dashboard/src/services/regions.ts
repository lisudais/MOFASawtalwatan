export type Region = 'UNITED_STATES' | 'EUROPE' | 'LATIN_AMERICA' | 'AFRICA' | 'OTHER';

export const REGION_LABEL_AR: Record<Region, string> = {
  UNITED_STATES: 'الولايات المتحدة',
  EUROPE: 'أوروبا',
  LATIN_AMERICA: 'أمريكا اللاتينية',
  AFRICA: 'أفريقيا',
  OTHER: 'مناطق أخرى',
};

export const REGION_LABEL_EN: Record<Region, string> = {
  UNITED_STATES: 'UNITED STATES',
  EUROPE: 'EUROPE',
  LATIN_AMERICA: 'LATIN AMERICA',
  AFRICA: 'AFRICA',
  OTHER: 'OTHER REGIONS',
};

/**
 * Approximate region from lat/lng using rough bounding boxes — used because most
 * of our live sources (GDACS/EONET/EMSC) never populate a countryCode, but every
 * event carries real coordinates. This is a coarse approximation (e.g. North
 * Africa/Mediterranean edges can misclassify), not a precise geocoder.
 */
export function guessRegion(lat: number, lng: number): Region {
  // United States (CONUS + Alaska + Hawaii)
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return 'UNITED_STATES';
  if (lat >= 51 && lat <= 72 && lng >= -170 && lng <= -129) return 'UNITED_STATES';
  if (lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154) return 'UNITED_STATES';

  // Latin America (Mexico through South America)
  if (lat >= -56 && lat <= 33 && lng >= -118 && lng <= -34) return 'LATIN_AMERICA';

  // Europe
  if (lat >= 34 && lat <= 72 && lng >= -25 && lng <= 45) return 'EUROPE';

  // Africa
  if (lat >= -35 && lat <= 38 && lng >= -20 && lng <= 52) return 'AFRICA';

  return 'OTHER';
}
