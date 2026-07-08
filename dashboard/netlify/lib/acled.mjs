// ACLED conflict-events fetcher (BACKEND ONLY — credentials never reach the
// browser). ACLED uses OAuth2; we support two configurations, read strictly
// from environment variables (nothing hardcoded):
//   1. ACLED_ACCESS_TOKEN                     → used directly as a Bearer token.
//   2. ACLED_EMAIL + ACLED_PASSWORD           → OAuth2 password grant against
//      (+ optional ACLED_CLIENT_ID / _SECRET)   https://acleddata.com/oauth/token
//
// If neither is set, ACLED is "not configured": the pipeline reports that and
// the UI shows a warning — it NEVER falls back to mock events.
//
// Every returned event is normalised into the security-event shape and traces
// back to a real ACLED record. Nothing (coordinates, fatalities, actors) is
// invented — fields absent from the API become null/0/''.

const OAUTH_URL = 'https://acleddata.com/oauth/token';
const READ_URL = 'https://acleddata.com/api/acled/read';
const WINDOW_DAYS = 14;

function cfg() {
  return {
    token: process.env.ACLED_ACCESS_TOKEN,
    email: process.env.ACLED_EMAIL,
    password: process.env.ACLED_PASSWORD,
    clientId: process.env.ACLED_CLIENT_ID || 'acled',
    clientSecret: process.env.ACLED_CLIENT_SECRET,
  };
}

export function acledConfigured() {
  const c = cfg();
  return Boolean(c.token || (c.email && c.password));
}

async function getAccessToken() {
  const c = cfg();
  if (c.token) return c.token; // pre-generated token path
  const body = { username: c.email, password: c.password, grant_type: 'password', client_id: c.clientId };
  if (c.clientSecret) body.client_secret = c.clientSecret;
  try {
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.access_token ?? null;
  } catch {
    return null;
  }
}

function severityFromFatalities(f) {
  return f >= 10 ? 'CRITICAL' : f >= 3 ? 'HIGH' : f >= 1 ? 'MEDIUM' : 'LOW';
}

// One ACLED record → normalised security event. Missing fields stay empty/null.
function normalize(r) {
  const fatalities = Number(r.fatalities) || 0;
  const lat = parseFloat(r.latitude);
  const lng = parseFloat(r.longitude);
  const eventType = r.event_type ?? '';
  const location = r.location ?? r.admin1 ?? '';
  if (!eventType && !location) return null;
  return {
    id: `acled-${r.event_id_cnty ?? `${r.iso}-${r.event_date}-${location}`}`,
    title: [eventType, location].filter(Boolean).join(' — '),
    country: r.country ?? '',
    location,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    eventDate: r.event_date ?? '',
    eventType,
    subEventType: r.sub_event_type ?? '',
    fatalities,
    actor1: r.actor1 ?? '',
    actor2: r.actor2 ?? '',
    notes: r.notes ?? '',
    severity: severityFromFatalities(fatalities),
    source: 'ACLED',
    sourceUrl: 'https://acleddata.com/dashboard/',
    category: 'security',
  };
}

// Returns { configured, ok, events }. Never throws.
export async function fetchAcledEvents() {
  if (!acledConfigured()) return { configured: false, ok: false, events: [] };
  try {
    const token = await getAccessToken();
    if (!token) return { configured: true, ok: false, events: [] };

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const url = `${READ_URL}?limit=600&event_date=${since}&event_date_where=%3E%3D`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { configured: true, ok: false, events: [] };

    const data = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const events = rows.map(normalize).filter(Boolean);
    return { configured: true, ok: true, events };
  } catch {
    return { configured: true, ok: false, events: [] };
  }
}
