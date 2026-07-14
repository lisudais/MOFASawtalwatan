// Flight monitoring — frontend service. Calls ONLY our own /api/opensky proxy
// (OpenSky Network, free/anonymous). Fully isolated from alert/risk data.

export interface Flight {
  icao24: string;
  callsign: string;
  originCountry: string;
  latitude: number;
  longitude: number;
  baroAltitude: number | null; // metres
  velocity: number | null;     // m/s
  heading: number | null;      // degrees
  lastContact: number | null;  // unix seconds
}

// ── Tunables (the flight layer's only knobs) ────────────────────────────
/** How often the client polls the proxy. Change this one value to 3000 for a
 *  3-second cadence. NOTE: this polls OUR proxy, which caches upstream ~15s, so
 *  faster client polling drives smoother interpolation without extra OpenSky
 *  calls. */
export const FLIGHT_REFRESH_INTERVAL_MS = 3000;
/** Duration a marker takes to glide from its previous snapshot to the newest
 *  one. Set to ~ the upstream snapshot cadence (proxy cache TTL) so aircraft
 *  arrive at each real position just as the next one is fetched — smooth motion
 *  strictly between two REAL points, never an invented route. */
export const FLIGHT_INTERPOLATION_MS = 15000;
/** Drop an aircraft that hasn't appeared in any response for this long. */
export const FLIGHT_STALE_TIMEOUT_MS = 45000;

export interface FlightFetchResult {
  ok: boolean;
  states: Flight[];
  /** Human-readable provenance, for dev logs only (no secrets). */
  source: string;
  /** Why the fetch returned no data (e.g. rate-limited 429), when ok:false. */
  reason?: string;
}

const SOURCE = 'OpenSky Network (via /api/opensky proxy)';

/** Fetches the latest states from our proxy. Never throws; `ok:false` signals a
 *  transport/upstream failure so the caller can keep the last good aircraft. */
export async function fetchFlightStates(): Promise<FlightFetchResult> {
  try {
    const res = await fetch('/api/opensky', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, states: [], source: SOURCE, reason: `proxy ${res.status}` };
    const data = await res.json();
    const states = Array.isArray(data?.states) ? (data.states as Flight[]) : [];
    // The proxy sets ok:false on upstream failure while still returning a shape.
    return { ok: data?.ok !== false, states, source: SOURCE, reason: data?.reason };
  } catch {
    return { ok: false, states: [], source: SOURCE, reason: 'proxy unreachable' };
  }
}

/** Back-compat thin wrapper (returns just the array). */
export async function fetchFlights(): Promise<Flight[]> {
  return (await fetchFlightStates()).states;
}
