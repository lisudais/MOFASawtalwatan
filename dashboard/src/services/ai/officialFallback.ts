// When a source link is unreachable or 404s, we never leave the user on a
// dead page — we resolve to that organization's current official landing
// page instead. This is a static map (not a live web search — no search API
// is configured in this project) but it's always the real official domain,
// never a third-party mirror.

export type OfficialOrg =
  | 'WHO' | 'USGS' | 'EMSC' | 'NOAA_NHC' | 'GDACS' | 'SMITHSONIAN_GVP'
  | 'NASA_FIRMS' | 'NASA_EONET' | 'RELIEFWEB' | 'GENERIC';

const FALLBACK_URL: Record<OfficialOrg, string> = {
  WHO: 'https://www.who.int/emergencies/disease-outbreak-news',
  USGS: 'https://earthquake.usgs.gov/earthquakes/map/',
  EMSC: 'https://www.seismicportal.eu/',
  NOAA_NHC: 'https://www.nhc.noaa.gov/',
  GDACS: 'https://www.gdacs.org/',
  SMITHSONIAN_GVP: 'https://volcano.si.edu/reports_weekly.cfm',
  NASA_FIRMS: 'https://firms.modaps.eosdis.nasa.gov/map/',
  NASA_EONET: 'https://eonet.gsfc.nasa.gov/',
  RELIEFWEB: 'https://reliefweb.int/updates',
  GENERIC: 'https://reliefweb.int/updates',
};

const ORG_MATCHERS: [OfficialOrg, RegExp][] = [
  ['WHO', /who\.int|world health organization/i],
  ['USGS', /usgs|earthquake\.usgs\.gov/i],
  ['EMSC', /emsc|seismicportal/i],
  ['NOAA_NHC', /nhc\.noaa\.gov|noaa|national hurricane center/i],
  ['GDACS', /gdacs/i],
  ['SMITHSONIAN_GVP', /volcano\.si\.edu|smithsonian|global volcanism|gvp/i],
  ['NASA_FIRMS', /firms\.modaps|firms/i],
  ['NASA_EONET', /eonet/i],
  ['RELIEFWEB', /reliefweb/i],
];

// Best-effort detection of which org a URL and/or a free-text hint (source
// name, adapter label) belongs to, so callers don't have to track it
// explicitly at every place a link is rendered.
export function detectOfficialOrg(...hints: (string | null | undefined)[]): OfficialOrg {
  const haystack = hints.filter(Boolean).join(' ');
  for (const [org, re] of ORG_MATCHERS) {
    if (re.test(haystack)) return org;
  }
  return 'GENERIC';
}

export function officialFallbackUrl(...hints: (string | null | undefined)[]): string {
  return FALLBACK_URL[detectOfficialOrg(...hints)];
}
