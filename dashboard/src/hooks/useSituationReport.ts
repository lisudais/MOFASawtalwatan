import { useQuery } from '@tanstack/react-query';
import { fetchSituationReport, type SituationReportStats } from '../services/aiInsight';

const STALE_TIME_MS = 20 * 60 * 1000; // don't re-call the model more than once per 20 min per category

export function useSituationReport(category: string | null, stats: SituationReportStats | null, sourceNames: string[]) {
  return useQuery({
    queryKey: ['situation-report', category, stats?.rate.current, stats?.rate.previous],
    queryFn: () => fetchSituationReport(stats!, sourceNames),
    enabled: !!category && !!stats,
    staleTime: STALE_TIME_MS,
    gcTime: STALE_TIME_MS * 2,
  });
}
