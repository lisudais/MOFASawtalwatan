// Netlify Function — GET /api/gdelt-feed. Thin wrapper over the GDELT core.
// Serves the Global Alert Feed's Stage 1 catch-all detection layer only.
import { getGdeltFeed, GDELT_FEED_CACHE_MAX_AGE } from '../lib/gdeltFeedCore.mjs';

export default async () => {
  const payload = await getGdeltFeed();
  // 200 even when ok:false — the adapter reads `ok`, and a 502 here would be
  // indistinguishable from the proxy itself being down.
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${GDELT_FEED_CACHE_MAX_AGE}, stale-while-revalidate=60`,
    },
  });
};

export const config = { path: '/api/gdelt-feed' };
