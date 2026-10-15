import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPortalFlowData,
  formatInvoice,
  hasUpcomingPayment,
  parseInvoiceCursor,
  parseInvoiceLimit,
  parsePortalFlow,
  pickCurrentSubscription,
  planFromPriceId,
  priceIdOfLine,
  toMajor,
  toPaymentMethodDto,
} from '@/lib/billing/stripeAccountServer';

const ENV_KEYS = ['PRICE_STARTER_MONTH', 'PRICE_GROWTH_YEAR', 'PRICE_PRO_MONTH', 'PRICE_GROWTH_MONTH_LEGACY', 'PRICE_PRO_YEAR_USD'];
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

describe('planFromPriceId', () => {
  it('maps current, legacy and per-currency env ids', () => {
    process.env.PRICE_STARTER_MONTH = 'price_s_m';
    process.env.PRICE_GROWTH_YEAR = 'price_g_y';
    process.env.PRICE_PRO_MONTH = 'price_p_m';
    process.env.PRICE_GROWTH_MONTH_LEGACY = 'price_g_m_old';
    process.env.PRICE_PRO_YEAR_USD = 'price_p_y_usd';
    expect(planFromPriceId('price_s_m')).toEqual({ plan: 'starter', interval: 'month' });
    expect(planFromPriceId('price_g_y')).toEqual({ plan: 'growth', interval: 'year' });
    expect(planFromPriceId('price_p_m')).toEqual({ plan: 'pro', interval: 'month' });
    expect(planFromPriceId('price_g_m_old')).toEqual({ plan: 'growth', interval: 'month' });
    expect(planFromPriceId('price_p_y_usd')).toEqual({ plan: 'pro', interval: 'year' });
  });
  it('unknown / empty → null', () => {
    expect(planFromPriceId('price_x')).toBeNull();
    expect(planFromPriceId(null)).toBeNull();
    expect(planFromPriceId('')).toBeNull();
  });
});

describe('priceIdOfLine', () => {
  it('reads basil pricing first, then legacy price/plan', () => {
    expect(priceIdOfLine({ pricing: { price_details: { price: 'price_a', product: 'p' } } } as any)).toBe('price_a');
    expect(priceIdOfLine({ pricing: null, price: { id: 'price_b' } } as any)).toBe('price_b');
    expect(priceIdOfLine({ pricing: null, plan: { id: 'price_c' } } as any)).toBe('price_c');
    expect(priceIdOfLine(undefined)).toBeNull();
  });
});

describe('toMajor', () => {
  it('cents-exact for 2-decimal currencies, identity for zero-decimal', () => {
    expect(toMajor(499900, 'try')).toBe(4999);
    expect(toMajor(5940, 'usd')).toBe(59.4);
    expect(toMajor(1000, 'JPY')).toBe(1000);
    expect(toMajor(null, 'usd')).toBe(0);
  });
});

describe('invoice query parsing', () => {
  it('limit clamps to 5..100, default 20', () => {
    expect(parseInvoiceLimit(undefined)).toBe(20);
    expect(parseInvoiceLimit('abc')).toBe(20);
    expect(parseInvoiceLimit('-3')).toBe(20);
    expect(parseInvoiceLimit('1')).toBe(5);
    expect(parseInvoiceLimit('50')).toBe(50);
    expect(parseInvoiceLimit('500')).toBe(100);
    expect(parseInvoiceLimit(['7', '9'])).toBe(7);
  });
  it('cursor must be an invoice id', () => {
    expect(parseInvoiceCursor(undefined)).toBeUndefined();
    expect(parseInvoiceCursor('')).toBeUndefined();
    expect(parseInvoiceCursor('in_1AbC')).toBe('in_1AbC');
    expect(parseInvoiceCursor('cus_123')).toBe(false);
    expect(parseInvoiceCursor('in_1;drop')).toBe(false);
  });
});

describe('formatInvoice', () => {
  const base = {
    id: 'in_1', number: 'KX-0001', created: 1_760_000_000, currency: 'try', amount_paid: 499900, amount_due: 499900,
    hosted_invoice_url: 'https://h', invoice_pdf: 'https://p',
    lines: { data: [{ description: '1 × Growth', period: { start: 1_760_000_000, end: 1_762_600_000 }, pricing: { price_details: { price: 'price_g_m', product: 'prod' } } }] },
  };
  it('paid invoice: amount_paid, plan from price, ISO dates, upper currency', () => {
    process.env.PRICE_GROWTH_MONTH_LEGACY = 'price_g_m';
    const row = formatInvoice({ ...base, status: 'paid' } as any);
    expect(row).toMatchObject({
      id: 'in_1', number: 'KX-0001', amount: 4999, currency: 'TRY', status: 'paid', plan: 'growth', interval: 'month',
      date: new Date(1_760_000_000_000).toISOString(), hostedInvoiceUrl: 'https://h', invoicePdf: 'https://p',
    });
    expect(row.period.start).toBe(new Date(1_760_000_000_000).toISOString());
  });
  it('open invoice uses amount_due; unknown price → plan null', () => {
    const row = formatInvoice({ ...base, status: 'open', amount_paid: 0, amount_due: 9900, currency: 'usd' } as any);
    expect(row.amount).toBe(99);
    expect(row.plan).toBeNull();
    expect(row.interval).toBeNull();
  });
});

describe('parsePortalFlow', () => {
  it('accepts the three flows, empty → null, junk → false', () => {
    expect(parsePortalFlow(undefined)).toBeNull();
    expect(parsePortalFlow('')).toBeNull();
    expect(parsePortalFlow({})).toBeNull();
    expect(parsePortalFlow({ flow: null })).toBeNull();
    expect(parsePortalFlow({ flow: 'payment_method_update' })).toBe('payment_method_update');
    expect(parsePortalFlow('{"flow":"subscription_cancel"}')).toBe('subscription_cancel');
    expect(parsePortalFlow({ flow: 'subscription_update' })).toBe('subscription_update');
    expect(parsePortalFlow({ flow: 'subscription_update_confirm' })).toBe(false);
    expect(parsePortalFlow('{bad')).toBe(false);
    expect(parsePortalFlow([1])).toBe(false);
  });
});

describe('buildPortalFlowData', () => {
  const ret = 'https://kolayxport.com/ayarlar?tab=billing';
  const sub = { id: 'sub_1', cancel_at_period_end: false, status: 'active' } as any;
  it('payment method update needs no subscription', () => {
    expect(buildPortalFlowData('payment_method_update', null, ret)).toEqual({
      type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: ret } },
    });
  });
  it('subscription flows carry the subscription id', () => {
    expect(buildPortalFlowData('subscription_update', sub, ret)).toMatchObject({ type: 'subscription_update', subscription_update: { subscription: 'sub_1' } });
    expect(buildPortalFlowData('subscription_cancel', sub, ret)).toMatchObject({ type: 'subscription_cancel', subscription_cancel: { subscription: 'sub_1' } });
  });
  it('no subscription, or already canceling → null (portal home)', () => {
    expect(buildPortalFlowData('subscription_update', null, ret)).toBeNull();
    expect(buildPortalFlowData('subscription_cancel', { ...sub, cancel_at_period_end: true }, ret)).toBeNull();
  });
});

describe('pickCurrentSubscription', () => {
  it('prefers active/trialing, then past_due; ignores canceled; newest wins ties', () => {
    const subs = [
      { id: 'a', status: 'canceled', created: 9 },
      { id: 'b', status: 'past_due', created: 5 },
      { id: 'c', status: 'active', created: 1 },
      { id: 'd', status: 'trialing', created: 3 },
    ] as any[];
    expect(pickCurrentSubscription(subs)?.id).toBe('d');
    expect(pickCurrentSubscription(subs.slice(0, 2))?.id).toBe('b');
    expect(pickCurrentSubscription([{ id: 'x', status: 'incomplete_expired', created: 1 } as any])).toBeNull();
  });
});

describe('payment method + upcoming helpers', () => {
  it('card → dto; non-card / string → null', () => {
    expect(toPaymentMethodDto({ type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2028 } } as any)).toEqual({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2028 });
    expect(toPaymentMethodDto({ type: 'sepa_debit', card: null } as any)).toBeNull();
    expect(toPaymentMethodDto('pm_1')).toBeNull();
    expect(toPaymentMethodDto(null)).toBeNull();
  });
  it('upcoming only for active/trialing/past_due not canceling', () => {
    expect(hasUpcomingPayment({ status: 'active', cancel_at_period_end: false } as any)).toBe(true);
    expect(hasUpcomingPayment({ status: 'trialing', cancel_at_period_end: false } as any)).toBe(true);
    expect(hasUpcomingPayment({ status: 'past_due', cancel_at_period_end: false } as any)).toBe(true);
    expect(hasUpcomingPayment({ status: 'active', cancel_at_period_end: true } as any)).toBe(false);
    expect(hasUpcomingPayment({ status: 'unpaid', cancel_at_period_end: false } as any)).toBe(false);
    expect(hasUpcomingPayment(null)).toBe(false);
  });
});
