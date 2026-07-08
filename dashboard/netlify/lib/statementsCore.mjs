// Backend proxy core for official state statements.
//
// Runs server-side (Netlify Function + Vite dev middleware) so the browser
// never calls GDELT / RSS / ReliefWeb directly — no CORS, no exposed keys.
// Fetches every trusted source, normalizes each into ONE common schema, merges,
// de-duplicates, sorts newest-first, and caches the result briefly.
//
// Adding a new government API later = add one fetcher below and push it into
// SOURCES. The frontend and its schema stay untouched.
//
// The original title / source / publish time / source link / body pass through
// verbatim — nothing here is invented or rewritten. AI enrichment happens on
// the client, separately.

const RELIEFWEB_APPNAME = process.env.RELIEFWEB_APPNAME ?? 'nawatai-dashboard';
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const FETCH_TIMEOUT_MS = 9000;

/* ─── Common normalized schema ───────────────────────────────────────
   { id, title, authority, publishedAt: Date, sourceName, sourceUrl,
     sourceApi: 'ReliefWeb'|'GDELT'|'RSS', fullText, country, countryCode } */

/* ─── Country lookup — ISO3 / English name → { ar, iso2 } ───────────── */
const COUNTRIES = {
  SAU: { ar: 'السعودية', iso2: 'SA' }, ARE: { ar: 'الإمارات', iso2: 'AE' },
  QAT: { ar: 'قطر', iso2: 'QA' }, KWT: { ar: 'الكويت', iso2: 'KW' },
  BHR: { ar: 'البحرين', iso2: 'BH' }, OMN: { ar: 'عُمان', iso2: 'OM' },
  YEM: { ar: 'اليمن', iso2: 'YE' }, IRQ: { ar: 'العراق', iso2: 'IQ' },
  JOR: { ar: 'الأردن', iso2: 'JO' }, LBN: { ar: 'لبنان', iso2: 'LB' },
  SYR: { ar: 'سوريا', iso2: 'SY' }, PSE: { ar: 'فلسطين', iso2: 'PS' },
  EGY: { ar: 'مصر', iso2: 'EG' }, SDN: { ar: 'السودان', iso2: 'SD' },
  LBY: { ar: 'ليبيا', iso2: 'LY' }, TUN: { ar: 'تونس', iso2: 'TN' },
  DZA: { ar: 'الجزائر', iso2: 'DZ' }, MAR: { ar: 'المغرب', iso2: 'MA' },
  MRT: { ar: 'موريتانيا', iso2: 'MR' }, SOM: { ar: 'الصومال', iso2: 'SO' },
  DJI: { ar: 'جيبوتي', iso2: 'DJ' }, COM: { ar: 'جزر القمر', iso2: 'KM' },
  IRN: { ar: 'إيران', iso2: 'IR' }, TUR: { ar: 'تركيا', iso2: 'TR' },
  ISR: { ar: 'إسرائيل', iso2: 'IL' }, USA: { ar: 'الولايات المتحدة', iso2: 'US' },
  GBR: { ar: 'المملكة المتحدة', iso2: 'GB' }, FRA: { ar: 'فرنسا', iso2: 'FR' },
  DEU: { ar: 'ألمانيا', iso2: 'DE' }, RUS: { ar: 'روسيا', iso2: 'RU' },
  CHN: { ar: 'الصين', iso2: 'CN' }, IND: { ar: 'الهند', iso2: 'IN' },
  PAK: { ar: 'باكستان', iso2: 'PK' }, AFG: { ar: 'أفغانستان', iso2: 'AF' },
  UKR: { ar: 'أوكرانيا', iso2: 'UA' }, ETH: { ar: 'إثيوبيا', iso2: 'ET' },
  NGA: { ar: 'نيجيريا', iso2: 'NG' }, ZAF: { ar: 'جنوب أفريقيا', iso2: 'ZA' },
  IDN: { ar: 'إندونيسيا', iso2: 'ID' }, MYS: { ar: 'ماليزيا', iso2: 'MY' },
  JPN: { ar: 'اليابان', iso2: 'JP' }, KOR: { ar: 'كوريا الجنوبية', iso2: 'KR' },
};
const NAME_TO_ISO3 = {
  'saudi arabia': 'SAU', 'united arab emirates': 'ARE', qatar: 'QAT', kuwait: 'KWT',
  bahrain: 'BHR', oman: 'OMN', yemen: 'YEM', iraq: 'IRQ', jordan: 'JOR',
  lebanon: 'LBN', syria: 'SYR', palestine: 'PSE', egypt: 'EGY', sudan: 'SDN',
  libya: 'LBY', tunisia: 'TUN', algeria: 'DZA', morocco: 'MAR', somalia: 'SOM',
  iran: 'IRN', turkey: 'TUR', israel: 'ISR', 'united states': 'USA',
  'united kingdom': 'GBR', france: 'FRA', germany: 'DEU', russia: 'RUS',
  china: 'CHN', india: 'IND', pakistan: 'PAK', afghanistan: 'AFG',
  ukraine: 'UKR', ethiopia: 'ETH', nigeria: 'NGA', indonesia: 'IDN', japan: 'JPN',
};
const byIso3 = (iso3) => (iso3 ? COUNTRIES[String(iso3).toUpperCase()] ?? null : null);
const byName = (name) => {
  if (!name) return null;
  const iso3 = NAME_TO_ISO3[String(name).trim().toLowerCase()];
  return iso3 ? COUNTRIES[iso3] ?? null : null;
};

/* ─── Small helpers ──────────────────────────────────────────────────── */
function timedFetch(url, opts = {}) {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...opts });
}
function stripHtml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripHtml(m[1]) : '';
}

/* ─── Source 1 · ReliefWeb v2 (official press releases) ─────────────── */
async function fetchReliefWeb() {
  const params = [
    `appname=${encodeURIComponent(RELIEFWEB_APPNAME)}`,
    'profile=full', 'preset=latest', 'limit=25',
    'filter[field]=format.name', 'filter[value]=News and Press Release',
    'fields[include][]=title', 'fields[include][]=body', 'fields[include][]=url',
    'fields[include][]=date.created', 'fields[include][]=source.name',
    'fields[include][]=primary_country.name', 'fields[include][]=primary_country.iso3',
  ].join('&');

  const res = await timedFetch(`https://api.reliefweb.int/v2/reports?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data?.data)) return [];

  return data.data.map((item) => {
    const f = item.fields ?? {};
    const src = Array.isArray(f.source) ? f.source[0] : f.source;
    const info = byIso3(f.primary_country?.iso3);
    return {
      id: `rw-${item.id}`,
      title: String(f.title ?? '').trim(),
      authority: src?.name ?? 'مصدر رسمي',
      publishedAt: f.date?.created ? new Date(f.date.created) : new Date(),
      sourceName: src?.name ?? 'ReliefWeb',
      sourceUrl: f.url ?? `https://reliefweb.int/node/${item.id}`,
      sourceApi: 'ReliefWeb',
      fullText: f.body ? stripHtml(f.body) : '',
      country: info?.ar ?? f.primary_country?.name ?? '',
      countryCode: info?.iso2 ?? '',
    };
  }).filter((s) => s.title);
}

/* ─── Source 2 · GDELT DOC 2.0 (discovery layer) ────────────────────── */
async function fetchGdelt() {
  const query = encodeURIComponent(
    '("ministry of foreign affairs" OR "foreign ministry" OR "official statement" OR "government statement")'
  );
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
    `&mode=ArtList&maxrecords=25&format=json&sort=DateDesc&timespan=3d`;

  const res = await timedFetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data?.articles)) return [];

  return data.articles.map((a, i) => {
    const info = byName(a.sourcecountry);
    const m = String(a.seendate ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const when = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date();
    return {
      id: `gdelt-${i}-${a.url ? a.url.length : 0}`,
      title: String(a.title ?? '').trim(),
      authority: a.domain ?? a.sourcecountry ?? 'مصدر إخباري رسمي',
      publishedAt: when,
      sourceName: a.domain ?? 'GDELT',
      sourceUrl: a.url ?? '',
      sourceApi: 'GDELT',
      fullText: '',
      country: info?.ar ?? a.sourcecountry ?? '',
      countryCode: info?.iso2 ?? '',
    };
  }).filter((s) => s.title && s.sourceUrl);
}

/* ─── Source 3 · Official government RSS / Atom feeds ────────────────
   Extensible allow-list of official feeds. Add ministry/embassy feeds here —
   the frontend needs no change. Handles both RSS <item> and Atom <entry>. */
const RSS_FEEDS = [
  { url: 'https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom',
    sourceName: 'المملكة المتحدة — FCDO', country: 'المملكة المتحدة', countryCode: 'GB' },
  { url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    sourceName: 'أخبار الأمم المتحدة', country: 'الأمم المتحدة', countryCode: '' },
];

function parseFeed(xml, feed) {
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) ?? [];

  return blocks.slice(0, 12).map((block, i) => {
    const title = tagText(block, 'title');
    let link = '';
    if (isAtom) {
      const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
        ?? block.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? alt[1] : '';
    } else {
      link = tagText(block, 'link');
    }
    const dateStr = tagText(block, 'pubDate') || tagText(block, 'updated') || tagText(block, 'published') || tagText(block, 'dc:date');
    const body = tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content');
    const when = dateStr ? new Date(dateStr) : new Date();

    return {
      id: `rss-${feed.countryCode || 'un'}-${i}-${title.length}`,
      title,
      authority: feed.sourceName,
      publishedAt: isNaN(when.getTime()) ? new Date() : when,
      sourceName: feed.sourceName,
      sourceUrl: link,
      sourceApi: 'RSS',
      fullText: body,
      country: feed.country,
      countryCode: feed.countryCode,
    };
  }).filter((s) => s.title && s.sourceUrl);
}

async function fetchRss() {
  const perFeed = await Promise.all(RSS_FEEDS.map(async (feed) => {
    try {
      const res = await timedFetch(feed.url, { headers: { 'User-Agent': 'nawatai-dashboard/1.0' } });
      if (!res.ok) return [];
      return parseFeed(await res.text(), feed);
    } catch {
      return []; // one bad feed never breaks the rest
    }
  }));
  return perFeed.flat();
}

/* ─── Registry — add new government sources here only ────────────────── */
const SOURCES = [
  { name: 'ReliefWeb', run: fetchReliefWeb },
  { name: 'GDELT', run: fetchGdelt },
  { name: 'RSS', run: fetchRss },
];

function dedupe(list) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const s of list) {
    const urlKey = (s.sourceUrl || '').trim();
    const titleKey = s.title.trim().toLowerCase();
    if ((urlKey && seenUrl.has(urlKey)) || seenTitle.has(titleKey)) continue;
    if (urlKey) seenUrl.add(urlKey);
    seenTitle.add(titleKey);
    out.push(s);
  }
  return out;
}

let cache = { at: 0, payload: null };

// Returns { statements, sources, cachedAt, degraded }. Each source is isolated:
// a failure is recorded but never blocks the others.
export async function getStatements() {
  if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true };
  }

  const settled = await Promise.allSettled(SOURCES.map((s) => s.run()));
  const sourceStatus = {};
  let merged = [];
  settled.forEach((r, i) => {
    const name = SOURCES[i].name;
    if (r.status === 'fulfilled') {
      sourceStatus[name] = { ok: true, count: r.value.length };
      merged = merged.concat(r.value);
    } else {
      sourceStatus[name] = { ok: false, count: 0 };
    }
  });

  const statements = dedupe(merged).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const degraded = Object.values(sourceStatus).some((s) => !s.ok);

  const payload = {
    statements,
    sources: sourceStatus,
    cachedAt: new Date().toISOString(),
    degraded,
    cached: false,
  };
  cache = { at: Date.now(), payload };
  return payload;
}

export const CACHE_MAX_AGE_SECONDS = Math.floor(CACHE_TTL_MS / 1000);
