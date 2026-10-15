/**
 * useStockManaged(listingId, shopId?) — which variants of an Etsy listing are
 * managed by stock sync, and their canonical quantity (W2).
 *
 * For the Etsy listing / variation editors (integration note in
 * docs/integration/parts/W2-stock-sync.md). Returns managed=false while
 * loading, on error, or when stock sync is off — the editor then behaves
 * exactly as today. Revalidates on live stock events.
 */
import useSWR from 'swr';
import { useMemo } from 'react';
import { swrStockFetcher } from './stockClient';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import { ETSY_MANAGED_MAX_IDS, normalizeListingIds } from '@/lib/stock/managedIds';

export type StockManagedVariant = { variantKey: string; canonical: number; stockItemId: string; sku: string };
export type StockManagedResponse = { managed: boolean; live: boolean; variants: StockManagedVariant[] };

export function useStockManaged(listingId: string | number | bigint | null | undefined, shopId?: string | number | null) {
  const key = listingId
    ? `/api/stock/etsy-managed?listingId=${encodeURIComponent(String(listingId))}${shopId ? `&shopId=${encodeURIComponent(String(shopId))}` : ''}`
    : null;
  const { data, mutate } = useSWR<StockManagedResponse>(key, swrStockFetcher, { revalidateOnFocus: false, shouldRetryOnError: false });
  useLiveRevalidate(['stock.changed'], key ? () => mutate() : null);
  const byVariant = useMemo(() => {
    const m = new Map<string, StockManagedVariant>();
    for (const v of data?.variants || []) m.set(v.variantKey, v);
    return m;
  }, [data]);
  return {
    managed: !!data?.managed,
    live: !!data?.live,
    variants: data?.variants || [],
    /** variantKey (lib/etsy/variantKey etsyVariantKeys) -> managed info; '*' = whole listing, '' = single product */
    get: (variantKey: string): StockManagedVariant | undefined => byVariant.get(variantKey) ?? byVariant.get('*') ?? (byVariant.size === 1 ? byVariant.get('') : undefined),
  };
}

export type StockManagedManyResponse = { live: boolean; listings: Record<string, StockManagedResponse> };

/**
 * useStockManagedMany(listingIds, shopId?) — batch form for grids (BR-11): ONE request to
 * GET /api/stock/etsy-managed?ids=… for all rows. The SWR key is built from the deduped, numerically
 * sorted ids, so a new array with the same ids (every parent render) never refetches. At most
 * ETSY_MANAGED_MAX_IDS (500) ids are sent; the rest read as unmanaged. Revalidates on live stock events.
 */
export function useStockManagedMany(listingIds: ReadonlyArray<string | number | bigint | null | undefined>, shopId?: string | number | null) {
  const idsKey = normalizeListingIds(listingIds).slice(0, ETSY_MANAGED_MAX_IDS).join(',');
  const key = idsKey
    ? `/api/stock/etsy-managed?ids=${idsKey}${shopId ? `&shopId=${encodeURIComponent(String(shopId))}` : ''}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<StockManagedManyResponse>(key, swrStockFetcher, { revalidateOnFocus: false, shouldRetryOnError: false });
  useLiveRevalidate(['stock.changed'], key ? () => mutate() : null);
  const byListing = useMemo(() => {
    const m = new Map<string, StockManagedResponse>();
    for (const [id, info] of Object.entries(data?.listings || {})) m.set(id, info);
    return m;
  }, [data]);
  return {
    /** listingId -> managed info (only listings the server answered for). */
    byListing,
    live: !!data?.live,
    isLoading: !!key && isLoading,
    error,
    /** Managed info for one listing; unmanaged while loading, on error, or when unknown. */
    get: (listingId: string | number | bigint): StockManagedResponse => {
      const id = normalizeListingIds([listingId])[0];
      return (id && byListing.get(id)) || { managed: false, live: false, variants: [] };
    },
  };
}
