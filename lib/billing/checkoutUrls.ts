// lib/billing/checkoutUrls.ts — Stripe Checkout return URLs (settings spec §9.5).
// success_url lands on Settings → Billing with `?checkout=success`, which BillingPanel's
// useCheckoutReturn picks up (polls the entitlement until the webhook moves the plan).

const FALLBACK_ORIGIN = 'http://localhost:3000';

function cleanOrigin(origin: string | undefined | null): string {
  const o = (origin || '').trim();
  return (o || FALLBACK_ORIGIN).replace(/\/+$/, '');
}

export function checkoutSuccessUrl(origin: string | undefined | null): string {
  return `${cleanOrigin(origin)}/ayarlar?tab=billing&checkout=success`;
}

export function checkoutCancelUrl(origin: string | undefined | null): string {
  return `${cleanOrigin(origin)}/fiyatlandirma`;
}
