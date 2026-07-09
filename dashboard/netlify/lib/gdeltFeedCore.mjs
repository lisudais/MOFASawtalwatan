// Global Alert Feed — Stage 1 broad GDELT catch-all detection layer.
//
// Server-side only: GDELT sends no CORS header, so the browser cannot call it.
// This is a NEW route (/api/gdelt-feed) and is deliberately separate from the
// GDELT queries inside statementsCore.mjs and securityCore.mjs, which serve the
// Statements and Security cards and must not change.
//
// Design notes vs. the existing GDELT integrations, both of which the audit
// found returning zero usable rows:
//   • securityCore filters articles with `title.includes(country.en)` in
//     English, so Arabic-language reporting never matches. We do NO country
//     filtering here — Stage 2's constrained classifier resolves the country.
//   • statementsCore restricts to four English MFA phrases. We use a broad
//     risk-domain query, because this layer's job is unstructured catch-all.
//
// Failures are reported, never swallowed: the payload always carries ok +
// httpStatus so the frontend can surface a degraded source instead of silently
// showing fewer cards.

import { request as httpsRequest } from 'node:https';

const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = Number(process.env.GDELT_TIMEOUT_MS ?? 25000);
const MAX_RECORDS = 250;
const TIMESPAN = process.env.GDELT_FEED_TIMESPAN ?? '3d';

// ── Query 1: broad catch-all (DETECTION) ────────────────────────────────────
// No country/language/domain filter — narrowing here is what starved the two
// existing GDELT integrations. Feeds Stage 2's classifier.
const BROAD_QUERY =
  '(conflict OR clashes OR attack OR terrorism OR protest OR unrest OR evacuation ' +
  'OR earthquake OR flood OR cyclone OR wildfire OR outbreak OR epidemic ' +
  'OR sanctions OR "state of emergency" OR curfew)';

// ── Query 2: domain-filtered (TIER-2 CORROBORATION) ─────────────────────────
// The broad query returns the global long tail: measured, 250 articles across
// 170 domains with ZERO hits on any trusted wire service. Stage 3 routes those
// to tier:null, so Stage 5 caps them at 30 and nothing can ever corroborate.
// This second query asks GDELT specifically for the four Tier-2 outlets.
//
// Two measured constraints shape it:
//   • GDELT rejects long queries outright ("Your query was too short or too
//     long", HTTP 200 + prose body). The full 15-term risk list plus four
//     domain clauses is over the limit, so the term set is trimmed to 7.
//   • GDELT SUBSTRING-matches `domain:` — `domain:apnews.com` also returns
//     `kelownacapnews.com`. We do not filter that here; routing.ts matches
//     domains strictly (exact or dot-suffix), so the artifact is rejected there.
const TIER2_QUERY =
  '(conflict OR attack OR protest OR earthquake OR flood OR outbreak OR sanctions) ' +
  '(domain:reuters.com OR domain:apnews.com OR domain:bbc.com OR domain:bloomberg.com)';

function urlFor(query) {
  return (
    'https://api.gdeltproject.org/api/v2/doc/doc' +
    `?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&maxrecords=${MAX_RECORDS}&format=json&sort=DateDesc&timespan=${TIMESPAN}`
  );
}

let cache = { at: 0, payload: null };

/* ─── Rate limiter ──────────────────────────────────────────────────────────
   GDELT enforces "one request every 5 seconds" per client and answers a
   violation with HTTP 429 and a plain-text body. This dashboard has three
   independent GDELT callers (statementsCore, securityCore, and this module),
   all firing on page load, so two of them lose the race. Those two modules
   serve the Statements and Security cards and are deliberately NOT touched
   here — instead this module makes itself a well-behaved client that can win
   the budget back: it spaces its own calls, coalesces concurrent callers into
   a single upstream request, and backs off rather than hammering on 429.

   Consequence to be aware of: since the other two callers still consume the
   same per-IP budget without spacing, an occasional 429 here remains possible.
   That is why we retry with backoff and never cache a failure. ──────────── */

const MIN_SPACING_MS = Number(process.env.GDELT_MIN_SPACING_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.GDELT_MAX_ATTEMPTS ?? 4);
// After the final 429 we stop calling GDELT entirely for this long, so a
// rate-limited dashboard doesn't turn into a retry storm.
const COOLDOWN_MS = Number(process.env.GDELT_COOLDOWN_MS ?? 60_000);

let lastRequestAt = 0;
let blockedUntil = 0;
let inFlight = null; // single-flight: concurrent callers share one upstream call

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// api.gdeltproject.org is reachable but slow to connect (~10-14s observed), and
// undici's DEFAULT CONNECT TIMEOUT IS 10s — it fires before any request-level
// AbortSignal, surfacing as an opaque `TypeError: fetch failed`. So a connect
// timeout here means "too slow", not "down", and must be retried rather than
// reported as a hard failure.
const RETRYABLE_TRANSPORT = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);

function isRetryableTransportError(err) {
  return RETRYABLE_TRANSPORT.has(err?.code) || RETRYABLE_TRANSPORT.has(err?.cause?.code) || err?.name === 'TimeoutError';
}

/** Blocks until at least MIN_SPACING_MS has elapsed since the last upstream call. */
async function waitForSlot() {
  const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
}

/** GDELT sends Retry-After only sometimes; fall back to exponential backoff. */
function backoffMs(res, attempt) {
  const header = Number(res?.retryAfter);
  if (Number.isFinite(header) && header > 0) return header * 1000;
  return MIN_SPACING_MS * 2 ** attempt; // 5s, 10s, 20s
}

// "20260709T081234Z" and "20260709081234" both occur across GDELT modes.
function parseGdeltDate(raw) {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  const m = digits.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
}

/**
 * GDELT's TCP connect regularly takes 10-14s. Node's global fetch() is undici,
 * whose CONNECT timeout is hard-coded to 10s and is not configurable through the
 * fetch options — it fires first and surfaces as an opaque `TypeError: fetch
 * failed`, regardless of any AbortSignal we pass. node:https lets us set the
 * timeout ourselves, so this one call bypasses fetch. Everything else in the
 * repo keeps using fetch.
 */
function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        timeout: timeoutMs, // covers connect AND socket idle
        headers: {
          'User-Agent': 'nawatai-dashboard/1.0 (global-alert-feed)',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          retryAfter: res.headers['retry-after'] ?? null,
          body,
        }));
      }
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('connect/idle timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** One upstream attempt. Returns a normalized result; never throws. */
async function attemptFetch(query) {
  await waitForSlot();
  lastRequestAt = Date.now();

  const res = await httpsGet(urlFor(query), TIMEOUT_MS);
  const httpStatus = res.status;

  if (httpStatus === 429) return { retryable: true, res, httpStatus };
  if (httpStatus < 200 || httpStatus >= 300) {
    return { retryable: false, result: { ok: false, httpStatus, articles: [], cached: false, error: `gdelt ${httpStatus}` } };
  }

  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    // GDELT's rejection path: HTTP 200 with a plain-text body. Its 429 body is
    // also prose, which is why the status check above must come first.
    return {
      retryable: false,
      result: {
        ok: false, httpStatus, articles: [], cached: false,
        error: `gdelt returned non-JSON (query rejected?): ${res.body.slice(0, 120)}`,
      },
    };
  }

  if (!Array.isArray(data?.articles)) {
    return { retryable: false, result: { ok: false, httpStatus, articles: [], cached: false, error: 'gdelt payload has no articles[]' } };
  }

  const articles = data.articles
    .map((a) => ({
      url: a.url ?? null,
      title: a.title ?? '',
      domain: a.domain ?? null,
      language: a.language ?? null,
      seenAt: parseGdeltDate(a.seendate),
    }))
    .filter((a) => a.title && a.url && a.seenAt);

  return { retryable: false, result: { ok: true, httpStatus, articles, cached: false, timespan: TIMESPAN } };
}

/** Spaced + backed-off fetch of ONE query. Only ever called by one caller at a time. */
async function fetchWithBackoff(query) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const a = await attemptFetch(query);
      if (!a.retryable) return a.result;
      lastStatus = a.httpStatus; // 429
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(a.res, attempt));
    } catch (err) {
      if (!isRetryableTransportError(err) || attempt === MAX_ATTEMPTS - 1) {
        return {
          ok: false, httpStatus: 0, articles: [], cached: false,
          error: `${err?.code ?? err?.cause?.code ?? err?.name ?? 'request failed'} after ${attempt + 1} attempt(s)`,
        };
      }
      lastStatus = 0;
      await sleep(backoffMs(null, attempt));
    }
  }

  // Exhausted retries against a 429: stop calling GDELT for a while so the
  // dashboard doesn't become a retry storm competing with its own other callers.
  // Only a genuine 429 warrants a cooldown; a slow-connect run should be retried
  // on the next poll rather than locking the source out for a minute.
  if (lastStatus === 429) blockedUntil = Date.now() + COOLDOWN_MS;
  return {
    ok: false,
    httpStatus: lastStatus,
    articles: [],
    cached: false,
    error: lastStatus === 429
      ? `gdelt rate-limited (429) after ${MAX_ATTEMPTS} attempts; cooling down ${Math.round(COOLDOWN_MS / 1000)}s`
      : `gdelt unreachable after ${MAX_ATTEMPTS} attempts`,
  };
}

/**
 * Returns { ok, httpStatus, articles, cached, error }. Never throws.
 *
 * A successful payload is cached for CACHE_TTL_MS. A FAILURE is never cached —
 * serving a stale success after an outage would hide the outage, which is the
 * exact silent-failure pattern this pipeline exists to eliminate.
 */
/**
 * Runs BOTH queries and merges them. Returns
 *   { ok, httpStatus, articles:[{..., queryKind}], queries:{broad,tier2}, cached, error }
 * Never throws.
 *
 * `ok` reflects the BROAD query — that is the detection layer the feed depends
 * on. A tier2 failure degrades corroboration but is not fatal, and is reported
 * separately in `queries.tier2` rather than being folded into a single boolean.
 *
 * The two calls run SEQUENTIALLY, not in parallel: they share one 5s-spaced
 * rate-limit budget, so firing them together would guarantee a 429 on the second.
 *
 * A successful payload is cached for CACHE_TTL_MS. A FAILURE is never cached —
 * serving a stale success after an outage would hide the outage.
 */
export async function getGdeltFeed() {
  if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true };
  }

  if (Date.now() < blockedUntil) {
    return {
      ok: false, httpStatus: 429, articles: [], cached: false,
      queries: { broad: { ok: false, count: 0 }, tier2: { ok: false, count: 0 } },
      error: `gdelt in rate-limit cooldown for ${Math.ceil((blockedUntil - Date.now()) / 1000)}s`,
    };
  }

  // Single-flight: concurrent callers (page refreshes, the probe, multiple
  // dashboard tabs) share one upstream round instead of each burning slots.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const broad = await fetchWithBackoff(BROAD_QUERY);

      // Only spend a second slot if the first query worked and we aren't cooling
      // down; otherwise tier2 would just eat retries against the same 429.
      const tier2 = broad.ok && Date.now() >= blockedUntil
        ? await fetchWithBackoff(TIER2_QUERY)
        : { ok: false, httpStatus: 0, articles: [], error: 'skipped: broad query failed or rate-limited' };

      const tag = (arr, queryKind) => arr.map((a) => ({ ...a, queryKind }));

      // Merge, preferring the tier2 tag when an article appears in both — its
      // provenance is what Stage 3 needs. Dedup by url.
      const byUrl = new Map();
      for (const a of tag(broad.articles ?? [], 'broad')) byUrl.set(a.url, a);
      for (const a of tag(tier2.articles ?? [], 'tier2')) byUrl.set(a.url, a);

      const payload = {
        ok: broad.ok,
        httpStatus: broad.httpStatus,
        articles: [...byUrl.values()],
        queries: {
          broad: { ok: broad.ok, count: broad.articles?.length ?? 0, error: broad.error },
          tier2: { ok: tier2.ok, count: tier2.articles?.length ?? 0, error: tier2.error },
        },
        cached: false,
        timespan: TIMESPAN,
        error: broad.error,
      };

      if (payload.ok) cache = { at: Date.now(), payload };
      return payload;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export const GDELT_FEED_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
