// Backend proxy + scoring engine for the Security Threats panel.
//
// Runs server-side (Netlify Function + Vite dev middleware). The browser never
// calls the sources directly. Data comes from trusted, real-time sources:
//   • U.S. Department of State Travel Advisories (official government data —
//     authoritative per-country threat LEVEL 1–4 + explicit risk indicators)
//   • GDELT DOC 2.0 (global event monitoring — recent security headlines,
//     matched to a country by title mention) — best-effort, fails soft.
//   (OSAC / ReliefWeb / WHO / UN OCHA are wired the same way when their
//    keys/feeds are available — add a fetcher and merge; the schema is stable.)
//
// The overall threat score is NOT taken raw from any API. It is COMPUTED here
// from weighted category signals extracted from the official advisory text.
// Nothing is invented: every threat/timeline item traces to a real source item.

import { fetchAcledEvents, acledConfigured } from './acled.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10000;

// Arabic labels for common ACLED event types (title stays source-faithful).
const ACLED_TYPE_AR = {
  'Battles': 'اشتباكات مسلحة',
  'Explosions/Remote violence': 'تفجيرات/هجمات عن بُعد',
  'Violence against civilians': 'عنف ضد المدنيين',
  'Riots': 'أعمال شغب',
  'Protests': 'احتجاجات',
  'Strategic developments': 'تطورات استراتيجية',
};

/* ─── Curated watchlist (Saudi-relevant) — English name must match the State
   advisory title; ar + iso2 drive the Arabic label + flag. Extend freely. ── */
const WATCHLIST = [
  { en: 'Yemen', ar: 'اليمن', iso2: 'YE' }, { en: 'Syria', ar: 'سوريا', iso2: 'SY' },
  { en: 'Iraq', ar: 'العراق', iso2: 'IQ' }, { en: 'Iran', ar: 'إيران', iso2: 'IR' },
  { en: 'Lebanon', ar: 'لبنان', iso2: 'LB' }, { en: 'Jordan', ar: 'الأردن', iso2: 'JO' },
  { en: 'Kuwait', ar: 'الكويت', iso2: 'KW' }, { en: 'Oman', ar: 'عُمان', iso2: 'OM' },
  { en: 'Qatar', ar: 'قطر', iso2: 'QA' }, { en: 'Bahrain', ar: 'البحرين', iso2: 'BH' },
  { en: 'United Arab Emirates', ar: 'الإمارات', iso2: 'AE' },
  { en: 'Egypt', ar: 'مصر', iso2: 'EG' }, { en: 'Sudan', ar: 'السودان', iso2: 'SD' },
  { en: 'South Sudan', ar: 'جنوب السودان', iso2: 'SS' }, { en: 'Libya', ar: 'ليبيا', iso2: 'LY' },
  { en: 'Tunisia', ar: 'تونس', iso2: 'TN' }, { en: 'Algeria', ar: 'الجزائر', iso2: 'DZ' },
  { en: 'Morocco', ar: 'المغرب', iso2: 'MA' }, { en: 'Mauritania', ar: 'موريتانيا', iso2: 'MR' },
  { en: 'Somalia', ar: 'الصومال', iso2: 'SO' }, { en: 'Djibouti', ar: 'جيبوتي', iso2: 'DJ' },
  { en: 'Turkey', ar: 'تركيا', iso2: 'TR' }, { en: 'Israel', ar: 'إسرائيل', iso2: 'IL' },
  { en: 'Afghanistan', ar: 'أفغانستان', iso2: 'AF' }, { en: 'Pakistan', ar: 'باكستان', iso2: 'PK' },
  { en: 'India', ar: 'الهند', iso2: 'IN' }, { en: 'Bangladesh', ar: 'بنغلاديش', iso2: 'BD' },
  { en: 'Nigeria', ar: 'نيجيريا', iso2: 'NG' }, { en: 'Mali', ar: 'مالي', iso2: 'ML' },
  { en: 'Niger', ar: 'النيجر', iso2: 'NE' }, { en: 'Burkina Faso', ar: 'بوركينا فاسو', iso2: 'BF' },
  { en: 'Chad', ar: 'تشاد', iso2: 'TD' }, { en: 'Ethiopia', ar: 'إثيوبيا', iso2: 'ET' },
  { en: 'Democratic Republic of the Congo', ar: 'الكونغو الديمقراطية', iso2: 'CD' },
  { en: 'Central African Republic', ar: 'أفريقيا الوسطى', iso2: 'CF' },
  { en: 'Ukraine', ar: 'أوكرانيا', iso2: 'UA' }, { en: 'Russia', ar: 'روسيا', iso2: 'RU' },
  { en: 'Venezuela', ar: 'فنزويلا', iso2: 'VE' }, { en: 'Haiti', ar: 'هايتي', iso2: 'HT' },
  { en: 'Burma', ar: 'ميانمار', iso2: 'MM' }, { en: 'North Korea', ar: 'كوريا الشمالية', iso2: 'KP' },
  { en: 'Colombia', ar: 'كولومبيا', iso2: 'CO' }, { en: 'Mexico', ar: 'المكسيك', iso2: 'MX' },
  { en: 'Philippines', ar: 'الفلبين', iso2: 'PH' }, { en: 'Indonesia', ar: 'إندونيسيا', iso2: 'ID' },
];

/* ─── Category ← risk-indicator keywords (matched in official advisory text) ── */
const CATEGORY_KEYWORDS = {
  security:          ['wrongful detention', 'detention', 'landmines', 'piracy', 'security'],
  terrorism:         ['terrorism', 'terrorist'],
  militaryConflict:  ['armed conflict', 'war', 'military', 'hostilities', 'missile', 'airstrike'],
  civilUnrest:       ['civil unrest', 'unrest', 'protest', 'demonstration', 'political instability', 'coup'],
  crime:             ['crime', 'violent crime', 'kidnapping', 'robbery', 'gang'],
  naturalDisasters:  ['earthquake', 'flood', 'cyclone', 'hurricane', 'volcano', 'storm', 'typhoon', 'wildfire'],
  healthRisks:       ['outbreak', 'disease', 'ebola', 'cholera', 'virus', 'pandemic', 'epidemic'],
  economicRisks:     ['fuel shortage', 'food shortage', 'inflation', 'sanction', 'economic collapse', 'currency'],
};
const CATEGORY_KEYS = Object.keys(CATEGORY_KEYWORDS);
const WEIGHTS = {
  security: 0.20, terrorism: 0.18, militaryConflict: 0.17, civilUnrest: 0.13,
  crime: 0.12, naturalDisasters: 0.07, healthRisks: 0.07, economicRisks: 0.06,
};
const LEVEL_SCORE = { 1: 15, 2: 42, 3: 68, 4: 90 };

// Arabic labels for the specific reasons we surface as "current threats".
const REASON_AR = [
  ['armed conflict', 'نزاع مسلح'], ['terrorism', 'تحذير من الإرهاب'], ['terrorist', 'تحذير من الإرهاب'],
  ['kidnapping', 'خطر الاختطاف'], ['civil unrest', 'اضطرابات مدنية'], ['unrest', 'اضطرابات مدنية'],
  ['protest', 'مظاهرات'], ['crime', 'جرائم عنيفة'], ['landmines', 'ألغام أرضية'],
  ['piracy', 'قرصنة بحرية'], ['wrongful detention', 'احتجاز تعسفي'], ['political instability', 'عدم استقرار سياسي'],
  ['health', 'مخاطر صحية'], ['outbreak', 'تفشٍّ وبائي'], ['missile', 'هجمات صاروخية'],
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
function severityFromLevel(level) {
  return level >= 4 ? 'CRITICAL' : level === 3 ? 'HIGH' : level === 2 ? 'MEDIUM' : 'LOW';
}

/* ─── Source 1 · U.S. State Dept Travel Advisories (authoritative backbone) ── */
async function fetchAdvisories() {
  const res = await timedFetch('https://travel.state.gov/_res/rss/TAsTWs.xml', {
    headers: { 'User-Agent': 'nawatai-dashboard/1.0' },
  });
  if (!res.ok) throw new Error(`advisory feed ${res.status}`);
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

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
  return map;
}

/* ─── Source 2 · GDELT (recent security events; title-matched to country) ─── */
async function fetchGdeltSecurity() {
  const query = encodeURIComponent('(security OR attack OR terrorism OR protest OR conflict OR clashes)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
    `&mode=ArtList&maxrecords=200&format=json&sort=DateDesc&timespan=5d`;
  try {
    const res = await timedFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.articles)) return [];
    return data.articles.map((a) => {
      const m = String(a.seendate ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      return {
        title: String(a.title ?? '').trim(),
        url: a.url ?? '',
        domain: a.domain ?? 'GDELT',
        at: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(),
      };
    }).filter((a) => a.title && a.url);
  } catch {
    return [];
  }
}

function scoreCountry(entry, adv, gdelt) {
  const desc = adv.desc.toLowerCase();
  const levelScore = LEVEL_SCORE[adv.level];

  const categories = {};
  const reasons = [];
  for (const cat of CATEGORY_KEYS) {
    if (cat === 'security') { categories[cat] = levelScore; continue; }
    // Deterministic: base on the official advisory level, then scale by how many
    // distinct risk indicators of this category the advisory actually names.
    const hits = CATEGORY_KEYWORDS[cat].filter((k) => desc.includes(k)).length;
    categories[cat] = hits > 0
      ? clamp(Math.round(0.55 * levelScore + hits * 11 + 18), 25, 97)
      : clamp(Math.round(levelScore * 0.3), 5, 45);
    if (hits > 0) reasons.push(cat);
  }

  const weighted = CATEGORY_KEYS.reduce((sum, c) => sum + WEIGHTS[c] * categories[c], 0);
  const overall = clamp(Math.round(0.45 * levelScore + 0.55 * weighted), 0, 100);
  const level = overall >= 75 ? 'CRITICAL' : overall >= 55 ? 'HIGH' : overall >= 30 ? 'MEDIUM' : 'LOW';
  const sev = severityFromLevel(adv.level);

  // Current threats — derived ONLY from the official advisory's stated reasons.
  const seen = new Set();
  const currentThreats = [];
  for (const [kw, arLabel] of REASON_AR) {
    if (desc.includes(kw) && !seen.has(arLabel)) {
      seen.add(arLabel);
      currentThreats.push({
        title: arLabel, severity: sev, time: adv.pubDate.toISOString(),
        source: 'وزارة الخارجية الأمريكية — تحذيرات السفر', url: adv.link,
      });
    }
  }

  // Timeline — the advisory update + any GDELT headline mentioning the country.
  const timeline = [{
    date: adv.pubDate.toISOString(), title: `تحديث التصنيف الأمني: ${adv.label}`,
    severity: sev, source: 'U.S. Department of State', url: adv.link,
  }];
  const gMatches = gdelt.filter((a) => a.title.toLowerCase().includes(entry.en.toLowerCase())).slice(0, 6);
  const gSources = new Set();
  for (const a of gMatches) {
    timeline.push({ date: a.at.toISOString(), title: a.title, severity: 'MEDIUM', source: a.domain, url: a.url });
    gSources.add(a.domain);
  }
  timeline.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());

  const lastUpdated = timeline.reduce((mx, t) => Math.max(mx, new Date(t.date).getTime()), adv.pubDate.getTime());

  const sources = [{ name: 'وزارة الخارجية الأمريكية (تحذيرات السفر)', url: adv.link }];
  for (const d of gSources) sources.push({ name: `GDELT · ${d}`, url: `https://${d}` });

  return {
    id: `sec-${entry.iso2}`,
    country: entry.ar, countryEn: entry.en, countryCode: entry.iso2,
    overall, level, advisoryLevel: adv.level, advisoryLabel: adv.label,
    categories, reasons, currentThreats, timeline, sources,
    lastUpdated: new Date(lastUpdated).toISOString(),
  };
}

// Merge real ACLED events into the matching country profiles: each event
// becomes a source-labelled current-threat + timeline entry, and recent
// fatalities give the country's overall score a modest, bounded boost so ACLED
// actually influences ranking. Nothing is invented; events without a matching
// watchlist country are dropped (this section is per-country).
function mergeAcled(profiles, events) {
  const byCountry = new Map(profiles.map((p) => [p.countryEn.toLowerCase(), p]));
  const grouped = new Map();
  for (const e of events) {
    const p = byCountry.get(String(e.country).toLowerCase());
    if (!p) continue;
    if (!grouped.has(p.id)) grouped.set(p.id, []);
    grouped.get(p.id).push(e);
  }

  for (const p of profiles) {
    const evs = (grouped.get(p.id) ?? []).sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
    if (evs.length === 0) continue;

    for (const e of evs.slice(0, 8)) {
      const typeAr = ACLED_TYPE_AR[e.eventType] ?? e.eventType;
      const fatal = e.fatalities > 0 ? ` — ${e.fatalities} قتيل` : '';
      const title = `${typeAr}${e.location ? ` · ${e.location}` : ''}${fatal}`;
      p.timeline.push({ date: new Date(e.eventDate).toISOString(), title, severity: e.severity, source: 'ACLED', url: e.sourceUrl });
    }
    // Surface the two most severe recent events as current threats.
    for (const e of [...evs].sort((a, b) => b.fatalities - a.fatalities).slice(0, 2)) {
      const typeAr = ACLED_TYPE_AR[e.eventType] ?? e.eventType;
      p.currentThreats.push({ title: typeAr, severity: e.severity, time: new Date(e.eventDate).toISOString(), source: 'ACLED', url: e.sourceUrl });
    }
    p.sources.push({ name: 'ACLED (أحداث النزاع)', url: 'https://acleddata.com/dashboard/' });

    // Modest, bounded score boost from fatalities in the last 7 days.
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recentFatal = evs.filter((e) => new Date(e.eventDate).getTime() >= weekAgo).reduce((s, e) => s + e.fatalities, 0);
    if (recentFatal > 0) {
      p.overall = clamp(p.overall + Math.min(12, Math.round(recentFatal / 5)), 0, 100);
      p.level = p.overall >= 75 ? 'CRITICAL' : p.overall >= 55 ? 'HIGH' : p.overall >= 30 ? 'MEDIUM' : 'LOW';
    }
    p.timeline.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
    p.lastUpdated = new Date(Math.max(new Date(p.lastUpdated).getTime(), new Date(evs[0].eventDate).getTime())).toISOString();
  }
}

let cache = { at: 0, payload: null };

export async function getSecurityProfiles() {
  if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true };
  }

  // Advisory feed is required (authoritative). GDELT + ACLED are best-effort.
  const [advResult, gdelt, acled] = await Promise.allSettled([
    fetchAdvisories(),
    fetchGdeltSecurity(),
    fetchAcledEvents(),
  ]);
  if (advResult.status !== 'fulfilled') {
    throw new Error('advisory source unavailable');
  }
  const advisories = advResult.value;
  const gdeltArticles = gdelt.status === 'fulfilled' ? gdelt.value : [];
  const acledResult = acled.status === 'fulfilled' ? acled.value : { configured: acledConfigured(), ok: false, events: [] };

  const profiles = WATCHLIST
    .map((entry) => {
      const adv = advisories.get(entry.en.toLowerCase());
      return adv ? scoreCountry(entry, adv, gdeltArticles) : null;
    })
    .filter(Boolean);

  // Fold in real ACLED conflict events, then rank.
  mergeAcled(profiles, acledResult.events);
  profiles.sort((a, b) => b.overall - a.overall);

  const payload = {
    profiles,
    sources: {
      'U.S. State Dept': { configured: true, ok: true, count: profiles.length },
      GDELT: { configured: true, ok: gdelt.status === 'fulfilled', count: gdeltArticles.length },
      ACLED: { configured: acledResult.configured, ok: acledResult.ok, count: acledResult.events.length },
    },
    cachedAt: new Date().toISOString(),
    cached: false,
  };
  cache = { at: Date.now(), payload };
  return payload;
}

export const SECURITY_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
