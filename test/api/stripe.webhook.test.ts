import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Hoist-safe mocks. We don't need a real Stripe instance — we mock everything the handler
// reaches into and exercise the customer-match defense.

vi.mock('micro', () => ({
  buffer: vi.fn(async (req: any) => Buffer.from(req._rawBody || '')),
}));

const constructEventMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn();

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...args: any[]) => constructEventMock(...args) },
    subscriptions: { retrieve: (...args: any[]) => subscriptionsRetrieveMock(...args) },
  },
}));

vi.mock('../../lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...args: any[]) => constructEventMock(...args) },
    subscriptions: { retrieve: (...args: any[]) => subscriptionsRetrieveMock(...args) },
  },
}));

const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const webhookEventFindUniqueMock = vi.fn(async () => null);
const webhookEventCreateMock = vi.fn(async () => ({ id: 'evt' }));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: (...args: any[]) => userFindUniqueMock(...args), update: (...args: any[]) => userUpdateMock(...args) },
    webhookEvent: {
      findUnique: (...args: any[]) => webhookEventFindUniqueMock(...args),
      create: (...args: any[]) => webhookEventCreateMock(...args),
    },
  },
}));
vi.mock('../../../lib/prisma', () => ({
  default: {
    user: { findUnique: (...args: any[]) => userFindUniqueMock(...args), update: (...args: any[]) => userUpdateMock(...args) },
    webhookEvent: {
      findUnique: (...args: any[]) => webhookEventFindUniqueMock(...args),
      create: (...args: any[]) => webhookEventCreateMock(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() },
  redact: (v: any) => v,
}));

vi.mock('@/lib/admin/events', () => ({
  logBillingEvent: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../../lib/stripePrices', () => ({
  STRIPE_PRICES: { starter: { month: 'price_starter_month', year: 'price_starter_year' } },
}));

import handler from '@/pages/api/stripe/webhook';

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

function makeReq(rawBody: string, sig: string = 'fake-signature') {
  return {
    method: 'POST',
    headers: { 'stripe-signature': sig },
    _rawBody: rawBody,
  } as any;
}

function makeRes() {
  const state = { status: 0, body: null as any, ended: false };
  const res: any = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      state.status = code;
      return res;
    }),
    json: vi.fn((body: any) => {
      state.body = body;
      state.ended = true;
      return res;
    }),
    send: vi.fn((body: any) => {
      state.body = body;
      state.ended = true;
      return res;
    }),
    end: vi.fn(() => {
      state.ended = true;
      return res;
    }),
    state,
  };
  return res;
}

describe('Stripe webhook — signature + customer-match', () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    subscriptionsRetrieveMock.mockReset();
    userFindUniqueMock.mockReset();
    userUpdateMock.mockReset();
    webhookEventFindUniqueMock.mockReset();
    webhookEventFindUniqueMock.mockResolvedValue(null);
    webhookEventCreateMock.mockReset();
    webhookEventCreateMock.mockResolvedValue({ id: 'evt' });
  });

  it('rejects with 400 when signature verification fails', async () => {
    constructEventMock.mockImplementationOnce(() => {
      throw new Error('bad signature');
    });
    const res = makeRes();
    await handler(makeReq('{}'), res);
    expect(res.state.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('on customer.subscription.deleted with unknown customer, does NOT update any user', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_test_1',
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_unknown', status: 'canceled' } },
    });
    userFindUniqueMock.mockResolvedValueOnce(null); // no matching user
    const res = makeRes();
    await handler(makeReq('{}'), res);
    expect(userUpdateMock).not.toHaveBeenCalled();
    // Webhook still acks so Stripe doesn't retry.
    expect(res.state.status).toBe(200);
  });

  it('on customer.subscription.deleted with matching customer, updates that user only', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_test_2',
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_match', status: 'canceled' } },
    });
    userFindUniqueMock.mockResolvedValueOnce({
      id: 'u1',
      stripeCustomerId: 'cus_match',
    });
    const res = makeRes();
    await handler(makeReq('{}'), res);
    expect(userUpdateMock).toHaveBeenCalledTimes(1);
    const call = userUpdateMock.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u1' });
    expect(call.data.subscriptionStatus).toBe('canceled');
    expect(res.state.status).toBe(200);
  });

  it('on customer.subscription.updated with unknown customer, does NOT mutate', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_test_3',
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_other', status: 'active' } },
    });
    userFindUniqueMock.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(makeReq('{}'), res);
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(res.state.status).toBe(200);
  });
});
