// components/domain/credits/useCredits.ts — the seller's AI kredisi balance (GET /api/ai/credits), in the
// currency of the UI language (TR → TRY, EN → USD). `refreshCredits()` re-reads it after a generation or a purchase.
import useSWR, { mutate } from 'swr';
import { useLocale } from 'next-intl';
import { jsonFetcher } from '@/lib/billing/entitlementCore';
import type { CreditBalance } from '@/lib/billing/aiCredits';
import type { Currency } from '@/lib/billing/types';

export const CREDITS_KEY_PREFIX = '/api/ai/credits?';

export function useCredits(enabled = true) {
  const currency: Currency = useLocale() === 'en' ? 'USD' : 'TRY';
  const swr = useSWR<CreditBalance>(enabled ? `${CREDITS_KEY_PREFIX}currency=${currency}` : null, (u: string) => jsonFetcher<CreditBalance>(u), {
    revalidateOnFocus: true,
    dedupingInterval: 5000,
  });
  return { balance: swr.data ?? null, loading: swr.isLoading, error: swr.error, currency, refresh: () => swr.mutate() };
}

export function refreshCredits() {
  return mutate((key) => typeof key === 'string' && key.startsWith(CREDITS_KEY_PREFIX));
}
