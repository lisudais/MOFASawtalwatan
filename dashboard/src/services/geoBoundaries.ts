import { useEffect, useState } from 'react';
import type { FeatureCollection } from 'geojson';

/**
 * Lazily fetches a boundary GeoJSON (once per url) and caches it in component
 * state. Shared by WorldMap's risk-highlight layer and EmbassyMap's
 * host-country outline — one fetch-with-cancellation implementation, not two.
 * `enabled` lets a caller defer the fetch until the layer is actually toggled
 * on; once loaded, toggling `enabled` off and back on doesn't re-fetch.
 */
export function useBoundariesGeoJson(url: string, enabled: boolean): FeatureCollection | null {
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!enabled || geo) return;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setGeo(d); })
      .catch(() => { /* layer just won't draw; callers should have a fallback */ });
    return () => { cancelled = true; };
  }, [url, enabled, geo]);
  return geo;
}
