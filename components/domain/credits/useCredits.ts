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

/**
 * Whether AI buttons may show what they cost ("· 3 kredi"). Hidden for Shopify-connected accounts (App Store 1.2.1:
 * nothing they see shows prices or credit costs; `balance.neutral`, as the Video Studio does) and until the balance
 * is known, so a reviewer never sees a cost flash before it loads.
 */
export function useAiCostsVisible(): boolean {
  const { balance } = useCredits();
  return balance ? !balance.neutral : false;
}

export function refreshCredits() {
  return mutate((key) => typeof key === 'string' && key.startsWith(CREDITS_KEY_PREFIX));
}
