// lib/billing/useEntitlement.ts — settings §2.4: the one client read of the account's plan, state, usage
// and Pro features. SWR key `/api/billing/entitlement` (`revalidateOnFocus: true`, `dedupingInterval: 30s`).
//
// Fallback mode (until the billing backend ships the endpoint): when the entitlement request fails, the
// entitlement is derived from `GET /api/user/settings` (`subscription`, the SWR key the shell already
// loads) + the decided plan tables, with only the `orders` and `labels` meters, and
// `stripeUpsell = !(billingProvider === 'shopify_free' || plan === 'shopify_free')` (the server already
// folds "has an active ShopifyShop" into `billingProvider`). `fallback: true` tells the UI to label the
// order meter "Order imports" and show "Detailed usage will appear here soon." Remove the fallback once
// the endpoint is live.
//
// Both requests failed → `data` undefined, `state: 'error'`: the provider is unknown and no Stripe surface
// may render (settings §0.2 safe direction).
import useSWR from 'swr';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import type { BillingState, Currency, Entitlement, Feature, Interval, MeterKey, MeterUsage, PlanKey } from './types';
import { isPlayClient } from './playClient';
import { ENTITLEMENT_KEY, SETTINGS_KEY, HttpError, jsonFetcher, normalizeEntitlement, entitlementFromSettings, type SettingsSubscription } from './entitlementCore';

// The pure helpers live in ./entitlementCore (server-safe); re-exported so existing imports keep working.
export * from './entitlementCore';

// ── Hook ───────────────────────────────────────────────────────────────────────────────────────

export interface UseEntitlementResult {
  data?: Entitlement;
  state: AsyncState;
  /** true while `data` is derived from `/api/user/settings` (2 meters, no currency/founding). */
  fallback: boolean;
  /** Revalidates the entitlement (and the fallback source). */
  mutate: () => Promise<unknown>;
  /** Restarts the async timers and revalidates (ErrorState Retry). */
  retry: () => void;
  isLoading: boolean;
}

export interface UseEntitlementOptions {
  /** false = no request (anonymous visitor on the pricing page). Default true. */
  enabled?: boolean;
}

type SettingsBody = { subscription?: SettingsSubscription | null } | null;

export function useEntitlement(options: UseEntitlementOptions = {}): UseEntitlementResult {
  const enabled = options.enabled ?? true;
  const primary = useSWR<unknown>(enabled ? ENTITLEMENT_KEY : null, jsonFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
    // A missing endpoint (404) is the fallback signal, not a transient error.
    shouldRetryOnError: (err: unknown) => !(err instanceof HttpError && (err.status === 404 || err.status === 401 || err.status === 403)),
  });
  const live = primary.data !== undefined ? normalizeEntitlement(primary.data) : null;
  const needFallback = enabled && (primary.error !== undefined || (primary.data !== undefined && !live));

  const settings = useSWR<SettingsBody>(needFallback ? SETTINGS_KEY : null, jsonFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
  });
  const derived = needFallback && settings.data ? entitlementFromSettings(settings.data?.subscription ?? null) : null;
  const known = live ?? derived ?? undefined;
  // Google Play app: no Stripe surface anywhere (playClient.ts), whatever the account's provider.
  const data = known && isPlayClient() ? { ...known, stripeUpsell: false } : known;

  const waitingFallback = needFallback && settings.data === undefined && !settings.error;
  const combined = {
    data,
    error: !data && needFallback && (settings.error || (settings.data !== undefined && !derived)) ? (settings.error ?? new Error('no subscription')) : undefined,
    isLoading: enabled && !data && (primary.isLoading || waitingFallback || (needFallback && settings.isLoading)),
    isValidating: primary.isValidating || settings.isValidating,
    mutate: () => Promise.all([primary.mutate(), needFallback ? settings.mutate() : undefined]),
  };
  const region = useAsyncRegion(combined, { idle: 'empty' });

  return {
    data,
    state: region.state,
    fallback: !live && !!derived,
    mutate: combined.mutate,
    retry: region.retry,
    isLoading: !!combined.isLoading,
  };
}

export default useEntitlement;
