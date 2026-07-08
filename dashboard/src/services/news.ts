import type { NewsArticle, VolumePoint } from '../types';

const GDELT_QUERY = '(Saudi Arabia OR "Middle East") sourcelang:english';
const GDELT_URL =
  `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}` +
  '&mode=artlist&format=json&maxrecords=15&sort=datedesc';
const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(GDELT_URL)}`;

const GDELT_VOL_URL =
  `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}` +
  '&mode=timelinevol&format=json';
const VOL_PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(GDELT_VOL_URL)}`;

function parseGdeltDate(rawDate: string): Date {
  // Tolerate both "20260706T081234Z" (artlist) and "20260706081234" (timeline* modes)
  const digits = rawDate.replace(/[^0-9]/g, '');
  const m = digits.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

export async function fetchNewsAnalysis(): Promise<NewsArticle[]> {
  try {
    const res = await fetch(PROXY_URL, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const articles = data.articles ?? [];

    return (articles as any[]).map((a, i) => ({
      id: `gdelt-${i}-${a.url}`,
      title: a.title ?? '',
      url: a.url,
      source: a.domain ?? 'unknown',
      seenDate: a.seendate ? parseGdeltDate(a.seendate) : new Date(),
    })).filter((a) => a.title);
  } catch {
    return [];
  }
}

export async function fetchNewsVolume(): Promise<VolumePoint[]> {
  try {
    const res = await fetch(VOL_PROXY_URL, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const points = data.timeline?.[0]?.data ?? [];

    return (points as any[])
      .map((p) => ({
        date: p.date ? parseGdeltDate(p.date) : new Date(NaN),
        count: typeof p.value === 'number' ? p.value : 0,
      }))
      .filter((p) => !Number.isNaN(p.date.getTime()));
  } catch {
    return [];
  }
}
