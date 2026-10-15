// components/domain/billing/useBillingSummary.ts — payment method + next payment (settings §2.3 A3,
// `GET /api/stripe/billing-summary`). Optional detail: any failure (incl. the endpoint not shipped yet)
// hides those rows silently (§9.8). Requested only for Stripe accounts with a subscription.
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/billing/useEntitlement';
import type { BillingSummary } from '@/lib/billing/types';

export const BILLING_SUMMARY_KEY = '/api/stripe/billing-summary';

/** Pure: validates the A3 body; null pieces when malformed. */
export function normalizeBillingSummary(raw: unknown): BillingSummary {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pm = r.paymentMethod && typeof r.paymentMethod === 'object' ? (r.paymentMethod as Record<string, unknown>) : null;
  const up = r.upcoming && typeof r.upcoming === 'object' ? (r.upcoming as Record<string, unknown>) : null;
  const paymentMethod =
    pm && typeof pm.brand === 'string' && typeof pm.last4 === 'string' && typeof pm.expMonth === 'number' && typeof pm.expYear === 'number'
      ? { brand: pm.brand, last4: pm.last4, expMonth: pm.expMonth, expYear: pm.expYear }
      : null;
  const upcoming =
    up && typeof up.amount === 'number' && Number.isFinite(up.amount) && typeof up.currency === 'string' && typeof up.date === 'string'
      ? { amount: up.amount, currency: up.currency.toUpperCase(), date: up.date }
      : null;
  return { paymentMethod, upcoming };
}

export function useBillingSummary(enabled: boolean): { data: BillingSummary | null; loading: boolean } {
  const { data, error, isLoading } = useSWR(enabled ? BILLING_SUMMARY_KEY : null, async (url: string) => normalizeBillingSummary(await jsonFetcher(url)), {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
    dedupingInterval: 30_000,
  });
  return { data: enabled && !error ? data ?? null : null, loading: enabled && isLoading };
}
