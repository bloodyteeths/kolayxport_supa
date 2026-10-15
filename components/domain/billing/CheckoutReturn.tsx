// components/domain/billing/CheckoutReturn.tsx — settings §9.5 `?checkout=success` (Stripe Checkout
// `success_url`). Strips the param, revalidates the entitlement and, until the webhook has moved the
// account to a paid plan, shows "Confirming your payment with Stripe…" polling every 3s for up to 30s.
// Success → toast "You're on Growth now." Timeout → "Payment received. Your plan will update within a few
// minutes." + [Refresh]. Never a failure message: Stripe already accepted the payment.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Banner, useToast } from '@/components/ds/feedback';
import { isPaidPlan, type Entitlement } from '@/lib/billing/types';

export const CHECKOUT_POLL_MS = 3_000;
export const CHECKOUT_TIMEOUT_MS = 30_000;

export type CheckoutPhase = 'idle' | 'confirming' | 'timeout' | 'done';

/** Pure: the webhook has landed when the account is on an active paid plan. */
export function checkoutConfirmed(e: Entitlement | null | undefined): boolean {
  return !!e && e.state === 'active' && isPaidPlan(e.plan);
}

/** Query without `checkout` (other params such as `tab` are kept). */
export function stripCheckoutParam(query: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(query)) if (k !== 'checkout' && v !== undefined) out[k] = v;
  return out;
}

export function useCheckoutReturn(entitlement: Entitlement | undefined, mutate: () => Promise<unknown>): { phase: CheckoutPhase; notice: ReactNode } {
  const router = useRouter();
  const t = useTranslations('billing');
  const toast = useToast();
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
  const startedAt = useRef<number>(0);
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  // 1. Detect and strip the param once.
  useEffect(() => {
    if (!router.isReady || router.query.checkout !== 'success') return;
    startedAt.current = Date.now();
    setPhase('confirming');
    void router.replace({ pathname: router.pathname, query: stripCheckoutParam(router.query) }, undefined, { shallow: true });
    void mutateRef.current();
  }, [router, router.isReady, router.query.checkout]);

  // 2. Confirmed → toast once.
  useEffect(() => {
    if ((phase === 'confirming' || phase === 'timeout') && checkoutConfirmed(entitlement)) {
      setPhase('done');
      toast.success(t('toast.planChanged', { plan: t(`planName.${entitlement!.plan}`) }));
    }
  }, [phase, entitlement, t, toast]);

  // 3. Poll while confirming; time out after 30s.
  useEffect(() => {
    if (phase !== 'confirming') return undefined;
    const id = setInterval(() => {
      if (Date.now() - startedAt.current >= CHECKOUT_TIMEOUT_MS) {
        setPhase('timeout');
        return;
      }
      void mutateRef.current();
    }, CHECKOUT_POLL_MS);
    return () => clearInterval(id);
  }, [phase]);

  let notice: ReactNode = null;
  if (phase === 'confirming') notice = <Banner tone="info" title={t('banner.confirming')} data-testid="checkout-confirming" />;
  if (phase === 'timeout') {
    notice = (
      <Banner
        tone="info"
        title={t('banner.confirmTimeout')}
        action={{ id: 'checkout-refresh', label: t('action.refresh'), onClick: () => { void mutateRef.current(); } }}
        data-testid="checkout-timeout"
      />
    );
  }
  return { phase, notice };
}
