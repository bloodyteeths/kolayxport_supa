import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './f-harness';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  userFind: vi.fn(),
  invoicesList: vi.fn(),
  invoicesPreview: vi.fn(),
  subsList: vi.fn(),
  portalCreate: vi.fn(),
  customersRetrieve: vi.fn(),
  pmRetrieve: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => m.auth(...a) }));
vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: (...a: any[]) => m.userFind(...a) } } }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    invoices: { list: (...a: any[]) => m.invoicesList(...a), createPreview: (...a: any[]) => m.invoicesPreview(...a) },
    subscriptions: { list: (...a: any[]) => m.subsList(...a) },
    billingPortal: { sessions: { create: (...a: any[]) => m.portalCreate(...a) } },
    customers: { retrieve: (...a: any[]) => m.customersRetrieve(...a) },
    paymentMethods: { retrieve: (...a: any[]) => m.pmRetrieve(...a) },
  },
}));

import historyHandler from '@/pages/api/stripe/billing-history';
import portalHandler from '@/pages/api/stripe/create-portal-session';
import summaryHandler from '@/pages/api/stripe/billing-summary';

const stripeUser = { stripeCustomerId: 'cus_1', billingProvider: 'stripe', subscriptionPlan: 'growth' };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.auth.mockResolvedValue({ id: 'u1' });
  m.userFind.mockResolvedValue(stripeUser);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.NEXTAUTH_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

const inv = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, number: `N-${id}`, created: 1_760_000_000, currency: 'usd', amount_paid: status === 'paid' ? 9900 : 0, amount_due: 9900,
  hosted_invoice_url: null, invoice_pdf: null, lines: { data: [] }, ...extra,
});

describe('GET /api/stripe/billing-history (A1)', () => {
  it('401 without a session; 405 on POST', async () => {
    m.auth.mockResolvedValueOnce(null);
    const r1 = makeRes(); await historyHandler(makeReq(), r1); expect(r1.state.status).toBe(401);
    const r2 = makeRes(); await historyHandler(makeReq({ method: 'POST' }), r2); expect(r2.state.status).toBe(405);
  });

  it('lists every status except draft, with hasMore and the default limit 20', async () => {
    m.invoicesList.mockResolvedValueOnce({ data: [inv('in_a', 'open'), inv('in_b', 'draft'), inv('in_c', 'paid'), inv('in_d', 'void'), inv('in_e', 'uncollectible')], has_more: false });
    const res = makeRes();
    await historyHandler(makeReq({ query: { limit: 'x' } }), res);
    expect(res.state.status).toBe(200);
    expect(m.invoicesList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 20 });
    expect(m.invoicesList.mock.calls[0][0]).not.toHaveProperty('status');
    expect(res.state.body.invoices.map((i: any) => i.id)).toEqual(['in_a', 'in_c', 'in_d', 'in_e']);
    expect(res.state.body.invoices[0]).toMatchObject({ status: 'open', amount: 99, currency: 'USD', number: 'N-in_a' });
    expect(res.state.body.hasMore).toBe(false);
    expect(res.state.headers['Cache-Control']).toBe('private, no-store');
  });

  it('passes limit + starting_after and tops up a page thinned by drafts', async () => {
    m.invoicesList
      .mockResolvedValueOnce({ data: [inv('in_1', 'paid'), inv('in_2', 'paid'), inv('in_3', 'paid'), inv('in_4', 'paid'), inv('in_5', 'draft')], has_more: true })
      .mockResolvedValueOnce({ data: [inv('in_6', 'open')], has_more: true });
    const res = makeRes();
    await historyHandler(makeReq({ query: { limit: '5', starting_after: 'in_0' } }), res);
    expect(m.invoicesList.mock.calls[0][0]).toEqual({ customer: 'cus_1', limit: 5, starting_after: 'in_0' });
    expect(m.invoicesList.mock.calls[1][0]).toEqual({ customer: 'cus_1', limit: 1, starting_after: 'in_5' });
    expect(res.state.body.invoices).toHaveLength(5);
    expect(res.state.body.hasMore).toBe(true);
    expect(res.state.body.nextCursor).toBe('in_6');
  });

  it('a draft-only run still returns a cursor to page past it', async () => {
    const drafts = (p: string) => ({ data: [inv(`in_${p}1`, 'draft'), inv(`in_${p}2`, 'draft')], has_more: true });
    m.invoicesList.mockResolvedValueOnce(drafts('a')).mockResolvedValueOnce(drafts('b')).mockResolvedValueOnce(drafts('c'));
    const res = makeRes();
    await historyHandler(makeReq({ query: { limit: '5' } }), res);
    expect(m.invoicesList).toHaveBeenCalledTimes(3);
    expect(res.state.body).toEqual({ invoices: [], hasMore: true, nextCursor: 'in_c2' });
  });

  it('legacy caller (no limit/cursor): paid only, up to 20, human error text', async () => {
    m.invoicesList.mockResolvedValueOnce({ data: [inv('in_p', 'paid')], has_more: false });
    const res = makeRes();
    await historyHandler(makeReq(), res);
    expect(m.invoicesList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 20, status: 'paid' });
    expect(res.state.body.invoices.map((i: any) => i.id)).toEqual(['in_p']);
    expect(res.state.body.invoices[0]).toHaveProperty('description');
    m.invoicesList.mockRejectedValueOnce(new Error('No such customer: cus_1 (secret detail)'));
    const r2 = makeRes();
    await historyHandler(makeReq(), r2);
    expect(r2.state.status).toBe(500);
    expect(r2.state.body).toEqual({ error: 'Failed to fetch billing history', code: 'billing_history_failed' });
  });

  it('400 on a malformed cursor (no Stripe call)', async () => {
    const res = makeRes();
    await historyHandler(makeReq({ query: { starting_after: 'cus_1' } }), res);
    expect(res.state.status).toBe(400);
    expect(res.state.body).toEqual({ error: 'invalid_cursor' });
    expect(m.invoicesList).not.toHaveBeenCalled();
  });

  it('no customer → empty list; shopify_free → 403', async () => {
    m.userFind.mockResolvedValueOnce({ ...stripeUser, stripeCustomerId: null });
    const r1 = makeRes(); await historyHandler(makeReq(), r1);
    expect(r1.state.body).toEqual({ invoices: [], hasMore: false, nextCursor: null });
    m.userFind.mockResolvedValueOnce({ ...stripeUser, billingProvider: 'shopify_free' });
    const r2 = makeRes(); await historyHandler(makeReq(), r2);
    expect(r2.state.status).toBe(403);
    m.userFind.mockResolvedValueOnce({ ...stripeUser, subscriptionPlan: 'shopify_free' });
    const r3 = makeRes(); await historyHandler(makeReq(), r3);
    expect(r3.state.status).toBe(403);
    expect(m.invoicesList).not.toHaveBeenCalled();
  });

  it('500 carries a code, never the Stripe message', async () => {
    m.invoicesList.mockRejectedValueOnce(new Error('No such customer: cus_1 (secret detail)'));
    const res = makeRes();
    await historyHandler(makeReq({ query: { limit: '20' } }), res);
    expect(res.state.status).toBe(500);
    expect(res.state.body).toEqual({ error: 'billing_history_failed' });
  });
});

describe('POST /api/stripe/create-portal-session (A2)', () => {
  const post = (body?: unknown) => makeReq({ method: 'POST', body, headers: { origin: 'https://kolayxport.com' } });

  it('no body → portal home with the billing return URL (legacy caller)', async () => {
    m.portalCreate.mockResolvedValueOnce({ url: 'https://portal/home' });
    const res = makeRes();
    await portalHandler(post(undefined), res);
    expect(m.portalCreate).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://kolayxport.com/ayarlar?tab=billing' });
    expect(res.state.body).toEqual({ url: 'https://portal/home', flow: null });
  });

  it('payment_method_update → flow_data without listing subscriptions', async () => {
    m.portalCreate.mockResolvedValueOnce({ url: 'https://portal/pm' });
    const res = makeRes();
    await portalHandler(post({ flow: 'payment_method_update' }), res);
    expect(m.subsList).not.toHaveBeenCalled();
    expect(m.portalCreate.mock.calls[0][0].flow_data).toMatchObject({ type: 'payment_method_update' });
    expect(res.state.body).toEqual({ url: 'https://portal/pm', flow: 'payment_method_update' });
  });

  it('subscription_cancel uses the current subscription', async () => {
    m.subsList.mockResolvedValueOnce({ data: [{ id: 'sub_old', status: 'canceled', created: 1 }, { id: 'sub_1', status: 'active', created: 2, cancel_at_period_end: false }] });
    m.portalCreate.mockResolvedValueOnce({ url: 'https://portal/cancel' });
    const res = makeRes();
    await portalHandler(post({ flow: 'subscription_cancel' }), res);
    expect(m.subsList).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 10 });
    expect(m.portalCreate.mock.calls[0][0].flow_data).toMatchObject({ type: 'subscription_cancel', subscription_cancel: { subscription: 'sub_1' } });
    expect(res.state.body.flow).toBe('subscription_cancel');
  });

  it('no current subscription → portal home, flow null', async () => {
    m.subsList.mockResolvedValueOnce({ data: [] });
    m.portalCreate.mockResolvedValueOnce({ url: 'https://portal/home' });
    const res = makeRes();
    await portalHandler(post({ flow: 'subscription_update' }), res);
    expect(m.portalCreate.mock.calls[0][0]).not.toHaveProperty('flow_data');
    expect(res.state.body).toEqual({ url: 'https://portal/home', flow: null });
  });

  it('Stripe rejects the flow → retries without flow_data', async () => {
    m.subsList.mockResolvedValueOnce({ data: [{ id: 'sub_1', status: 'active', created: 2, cancel_at_period_end: false }] });
    m.portalCreate.mockRejectedValueOnce(new Error('subscription_update is disabled')).mockResolvedValueOnce({ url: 'https://portal/home' });
    const res = makeRes();
    await portalHandler(post({ flow: 'subscription_update' }), res);
    expect(m.portalCreate).toHaveBeenCalledTimes(2);
    expect(m.portalCreate.mock.calls[1][0]).not.toHaveProperty('flow_data');
    expect(res.state.body).toEqual({ url: 'https://portal/home', flow: null });
  });

  it('guards: invalid flow 400, no customer 400, shopify_free 403, error 500 without details', async () => {
    const r1 = makeRes(); await portalHandler(post({ flow: 'nope' }), r1);
    expect(r1.state).toMatchObject({ status: 400, body: { error: 'invalid_flow' } });
    m.userFind.mockResolvedValueOnce({ ...stripeUser, stripeCustomerId: null });
    const r2 = makeRes(); await portalHandler(post({}), r2);
    expect(r2.state).toMatchObject({ status: 400, body: { code: 'no_customer' } });
    m.userFind.mockResolvedValueOnce({ ...stripeUser, billingProvider: 'shopify_free' });
    const r3 = makeRes(); await portalHandler(post({}), r3);
    expect(r3.state).toMatchObject({ status: 403, body: { code: 'shopify_free' } });
    m.portalCreate.mockRejectedValueOnce(new Error('boom detail'));
    const r4 = makeRes(); await portalHandler(post({}), r4);
    expect(r4.state).toMatchObject({ status: 500, body: { code: 'portal_session_failed' } });
    expect(JSON.stringify(r4.state.body)).not.toContain('boom');
  });

  it('prefers the configured app URL over the Origin header', async () => {
    process.env.NEXTAUTH_URL = 'https://kolayxport.com/';
    m.portalCreate.mockResolvedValueOnce({ url: 'u' });
    await portalHandler(makeReq({ method: 'POST', headers: { origin: 'https://evil.example' } }), makeRes());
    expect(m.portalCreate.mock.calls[0][0].return_url).toBe('https://kolayxport.com/ayarlar?tab=billing');
  });
});

describe('GET /api/stripe/billing-summary (A3)', () => {
  const card = { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2028 } };

  it('subscription payment method + preview of the next payment', async () => {
    m.customersRetrieve.mockResolvedValueOnce({ id: 'cus_1', invoice_settings: { default_payment_method: null } });
    m.subsList.mockResolvedValueOnce({ data: [{ id: 'sub_1', status: 'active', created: 1, cancel_at_period_end: false, default_payment_method: card, items: { data: [{ current_period_end: 1_762_000_000 }] } }] });
    m.invoicesPreview.mockResolvedValueOnce({ amount_due: 499900, currency: 'try', next_payment_attempt: null, period_end: 1 });
    const res = makeRes();
    await summaryHandler(makeReq(), res);
    expect(m.customersRetrieve).toHaveBeenCalledWith('cus_1', { expand: ['invoice_settings.default_payment_method'] });
    expect(m.subsList).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 10, expand: ['data.default_payment_method'] });
    expect(m.invoicesPreview).toHaveBeenCalledWith({ customer: 'cus_1', subscription: 'sub_1' });
    expect(res.state.body).toEqual({
      paymentMethod: { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2028 },
      upcoming: { amount: 4999, currency: 'TRY', date: new Date(1_762_000_000_000).toISOString() },
    });
  });

  it('falls back to the customer default payment method (retrieved when not expanded); canceling → no upcoming', async () => {
    m.customersRetrieve.mockResolvedValueOnce({ id: 'cus_1', invoice_settings: { default_payment_method: 'pm_1' } });
    m.subsList.mockResolvedValueOnce({ data: [{ id: 'sub_1', status: 'active', created: 1, cancel_at_period_end: true, default_payment_method: null }] });
    m.pmRetrieve.mockResolvedValueOnce(card);
    const res = makeRes();
    await summaryHandler(makeReq(), res);
    expect(m.pmRetrieve).toHaveBeenCalledWith('pm_1');
    expect(m.invoicesPreview).not.toHaveBeenCalled();
    expect(res.state.body).toEqual({ paymentMethod: { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2028 }, upcoming: null });
  });

  it('preview failure only drops `upcoming`', async () => {
    m.customersRetrieve.mockResolvedValueOnce({ id: 'cus_1', invoice_settings: { default_payment_method: card } });
    m.subsList.mockResolvedValueOnce({ data: [{ id: 'sub_1', status: 'trialing', created: 1, cancel_at_period_end: false, default_payment_method: null }] });
    m.invoicesPreview.mockRejectedValueOnce(new Error('no upcoming'));
    const res = makeRes();
    await summaryHandler(makeReq(), res);
    expect(res.state.status).toBe(200);
    expect(res.state.body.paymentMethod?.last4).toBe('4242');
    expect(res.state.body.upcoming).toBeNull();
  });

  it('no customer / deleted customer → nulls; shopify_free 403; Stripe error 500 code', async () => {
    m.userFind.mockResolvedValueOnce({ ...stripeUser, stripeCustomerId: null });
    const r1 = makeRes(); await summaryHandler(makeReq(), r1);
    expect(r1.state.body).toEqual({ paymentMethod: null, upcoming: null });
    m.customersRetrieve.mockResolvedValueOnce({ id: 'cus_1', deleted: true });
    const r2 = makeRes(); await summaryHandler(makeReq(), r2);
    expect(r2.state.body).toEqual({ paymentMethod: null, upcoming: null });
    m.userFind.mockResolvedValueOnce({ ...stripeUser, billingProvider: 'shopify_free' });
    const r3 = makeRes(); await summaryHandler(makeReq(), r3);
    expect(r3.state.status).toBe(403);
    m.customersRetrieve.mockRejectedValueOnce(new Error('stripe down'));
    const r4 = makeRes(); await summaryHandler(makeReq(), r4);
    expect(r4.state).toMatchObject({ status: 500, body: { error: 'billing_summary_failed' } });
    const r5 = makeRes(); await summaryHandler(makeReq({ method: 'POST' }), r5);
    expect(r5.state.status).toBe(405);
  });
});
