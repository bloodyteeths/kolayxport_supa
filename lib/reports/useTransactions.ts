// lib/reports/useTransactions.ts — finance-analytics §6.3, M9 Group E.
//
// Client data layer of Reports › Transactions (and the Payouts "Open Transactions" link):
//   - `useTransactionsFilter()`  the tab's own URL keys: `type` (category filter) and `page` (1-based). Range and
//                                marketplace come from `useFinanceScope()` (lib/reports/useFinanceReport.ts, Group D),
//                                so every finance tab resolves `mp`/`from`/`to` the same way.
//   - `useTransactions()`        SWR over `GET /api/finance/settlements` (page, size, category), errors surfaced (B14).
//   - `typeOptionsFromSummary()` the Type filter options with counts, from the dashboard's `transactionTypeSummary`.
//   - CSV                        the `format=csv` export URL (§6.2: every row in range, server-side) + a downloader.
//
// Ranges are seller-timezone calendar days: reads send `from`/`to` (YYYY-MM-DD) + `tz`, which the settlements handler
// turns into the same window as the dashboard (Group B `lib/finance/periods.ts`). Never `toISOString` for a day (B13).
import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import { useUrlState, urlField } from '@/lib/ds/useUrlState';
import { FinanceFetchError, type FinanceMarketplace } from '@/lib/reports/useFinanceReport';
import {
  classifyTransactionType, isTransactionCategory, TRANSACTION_CATEGORIES, type TransactionCategory,
} from '@/lib/finance/classifyTransaction';

// ── transactions ────────────────────────────────────────────────────────────────────────────────────────

export type TxCategory = TransactionCategory;
export const TX_CATEGORIES = TRANSACTION_CATEGORIES;
export const isTxCategory = isTransactionCategory;

/** One `FinancialTransaction` row as the UI reads it (Decimal columns arrive as strings → numbers). */
export interface TxRow {
  id: string;
  date: string;
  /** Raw marketplace type ("Sale", "Komisyon Faturası"), shown only in the tooltip (B16). */
  rawType: string;
  /** API `category` (§6.2); classified client-side with the same rule when absent. */
  category: TxCategory;
  productName: string | null;
  barcode: string | null;
  orderNumber: string | null;
  quantity: number;
  amount: number;
  commission: number | null;
  currency: string;
}

export interface TxPage {
  rows: TxRow[];
  total: number;
  /** 1-based. */
  page: number;
  size: number;
  /** `FinancialSyncCursor` (null = this marketplace was never synced). */
  syncCursor: { lastSyncedTo: string | null; totalSynced: number; updatedAt: string | null } | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Pure: normalises the settlements GET payload. Unknown shapes become an empty page, never a crash. */
export function parseTxPage(body: unknown): TxPage {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const list = Array.isArray(b.transactions) ? (b.transactions as Record<string, unknown>[]) : [];
  const rows: TxRow[] = list.map((r, i) => {
    const rawType = str(r?.transactionType) ?? '';
    return {
      id: str(r?.id) ?? `row-${i}`,
      date: str(r?.transactionDate) ?? '',
      rawType,
      category: isTransactionCategory(r?.category) ? r.category : classifyTransactionType(rawType),
      productName: str(r?.productName),
      barcode: str(r?.barcode),
      orderNumber: str(r?.orderNumber),
      quantity: num(r?.quantity) ?? 1,
      amount: num(r?.amount) ?? 0,
      commission: num(r?.commission),
      currency: str(r?.currency) ?? 'USD',
    };
  });
  const c = b.syncCursor && typeof b.syncCursor === 'object' ? (b.syncCursor as Record<string, unknown>) : null;
  return {
    rows,
    total: num(b.total) ?? rows.length,
    page: (num(b.page) ?? 0) + 1,
    size: num(b.size) ?? rows.length,
    syncCursor: c ? { lastSyncedTo: str(c.lastSyncedTo), totalSynced: num(c.totalSynced) ?? 0, updatedAt: str(c.updatedAt) } : null,
  };
}

/** Prefix of a raw-type filter value (an exact `transactionType`, e.g. from an old link). */
export const RAW_TYPE_PREFIX = 'raw:';

/** Pure: the Type filter value → the settlements query param (`category` per §6.2, or an exact `transactionType`). */
export function typeFilterParam(type: string | null): { category?: string; transactionType?: string } {
  if (!type) return {};
  if (type.startsWith(RAW_TYPE_PREFIX)) {
    const raw = type.slice(RAW_TYPE_PREFIX.length);
    return raw ? { transactionType: raw } : {};
  }
  return isTransactionCategory(type) ? { category: type } : {};
}

export interface TypeOption {
  /** Filter value written to the URL `type`. */
  value: TxCategory;
  count: number;
}

/**
 * Pure: Type filter options from the dashboard's `transactionTypeSummary` (`Record<rawType, { count, total,
 * category }>`, §6.2), one per category with counts summed, largest first. A summary item without `category` is
 * classified with the shared rule. Arrays of `{ type|transactionType, count, category? }` are accepted too.
 */
export function typeOptionsFromSummary(summary: unknown): TypeOption[] {
  const by = new Map<TxCategory, number>();
  const add = (raw: string, count: number, category: unknown) => {
    if (!(count > 0)) return;
    const cat = isTransactionCategory(category) ? category : classifyTransactionType(raw);
    by.set(cat, (by.get(cat) ?? 0) + count);
  };
  if (Array.isArray(summary)) {
    for (const it of summary as Record<string, unknown>[]) {
      add(str(it?.type) ?? str(it?.transactionType) ?? '', num(it?.count) ?? 0, it?.category);
    }
  } else if (summary && typeof summary === 'object') {
    for (const [raw, v] of Object.entries(summary as Record<string, unknown>)) {
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      add(raw, num(o.count) ?? 0, o.category);
    }
  }
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1] || TX_CATEGORIES.indexOf(a[0]) - TX_CATEGORIES.indexOf(b[0]))
    .map(([value, count]) => ({ value, count }));
}

// ── tab URL state (`type`, `page`) ─────────────────────────────────────────────────────────────────────

export const TX_URL_SCHEMA = {
  type: urlField.string(undefined, { maxLength: 120 }),
  page: urlField.int(1, { min: 1, max: 100_000 }),
};

/** Pure: `type` URL value → filter value (null = All). */
export function parseTypeParam(v: string | undefined | null): string | null {
  const s = v?.trim();
  if (!s || s === 'all') return null;
  return s;
}

export interface TransactionsFilter {
  type: string | null;
  /** 1-based. */
  page: number;
  setPage(page: number): void;
  setType(type: string | null): void;
  ready: boolean;
}

/**
 * `type` and `page` for the Transactions tab. `ReportsPage` renders the Type `FilterButton` from `toolbarExtra` and
 * writes `type` itself, so a change of type, marketplace or range (written by other `useUrlState` instances, which
 * do not know `page`) sends the table back to page 1 here.
 */
export function useTransactionsFilter(scopeKey: string): TransactionsFilter {
  const [q, set, helpers] = useUrlState(TX_URL_SCHEMA);
  const type = parseTypeParam(q.type);
  const resetKey = `${scopeKey}|${type ?? ''}`;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!helpers.ready) return;
    if (prev.current !== null && prev.current !== resetKey && q.page !== 1) set({ page: 1 });
    prev.current = resetKey;
  }, [resetKey, helpers.ready, q.page, set]);
  const setPage = useCallback((page: number) => set({ page: Math.max(1, Math.floor(page)) }), [set]);
  const setType = useCallback((next: string | null) => set({ type: next ?? undefined, page: 1 }), [set]);
  return { type, page: q.page, setPage, setType, ready: helpers.ready };
}

export const SETTLEMENTS_PATH = '/api/finance/settlements';
export const TX_PAGE_SIZES = [50, 100, 250] as const;
export type TxPageSize = (typeof TX_PAGE_SIZES)[number];

export interface TransactionsQuery {
  mp: FinanceMarketplace;
  from: string;
  to: string;
  tz: string;
  type: string | null;
  /** 1-based. */
  page: number;
  size: number;
}

function rangeParams(q: { mp: string; from: string; to: string; tz: string; type: string | null }): URLSearchParams {
  const qs = new URLSearchParams({ marketplace: q.mp, from: q.from, to: q.to, tz: q.tz });
  const p = typeFilterParam(q.type);
  if (p.category) qs.set('category', p.category);
  if (p.transactionType) qs.set('transactionType', p.transactionType);
  return qs;
}

/** Pure: the settlements GET URL (also the SWR key). The API page is 0-based. */
export function transactionsUrl(q: TransactionsQuery): string {
  const qs = rangeParams(q);
  qs.set('page', String(Math.max(0, q.page - 1)));
  qs.set('size', String(q.size));
  return `${SETTLEMENTS_PATH}?${qs.toString()}`;
}

export const transactionsFetcher = async (url: string): Promise<TxPage> => {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new FinanceFetchError(res.status, body);
  return parseTxPage(body);
};

export interface UseTransactionsResult {
  data: TxPage | undefined;
  /** DS four-state region (skeleton → "Still loading…" at 15 s → error at 30 s; `stale` keeps the old rows). */
  state: AsyncState;
  error: unknown;
  /** A new key or a revalidation is in flight (the rows stay, dimmed). */
  isValidating: boolean;
  /** Restarts the region timers and revalidates. */
  retry: () => void;
  mutate: () => Promise<TxPage | undefined>;
  key: string | null;
}

/** SWR on the settlements GET with `keepPreviousData` (a page change keeps the rows dimmed). `null` pauses it. */
export function useTransactions(q: TransactionsQuery | null): UseTransactionsResult {
  const key = q ? transactionsUrl(q) : null;
  const swr = useSWR<TxPage>(key, transactionsFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    // A 4xx (incl. 402 featureLocked, swapped to the locked body by the interceptor) is final.
    shouldRetryOnError: (err: unknown) => !(err instanceof FinanceFetchError && err.status >= 400 && err.status < 500),
    errorRetryCount: 2,
  });
  const region = useAsyncRegion<TxPage>(swr, { // `total`, not this page's rows: a page past the end (stale link, size change, backend dedupe) is not an
  // empty range (B14); the tab clamps the page instead.
  isEmpty: (d) => d.total === 0, idle: 'loading' });
  const { mutate } = swr;
  const revalidate = useCallback(() => mutate(), [mutate]);
  return {
    data: swr.data,
    state: region.state,
    error: swr.error,
    isValidating: swr.isValidating,
    retry: region.retry,
    mutate: revalidate,
    key,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `SETTLEMENTS_CSV_MAX_ROWS` of `pages/api/finance/settlements.ts` (not imported: that module is server-only). */
export const TX_EXPORT_MAX_ROWS = 50_000;

/** Pure: the Transactions export URL (`format=csv`, every row in range up to the API cap, §6.2). */
export function transactionsCsvUrl(q: Omit<TransactionsQuery, 'page' | 'size'>): string {
  const qs = rangeParams(q);
  qs.set('format', 'csv');
  return `${SETTLEMENTS_PATH}?${qs.toString()}`;
}

/** Fetches a file from our API and saves it under `fileName`. Rejects on a non-2xx (the caller shows the toast). */
export async function downloadFromUrl(url: string, fileName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/csv' } });
  if (!res.ok) throw new FinanceFetchError(res.status, null);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}
