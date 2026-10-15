// Home data (research.md §4.1, §10): GET /api/research/home?mkt → `ResearchResponse<HomeData>` (R1-A). DB only, no
// marketplace call. Only Etsy and eBay have a Listing doctor, so the request names the selected marketplace when
// it is one of them (the server falls back to the first connected and reports it in `needsWorkMkt`).
import useSWR from 'swr';
import { useAsyncRegion } from '@/lib/ds/useAsyncState';
import type { HomeData, ResearchMkt, ResearchResponse } from '@/lib/research/types';
import { errorsOf, fetchResearch } from '@/lib/research/hooks/useResearchProducts';

export function homeKey(mkt: ResearchMkt): string {
  return mkt === 'etsy' || mkt === 'ebay' ? `/api/research/home?mkt=${mkt}` : '/api/research/home';
}

export function useResearchHome(mkt: ResearchMkt) {
  const swr = useSWR<ResearchResponse<HomeData>>(homeKey(mkt), (u: string) => fetchResearch<HomeData>(u), {
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
  const data = swr.data?.data ?? null;
  const needsWork = Array.isArray(data?.needsWork) ? data!.needsWork.slice(0, 3) : [];
  const region = useAsyncRegion({ data: swr.data ? needsWork : undefined, error: swr.error, isLoading: swr.isLoading, isValidating: swr.isValidating, mutate: swr.mutate });
  return {
    /** null = no Etsy/eBay store connected; undefined = not known yet. */
    needsWorkMkt: swr.data ? (data?.needsWorkMkt ?? null) : undefined,
    needsWork,
    needsWorkTotal: typeof data?.needsWorkTotal === 'number' ? data.needsWorkTotal : needsWork.length,
    recentWatched: Array.isArray(data?.recentWatched) ? data!.recentWatched : [],
    source: swr.data?.source,
    errors: errorsOf(swr.data),
    region,
  };
}
