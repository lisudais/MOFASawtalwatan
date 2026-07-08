// Backend proxy for gold price + 7-day history.
//
// Alpha Vantage's free tier has no gold and the browser can't reach a
// historical gold source directly (Yahoo sends no CORS header; gold-api.com is
// spot-only). Server-side has neither limit, so we fetch the daily gold-futures
// series from Yahoo Finance (GC=F) here and fall back to gold-api.com's spot
// price if Yahoo is unavailable. Cached ~1h.

const YF_URL = 'https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=10d';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

let cache = { at: 0, data: null };

async function fromYahoo() {
  const res = await fetch(YF_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) return null;
  const d = await res.json();
  const r = d?.chart?.result?.[0];
  const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter((x) => typeof x === 'number');
  if (closes.length < 2) return null;
  const trend = closes.slice(-7);
  const value = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  const changePercent = prev ? +(((value - prev) / prev) * 100).toFixed(2) : 0;
  return { value: +value.toFixed(2), changePercent, trend: trend.map((v) => +v.toFixed(2)), source: 'Yahoo Finance', updatedAt: new Date().toISOString() };
}

async function fromGoldApi() {
  const res = await fetch('https://api.gold-api.com/price/XAU', { signal: AbortSignal.timeout(9000) });
  if (!res.ok) return null;
  const d = await res.json();
  const v = parseFloat(d?.price);
  if (!Number.isFinite(v)) return null;
  return { value: +v.toFixed(2), changePercent: 0, trend: [], source: 'Gold-API', updatedAt: d?.updatedAt ?? new Date().toISOString() };
}

export async function getGold() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) return { ...cache.data, cached: true };
  let data = null;
  try { data = await fromYahoo(); } catch { data = null; }
  if (!data) { try { data = await fromGoldApi(); } catch { data = null; } }
  if (data) cache = { at: Date.now(), data };
  return data;
}

export const GOLD_CACHE_MAX_AGE = Math.floor(CACHE_TTL_MS / 1000);
