import useSWR from 'swr';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import type { OrderLifecycleFlags } from '@/lib/orders/lifecycleFlags';

export type { OrderLifecycleFlags };

async function fetchFlags(key: string): Promise<Record<string, OrderLifecycleFlags>> {
  const ids = key.slice('lifecycle-flags:'.length);
  const res = await fetch('/api/orders/lifecycle-flags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids.split(',') }),
  });
  if (!res.ok) throw new Error(`lifecycle-flags ${res.status}`);
  const data = await res.json();
  return (data?.flags || {}) as Record<string, OrderLifecycleFlags>;
}

/**
 * Lifecycle flags for the visible orders. The SWR key is a stable, sorted,
 * joined id string (never the array itself), so parent re-renders do not
 * refetch. Live order/shipment events (W6) revalidate it automatically;
 * `mutate()` is also returned for manual refresh after an action.
 */
export function useOrderLifecycleFlags(orderIds: string[]) {
  const ids = Array.from(new Set((orderIds || []).filter(Boolean))).sort().slice(0, 200);
  const key = ids.length ? `lifecycle-flags:${ids.join(',')}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetchFlags, { revalidateOnFocus: true, dedupingInterval: 5000 });
  useLiveRevalidate(['order', 'shipment'], 'lifecycle-flags:', { throttleMs: 1500 });
  return { flags: data || {}, error, isLoading, mutate };
}

export default useOrderLifecycleFlags;
