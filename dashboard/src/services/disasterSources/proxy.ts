// A few upstream APIs (GDACS, NOAA NHC, Smithsonian GVP) don't set
// Access-Control-Allow-Origin, so a browser fetch() is blocked by CORS.
// Same workaround already used by services/gdacs.ts for the GDACS RSS feed.
export function corsProxy(url: string): string {
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
}
