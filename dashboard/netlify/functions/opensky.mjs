// Netlify Function — GET /api/opensky. Live aircraft states (OpenSky, free/
// anonymous). Thin wrapper over the shared flight core. Isolated from alerts.
import { getOpenSkyStates, OPENSKY_CACHE_MAX_AGE } from '../lib/openskyCore.mjs';

export default async () => {
  try {
    const data = await getOpenSkyStates();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${OPENSKY_CACHE_MAX_AGE}`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ time: 0, states: [], ok: false }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};

export const config = { path: '/api/opensky' };
