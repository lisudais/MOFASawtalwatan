// Shared flight-status source for BOTH the map's "حركة الطيران" layer and the
// AI assistant — one fetch loop, one cache, no duplicate API calls.
//
// The map layer used to own its own fetch (WorldMap local state). Lifting it
// here means the assistant can read the SAME live OpenSky data the map draws,
// without a second /api/opensky request. Consumers subscribe via useFlights();
// the underlying 15s poll is REF-COUNTED, so N subscribers still share ONE loop.
//
// No new data source and no mock: this only re-exposes services/opensky.ts's
// existing fetchFlights() result. The map's own rendering is untouched.

import { useEffect, useState } from 'react';
import { fetchFlights, type Flight } from './opensky';

// The Arabic summariser is pure and dependency-free; re-exported here so callers
// import both the hook and the summary from one place.
export { buildFlightStatusSummary, type FlightSummaryOpts } from './flightSummary';

const REFRESH_MS = 15000; // same cadence the map layer already used

// ── Module-level shared state (singleton) ───────────────────────────────────
let cache: Flight[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let activeCount = 0;
const subscribers = new Set<(f: Flight[]) => void>();

async function loadOnce(): Promise<void> {
  const data = await fetchFlights();
  cache = data;
  subscribers.forEach((cb) => cb(cache));
}

function startLoop(): void {
  if (timer) return;
  loadOnce();                       // immediate first load
  timer = setInterval(loadOnce, REFRESH_MS);
}

function stopLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Latest shared flights snapshot (cache) — for non-hook readers. */
export function getFlightsSnapshot(): Flight[] {
  return cache;
}

/**
 * Subscribe to the shared live flight feed. While `active` is true the shared
 * 15s poll runs (ref-counted → many consumers = ONE fetch loop). Returns the
 * latest flights, updating live as the poll refreshes.
 */
export function useFlights(active = true): Flight[] {
  const [flights, setFlights] = useState<Flight[]>(cache);

  useEffect(() => {
    if (!active) return;
    subscribers.add(setFlights);
    activeCount += 1;
    startLoop();
    setFlights(cache); // paint immediately from the shared cache
    return () => {
      subscribers.delete(setFlights);
      activeCount -= 1;
      if (activeCount <= 0) stopLoop();
    };
  }, [active]);

  return flights;
}
