// Netlify Function — GET /api/statements (via redirect) or
// /.netlify/functions/statements. Thin wrapper over the shared proxy core.
import { getStatements, CACHE_MAX_AGE_SECONDS } from '../lib/statementsCore.mjs';

export default async () => {
  try {
    const payload = await getStatements();

    // If every source failed, surface a 502 so the client shows its error state.
    const allFailed = Object.values(payload.sources).every((s) => !s.ok);
    if (allFailed && payload.statements.length === 0) {
      return new Response(JSON.stringify({ error: 'all-sources-failed', ...payload }), {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Short CDN/browser cache on top of the in-memory cache.
        'cache-control': `public, max-age=${CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=120`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'proxy-failure', statements: [] }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};

export const config = { path: '/api/statements' };
