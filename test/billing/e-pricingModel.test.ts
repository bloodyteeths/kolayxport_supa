// Settings Group E — pure pricing-page model, founding-spots normalizer, checkout request (settings §0.2,
// §10.2, §10.4, A4). Prices are asserted against the §0.2 tables, never recomputed here.
import { describe, expect, it, vi } from 'vitest';
import {
  COMPARE_ROWS, PRICING_PLANS, cardPrice, pricingGate, defaultCurrency, fromPrice, hasFeature, limitFor, reviewerFacts,
} from '@/components/domain/pricing/pricingModel';
import { loginBackHref, requestCheckout, CHECKOUT_ENDPOINT } from '@/components/domain/pricing/useCheckout';
import { foundingOpen, normalizeFoundingSpots } from '@/lib/billing/useFoundingSpots';
import type { Entitlement } from '@/lib/billing/types';

describe('cardPrice (§0.2 tables)', () => {
  it('list prices, no founding', () => {
    expect(cardPrice('starter', 'month', 'TRY', null)).toEqual({ amount: 2499, struck: null, perMonth: null, founding: false });
    expect(cardPrice('growth', 'month', 'USD', null)).toEqual({ amount: 99, struck: null, perMonth: null, founding: false });
    expect(cardPrice('pro', 'year', 'TRY', null)).toEqual({ amount: 79990, struck: null, perMonth: 6665.83, founding: false });
  });

  it('founding monthly: 40% off, struck list price', () => {
    const rows: [Parameters<typeof cardPrice>[0], 'TRY' | 'USD', number, number][] = [
      ['starter', 'TRY', 1499.4, 2499], ['growth', 'TRY', 2999.4, 4999], ['pro', 'TRY', 4799.4, 7999],
      ['starter', 'USD', 35.4, 59], ['growth', 'USD', 59.4, 99], ['pro', 'USD', 89.4, 149],
    ];
    for (const [plan, cur, amount, struck] of rows) {
      expect(cardPrice(plan, 'month', cur, 40)).toEqual({ amount, struck, perMonth: null, founding: true });
    }
  });

  it('founding yearly + per-month equivalent', () => {
    expect(cardPrice('starter', 'year', 'TRY', 40)).toEqual({ amount: 14994, struck: 24990, perMonth: 1249.5, founding: true });
    expect(cardPrice('growth', 'year', 'TRY', 40)).toEqual({ amount: 29994, struck: 49990, perMonth: 2499.5, founding: true });
    expect(cardPrice('pro', 'year', 'USD', 40)).toEqual({ amount: 894, struck: 1490, perMonth: 74.5, founding: true });
  });

  it('yearly per-month equivalents without founding (§0.2 third table)', () => {
    expect(cardPrice('starter', 'year', 'TRY', null)?.perMonth).toBe(2082.5);
    expect(cardPrice('growth', 'year', 'TRY', null)?.perMonth).toBe(4165.83);
    expect(cardPrice('starter', 'year', 'USD', null)?.perMonth).toBe(49.17);
    expect(cardPrice('growth', 'year', 'USD', null)?.perMonth).toBe(82.5);
    expect(cardPrice('pro', 'year', 'USD', null)?.perMonth).toBe(124.17);
  });

  it('enterprise has no price', () => {
    expect(cardPrice('enterprise', 'month', 'TRY', 40)).toBeNull();
  });
});

describe('limits and comparison', () => {
  it('limits come from the decided plan table', () => {
    expect(PRICING_PLANS.map((p) => limitFor(p, 'orders'))).toEqual([500, 2000, 6000, null]);
    expect(PRICING_PLANS.map((p) => limitFor(p, 'labels'))).toEqual([250, 1000, 3000, null]);
    expect(PRICING_PLANS.map((p) => limitFor(p, 'connectedStores'))).toEqual([2, 5, 10, null]);
    expect(PRICING_PLANS.map((p) => limitFor(p, 'aiCredits'))).toEqual([300, 1500, 5000, null]);
  });

  it('Pro features only on Pro and Enterprise; support row', () => {
    for (const f of ['arbitrage', 'financials', 'bulkPhotoStudio'] as const) {
      expect(PRICING_PLANS.map((p) => hasFeature(p, f))).toEqual([false, false, true, true]);
    }
    const support = COMPARE_ROWS.find((r) => r.id === 'support')!;
    expect(PRICING_PLANS.map((p) => support.cell(p))).toEqual([
      { kind: 'text', key: 'compare.supportEmail' },
      { kind: 'text', key: 'compare.supportEmail' },
      { kind: 'text', key: 'compare.supportPriority' },
      { kind: 'text', key: 'compare.supportDedicated' },
    ]);
  });

  it('no removed claims (users per plan, API access)', () => {
    const ids = COMPARE_ROWS.map((r) => r.id).join(',');
    expect(ids).not.toMatch(/user|api/i);
  });

  it('reviewer facts: list prices in both currencies, both intervals', () => {
    expect(reviewerFacts()).toEqual([
      { plan: 'starter', monthTry: 2499, yearTry: 24990, monthUsd: 59, yearUsd: 590, orders: 500, labels: 250, stores: 2, ai: 300 },
      { plan: 'growth', monthTry: 4999, yearTry: 49990, monthUsd: 99, yearUsd: 990, orders: 2000, labels: 1000, stores: 5, ai: 1500 },
      { plan: 'pro', monthTry: 7999, yearTry: 79990, monthUsd: 149, yearUsd: 1490, orders: 6000, labels: 3000, stores: 10, ai: 5000 },
    ]);
  });

  it('fromPrice and defaultCurrency', () => {
    expect(fromPrice('TRY')).toBe(2499);
    expect(fromPrice('USD')).toBe(59);
    expect(defaultCurrency('tr')).toBe('TRY');
    expect(defaultCurrency('en')).toBe('USD');
    expect(defaultCurrency(undefined)).toBe('TRY');
  });
});

describe('founding spots', () => {
  it('normalizes and only opens with spots left', () => {
    expect(normalizeFoundingSpots({ active: true, total: 20, remaining: 7, percentOff: 40 })).toEqual({ active: true, total: 20, remaining: 7, percentOff: 40 });
    expect(normalizeFoundingSpots({ active: true, total: 20, remaining: 25, percentOff: 40 })?.remaining).toBe(20);
    expect(normalizeFoundingSpots({ active: true, total: '20', remaining: 7, percentOff: 40 })).toBeNull();
    expect(normalizeFoundingSpots(null)).toBeNull();
    expect(normalizeFoundingSpots([])).toBeNull();
    expect(foundingOpen({ active: true, total: 20, remaining: 1, percentOff: 40 })).toBe(true);
    expect(foundingOpen({ active: true, total: 20, remaining: 0, percentOff: 40 })).toBe(false);
    expect(foundingOpen({ active: false, total: 20, remaining: 7, percentOff: 40 })).toBe(false);
    expect(foundingOpen(null)).toBe(false);
  });
});

describe('pricingGate (§10.5)', () => {
  const shopify = { plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false } as Entitlement;
  const trial = { plan: 'trial', state: 'trial', stripeUpsell: true } as Entitlement;
  it('never shows money before the viewer is known', () => {
    expect(pricingGate({ authLoading: true, signedIn: false, entitlement: null, entitlementError: false })).toBe('skeleton');
    expect(pricingGate({ authLoading: false, signedIn: false, entitlement: null, entitlementError: false })).toBe('show');
    expect(pricingGate({ authLoading: false, signedIn: true, entitlement: null, entitlementError: false })).toBe('skeleton');
    expect(pricingGate({ authLoading: false, signedIn: true, entitlement: shopify, entitlementError: false })).toBe('redirect');
    expect(pricingGate({ authLoading: false, signedIn: true, entitlement: trial, entitlementError: false })).toBe('show');
    // provider unknown: fails closed (may be shopify_free) — no prices, inline error with Reload
    expect(pricingGate({ authLoading: false, signedIn: true, entitlement: null, entitlementError: true })).toBe('error');
  });
});

describe('requestCheckout (§10.4, A4)', () => {
  const req = { plan: 'growth' as const, interval: 'year' as const, currency: 'TRY' as const, expectFounding: true };
  const res = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) }) as unknown as Response;

  it('posts the tiers-plan body with lower-case currency and expectFounding', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(res(200, { url: 'https://checkout.stripe.com/c/1' })));
    await expect(requestCheckout(req, fetchImpl as unknown as typeof fetch)).resolves.toEqual({ ok: true, url: 'https://checkout.stripe.com/c/1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CHECKOUT_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ plan: 'growth', interval: 'year', currency: 'try', expectFounding: true });
  });

  it('maps statuses; never surfaces server text', async () => {
    const run = (r: Response | Error) => requestCheckout(req, (() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r))) as unknown as typeof fetch);
    await expect(run(res(401))).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(run(res(403, { error: 'shopify' }))).resolves.toEqual({ ok: false, reason: 'forbidden' });
    await expect(run(res(409, { reason: 'founding_full' }))).resolves.toEqual({ ok: false, reason: 'foundingFull' });
    await expect(run(res(409, { error: 'no user' }))).resolves.toEqual({ ok: false, reason: 'failed' });
    await expect(run(res(500, { error: 'Stripe exploded' }))).resolves.toEqual({ ok: false, reason: 'failed' });
    await expect(run(res(200, { sessionId: 'cs_1' }))).resolves.toEqual({ ok: false, reason: 'failed' });
    await expect(run(res(200, { url: 'http://evil.example' }))).resolves.toEqual({ ok: false, reason: 'failed' });
    await expect(run(new Error('offline'))).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('login return keeps plan, interval and currency', () => {
    expect(loginBackHref(req)).toBe(`/login?callbackUrl=${encodeURIComponent('/fiyatlandirma?plan=growth&interval=year&currency=try')}`);
  });
});
