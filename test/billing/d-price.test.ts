// settings §0.2: list, founding and yearly-equivalent prices, both currencies (Group D price.ts).
import { describe, expect, it } from 'vitest';
import {
  cheapestPlanFor, currencyCode, effectivePrice, foundingPrice, listPrice, nextPlanFor, perMonthEquivalent, planLimit,
} from '@/lib/billing/price';

describe('price.ts — §0.2 tables', () => {
  it('list prices (monthly / yearly = 10 × monthly)', () => {
    expect(listPrice('starter', 'month', 'TRY')).toBe(2499);
    expect(listPrice('growth', 'month', 'try')).toBe(4999);
    expect(listPrice('pro', 'month', 'TRY')).toBe(7999);
    expect(listPrice('starter', 'year', 'TRY')).toBe(24990);
    expect(listPrice('growth', 'year', 'USD')).toBe(990);
    expect(listPrice('pro', 'year', 'usd')).toBe(1490);
    expect(listPrice('trial', 'month', 'TRY')).toBeNull();
    expect(listPrice('enterprise', 'month', 'TRY')).toBeNull();
    expect(listPrice('shopify_free', 'month', 'TRY')).toBeNull();
    expect(listPrice('growth', 'month', 'EUR')).toBeNull();
  });

  it.each([
    ['starter', 'month', 'TRY', 1499.4], ['growth', 'month', 'TRY', 2999.4], ['pro', 'month', 'TRY', 4799.4],
    ['starter', 'month', 'USD', 35.4], ['growth', 'month', 'USD', 59.4], ['pro', 'month', 'USD', 89.4],
    ['starter', 'year', 'TRY', 14994], ['growth', 'year', 'TRY', 29994], ['pro', 'year', 'TRY', 47994],
    ['starter', 'year', 'USD', 354], ['growth', 'year', 'USD', 594], ['pro', 'year', 'USD', 894],
  ] as const)('founding %s %s %s = %s', (plan, interval, currency, expected) => {
    expect(foundingPrice(plan, interval, currency)).toBe(expected);
  });

  it.each([
    ['starter', 'TRY', 2082.5], ['growth', 'TRY', 4165.83], ['pro', 'TRY', 6665.83],
    ['starter', 'USD', 49.17], ['growth', 'USD', 82.5], ['pro', 'USD', 124.17],
  ] as const)('yearly per-month equivalent %s %s = %s', (plan, currency, expected) => {
    expect(perMonthEquivalent(plan, 'year', currency)).toBe(expected);
  });

  it('founding yearly per-month (pricing §10.2 "₺1.249,50 a month")', () => {
    expect(perMonthEquivalent('starter', 'year', 'TRY', { founding: true })).toBe(1249.5);
    expect(perMonthEquivalent('growth', 'month', 'TRY')).toBe(4999);
  });

  it('effectivePrice: founding members pay the founding price and see the struck list price', () => {
    expect(effectivePrice('growth', 'month', 'TRY', true)).toEqual({ amount: 2999.4, list: 4999 });
    expect(effectivePrice('growth', 'month', 'TRY', false)).toEqual({ amount: 4999, list: null });
    expect(effectivePrice('enterprise', 'month', 'TRY', true)).toBeNull();
  });

  it('currencyCode', () => {
    expect(currencyCode('try')).toBe('TRY');
    expect(currencyCode('USD')).toBe('USD');
    expect(currencyCode(null)).toBeNull();
  });

  it('limits come from the decided tiers', () => {
    expect(planLimit('growth', 'labels')).toBe(1000);
    expect(planLimit('pro', 'connectedStores')).toBe(10);
    expect(planLimit('enterprise', 'orders')).toBeNull();
    expect(planLimit('nope', 'orders')).toBeUndefined();
  });

  it('cheapestPlanFor / nextPlanFor (near-limit upsell)', () => {
    expect(cheapestPlanFor('labels', 820)).toBe('growth');
    expect(cheapestPlanFor('labels', 2500)).toBe('pro');
    expect(cheapestPlanFor('orders', 7000)).toBe('enterprise');
    expect(cheapestPlanFor('labels', 820, 'growth')).toBe('pro');
    expect(nextPlanFor('labels', 'growth')).toBe('pro');
    expect(nextPlanFor('orders', 'starter')).toBe('growth');
    expect(nextPlanFor('orders', 'pro')).toBe('enterprise');
    // trial (150 orders): the cheapest plan above the trial limit
    expect(nextPlanFor('orders', 'trial')).toBe('starter');
  });
});
