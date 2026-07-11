// Netlify Function — GET /api/link-check?url=... . Validates a source link
// server-side (see linkCheckCore.mjs for why) before the UI opens it.
import { checkUrl } from '../lib/linkCheckCore.mjs';

export default async (req) => {
  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return new Response(JSON.stringify({ ok: false, status: 0, error: 'missing url' }), {
      status: 400, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const result = await checkUrl(url);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
};

export const config = { path: '/api/link-check' };
