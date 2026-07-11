// ACLED conflict-events fetcher (BACKEND ONLY — credentials never reach the
// browser). ACLED uses OAuth2; we support two configurations, read strictly
// from environment variables (nothing hardcoded):
//   1. ACLED_ACCESS_TOKEN                     → used directly as a Bearer token.
//   2. ACLED_EMAIL + ACLED_PASSWORD           → OAuth2 password grant against
//      (+ optional ACLED_CLIENT_ID / _SECRET)   https://acleddata.com/oauth/token
//
// If neither is set, ACLED is "not configured": the pipeline reports that
// internally (securityCore.mjs), and the UI simply shows its generic
// unavailable/empty state — it NEVER falls back to mock events and never
// surfaces this as a technical/config error to the user.
//
// Every stage of the pipeline is logged to the SERVER console (netlify
// dev/function logs — never sent to the browser, so this is always safe to
// leave on): the exact request URL, response status, how many raw rows
// ACLED returned, how many survived normalization, and why any didn't. This
// is deliberate — a silent "0 events" is indistinguishable from "ACLED is
// actually empty" unless every step that could drop a row is auditable.
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

// Parses a fetch Response as JSON without assuming a non-empty, well-formed
// body — ACLED (like most APIs) can return an empty body or malformed JSON
// on transient failures, and both need to be told apart from "valid JSON
// with zero results" rather than lumped together as one generic failure.
async function parseJsonResponse(res, label) {
  const text = await res.text();
  console.log(`[ACLED] ${label}: response body length=${text.length}`);
  if (!text) {
    console.error(`[ACLED] ${label}: response body was empty (HTTP ${res.status})`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[ACLED] ${label}: response was not valid JSON. Raw body:`, text.slice(0, 500), 'Parse error:', err);
    return null;
  }
}

// OAuth2 password grant. IMPORTANT: ACLED's token endpoint is a standard
// OAuth2 token endpoint (Keycloak-backed) and per RFC 6749 §4.3.2 REQUIRES
// `application/x-www-form-urlencoded`, NOT `application/json` — sending
// JSON here is a documented cause of silent auth failure that then presents
// as "ACLED returned zero events" downstream. Never log the password.
async function getAccessToken() {
  const c = cfg();
  if (c.token) {
    console.log('[ACLED] auth: using pre-generated ACLED_ACCESS_TOKEN');
    return c.token;
  }

  const form = new URLSearchParams();
  form.set('username', c.email ?? '');
  form.set('password', c.password ?? '');
  form.set('grant_type', 'password');
  form.set('client_id', c.clientId);
  if (c.clientSecret) form.set('client_secret', c.clientSecret);

  console.log(`[ACLED] auth: requesting OAuth token from ${OAUTH_URL} (username=${c.email}, client_id=${c.clientId})`);

  try {
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[ACLED] auth: OAuth response status=${res.status}`);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(`[ACLED] oauth token request responded ${res.status}. Body:`, bodyText.slice(0, 500));
      return null;
    }
    const d = await parseJsonResponse(res, 'oauth');
    if (!d?.access_token) {
      console.error('[ACLED] oauth response had no access_token — check ACLED_EMAIL/ACLED_PASSWORD. Full response:', d);
      return null;
    }
    console.log('[ACLED] auth: obtained access token successfully');
    return d.access_token;
  } catch (err) {
    console.error('[ACLED] oauth request threw:', err);
    return null;
  }
}

function severityFromFatalities(f) {
  return f >= 10 ? 'CRITICAL' : f >= 3 ? 'HIGH' : f >= 1 ? 'MEDIUM' : 'LOW';
}

// Coarse ACLED event_type → weighted-scoring bucket, used only by the
// Security module's risk-score factors (securityCore.mjs). Never changes
// the event's own displayed type/label.
export function classifyAcled(eventType) {
  switch (eventType) {
    case 'Battles':
    case 'Violence against civilians':
      return 'armedConflict';
    case 'Explosions/Remote violence':
      return 'terrorism';
    case 'Riots':
    case 'Protests':
      return 'civilUnrest';
    default:
      return null;
  }
}

// One ACLED record → normalised security event, or null if the row is
// unusable (both event_type and location/admin1 missing — essentially never
// happens for real ACLED rows). Returns { event, reason } so the caller can
// count and report exactly how many rows were dropped here and why.
function normalize(r) {
  const fatalities = Number(r.fatalities) || 0;
  const lat = parseFloat(r.latitude);
  const lng = parseFloat(r.longitude);
  const eventType = r.event_type ?? '';
  const location = r.location ?? r.admin1 ?? '';
  if (!eventType && !location) {
    return { event: null, reason: 'missing both event_type and location/admin1' };
  }
  return {
    event: {
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
    },
    reason: null,
  };
}

// One attempt at the ACLED read call. Returns an events array on success, or
// null on ANY failure (network error, non-2xx, empty body, invalid JSON, or
// ACLED reporting `success: false` — which it can do on a 200 response for
// bad parameters/auth/quota issues). null is the caller's cue to retry, and
// it is never confused with a legitimate empty result: a genuinely empty
// result is `data.data === []` with `success !== false`, which returns `[]`.
async function readOnce(token) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = `${READ_URL}?limit=2000&event_date=${since}&event_date_where=%3E%3D`;

  console.log(`[ACLED] read: GET ${url}`);
  console.log(`[ACLED] read: date filter = event_date >= ${since} (window: ${WINDOW_DAYS} days)`);

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
  } catch (err) {
    console.error('[ACLED] read request threw:', err);
    return null;
  }

  console.log(`[ACLED] read: response status=${res.status}`);
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error(`[ACLED] read responded ${res.status}. Body:`, bodyText.slice(0, 500));
    return null;
  }

  const data = await parseJsonResponse(res, 'read');
  if (data === null) return null;

  // ACLED signals logical failures (bad params, auth/quota problems) with
  // `success: false` even on HTTP 200 — never mistake that for zero events.
  if (data && data.success === false) {
    console.error('[ACLED] read reported success:false —', data.error ?? data);
    return null;
  }

  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  console.log(`[ACLED] read: parsed response — success=${data?.success}, reported count=${data?.count}, rows in data[]=${rows.length}`);

  const normalized = rows.map(normalize);
  const events = normalized.map((n) => n.event).filter(Boolean);
  const dropped = normalized.filter((n) => n.event === null);
  console.log(`[ACLED] read: ${rows.length} raw rows → ${events.length} events after normalization (${dropped.length} dropped)`);
  if (dropped.length > 0) {
    const reasonCounts = {};
    for (const d of dropped) reasonCounts[d.reason] = (reasonCounts[d.reason] ?? 0) + 1;
    console.log('[ACLED] read: drop reasons —', reasonCounts);
  }

  return events;
}

// Returns { configured, ok, events }. Never throws. Retries the read call
// once on failure (network blip / transient upstream error) before giving up.
export async function fetchAcledEvents() {
  if (!acledConfigured()) {
    console.log('[ACLED] not configured (no ACLED_ACCESS_TOKEN or ACLED_EMAIL/ACLED_PASSWORD env vars set)');
    return { configured: false, ok: false, events: [] };
  }
  try {
    const token = await getAccessToken();
    if (!token) {
      console.error('[ACLED] fetch aborted: could not obtain an access token (see auth logs above)');
      return { configured: true, ok: false, events: [] };
    }

    let events = await readOnce(token);
    if (events === null) {
      console.log('[ACLED] read failed once — retrying...');
      events = await readOnce(token);
    }
    if (events === null) {
      console.error('[ACLED] fetch failed after retry — returning ok:false, events:[] (this is NOT "zero active events", see logs above for the actual cause)');
      return { configured: true, ok: false, events: [] };
    }

    console.log(`[ACLED] fetch succeeded: ${events.length} total events available to the security module`);
    return { configured: true, ok: true, events };
  } catch (err) {
    console.error('[ACLED] fetch failed with an unexpected exception:', err);
    return { configured: true, ok: false, events: [] };
  }
}
