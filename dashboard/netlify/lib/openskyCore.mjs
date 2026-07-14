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

// OpenSky migrated to OAuth2 (Keycloak) in 2025 and now throttles ANONYMOUS
// /states/all to ~nothing (HTTP 429 "Too many requests" almost immediately),
// which is why the flight layer showed no aircraft. Preferred auth is now a free
// OAuth2 CLIENT-CREDENTIALS pair (create one under your OpenSky account →
// "API Client"), supplied via env; legacy basic-auth and anonymous remain as
// fallbacks. Nothing is hardcoded.
const OAUTH_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let cache = { at: 0, data: null };
let tokenCache = { token: null, exp: 0 };

// Fetch + cache an OAuth2 access token via the client-credentials grant. Returns
// null when no client credentials are configured or the token request fails.
async function getBearerToken() {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  try {
    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');
    form.set('client_id', id);
    form.set('client_secret', secret);
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.access_token) return null;
    // Refresh a minute before expiry to avoid a mid-request 401.
    const ttl = Math.max(30, (Number(d.expires_in) || 1800) - 60);
    tokenCache = { token: d.access_token, exp: Date.now() + ttl * 1000 };
    return tokenCache.token;
  } catch {
    return null;
  }
}

// Resolve the best available auth: OAuth2 Bearer → legacy Basic → anonymous.
async function authHeaders() {
  const bearer = await getBearerToken();
  if (bearer) return { Authorization: `Bearer ${bearer}` };
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

// Returns { time, states, ok, cached, reason? }. Never throws.
export async function getOpenSkyStates() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  try {
    const res = await fetch(OPENSKY_URL, { headers: await authHeaders(), signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) {
      // 429 (anonymous rate-limit) / 401 (auth) → surface a reason for dev logs.
      // Briefly cache the failure so we don't hammer OpenSky and deepen the 429.
      const reason = res.status === 429 ? 'rate-limited (429) — configure OPENSKY_CLIENT_ID/SECRET'
        : res.status === 401 ? 'unauthorized (401) — check OpenSky credentials'
        : `upstream ${res.status}`;
      const payload = { time: 0, states: [], ok: false, cached: false, reason };
      cache = { at: Date.now(), data: payload };
      return payload;
    }
    const d = await res.json();
    const states = (Array.isArray(d?.states) ? d.states : [])
      .map(normalize)
      .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && !s.onGround)
      .slice(0, MAX_STATES);
    const payload = { time: d.time ?? 0, states, ok: true, cached: false };
    cache = { at: Date.now(), data: payload };
    return payload;
  } catch {
    return { time: 0, states: [], ok: false, reason: 'network/timeout' };
  }
}

export const OPENSKY_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
