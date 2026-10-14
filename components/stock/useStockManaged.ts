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
