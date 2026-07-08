const STORAGE_KEY = 'disaster-history-log';
const MAX_ENTRIES = 90;

export interface HistoryEntry {
  date: string; // 'YYYY-MM-DD'
  counts: Record<string, number>;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Records today's counts once per calendar day — safe to call on every render/mount. */
export function recordDailySnapshot(counts: Record<string, number>): void {
  try {
    const log = getHistory();
    const today = todayKey();
    if (log.length > 0 && log[log.length - 1].date === today) {
      log[log.length - 1] = { date: today, counts };
    } else {
      log.push({ date: today, counts });
    }
    const trimmed = log.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage unavailable — history simply won't accumulate this session
  }
}

/** Daily counts for one category, oldest first, excluding today. */
export function getCategoryHistory(category: string): number[] {
  const today = todayKey();
  return getHistory()
    .filter((e) => e.date !== today)
    .map((e) => e.counts[category] ?? 0);
}
