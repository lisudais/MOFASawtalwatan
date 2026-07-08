// Netlify Function — GET /api/gold. Gold spot + 7-day history (Yahoo GC=F,
// gold-api.com fallback). Thin wrapper over the shared gold core.
import { getGold, GOLD_CACHE_MAX_AGE } from '../lib/goldCore.mjs';

export default async () => {
  try {
    const data = await getGold();
    if (!data) {
      return new Response(JSON.stringify({ error: 'gold-unavailable' }), {
        status: 502, headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${GOLD_CACHE_MAX_AGE}, stale-while-revalidate=600`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'gold-proxy-failure' }), {
      status: 502, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};

export const config = { path: '/api/gold' };
