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

export async function fetchFlights(): Promise<Flight[]> {
  try {
    const res = await fetch('/api/opensky', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.states) ? (data.states as Flight[]) : [];
  } catch {
    return [];
  }
}
