// Server-side link validation for "official source" links rendered across
// the dashboard (disasters, health, security, statements).
//
// Why this has to run server-side: a browser fetch() to a cross-origin URL
// without the target's CORS headers only ever gets an opaque response (status
// always 0), so the page can never tell 200 from 404 itself. Node has no such
// restriction, so this proxy makes the real request and hands back just the
// outcome — never the body, never credentials.

const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

export async function checkUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0 };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, status: 0 };
  }

  // Some servers reject HEAD (405/501) — fall back to GET before giving up.
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(parsed.toString(), {
        method,
        redirect: 'follow',
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, status: res.status };
      if (method === 'GET') return { ok: false, status: res.status };
    } catch {
      if (method === 'GET') return { ok: false, status: 0 };
    }
  }
  return { ok: false, status: 0 };
}
