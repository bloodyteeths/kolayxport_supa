// components/domain/pricing/useCheckout.ts — "Choose {Plan}" on the pricing page (settings §10.4).
// POST /api/stripe/create-checkout-session `{ plan, interval, currency, expectFounding }` (tiers.md §2 body +
// settings A4 `expectFounding`) → `window.location.assign(url)` (hosted Checkout only; no Stripe.js).
//   401 → login, back to this page with plan/interval/currency (unchanged flow, gains `currency`)
//   403 → toast "This account can't buy a plan here." (no Shopify wording: also enterprise/admin)
//   409 `{ reason: 'founding_full' }` → the founding Modal; Continue re-posts with `expectFounding: false`
//   anything else → toast "Couldn't open checkout. Try again." + Retry. Never raw server text.
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ds/feedback';
import type { Currency, Interval, PaidPlanKey } from '@/lib/billing/types';
import { track } from '@/lib/tracking/events';

export const CHECKOUT_ENDPOINT = '/api/stripe/create-checkout-session';

export interface CheckoutRequest {
  plan: PaidPlanKey;
  interval: Interval;
  currency: Currency;
  /** The page showed a founding price; the server answers 409 instead of silently charging full price. */
  expectFounding: boolean;
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'unauthorized' | 'forbidden' | 'foundingFull' | 'failed' };

/** The request (fetch injected in tests). Currency goes over the wire lower-case (`PLANS` price keys). */
export async function requestCheckout(req: CheckoutRequest, fetchImpl: typeof fetch = fetch): Promise<CheckoutResult> {
  track('begin_checkout', { plan: req.plan, interval: req.interval, currency: req.currency });
  try {
    const res = await fetchImpl(CHECKOUT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: req.plan, interval: req.interval, currency: req.currency.toLowerCase(), expectFounding: req.expectFounding }),
    });
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    if (res.status === 403) return { ok: false, reason: 'forbidden' };
    const body = (await res.json().catch(() => null)) as { url?: unknown; reason?: unknown } | null;
    if (res.status === 409 && body?.reason === 'founding_full') return { ok: false, reason: 'foundingFull' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    return typeof body?.url === 'string' && body.url.startsWith('https://') ? { ok: true, url: body.url } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Where a 401 sends the visitor: login, then back here with the same choice. */
export function loginBackHref(req: Pick<CheckoutRequest, 'plan' | 'interval' | 'currency'>): string {
  const back = `/fiyatlandirma?${new URLSearchParams({ plan: req.plan, interval: req.interval, currency: req.currency.toLowerCase() }).toString()}`;
  return `/login?callbackUrl=${encodeURIComponent(back)}`;
}

export interface UseCheckout {
  start: (req: CheckoutRequest) => Promise<void>;
  /** Plan whose checkout is opening (its button shows "Opening checkout…"; the others are disabled). */
  pending: PaidPlanKey | null;
  /** Set after a 409 `founding_full`: the request to continue at full price. */
  foundingFull: CheckoutRequest | null;
  dismissFoundingFull: () => void;
}

export function useCheckout(options: { onFoundingFull?: () => void } = {}): UseCheckout {
  const t = useTranslations('marketing.pricingV2');
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState<PaidPlanKey | null>(null);
  const [foundingFull, setFoundingFull] = useState<CheckoutRequest | null>(null);
  const busy = useRef(false);
  const onFull = useRef(options.onFoundingFull);
  onFull.current = options.onFoundingFull;

  const start = useCallback(
    async (req: CheckoutRequest) => {
      if (busy.current) return; // double taps while a session is being created
      busy.current = true;
      setPending(req.plan);
      setFoundingFull(null);
      const result = await requestCheckout(req);
      if (result.ok) {
        window.location.assign(result.url);
        return; // keep the loading state while the browser leaves
      }
      busy.current = false;
      setPending(null);
      if (result.reason === 'unauthorized') {
        void router.push(loginBackHref(req));
      } else if (result.reason === 'forbidden') {
        toast.error(t('checkout.forbidden'), { persist: false });
      } else if (result.reason === 'foundingFull') {
        setFoundingFull({ ...req, expectFounding: false });
        onFull.current?.();
      } else {
        toast.error(t('checkout.failed'), { action: { onClick: () => { void start(req); } } });
      }
    },
    [router, t, toast],
  );

  return { start, pending, foundingFull, dismissFoundingFull: useCallback(() => setFoundingFull(null), []) };
}
