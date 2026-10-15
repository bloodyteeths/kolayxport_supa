// lib/hooks/useOverviewSummary.ts — client hook over `GET /api/overview/summary` (overview §3.7, §4, G4).
//
// Key: `/api/overview/summary?tz=<IANA>&currency=<TRY|USD>`. `tz` is the seller zone from `useFormatters()`
// (DS §3.12; it already falls back to Europe/Istanbul), `currency` the locale default (`localeConfig`) unless
// the caller passes one. SWR options per §3.7: poll every 60 s (never while the tab is hidden — SWR default),
// revalidate on focus, keep the previous summary while a new key loads or a refresh fails, retry twice.
//
// The receive time lives in the cached value (`receivedAt`), so every consumer of the key sees the same
// freshness, and an error over an older summary can render "Showing data from 10:42 · Retry" (`isStale`).
import useSWR from 'swr';
import { useFormatters } from '@/lib/format';
import { getLocaleConfig } from '@/lib/i18n/localeConfig';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import type { OverviewCurrency, OverviewSummary, OverviewSummaryError, SectionKey } from '@/lib/overview/types';

export const OVERVIEW_SUMMARY_PATH = '/api/overview/summary';
/** Every summary key starts with this (useSyncOrders revalidates them all). */
export const OVERVIEW_SUMMARY_KEY_PREFIX = `${OVERVIEW_SUMMARY_PATH}?`;
export const OVERVIEW_SUMMARY_REFRESH_MS = 60_000;

/** The SWR options of §3.7 (exported for tests and for a `preload` caller). */
export const OVERVIEW_SUMMARY_SWR_OPTIONS = {
  refreshInterval: OVERVIEW_SUMMARY_REFRESH_MS,
  refreshWhenHidden: false,
  revalidateOnFocus: true,
  keepPreviousData: true,
  errorRetryCount: 2,
} as const;

/** Pure: the SWR key for a zone and currency. */
export function overviewSummaryKey(tz: string, currency: OverviewCurrency): string {
  const qs = new URLSearchParams({ tz, currency });
  return `${OVERVIEW_SUMMARY_PATH}?${qs.toString()}`;
}

/** Pure: `localeConfig.defaultCurrency` narrowed to the two currencies the summary supports. */
export function defaultOverviewCurrency(locale: 'tr' | 'en'): OverviewCurrency {
  return getLocaleConfig(locale).defaultCurrency === 'USD' ? 'USD' : 'TRY';
}

/** A failed request (whole response). `requestId` is the server's, for "Copy error ID", when it sent one. */
export class OverviewSummaryFetchError extends Error {
  status: number | null;
  requestId: string | null;
  constructor(status: number | null, requestId: string | null = null) {
    super(status == null ? 'Failed to load overview summary (network)' : `Failed to load overview summary (${status})`);
    this.name = 'OverviewSummaryFetchError';
    this.status = status;
    this.requestId = requestId;
  }
}

/** The cached value: the response plus the client time it arrived. */
export type OverviewSummaryCached = OverviewSummary & { receivedAt: number };

export const overviewSummaryFetcher = async (url: string): Promise<OverviewSummaryCached> => {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new OverviewSummaryFetchError(null);
  }
  if (!res.ok) {
    let requestId: string | null = null;
    try {
      const body = (await res.json()) as Partial<OverviewSummaryError> | null;
      if (body && typeof body.requestId === 'string') requestId = body.requestId;
    } catch {
      /* non-JSON error body */
    }
    throw new OverviewSummaryFetchError(res.status, requestId);
  }
  const json = (await res.json()) as OverviewSummary;
  return { ...json, receivedAt: Date.now() };
};

/** Pure: did this section fail (null + listed in `errors`)? A missing summary counts as not failed (loading). */
export function sectionFailed(summary: Pick<OverviewSummary, 'errors'> | null | undefined, key: SectionKey): boolean {
  return Boolean(summary && summary.errors.includes(key));
}

export interface UseOverviewSummaryOptions {
  /** Default: the locale's currency (TRY for tr, USD for en). */
  currency?: OverviewCurrency;
  /** Default: the seller zone from `useFormatters()`. */
  tz?: string;
  /** false = no request (the `overview` flag is off, or auth is still loading). Default true. */
  enabled?: boolean;
}

export interface UseOverviewSummaryResult {
  /** The latest summary; while a refresh failed, the previous one (see `isStale`). */
  summary: OverviewSummaryCached | undefined;
  error: OverviewSummaryFetchError | undefined;
  /** First load: no summary yet and a request is running. */
  isLoading: boolean;
  isValidating: boolean;
  /** An error arrived while an older summary is still shown ("Showing data from {receivedAt} · Retry"). */
  isStale: boolean;
  /** Whole request failed and nothing to show ("Couldn't load your overview"). */
  isError: boolean;
  /** Re-fetch now (Retry buttons, after a refresh). */
  refresh: () => Promise<OverviewSummaryCached | undefined>;
  key: string | null;
  tz: string;
  currency: OverviewCurrency;
}

/**
 * The summary's retry policy (replaces SWR's built-in one, so it must honour `errorRetryCount` itself).
 * SWR passes `retryCount` starting at 1 for the first error, and its default handler stops only when
 * `retryCount > errorRetryCount` — so 2 means 1 request + 2 retries. 401/405 are never retried: an expired
 * session is not a transient error. Backoff 5 s, 10 s.
 */
export function overviewSummaryOnErrorRetry(
  err: { status?: number | null } | undefined,
  revalidate: (opts: { retryCount: number }) => unknown,
  retryCount: number,
): void {
  if (err?.status === 401 || err?.status === 405) return;
  if (retryCount > OVERVIEW_SUMMARY_SWR_OPTIONS.errorRetryCount) return;
  setTimeout(() => void revalidate({ retryCount }), 5000 * 2 ** Math.max(0, retryCount - 1));
}

export function useOverviewSummary(options: UseOverviewSummaryOptions = {}): UseOverviewSummaryResult {
  const fmt = useFormatters();
  const locale = useLocaleStore((s) => s.locale);
  const tz = options.tz ?? fmt.timeZone;
  const currency = options.currency ?? defaultOverviewCurrency(locale);
  const key = options.enabled === false ? null : overviewSummaryKey(tz, currency);

  const swr = useSWR<OverviewSummaryCached, OverviewSummaryFetchError>(key, overviewSummaryFetcher, {
    ...OVERVIEW_SUMMARY_SWR_OPTIONS,
    onErrorRetry: (err, _key, _config, revalidate, { retryCount }) =>
      overviewSummaryOnErrorRetry(err, revalidate, retryCount),
  });

  const summary = swr.data;
  const error = swr.error;
  return {
    summary,
    error,
    isLoading: Boolean(key) && !summary && !error,
    isValidating: swr.isValidating,
    isStale: Boolean(error && summary),
    isError: Boolean(error && !summary),
    refresh: () => swr.mutate(),
    key,
    tz,
    currency,
  };
}

export default useOverviewSummary;
