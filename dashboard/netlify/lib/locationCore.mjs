// Global Alert Feed — deterministic, non-AI location DISPLAY resolver.
//
// Fixes "موقع غير محدد" cards WITHOUT touching Stage 2 classification, Stage 4
// corroboration, Stage 5 scoring or Stage 6 summarization — this module only
// adds a `location` string to each card DTO, computed AFTER the real pipeline
// has already produced eventType/country/score/summary. Nothing here can
// change what the AI stages classified, scored or wrote.
//
// Priority (per product spec — first one that clears its confidence bar wins):
//   1. City/region parsed from the source's own place text (title/description/
//      body — see RawSignal.placeText / rawText)
//   2. Reverse geocoding from REAL lat/lng (OpenStreetMap Nominatim — the same
//      OSM ecosystem the Hospitals/Airports layers already use)
//   3. Country clearly present — the classifier's already-verified `country`
//      first (cheapest, most authoritative), else a direct name match against
//      every ISO 3166-1 country name found in the source text (broader than
//      the classification watchlist, so an off-watchlist country still gets a
//      real name instead of "unknown")
//   4. "موقع غير محدد" — only when none of the above found anything reliable
//
// Every step is deterministic: regex + a real geocoding API + the ISO 3166-1
// list. No LLM call, no invented place, no random guess.

const REVERSE_GEOCODE_CACHE = new Map(); // "latRounded,lngRounded" → { label, countryCode, at }
const REVERSE_GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const REVERSE_GEOCODE_TIMEOUT_MS = 6000;
// Nominatim's usage policy caps public traffic at ~1 req/s; this keeps a single
// pipeline run polite regardless of how many cards need geocoding this pass.
const REVERSE_GEOCODE_CONCURRENCY = 2;
const NOMINATIM_UA = 'MOFA-SawtAlWatan-Dashboard/1.0 (crisis-monitoring dashboard)';

// Confidence floor — a candidate below this is discarded and the next tier is
// tried instead. Nothing under this bar is ever shown as if it were certain.
const MIN_CONFIDENCE = 0.55;

const UNKNOWN_LOCATION_AR = 'موقع غير محدد';

/* ── ISO 3166-1 alpha-2 → canonical AR/EN names, via Node's own ICU data ─── */

const ALL_ISO2 = [
  'AF','AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ','BS','BH','BD','BB','BY','BE','BZ','BJ','BT',
  'BO','BA','BW','BR','BN','BG','BF','BI','CV','KH','CM','CA','CF','TD','CL','CN','CO','KM','CG','CD',
  'CR','CI','HR','CU','CY','CZ','DK','DJ','DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FJ','FI',
  'FR','GA','GM','GE','DE','GH','GR','GD','GT','GN','GW','GY','HT','HN','HU','IS','IN','ID','IR','IQ',
  'IE','IL','IT','JM','JP','JO','KZ','KE','KI','KP','KR','KW','KG','LA','LV','LB','LS','LR','LY','LI',
  'LT','LU','MG','MW','MY','MV','ML','MT','MH','MR','MU','MX','FM','MD','MC','MN','ME','MA','MZ','MM',
  'NA','NR','NP','NL','NZ','NI','NE','NG','MK','NO','OM','PK','PW','PS','PA','PG','PY','PE','PH','PL',
  'PT','QA','RO','RU','RW','KN','LC','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SK','SI','SB',
  'SO','ZA','SS','ES','LK','SD','SR','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TO','TT','TN','TR',
  'TM','TV','UG','UA','AE','GB','US','UY','UZ','VU','VA','VE','VN','YE','ZM','ZW',
];

const enNames = new Intl.DisplayNames(['en'], { type: 'region' });
let arNames = null;
try {
  arNames = new Intl.DisplayNames(['ar'], { type: 'region' });
} catch {
  arNames = null; // ICU without Arabic data — canonicalAr() falls back to EN below
}

/** Canonical Arabic country name for an ISO2 — the SAME normalization used
 *  everywhere a country name is derived here, regardless of which tier found
 *  it (text match, reverse-geocode, or the classifier's own `country`). */
function canonicalAr(iso2) {
  if (!iso2) return null;
  try {
    return arNames ? arNames.of(iso2.toUpperCase()) : enNames.of(iso2.toUpperCase());
  } catch {
    return null;
  }
}

function canonicalEn(iso2) {
  if (!iso2) return null;
  try {
    return enNames.of(iso2.toUpperCase());
  } catch {
    return null;
  }
}

// Built once, lazily: every country's EN + AR display name → its ISO2, longest
// name first so "United Arab Emirates" matches before a shorter false friend
// would. Powers tier 3's "country mentioned in the text" scan.
let nameIndex = null;
function buildNameIndex() {
  if (nameIndex) return nameIndex;
  const entries = [];
  for (const iso2 of ALL_ISO2) {
    const en = canonicalEn(iso2);
    const ar = canonicalAr(iso2);
    if (en) entries.push({ name: en, lower: en.toLowerCase(), iso2 });
    if (ar && ar !== en) entries.push({ name: ar, lower: ar, iso2 });
  }
  entries.sort((a, b) => b.name.length - a.name.length);
  nameIndex = entries;
  return entries;
}

/** Finds any ISO 3166-1 country name (EN, word-boundary matched; AR,
 *  substring matched) in free text. Broader than the classifier's watchlist
 *  enum on purpose — an off-watchlist country still gets a real name here. */
function countryFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of buildNameIndex()) {
    if (entry.lower.length < 4) continue; // avoid short-code false positives
    if (/[a-z]/.test(entry.lower)) {
      const re = new RegExp(`\\b${entry.lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) return entry.iso2;
    } else if (text.includes(entry.name)) {
      return entry.iso2;
    }
  }
  return null;
}

/* ── Tier 1: city/region from the source's own STRUCTURED place text ─────── */
//
// Deliberately reads ONLY `placeText` — the structured place field populated
// for geophysical sources (USGS's "12km SW of Banda Aceh, Indonesia", EMSC's
// flynn_region "SULAWESI, INDONESIA": both comma-segmented, country last).
// It must NEVER read `rawText`: that is free-form prose (a GDELT headline, a
// security-advisory sentence), and naive comma-splitting a sentence produces
// nonsense like "Clashes reported near Aden" as a "city". Prose only ever
// reaches the country tier (a safe substring/word-boundary scan), never this
// one — that is the confidence check this function exists to enforce.

// Event-TYPE words/phrases, never place names, that structured titles put in
// front of the real location — USGS's "M6.8 Earthquake — …", EONET's own
// category names ("Wildfire …", "Prescribed Fire RX …", "Severe Storm …").
// Longest phrase first so "prescribed fire" strips before the bare "fire"
// inside it would. Applied repeatedly so a title with two such words in a
// row (e.g. "Wildfire Event …") is fully cleaned, not just the first hit.
const EVENT_NOISE_PHRASES = [
  'prescribed fire', 'wildland fire', 'wild fire', 'wildfire', 'fire',
  'earthquake', 'quake',
  'flash flood', 'flooding', 'flood',
  'severe storm', 'tropical storm', 'winter storm', 'storm',
  'cyclone', 'hurricane', 'typhoon',
  'volcanic eruption', 'volcano', 'eruption',
  'drought',
  'landslide', 'mudslide', 'avalanche',
  'tsunami',
  'dust and haze', 'dust storm', 'haze',
  'sea and lake ice', 'temperature extremes', 'temperature extreme',
  'water color',
  'event', 'incident', 'alert', 'warning', 'advisory',
].sort((a, b) => b.length - a.length);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips leading event-type noise so only geographic names remain — "Wildfire
 * Rose Hill Bay, Duplin" → "Rose Hill Bay, Duplin", "M6.8 Earthquake — 12km SW
 * of Banda Aceh, Indonesia" → "Banda Aceh, Indonesia". Deterministic word/
 * phrase stripping only; never touches an actual place name.
 */
function stripEventNoise(text) {
  let t = text.trim();

  // A leading magnitude code ("M6.8 ") is never part of a place name.
  t = t.replace(/^M\d+(\.\d+)?\s+/i, '');

  // When the title carries a "— " separator (USGS's "M6.8 Earthquake — Fiji
  // region"), the real place is everything after the LAST one.
  const dashIdx = Math.max(t.lastIndexOf('—'), t.lastIndexOf(' - '));
  if (dashIdx !== -1) t = t.slice(dashIdx + 1).replace(/^[-—]\s*/, '').trim();

  // Repeatedly strip a leading event-type phrase — handles back-to-back
  // noise like an EONET "RX" (prescribed-fire designator) after "Prescribed
  // Fire", or a title that happens to repeat a category word.
  let changed = true;
  while (changed) {
    changed = false;
    for (const phrase of EVENT_NOISE_PHRASES) {
      const re = new RegExp(`^${escapeRe(phrase)}\\b[\\s:.-]*`, 'i');
      if (re.test(t)) { t = t.replace(re, '').trim(); changed = true; }
    }
    if (/^RX\b[\s:.-]*/i.test(t)) { t = t.replace(/^RX\b[\s:.-]*/i, '').trim(); changed = true; }
  }

  return t;
}

// Handles the two dominant real-world formats in this feed's structured
// sources: USGS's "12km SW of Banda Aceh, Indonesia" and EMSC's flynn_region
// "SULAWESI, INDONESIA" (both comma-segmented, country last).
function extractCityFromText(text, countryIso2) {
  if (!text) return null;
  let cleaned = stripEventNoise(text);
  // Greedy match consumes up to the RIGHTMOST "N km DIR of " occurrence, so a
  // title like "12km SW of Banda Aceh, Indonesia" (already stripped of its
  // "M6.8 Earthquake — " prefix above) still yields just the place after it.
  cleaned = cleaned.replace(/^.*\d+(\.\d+)?\s*km\s+[nsew]{1,3}\s+of\s+/i, '').trim();

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const city = parts.slice(0, -1).join(', ').trim();
  if (city.length < 2 || city.length > 60) return null;
  if (/^\d+(\.\d+)?$/.test(city)) return null; // a bare number is not a place
  // A structured place field never contains a verb-bearing sentence — if it
  // does, this text was not the clean field we expect and should not be
  // trusted as a city (defends against a future source misusing placeText).
  if (/\b(reported|clashes|attack|killed|said|according)\b/i.test(city)) return null;

  // A "city" that's actually just the country's own name is not a real city —
  // fall through to the country tier instead of a redundant "Country, Country".
  const countryEn = countryIso2 ? canonicalEn(countryIso2) : null;
  const countryAr = countryIso2 ? canonicalAr(countryIso2) : null;
  if (countryEn && city.toLowerCase() === countryEn.toLowerCase()) return null;
  if (countryAr && city === countryAr) return null;

  return { city, confidence: 0.75 };
}

/* ── Tier 2: reverse geocoding from real coordinates ──────────────────────── */

function hasValidCoords(coords) {
  return (
    coords &&
    Number.isFinite(coords.lat) && Number.isFinite(coords.lng) &&
    (coords.lat !== 0 || coords.lng !== 0)
  );
}

function coordKey(lat, lng) {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`; // ~1.1km grid — plenty for "which city"
}

async function reverseGeocode(lat, lng) {
  const key = coordKey(lat, lng);
  const cached = REVERSE_GEOCODE_CACHE.get(key);
  if (cached && Date.now() - cached.at < REVERSE_GEOCODE_TTL_MS) return cached;

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&accept-language=ar,en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal: AbortSignal.timeout(REVERSE_GEOCODE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address ?? {};
    const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.state ?? null;
    const countryCode = addr.country_code ? addr.country_code.toUpperCase() : null;
    if (!city && !countryCode) return null;

    const result = { city, countryCode, at: Date.now() };
    REVERSE_GEOCODE_CACHE.set(key, result);
    return result;
  } catch {
    return null; // best-effort — geocoding failure never breaks the feed
  }
}

/* ── Per-card resolution ──────────────────────────────────────────────────── */

/**
 * Resolves ONE card's display location. `members` are the RawSignals behind
 * this card's cluster; `country` is the cluster's already-verified ISO2 (or
 * null). `allowReverseGeocode` is false for the fast tier, whose ~2s budget a
 * network round-trip would blow — those cards fall straight through to the
 * country tier and get upgraded automatically when the full run replaces
 * them minutes later, same as their score already does. Never throws.
 */
async function resolveOne({ country, coords, members }, { allowReverseGeocode = true } = {}) {
  // Structured place text ONLY — the sole input tier 1 is allowed to touch.
  const placeTexts = members.map((m) => m.placeText).filter((t) => !!t && t.trim());
  // Everything with any text, structured or prose — safe for tier 3's
  // substring/word-boundary country scan, never for city-guessing.
  const allTexts = members.map((m) => m.placeText ?? m.rawText).filter((t) => !!t && t.trim());

  // Tier 1 — city/region from structured source text only.
  for (const text of placeTexts) {
    const hit = extractCityFromText(text, country);
    if (hit && hit.confidence >= MIN_CONFIDENCE) {
      const countryLabel = country ? canonicalAr(country) : countryFromText(text) && canonicalAr(countryFromText(text));
      return { location: countryLabel ? `${hit.city}، ${countryLabel}` : hit.city, source: 'city', confidence: hit.confidence };
    }
  }

  // Tier 2 — reverse geocoding from real coordinates.
  if (allowReverseGeocode && hasValidCoords(coords)) {
    const geo = await reverseGeocode(coords.lat, coords.lng);
    if (geo) {
      const iso2 = country ?? geo.countryCode;
      const countryLabel = iso2 ? canonicalAr(iso2) : null;
      if (geo.city && countryLabel) {
        return { location: `${geo.city}، ${countryLabel}`, source: 'coords', confidence: 0.85 };
      }
      if (countryLabel) {
        return { location: countryLabel, source: 'coords', confidence: 0.75 };
      }
    }
  }

  // Tier 3 — country clearly known: the classifier's own verified country
  // first (already deterministically checked in Stage 2), else any ISO 3166-1
  // country name found directly in the source text.
  if (country) {
    const label = canonicalAr(country);
    if (label) return { location: label, source: 'country', confidence: 1 };
  }
  for (const text of allTexts) {
    const iso2 = countryFromText(text);
    if (iso2) {
      const label = canonicalAr(iso2);
      if (label) return { location: label, source: 'country-text', confidence: 0.6 };
    }
  }

  // Tier 4 — nothing reliable found.
  return { location: UNKNOWN_LOCATION_AR, source: 'unknown', confidence: 0 };
}

/** Bounded-concurrency map so a burst of reverse-geocode calls never exceeds
 *  Nominatim's polite-use rate, whatever the cluster count for this run. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Resolves display locations for a batch of cards in one pass. `cards` is an
 * array of `{ country, coords, members }`; returns a parallel array of
 * `{ location, source, confidence }`. Never throws — a per-card failure
 * degrades to the unknown-location string, never a crash of the whole feed.
 * Pass `{ allowReverseGeocode: false }` for the fast tier (no network calls —
 * keeps its ~2s budget intact; the full run upgrades these locations later).
 */
export async function resolveLocations(cards, options = {}) {
  const concurrency = options.allowReverseGeocode === false ? cards.length || 1 : REVERSE_GEOCODE_CONCURRENCY;
  return mapWithConcurrency(cards, concurrency, async (c) => {
    try {
      return await resolveOne(c, options);
    } catch {
      return { location: UNKNOWN_LOCATION_AR, source: 'unknown', confidence: 0 };
    }
  });
}

export const UNKNOWN_LOCATION = UNKNOWN_LOCATION_AR;
