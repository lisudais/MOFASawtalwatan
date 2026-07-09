// Flight monitoring proxy — OpenSky Network live aircraft states.
//
// Isolated from all alert/risk data. Uses FREE ANONYMOUS access by default (no
// key required). Optional basic-auth credentials may be supplied via env
// (OPENSKY_USERNAME / OPENSKY_PASSWORD) to raise rate limits — nothing is
// hardcoded and no paid API is used. Results are cached ~15s to respect the
// anonymous rate limit; the /api/opensky route refreshes on that cadence.

// Anonymous OpenSky throttles the unbounded /states/all query, but a bounded
// bbox query works. Default to a broad region (Africa → Europe → Middle East →
// South/Central Asia) covering the dashboard's area of interest; overridable via
// env (OPENSKY_LAMIN / _LOMIN / _LAMAX / _LOMAX) without touching code.
const BBOX = {
  lamin: process.env.OPENSKY_LAMIN ?? '0',
  lomin: process.env.OPENSKY_LOMIN ?? '-15',
  lamax: process.env.OPENSKY_LAMAX ?? '60',
  lomax: process.env.OPENSKY_LOMAX ?? '100',
};
const OPENSKY_URL =
  `https://opensky-network.org/api/states/all?lamin=${BBOX.lamin}&lomin=${BBOX.lomin}&lamax=${BBOX.lamax}&lomax=${BBOX.lomax}`;
const CACHE_TTL_MS = 15000;
const MAX_STATES = 300; // cap payload so the map stays readable
const TIMEOUT = 12000;

let cache = { at: 0, data: null };

function authHeaders() {
  const u = process.env.OPENSKY_USERNAME;
  const p = process.env.OPENSKY_PASSWORD;
  if (u && p) return { Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') };
  return {};
}

// OpenSky "states" are positional arrays; index map per their API docs.
function normalize(s) {
  return {
    icao24: s[0] ?? '',
    callsign: (s[1] ?? '').trim(),
    originCountry: s[2] ?? '',
    lastContact: s[4] ?? null,
    longitude: s[5],
    latitude: s[6],
    baroAltitude: s[7],       // metres
    onGround: s[8],
    velocity: s[9],           // m/s
    heading: s[10],           // degrees (true track)
    geoAltitude: s[13],       // metres
  };
}

// Returns { time, states, ok, cached }. Never throws.
export async function getOpenSkyStates() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  try {
    const res = await fetch(OPENSKY_URL, { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return { time: 0, states: [], ok: false };
    const d = await res.json();
    const states = (Array.isArray(d?.states) ? d.states : [])
      .map(normalize)
      .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && !s.onGround)
      .slice(0, MAX_STATES);
    const payload = { time: d.time ?? 0, states, ok: true, cached: false };
    cache = { at: Date.now(), data: payload };
    return payload;
  } catch {
    return { time: 0, states: [], ok: false };
  }
}

export const OPENSKY_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
