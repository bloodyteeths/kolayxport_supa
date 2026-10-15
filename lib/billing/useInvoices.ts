// lib/billing/useInvoices.ts — settings §2.4 / §9.6: invoices from `GET /api/stripe/billing-history`,
// paged with `?limit=` + `?starting_after=<invoiceId>` (A1). `useSWRInfinite`; disabled (no request)
// when the account must not see Stripe surfaces.
//
// Tolerates both response shapes: the pre-A1 body `{ invoices: [{ id, date, amount, currency, status,
// hostedInvoiceUrl, invoicePdf, description, period }] }` (paid only, ignores `limit`, no `hasMore`) and
// the A1 body `{ invoices: [... + number, plan, interval], hasMore, nextCursor }`. Pages continue from
// `nextCursor` (last id scanned), so a page Stripe filled with drafts still pages forward.
import useSWRInfinite from 'swr/infinite';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import { jsonFetcher } from './useEntitlement';
import type { Interval, Invoice, InvoicesPage } from './types';
import { isPlanKey } from './types';

export const BILLING_HISTORY_KEY = '/api/stripe/billing-history';
export const INVOICE_LIMIT_MIN = 5;
export const INVOICE_LIMIT_MAX = 100;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : v instanceof Date ? v.toISOString() : null);

function normalizeInvoice(raw: unknown): Invoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const date = str(r.date) ?? (typeof r.created === 'number' ? new Date(r.created * 1000).toISOString() : null);
  if (!id || !date) return null;
  const period = r.period && typeof r.period === 'object' ? (r.period as Record<string, unknown>) : {};
  const amount = typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : Number(r.amount);
  const interval = r.interval === 'month' || r.interval === 'year' ? (r.interval as Interval) : null;
  return {
    id,
    number: str(r.number),
    date,
    amount: Number.isFinite(amount) ? amount : 0,
    currency: (str(r.currency) ?? '').toUpperCase(),
    status: (str(r.status) ?? '').toLowerCase(),
    plan: isPlanKey(r.plan) ? r.plan : null,
    interval,
    periodStart: str(period.start) ?? str(r.periodStart),
    periodEnd: str(period.end) ?? str(r.periodEnd),
    hostedInvoiceUrl: str(r.hostedInvoiceUrl),
    invoicePdf: str(r.invoicePdf),
  };
}

/** Pure: a billing-history body → one page. `limit` trims the pre-A1 response (it ignores `?limit=`). */
export function normalizeInvoicesPage(raw: unknown, limit: number): InvoicesPage {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(r.invoices) ? r.invoices.map(normalizeInvoice).filter((x): x is Invoice => !!x) : [];
  // Stripe drafts never reach the UI (A1 excludes them; the old route only listed `paid`).
  const visible = list.filter((i) => i.status !== 'draft');
  if (typeof r.hasMore === 'boolean') return { invoices: visible, hasMore: r.hasMore, nextCursor: str(r.nextCursor) };
  return { invoices: visible.slice(0, limit), hasMore: false, nextCursor: null };
}

/** Pure: where the next page starts — the server's scan cursor, else the last row shown; null = stop. */
export function nextInvoiceCursor(prev: InvoicesPage | null): string | null {
  if (!prev || !prev.hasMore) return null;
  return prev.nextCursor ?? prev.invoices[prev.invoices.length - 1]?.id ?? null;
}

export function clampInvoiceLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.min(INVOICE_LIMIT_MAX, Math.max(INVOICE_LIMIT_MIN, Math.round(limit)));
}

export function invoicesKey(limit: number, startingAfter?: string | null): string {
  const q = new URLSearchParams({ limit: String(clampInvoiceLimit(limit)) });
  if (startingAfter) q.set('starting_after', startingAfter);
  return `${BILLING_HISTORY_KEY}?${q.toString()}`;
}

export interface UseInvoicesResult {
  invoices: Invoice[];
  hasMore: boolean;
  loadMore: () => void;
  /** First page state (`empty` when the list is empty or the hook is disabled). */
  state: AsyncState;
  retry: () => void;
  /** A "Load more" page is in flight. */
  loadingMore: boolean;
  /** The last "Load more" failed (first page still shown). */
  loadMoreFailed: boolean;
}

export function useInvoices({ limit = 20, enabled = true }: { limit?: number; enabled?: boolean } = {}): UseInvoicesResult {
  const size = clampInvoiceLimit(limit);
  const swr = useSWRInfinite<InvoicesPage>(
    (index: number, prev: InvoicesPage | null) => {
      if (!enabled) return null;
      if (index === 0) return invoicesKey(size);
      const cursor = nextInvoiceCursor(prev);
      return cursor ? invoicesKey(size, cursor) : null;
    },
    async (url: string) => normalizeInvoicesPage(await jsonFetcher(url), size),
    { revalidateOnFocus: false, revalidateFirstPage: false, shouldRetryOnError: false },
  );
  const pages = swr.data ?? [];
  const invoices = pages.flatMap((p) => p.invoices);
  const last = pages[pages.length - 1];
  const firstLoaded = pages.length > 0;
  const pendingMore = swr.size > pages.length && firstLoaded;

  const region = useAsyncRegion(
    {
      data: firstLoaded ? invoices : undefined,
      error: firstLoaded ? undefined : swr.error,
      isLoading: enabled ? swr.isLoading : false,
      isValidating: enabled ? swr.isValidating && !firstLoaded : false,
      mutate: swr.mutate,
    },
    { idle: 'empty' },
  );

  return {
    invoices,
    hasMore: !!last?.hasMore,
    loadMore: () => { void swr.setSize(pages.length + 1); },
    state: region.state,
    retry: region.retry,
    loadingMore: pendingMore && !swr.error,
    loadMoreFailed: firstLoaded && !!swr.error,
  };
}

export default useInvoices;
