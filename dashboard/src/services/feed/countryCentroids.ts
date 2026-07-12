// Approximate country centroids (lat/lng) for the map's risk-highlight layer.
//
// The repo carries no country-boundary data, so the risk layer draws a
// translucent circle at each country's centroid rather than a true polygon
// outline. Deliberately approximate — a regional blob, not a border — and used
// only for the RED (current risk) and BLUE (experimental) highlight layers.
//
// Covers the 45-country classifier watchlist plus the off-watchlist ISO2 codes
// that USGS's place-name heuristic can emit (US, JP, CN, …), so any country that
// can appear on a feed card can be placed. A country with no centroid here is
// simply not drawn — honest about the gap rather than guessing a location.

export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  // ── Watchlist (Middle East / North Africa / Sahel / conflict belt) ──
  YE: [15.55, 48.52], SY: [34.80, 38.99], IQ: [33.22, 43.68], IR: [32.43, 53.69],
  LB: [33.85, 35.86], JO: [30.59, 36.24], KW: [29.31, 47.48], OM: [21.47, 55.98],
  QA: [25.35, 51.18], BH: [26.03, 50.55], AE: [23.42, 53.85], EG: [26.82, 30.80],
  SD: [12.86, 30.22], SS: [6.88, 31.31], LY: [26.34, 17.23], TN: [33.89, 9.54],
  DZ: [28.03, 1.66], MA: [31.79, -7.09], MR: [21.01, -10.94], SO: [5.15, 46.20],
  DJ: [11.83, 42.59], TR: [38.96, 35.24], IL: [31.05, 34.85], AF: [33.94, 67.71],
  PK: [30.38, 69.35], IN: [20.59, 78.96], BD: [23.68, 90.36], NG: [9.08, 8.68],
  ML: [17.57, -4.00], NE: [17.61, 8.08], BF: [12.24, -1.56], TD: [15.45, 18.73],
  ET: [9.15, 40.49], CD: [-4.04, 21.76], CF: [6.61, 20.94], UA: [48.38, 31.17],
  RU: [61.52, 105.32], VE: [6.42, -66.59], HT: [18.97, -72.29], MM: [21.91, 95.96],
  KP: [40.34, 127.51], CO: [4.57, -74.30], MX: [23.63, -102.55], PH: [12.88, 121.77],
  ID: [-0.79, 113.92],
  // ── Off-watchlist codes USGS guessCountryCode can emit ──
  US: [39.83, -98.58], JP: [36.20, 138.25], CL: [-35.68, -71.54], NZ: [-40.90, 174.89],
  GR: [39.07, 21.82], IT: [41.87, 12.57], NP: [28.39, 84.12], PE: [-9.19, -75.02],
  EC: [-1.83, -78.18], PG: [-6.31, 143.96], CN: [35.86, 104.20], TW: [23.70, 120.96],
  FJ: [-17.71, 178.07], TO: [-21.18, -175.20], SB: [-9.65, 160.16], VU: [-15.38, 166.96],
};

/** Centroid for an ISO2 code, or null when we have no coordinate for it. */
export function centroidFor(iso2: string | null | undefined): [number, number] | null {
  if (!iso2) return null;
  return COUNTRY_CENTROIDS[iso2] ?? null;
}

// ISO 3166-1 alpha-2 → alpha-3, for matching feed cards (keyed by ISO2) to the
// world-countries GeoJSON (whose feature `id` is ISO alpha-3). Same country set
// as the centroids above.
export const ISO2_TO_ISO3: Record<string, string> = {
  YE: 'YEM', SY: 'SYR', IQ: 'IRQ', IR: 'IRN', LB: 'LBN', JO: 'JOR', KW: 'KWT',
  OM: 'OMN', QA: 'QAT', BH: 'BHR', AE: 'ARE', EG: 'EGY', SD: 'SDN', SS: 'SSD',
  LY: 'LBY', TN: 'TUN', DZ: 'DZA', MA: 'MAR', MR: 'MRT', SO: 'SOM', DJ: 'DJI',
  TR: 'TUR', IL: 'ISR', AF: 'AFG', PK: 'PAK', IN: 'IND', BD: 'BGD', NG: 'NGA',
  ML: 'MLI', NE: 'NER', BF: 'BFA', TD: 'TCD', ET: 'ETH', CD: 'COD', CF: 'CAF',
  UA: 'UKR', RU: 'RUS', VE: 'VEN', HT: 'HTI', MM: 'MMR', KP: 'PRK', CO: 'COL',
  MX: 'MEX', PH: 'PHL', ID: 'IDN', US: 'USA', JP: 'JPN', CL: 'CHL', NZ: 'NZL',
  GR: 'GRC', IT: 'ITA', NP: 'NPL', PE: 'PER', EC: 'ECU', PG: 'PNG', CN: 'CHN',
  TW: 'TWN', FJ: 'FJI', TO: 'TON', SB: 'SLB', VU: 'VUT',
};

export function iso3For(iso2: string | null | undefined): string | null {
  if (!iso2) return null;
  return ISO2_TO_ISO3[iso2] ?? null;
}

// ISO3 codes absent from the 110m world-countries GeoJSON (too small at that
// resolution): Bahrain, Tonga. These fall back to a centroid circle so a
// high-risk Gulf state like Bahrain is never silently dropped from the map.
export const ISO3_WITHOUT_POLYGON = new Set(['BHR', 'TON']);
