// ─────────────────────────────────────────────────────────────────────────
// Reverse geocoding for coordinate-only alerts.
//
// Some disaster events (notably NASA EONET wildfires whose title is a US-park or
// place name we can't map offline) arrive with real latitude/longitude but no
// resolved country. Rather than print "موقع غير محدد", we turn the coordinates
// into a real country name via the free OpenStreetMap / Nominatim reverse
// endpoint (CORS-open, keyless, Arabic labels via accept-language=ar).
//
// Nominatim's usage policy asks for ≤1 request/second and caching. We honour
// both: a module-level in-memory cache + a localStorage mirror (coordinates
// change rarely, so a hit costs zero network), and a serial 1.1s-spaced queue.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import type { AggregatedAlert } from './aggregateAlerts';

const LS_KEY = 'revgeo-cache-v1';
const REQUEST_SPACING_MS = 1100;

/** Coordinates snapped to ~11 km so nearby events share one cache entry / one request. */
export function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

function loadCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persist(cache: Record<string, string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — in-memory cache still works for this session
  }
}

const memCache: Record<string, string> = loadCache();

// Serial queue — Nominatim asks for ≤1 req/s; we space calls 1.1s apart.
let queue: Promise<void> = Promise.resolve();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchNominatim(lat: number, lng: number): Promise<string | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=3&addressdetails=1` +
      `&lat=${lat}&lon=${lng}&accept-language=ar`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data?.address ?? {};
    const country: string | undefined = addr.country;
    const region: string | undefined = addr.state ?? addr.region ?? addr.county;
    if (!country) return null;
    return region ? `${region}، ${country}` : country;
  } catch {
    return null;
  }
}

/** Cached, rate-limited reverse geocode. Returns null when the lookup yields nothing. */
export function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = coordKey(lat, lng);
  if (key in memCache) return Promise.resolve(memCache[key]);

  const run = queue.then(async () => {
    if (key in memCache) return; // resolved while waiting in the queue
    const name = await fetchNominatim(lat, lng);
    await delay(REQUEST_SPACING_MS);
    if (name) {
      memCache[key] = name;
      persist(memCache);
    }
  });
  // Keep the queue alive even if one lookup throws.
  queue = run.catch(() => {});
  return run.then(() => memCache[key] ?? null);
}

/**
 * Progressive enhancement: returns the alerts with coordinate-only locations
 * upgraded to real country names as Nominatim responds. Until then each such
 * alert keeps its coordinate string (never "غير محدد"), so the UI is always
 * populated and simply sharpens over the next second or two.
 */
export function useReverseGeocodedAlerts(alerts: AggregatedAlert[]): AggregatedAlert[] {
  const [resolved, setResolved] = useState<Record<string, string>>(() => ({ ...memCache }));

  useEffect(() => {
    let cancelled = false;
    const pending = alerts.filter(
      (a) =>
        a.needsGeocode &&
        a.lat != null &&
        a.lng != null &&
        !(coordKey(a.lat, a.lng) in resolved),
    );
    if (pending.length === 0) return;

    (async () => {
      for (const a of pending) {
        const name = await reverseGeocode(a.lat!, a.lng!);
        if (cancelled) return;
        if (name) {
          const key = coordKey(a.lat!, a.lng!);
          setResolved((prev) => (key in prev ? prev : { ...prev, [key]: name }));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [alerts, resolved]);

  return useMemo(
    () =>
      alerts.map((a) => {
        if (!a.needsGeocode || a.lat == null || a.lng == null) return a;
        const name = resolved[coordKey(a.lat, a.lng)];
        return name ? { ...a, location: name, needsGeocode: false } : a;
      }),
    [alerts, resolved],
  );
}
