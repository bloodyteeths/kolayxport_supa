// lib/hooks/useSyncOrders.ts — the one "Refresh orders" handler (overview §3.7, §4.4, G4).
//
// POST /api/orders/sync (`withUsageLimiter('orderSync')`, costs 1 order sync), then revalidates every orders SWR
// key (`/api/orders…`), the nav counters and the Overview summary. Optionally navigates afterwards (`redirectTo`;
// the Overview passes nothing and stays put, a palette caller can pass '/app/labels').
//
// - One request at a time app-wide: a second `sync()` while one runs returns the same promise, and `syncing` is
//   shared by every mounted caller (SyncMeta and the setup checklist show the same state).
// - Never automatic: callers run it on click only.
// - Toasts (i18n `overview.toast.*`): success "Orders refreshed" (4 s); 500 / network / 401 failure persistent
//   with Retry; 400 (nothing this endpoint can refresh) and 429 (defensive — the endpoint does not return it
//   today) are timed (4 s, `persist: false`) so they never hold the DS toast queue; a 402 usage limit shows
//   nothing here because the global limit interceptor already opened its dialog.
// - Known gap (integrator, outOfScope): CommandPalette's orders.refresh and useOrdersList's pull still POST the
//   endpoint with their own guards; until they call runOrdersSync() the dedupe covers only this hook's callers.
import { useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { mutate as globalMutate } from 'swr';
import { create } from 'zustand';
import { useToast } from '@/components/ds/feedback/toast';
import { fetchWithLimit } from '@/lib/fetchWithLimit';
import { isUsageLimitError } from '@/lib/notify';
import { NAV_COUNTS_KEY } from '@/lib/nav/useNavCounts';
import { OVERVIEW_SUMMARY_KEY_PREFIX } from '@/lib/hooks/useOverviewSummary';
import { settingsHref } from '@/lib/nav/links';

export const ORDERS_SYNC_URL = '/api/orders/sync';

/** Why a refresh failed. `limit` = 402 (the interceptor's dialog is already up). */
export type SyncOrdersFailure = 'limit' | 'tooSoon' | 'nothingToSync' | 'unauthorized' | 'failed';

export type SyncOrdersResult = { ok: true } | { ok: false; reason: SyncOrdersFailure; status: number | null };

/** Pure: HTTP status (null = network error) → failure reason. */
export function classifySyncFailure(status: number | null): SyncOrdersFailure {
  if (status === 402) return 'limit';
  // Kept deliberately though /api/orders/sync never answers 429 today (cheap guard if a cooldown is added).
  if (status === 429) return 'tooSoon';
  // 400 = none of Veeqo/Shippo/Trendyol/Wix/Shopify connected. A direct Etsy/eBay/Amazon seller can get it with
  // stores connected, so the copy is neutral ("nothing to refresh"), never "no stores connected".
  if (status === 400) return 'nothingToSync';
  if (status === 401) return 'unauthorized';
  return 'failed';
}

/** Pure: the `overview.*` toast key for a failure, or null when nothing is shown (402: the dialog already is). */
export function syncFailureToastKey(
  reason: SyncOrdersFailure,
): 'toast.refreshFailed' | 'toast.refreshTooSoon' | 'toast.refreshNothingToSync' | null {
  switch (reason) {
    case 'limit':
      return null;
    case 'tooSoon':
      return 'toast.refreshTooSoon';
    case 'nothingToSync':
      return 'toast.refreshNothingToSync';
    default:
      return 'toast.refreshFailed';
  }
}

/** Pure: SWR keys a finished refresh revalidates (orders lists/details, nav counts, Overview summary). */
export function isOrdersCacheKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  return key.startsWith('/api/orders') || key === NAV_COUNTS_KEY || key.startsWith(OVERVIEW_SUMMARY_KEY_PREFIX);
}

/** The request itself (no React). 402 → `limit` (fetchWithLimit throws UsageLimitError). */
export async function postOrdersSync(): Promise<SyncOrdersResult> {
  try {
    const res = await fetchWithLimit(ORDERS_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ syncType: 'fast' }),
    });
    if (!res.ok) return { ok: false, reason: classifySyncFailure(res.status), status: res.status };
    return { ok: true };
  } catch (e) {
    if (isUsageLimitError(e)) return { ok: false, reason: 'limit', status: 402 };
    return { ok: false, reason: 'failed', status: null };
  }
}

// ── shared state ────────────────────────────────────────────────────────────────────────────────────────

interface SyncOrdersState {
  syncing: boolean;
  /** Client time (ms) the last refresh finished OK in this tab. */
  lastSucceededAt: number | null;
  lastResult: SyncOrdersResult | null;
}

const useSyncOrdersStore = create<SyncOrdersState>(() => ({ syncing: false, lastSucceededAt: null, lastResult: null }));

let inFlight: Promise<SyncOrdersResult> | null = null;

/**
 * Runs one refresh app-wide (dedupes concurrent calls) and revalidates the caches on success. No toasts and no
 * navigation: that is the hook's job. Exported for non-React callers and tests.
 */
export function runOrdersSync(): Promise<SyncOrdersResult> {
  if (inFlight) return inFlight;
  useSyncOrdersStore.setState({ syncing: true });
  inFlight = (async () => {
    try {
      const result = await postOrdersSync();
      if (result.ok) {
        useSyncOrdersStore.setState({ lastSucceededAt: Date.now() });
        await globalMutate(isOrdersCacheKey);
      }
      useSyncOrdersStore.setState({ lastResult: result });
      return result;
    } finally {
      inFlight = null;
      useSyncOrdersStore.setState({ syncing: false });
    }
  })();
  return inFlight;
}

/** Test helper. */
export function __resetSyncOrdersForTests(): void {
  inFlight = null;
  useSyncOrdersStore.setState({ syncing: false, lastSucceededAt: null, lastResult: null });
}

// ── hook ────────────────────────────────────────────────────────────────────────────────────────────────

export interface UseSyncOrdersOptions {
  /** Navigate here after a successful refresh (skipped when already on that path). Default null: stay. */
  redirectTo?: string | null;
  /** Show the success / failure toasts (default true). */
  toasts?: boolean;
}

export interface UseSyncOrdersResult {
  /** Starts a refresh (or joins the running one). Resolves with the outcome; never throws. */
  sync: () => Promise<SyncOrdersResult>;
  /** True while any caller's refresh runs (shared app-wide). */
  syncing: boolean;
  lastSucceededAt: number | null;
  lastResult: SyncOrdersResult | null;
}

function pathOf(href: string): string {
  const i = href.search(/[?#]/);
  return i === -1 ? href : href.slice(0, i);
}

export function useSyncOrders(options: UseSyncOrdersOptions = {}): UseSyncOrdersResult {
  const { redirectTo = null, toasts = true } = options;
  const router = useRouter();
  const t = useTranslations('overview');
  const toast = useToast();
  const syncing = useSyncOrdersStore((s) => s.syncing);
  const lastSucceededAt = useSyncOrdersStore((s) => s.lastSucceededAt);
  const lastResult = useSyncOrdersStore((s) => s.lastResult);

  const sync = useCallback(async (): Promise<SyncOrdersResult> => {
    const joined = inFlight !== null;
    const result = await runOrdersSync();
    // A caller that joined a running refresh leaves the toasts to the one that started it.
    if (joined) return result;
    if (result.ok) {
      if (toasts) toast.success(t('toast.refreshed'));
      if (redirectTo && router && pathOf(router.asPath ?? router.pathname ?? '') !== pathOf(redirectTo)) {
        void router.push(redirectTo);
      }
      return result;
    }
    const key = syncFailureToastKey(result.reason);
    if (toasts && key) {
      if (result.reason === 'nothingToSync') {
        toast.error(t(key), {
          persist: false,
          action: { label: t('toast.openConnections'), onClick: () => void router?.push(settingsHref('connections')) },
        });
      } else if (result.reason === 'tooSoon') {
        toast.error(t(key), { persist: false });
      } else {
        toast.error(t(key), { action: { onClick: () => void sync() } });
      }
    }
    return result;
  }, [redirectTo, router, t, toast, toasts]);

  return { sync, syncing, lastSucceededAt, lastResult };
}

export default useSyncOrders;
