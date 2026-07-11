// Security-intelligence engine for the Security Threats panel.
//
// U.S. State Department travel advisories are the REQUIRED backbone — a
// free, public, key-less RSS feed covering essentially every country, so the
// widget shows real data immediately with zero configuration. ACLED (armed-
// conflict events) and GDELT (breaking security headlines) are merged in as
// bonus enrichment when available; ACLED needs credentials (see acled.mjs),
// GDELT needs none. If the advisory feed itself is down, getSecurityProfiles
// throws (caught by the Netlify function → 502) — everything else is
// best-effort and fails soft (Promise.allSettled).
//
// Nothing is invented: every score traces to real advisory text, a real
// ACLED record, or a real GDELT headline. The output shape (riskScore,
// riskLevel, factors, topReasons, activeIncidents, fatalities, sourceCount,
// latestUpdate, currentThreats, timeline, sources) is unchanged from the
// ACLED-only version — this file only changes WHERE the numbers come from,
// not what the frontend/UI consumes (see security.ts, SecurityCategoryCard.tsx,
// SecurityDetailPanel.tsx — none of them needed to change).
//
// Only countries with an elevated advisory (Level ≥ 2) OR real merged ACLED/
// GDELT signal are included — this is a "Security Threats" list, not a
// roster of all ~200 countries at baseline "exercise normal precautions".

import { fetchAcledEvents, acledConfigured, classifyAcled } from './acled.mjs';
import { countryEntries } from './countryIso.mjs';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FETCH_TIMEOUT_MS = 10000;
const WINDOW_DAYS = 14; // recency window for ACLED/GDELT signals

const ACLED_TYPE_AR = {
  'Battles': 'اشتباكات مسلحة',
  'Explosions/Remote violence': 'تفجيرات/هجمات عن بُعد',
  'Violence against civilians': 'عنف ضد المدنيين',
  'Riots': 'أعمال شغب',
  'Protests': 'احتجاجات',
  'Strategic developments': 'تطورات استراتيجية',
};

const FACTOR_LABEL_AR = {
  volume: 'عدد الأحداث النشطة',
  fatalities: 'الضحايا (القتلى)',
  severity: 'شدة تحذير السفر الرسمي',
  recency: 'حداثة الأحداث',
  intensity: 'كثافة النزاع المسلح',
};

// Five factors, weighted to 100%. `severity` now reads the official U.S.
// travel-advisory level (always available); the other four still read real
// ACLED/GDELT event data when present.
const WEIGHTS = {
  volume: 0.20, fatalities: 0.15, severity: 0.40, recency: 0.10, intensity: 0.15,
};

// U.S. Level 1-4 → 0-100. Level 1 ("exercise normal precautions") is a low
// baseline, not a warning — countries stuck at Level 1 with no other signal
// are filtered out below (see MIN_ADVISORY_LEVEL / hasRealSignal).
const LEVEL_SCORE = { 1: 15, 2: 42, 3: 68, 4: 90 };
const MIN_ADVISORY_LEVEL = 2;

// Keyword hints matched against the advisory's own text — used only to
// enrich `intensity`/topReasons with the advisory's stated reasons, exactly
// like the ACLED-only version's classifyAcled() enriches from event types.
const CONFLICT_TEXT_HINTS = [
  'armed conflict', 'civil war', 'ongoing conflict', 'hostilities', 'military conflict',
  'airstrike', 'air strike', 'missile', 'drone attack', 'active conflict', 'war zone',
  'terrorism', 'terrorist',
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function timedFetch(url, opts = {}) {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...opts });
}
function stripHtml(s) {
  return String(s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#8239;|&#160;/gi, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function tag(block, t) {
  const m = block.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i'));
  return m ? m[1].trim() : '';
}
function severityFromScore(score) {
  return score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
}
function severityFromLevel(level) {
  return level >= 4 ? 'CRITICAL' : level === 3 ? 'HIGH' : level === 2 ? 'MEDIUM' : 'LOW';
}

/* ─── Source 1 · U.S. State Dept Travel Advisories — REQUIRED backbone.
   Free, public RSS, no API key. Covers essentially every country, so the
   widget has real data with zero configuration. ── */
async function fetchAdvisories() {
  console.log('[StateDept] fetching travel advisories RSS...');
  const res = await timedFetch('https://travel.state.gov/_res/rss/TAsTWs.xml', {
    headers: { 'User-Agent': 'nawatai-dashboard/1.0' },
  });
  console.log(`[StateDept] response status=${res.status}`);
  if (!res.ok) throw new Error(`advisory feed responded ${res.status}`);
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  console.log(`[StateDept] parsed ${items.length} RSS items`);

  const map = new Map(); // enNameLower → { level, label, link, pubDate, desc }
  for (const it of items) {
    const title = stripHtml(tag(it, 'title'));
    const m = title.match(/^(.*?)\s*-\s*Level\s*(\d)\s*:\s*(.*)$/i);
    if (!m) continue;
    const name = m[1].trim();
    const level = clamp(parseInt(m[2], 10), 1, 4);
    const desc = stripHtml(tag(it, 'description'));
    const pub = tag(it, 'pubDate');
    map.set(name.toLowerCase(), {
      level,
      label: `Level ${level}: ${m[3].trim()}`,
      link: stripHtml(tag(it, 'link')),
      pubDate: pub ? new Date(pub) : new Date(),
      desc,
    });
  }
  console.log(`[StateDept] matched ${map.size} country advisory entries`);
  return map;
}

/* ─── Source 2 · GDELT — recent security headlines, title-matched to country.
   Free, best-effort, fails soft. ── */
async function fetchGdeltSecurity() {
  const query = encodeURIComponent('(security OR attack OR terrorism OR protest OR conflict OR clashes)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
    `&mode=ArtList&maxrecords=200&format=json&sort=DateDesc&timespan=${WINDOW_DAYS}d`;
  try {
    const res = await timedFetch(url);
    console.log(`[GDELT] response status=${res.status}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.articles)) return [];
    const articles = data.articles.map((a) => {
      const m = String(a.seendate ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      return {
        title: String(a.title ?? '').trim(),
        url: a.url ?? '',
        domain: a.domain ?? 'GDELT',
        at: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(),
      };
    }).filter((a) => a.title && a.url);
    console.log(`[GDELT] parsed ${articles.length} articles`);
    return articles;
  } catch (err) {
    console.error('[GDELT] fetch failed (non-fatal, best-effort source):', err);
    return [];
  }
}

function topReasonsFor(factors) {
  return Object.entries(factors)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => FACTOR_LABEL_AR[k]);
}

// Builds one country's profile from its advisory (required) + any matched
// ACLED events + any matched GDELT articles. Same output shape as the
// ACLED-only version's buildProfile().
function buildProfile(entry, adv, acledEvents, gdeltMatches) {
  const fatalities = acledEvents.reduce((s, e) => s + e.fatalities, 0);
  const desc = (adv.desc ?? '').toLowerCase();
  const textHits = CONFLICT_TEXT_HINTS.filter((k) => desc.includes(k)).length;

  const totalSignals = acledEvents.length + gdeltMatches.length;
  const hardSignals = acledEvents.filter((e) => {
    const c = classifyAcled(e.eventType);
    return c === 'armedConflict' || c === 'terrorism';
  }).length + (textHits > 0 ? 1 : 0);

  const now = Date.now();
  const recentDates = [
    ...acledEvents.map((e) => new Date(e.eventDate).getTime()),
    ...gdeltMatches.map((a) => a.at.getTime()),
  ].filter((t) => Number.isFinite(t));
  const avgAgeDays = recentDates.length > 0
    ? recentDates.reduce((s, t) => s + Math.max(0, (now - t) / 86_400_000), 0) / recentDates.length
    : null;

  const factors = {
    volume: totalSignals === 0 ? 0 : totalSignals >= 16 ? 100 : totalSignals >= 9 ? 85 : totalSignals >= 4 ? 60 : 30,
    fatalities: fatalities >= 100 ? 100 : fatalities >= 40 ? 85 : fatalities >= 15 ? 65 : fatalities >= 5 ? 45 : fatalities > 0 ? 25 : 0,
    severity: LEVEL_SCORE[adv.level] ?? 0,
    recency: avgAgeDays === null ? 0 : clamp(Math.round(100 - (avgAgeDays / WINDOW_DAYS) * 100), 0, 100),
    intensity: totalSignals === 0 ? (textHits > 0 ? clamp(textHits * 25, 0, 100) : 0) : clamp(Math.round((hardSignals / totalSignals) * 100), 0, 100),
  };

  const riskScore = clamp(Math.round(
    WEIGHTS.volume * factors.volume +
    WEIGHTS.fatalities * factors.fatalities +
    WEIGHTS.severity * factors.severity +
    WEIGHTS.recency * factors.recency +
    WEIGHTS.intensity * factors.intensity
  ), 0, 100);

  const riskLevel = severityFromScore(riskScore);
  const advSeverity = severityFromLevel(adv.level);

  // Current threats — real ACLED events first (most fatalities), then the
  // advisory update itself if it names a concrete reason.
  const currentThreats = [...acledEvents]
    .sort((a, b) => b.fatalities - a.fatalities)
    .slice(0, 3)
    .map((e) => ({
      title: ACLED_TYPE_AR[e.eventType] ?? e.eventType,
      severity: e.severity,
      time: new Date(e.eventDate).toISOString(),
      source: 'ACLED',
      url: e.sourceUrl,
    }));
  if (adv.level >= MIN_ADVISORY_LEVEL) {
    currentThreats.push({
      title: `تحذير سفر أمريكي — ${adv.label}`,
      severity: advSeverity,
      time: adv.pubDate.toISOString(),
      source: 'وزارة الخارجية الأمريكية',
      url: adv.link,
    });
  }

  // Timeline — advisory update + every matched ACLED event + GDELT headline.
  const timeline = [{
    date: adv.pubDate.toISOString(),
    title: `تحديث تحذير السفر: ${adv.label}`,
    severity: advSeverity,
    source: 'وزارة الخارجية الأمريكية',
    url: adv.link,
  }];
  for (const e of [...acledEvents].sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate)).slice(0, 8)) {
    const typeAr = ACLED_TYPE_AR[e.eventType] ?? e.eventType;
    const fatal = e.fatalities > 0 ? ` — ${e.fatalities} قتيل` : '';
    timeline.push({
      date: new Date(e.eventDate).toISOString(),
      title: `${typeAr}${e.location ? ` · ${e.location}` : ''}${fatal}`,
      severity: e.severity, source: 'ACLED', url: e.sourceUrl,
    });
  }
  for (const a of gdeltMatches.slice(0, 6)) {
    timeline.push({ date: a.at.toISOString(), title: a.title, severity: 'MEDIUM', source: a.domain, url: a.url });
  }
  timeline.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  // The detail panel only ever renders the first 8 — trim the rest here so
  // the list response (all ~100+ countries, most never opened) doesn't carry
  // timeline entries no one will see.
  timeline.length = Math.min(timeline.length, 10);

  const sources = [{ name: 'وزارة الخارجية الأمريكية (تحذيرات السفر)', url: adv.link }];
  if (acledEvents.length > 0) sources.push({ name: 'ACLED (بيانات النزاعات المسلحة)', url: 'https://acleddata.com/dashboard/' });
  const gdeltDomains = new Set(gdeltMatches.map((a) => a.domain));
  for (const d of gdeltDomains) sources.push({ name: `GDELT · ${d}`, url: `https://${d}` });

  const allDates = [adv.pubDate.getTime(), ...recentDates].filter((t) => Number.isFinite(t));
  const latestUpdate = new Date(Math.max(...allDates)).toISOString();

  return {
    id: `sec-${entry.iso2}`,
    country: entry.ar, countryEn: entry.en, countryCode: entry.iso2,
    riskScore, riskLevel,
    activeIncidents: acledEvents.length + gdeltMatches.length,
    fatalities,
    sourceCount: sources.length,
    latestUpdate,
    factors, topReasons: topReasonsFor(factors),
    currentThreats, timeline, sources,
    _hasRealSignal: adv.level >= MIN_ADVISORY_LEVEL || totalSignals > 0,
  };
}

let cache = { at: 0, payload: null };

export async function getSecurityProfiles() {
  if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    console.log(`[securityCore] serving cached result (${cache.payload.countries.length} countries, age=${Date.now() - cache.at}ms)`);
    return { ...cache.payload, cached: true };
  }

  // Advisory feed is REQUIRED (the free backbone). GDELT + ACLED are best-effort.
  const [advResult, gdelt, acled] = await Promise.allSettled([
    fetchAdvisories(),
    fetchGdeltSecurity(),
    fetchAcledEvents(),
  ]);

  if (advResult.status !== 'fulfilled') {
    console.error('[securityCore] advisory source (required backbone) failed:', advResult.reason);
    throw new Error('advisory source unavailable');
  }
  const advisories = advResult.value;
  const gdeltArticles = gdelt.status === 'fulfilled' ? gdelt.value : [];
  const acledResult = acled.status === 'fulfilled' ? acled.value : { configured: acledConfigured(), ok: false, events: [] };

  console.log(
    `[securityCore] sources → advisories=${advisories.size}, gdelt=${gdeltArticles.length} articles, `
    + `acled.configured=${acledResult.configured} acled.ok=${acledResult.ok} acled.events=${acledResult.events.length}`,
  );

  const acledByCountry = new Map();
  for (const e of acledResult.events) {
    const key = String(e.country || '').trim().toLowerCase();
    if (!key) continue;
    if (!acledByCountry.has(key)) acledByCountry.set(key, []);
    acledByCountry.get(key).push(e);
  }

  const entries = countryEntries();
  const withAdvisory = entries.filter((entry) => advisories.has(entry.en));
  console.log(`[securityCore] ${withAdvisory.length} of ${entries.length} known countries have a matching advisory`);

  const profiles = withAdvisory.map((entry) => {
    const adv = advisories.get(entry.en);
    const acledEvents = acledByCountry.get(entry.en) ?? [];
    const gdeltMatches = gdeltArticles.filter((a) => a.title.toLowerCase().includes(entry.en));
    return buildProfile(entry, adv, acledEvents, gdeltMatches);
  });

  const countries = profiles
    .filter((p) => p._hasRealSignal)
    .map(({ _hasRealSignal, ...p }) => p)
    .sort((a, b) => b.riskScore - a.riskScore);
  console.log(`[securityCore] ${countries.length} of ${profiles.length} countries have elevated/real signal (Level ≥ ${MIN_ADVISORY_LEVEL} or ACLED/GDELT match) — final result`);

  const payload = {
    countries,
    // Internal diagnostics only — never rendered as an error to the user
    // (see SecurityCategoryCard.tsx). Useful for server logs / DevTools.
    _sources: {
      'U.S. State Dept': { configured: true, ok: true, count: advisories.size },
      GDELT: { configured: true, ok: gdelt.status === 'fulfilled', count: gdeltArticles.length },
      ACLED: { configured: acledResult.configured, ok: acledResult.ok, count: acledResult.events.length },
    },
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  cache = { at: Date.now(), payload };
  return payload;
}

export const SECURITY_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
