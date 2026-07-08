// Netlify Function — GET /api/security. Thin wrapper over the security core.
import { getSecurityProfiles, SECURITY_CACHE_MAX_AGE } from '../lib/securityCore.mjs';

export default async () => {
  try {
    const payload = await getSecurityProfiles();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${SECURITY_CACHE_MAX_AGE}, stale-while-revalidate=180`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'security-proxy-failure', profiles: [] }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};

export const config = { path: '/api/security' };
