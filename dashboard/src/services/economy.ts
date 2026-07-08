// Economic Changes — LIVE data only (no mock).
//
// Primary: Alpha Vantage (https://www.alphavantage.co) — near-real-time oil,
//   natural gas, gold, and USD/SAR. Requires a free key in
//   VITE_ALPHAVANTAGE_API_KEY (free tier = 25 requests/day, so results are
//   cached aggressively below).
// Fallback: World Bank API (https://api.worldbank.org) — keyless, CORS-open,
//   official macro indicators (inflation, GDP growth). Used when Alpha Vantage
//   has no key or fails. Because it needs no key, the card shows REAL data out
//   of the box even before an Alpha Vantage key is added.
// If BOTH fail → getEconomicIndicators() throws → the card's "تعذّر الاتصال"
// state. Never any mock fallback.

export interface EconomicIndicator {
  key: string;
  nameAr: string;
  unit: string;
  value: number;
  changePercent: number; // vs previous reading (points for macro %, % for prices)
  trend: number[];       // oldest → newest, for the sparkline
  updatedAt: string;     // ISO
  source: string;        // 'Alpha Vantage' | 'World Bank' | 'Gold-API'
}

const AV_KEY = import.meta.env.VITE_ALPHAVANTAGE_API_KEY as string | undefined;
const AV_BASE = 'https://www.alphavantage.co/query';
const WB_BASE = 'https://api.worldbank.org/v2';
const TIMEOUT = 9000;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h — keeps us well under AV's 25/day

const num = (v: unknown) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
};
const pctChange = (latest: number, prev: number) =>
  prev !== 0 ? +(((latest - prev) / Math.abs(prev)) * 100).toFixed(2) : 0;

/* ─── Alpha Vantage (primary) ────────────────────────────────────────── */

// WTI / BRENT / NATURAL_GAS: { data: [{date, value}] } newest-first.
async function avCommodity(fn: string, key: string, nameAr: string, unit: string): Promise<EconomicIndicator | null> {
  const res = await fetch(`${AV_BASE}?function=${fn}&interval=daily&apikey=${AV_KEY}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  const data = await res.json();
  const rows: { date: string; value: string }[] = Array.isArray(data?.data) ? data.data : [];
  const pts = rows.map((r) => ({ date: r.date, v: num(r.value) })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return null; // includes the "rate limit / note" responses (no data array)
  return {
    key, nameAr, unit, value: pts[0].v, changePercent: pctChange(pts[0].v, pts[1].v),
    trend: pts.slice(0, 7).map((p) => p.v).reverse(),
    updatedAt: new Date(pts[0].date).toISOString(), source: 'Alpha Vantage',
  };
}

// Gold (XAU/USD) — Alpha Vantage's free tier has no gold and no historical gold
// source is reachable from the browser (CORS), so gold comes from our own
// backend proxy /api/gold (Yahoo GC=F daily series server-side, with a
// gold-api.com spot fallback). Includes the 7-day trend for the sparkline.
async function fetchGold(): Promise<EconomicIndicator | null> {
  try {
    const res = await fetch('/api/gold', { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!Number.isFinite(num(d?.value))) return null;
    return {
      key: 'gold', nameAr: 'الذهب', unit: 'دولار/أونصة',
      value: d.value, changePercent: Number.isFinite(d?.changePercent) ? d.changePercent : 0,
      trend: Array.isArray(d?.trend) ? d.trend : [],
      updatedAt: d?.updatedAt ?? new Date().toISOString(), source: d?.source ?? 'Gold',
    };
  } catch {
    return null;
  }
}

// FX_DAILY: { "Time Series FX (Daily)": { date: { "4. close" } } } — USD/SAR.
async function avFx(from: string, to: string, key: string, nameAr: string, unit: string): Promise<EconomicIndicator | null> {
  const res = await fetch(`${AV_BASE}?function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&apikey=${AV_KEY}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  const data = await res.json();
  const series = data?.['Time Series FX (Daily)'];
  if (!series) return null;
  const dates = Object.keys(series).sort().reverse(); // newest-first
  const closes = dates.map((d) => num(series[d]?.['4. close'])).filter(Number.isFinite);
  if (closes.length < 2) return null;
  return {
    key, nameAr, unit, value: closes[0], changePercent: pctChange(closes[0], closes[1]),
    trend: closes.slice(0, 7).reverse(), updatedAt: new Date(dates[0]).toISOString(), source: 'Alpha Vantage',
  };
}

// Alpha Vantage commodity/FX set (verified live on the free tier): WTI oil,
// natural gas, USD/SAR. Requests are made sequentially to respect AV's
// 1-request/second burst limit (parallel calls trip it and return a note).
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAlphaVantage(): Promise<EconomicIndicator[]> {
  if (!AV_KEY) return [];
  const key = AV_KEY;
  const out: EconomicIndicator[] = [];
  const oil = await avCommodity('WTI', key, 'النفط', 'دولار/برميل');
  if (oil) out.push(oil);
  await delay(1300);
  const gas = await avCommodity('NATURAL_GAS', key, 'الغاز', 'دولار/MMBtu');
  if (gas) out.push(gas);
  await delay(1300);
  const sar = await avFx('USD', 'SAR', key, 'الدولار/الريال', 'ريال');
  if (sar) out.push(sar);
  return out;
}

/* ─── World Bank (fallback) — official macro indicators, keyless ──────── */

const WB_INDICATORS: { key: string; country: string; indicator: string; nameAr: string; unit: string }[] = [
  { key: 'sau-cpi', country: 'SAU', indicator: 'FP.CPI.TOTL.ZG', nameAr: 'التضخم — السعودية', unit: '%' },
  { key: 'wld-cpi', country: 'WLD', indicator: 'FP.CPI.TOTL.ZG', nameAr: 'التضخم — عالمي', unit: '%' },
  { key: 'sau-gdp', country: 'SAU', indicator: 'NY.GDP.MKTP.KD.ZG', nameAr: 'نمو الناتج — السعودية', unit: '%' },
  { key: 'wld-gdp', country: 'WLD', indicator: 'NY.GDP.MKTP.KD.ZG', nameAr: 'نمو الاقتصاد العالمي', unit: '%' },
];

async function wbFetch(cfg: (typeof WB_INDICATORS)[number]): Promise<EconomicIndicator | null> {
  const res = await fetch(`${WB_BASE}/country/${cfg.country}/indicator/${cfg.indicator}?format=json&per_page=10&mrv=10`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  const data = await res.json();
  const rows: any[] = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  const meta = Array.isArray(data) ? data[0] : null;
  const pts = rows.map((r) => num(r.value)).filter(Number.isFinite); // newest-first
  if (pts.length < 2) return null;
  return {
    key: cfg.key, nameAr: cfg.nameAr, unit: cfg.unit,
    value: +pts[0].toFixed(2), changePercent: +(pts[0] - pts[1]).toFixed(2),
    trend: pts.slice(0, 7).reverse(),
    updatedAt: meta?.lastupdated ? new Date(meta.lastupdated).toISOString() : new Date().toISOString(),
    source: 'World Bank',
  };
}

async function fetchWorldBank(): Promise<EconomicIndicator[]> {
  const results = await Promise.allSettled(WB_INDICATORS.map(wbFetch));
  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((x): x is EconomicIndicator => x !== null);
}

/* ─── Orchestrator with cache + automatic fallback ───────────────────── */
let cache: { at: number; data: EconomicIndicator[] } | null = null;

export async function getEconomicIndicators(): Promise<EconomicIndicator[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  // Gold (via our /api/gold proxy) is always attempted — neither AV nor World
  // Bank provide it. It carries its own 7-day trend for the sparkline.
  const gold = await fetchGold();

  // Primary: Alpha Vantage commodities/FX (oil, gas, USD/SAR) when a key exists.
  // Fallback: World Bank macro indicators when Alpha Vantage yields nothing.
  const av = await fetchAlphaVantage();
  const base = av.length > 0 ? av : await fetchWorldBank();

  // Gold leads the list (headline commodity) when available.
  const indicators = gold ? [gold, ...base] : base;

  if (indicators.length === 0) {
    throw new Error('تعذّر جلب المؤشرات الاقتصادية من المصادر');
  }

  cache = { at: Date.now(), data: indicators };
  return indicators;
}
