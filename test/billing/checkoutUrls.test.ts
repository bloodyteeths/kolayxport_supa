// Stripe Checkout return URLs must land on Settings → Billing with `?checkout=success` (settings §9.5),
// the only place useCheckoutReturn listens.
import { describe, expect, it } from 'vitest';
import { checkoutCancelUrl, checkoutSuccessUrl } from '@/lib/billing/checkoutUrls';
import { resolveSettingsTab, SETTINGS_PATH } from '@/components/domain/settings/settingsNav';
import { stripCheckoutParam } from '@/components/domain/billing/CheckoutReturn';

describe('checkoutSuccessUrl', () => {
  it('points at /ayarlar billing tab with checkout=success', () => {
    const u = new URL(checkoutSuccessUrl('https://kolayxport.com'));
    expect(u.origin).toBe('https://kolayxport.com');
    expect(u.pathname).toBe(SETTINGS_PATH);
    expect(u.searchParams.get('checkout')).toBe('success');
    expect(resolveSettingsTab(u.searchParams.get('tab') ?? undefined, true)).toBe('billing');
    expect(resolveSettingsTab(u.searchParams.get('tab') ?? undefined, false)).toBe('billing');
  });

  it('keeps the billing tab once the checkout param is stripped', () => {
    const u = new URL(checkoutSuccessUrl('https://kolayxport.com'));
    const query = Object.fromEntries(u.searchParams.entries());
    expect(stripCheckoutParam(query)).toEqual({ tab: 'billing' });
  });

  it('falls back to localhost and trims trailing slashes', () => {
    expect(checkoutSuccessUrl(undefined)).toBe('http://localhost:3000/ayarlar?tab=billing&checkout=success');
    expect(checkoutSuccessUrl('https://kolayxport.com/')).toBe('https://kolayxport.com/ayarlar?tab=billing&checkout=success');
  });
});

describe('checkoutCancelUrl', () => {
  it('returns to pricing', () => {
    expect(checkoutCancelUrl('https://kolayxport.com')).toBe('https://kolayxport.com/fiyatlandirma');
    expect(checkoutCancelUrl(null)).toBe('http://localhost:3000/fiyatlandirma');
  });
});
