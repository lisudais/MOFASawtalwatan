// Client for the /api/link-check proxy (netlify/functions/link-check.mjs) —
// see that file for why this can't just be a browser fetch() to the target.
export interface LinkCheckResult {
  ok: boolean;
  status: number;
}

export async function checkLink(url: string): Promise<LinkCheckResult> {
  try {
    const res = await fetch(`/api/link-check?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return await res.json();
  } catch {
    return { ok: false, status: 0 };
  }
}
