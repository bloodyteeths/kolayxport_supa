/**
 * Store meter + Stripe-upsell gate for Connections (§4.5, §4.6, §11), read from Group D's
 * `useEntitlement()` (SWR `/api/billing/entitlement`, with its `/api/user/settings` fallback).
 *
 * - `stripeUpsell` stays `undefined` until the entitlement is known: no "Compare plans" link and the
 *   neutral store-limit copy (unknown provider is the safe direction, §0.2).
 * - The store meter is read only when the entitlement actually carries `meters.connectedStores`; the
 *   fallback mode has no store meter, so the "Stores · 4 of 5 used" line stays hidden there.
 */
import { useEntitlement } from '@/lib/billing/useEntitlement';
import type { StoreAllowance } from './connectionView';

export function useStoreAllowance(): StoreAllowance {
  const { data, fallback } = useEntitlement();
  if (!data) return { stripeUpsell: undefined };
  // Fallback mode carries only `orders` and `labels` (meters is Partial); never invent a store meter.
  const m = fallback ? undefined : data.meters.connectedStores;
  return {
    stripeUpsell: data.stripeUpsell,
    plan: data.plan,
    used: m?.used,
    limit: m ? m.limit : undefined,
    extraStores: data.modules?.extraStores ?? 0,
  };
}
