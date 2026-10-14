import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { orders: [] as any[], items: [] as any[], effects: [] as any[] };
  const db: any = {
    order: {
      findUnique: async ({ where }: any) => {
        const k = where.userId_marketplace_marketplaceKey;
        return state.orders.find((o) => o.userId === k.userId && o.marketplace === k.marketplace && o.marketplaceKey === k.marketplaceKey) || null;
      },
      create: async ({ data }: any) => {
        const row = { id: `o${state.orders.length + 1}`, deliveredAt: null, cancelledAt: null, ...data };
        state.orders.push(row);
        return row;
      },
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.orders.find((o) => o.id === where.id), data)),
    },
    orderItem: {
      findMany: async ({ where }: any) => state.items.filter((i) => i.orderId === where.orderId),
      create: async ({ data }: any) => {
        const row = { id: `i${state.items.length + 1}`, ...data };
        state.items.push(row);
        return row;
      },
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.items.find((i) => i.id === where.id), data)),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    orderEffect: {
      findFirst: async ({ where }: any) => state.effects.find((e: any) => e.orderId === where.orderId) || null,
      findMany: async () => [],
      createMany: async ({ data }: any) => {
        state.effects.push(...data);
        return { count: data.length };
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { state, db };
});

vi.mock('@/lib/prisma', () => ({ default: h.db }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/admin/events', () => ({ logSystemEvent: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishOrderEvent: vi.fn(), publishLive: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveNotification: vi.fn(), NOTIFICATION_LINKS: { labels: '/app/labels' } }));
vi.mock('@/lib/hooks/statusUpdateHook', () => ({ batchExecuteStatusUpdateHook: vi.fn() }));

import { upsertMarketplaceOrder } from '@/lib/orders/marketplaceOrderWrite';
import { checkApplyAllowed, parseArgs, parseDbHost } from '../../scripts/lib/safeDb';

const trendyolOrder = (over: any = {}) => ({
  userId: 'u1',
  marketplace: 'Trendyol',
  marketplaceKey: '10293847',
  uiOrderDate: new Date(),
  customerName: 'Ayşe',
  status: 'Created',
  currency: 'TRY',
  totalPrice: 499.9,
  orderNumber: '10293847',
  shippingAddress: { name: 'Ayşe', street1: 'Atatürk Cd. 1', city: 'İstanbul', country: 'TR' },
  rawData: { id: 1 },
  commodityDesc: 'Kutu',
  externalStatus: 'Created',
  shippedAt: null,
  shippingLabelUrl: null,
  trackingNumber: null,
  labelStatus: null,
  ...over,
});
const lines = [{ id: 'L1', title: 'Kutu', value: 499.9, quantity: 1, weight: 0.5, sku: 'K1', image: '' }];

beforeEach(() => {
  h.state.orders.length = 0;
  h.state.items.length = 0;
  h.state.effects.length = 0;
  h.db.order.update.mockClear();
  h.db.orderItem.update.mockClear();
  h.db.orderItem.deleteMany.mockClear();
});

describe('upsertMarketplaceOrder (Trendyol/Wix/Shopify writer)', () => {
  it('new recent order -> live "new"; re-sync unchanged -> skipped, nothing rewritten', async () => {
    const first = await upsertMarketplaceOrder('u1', trendyolOrder(), lines, { source: 'trendyol' });
    expect(first).toMatchObject({ created: true, live: { kind: 'new' } });
    const again = await upsertMarketplaceOrder('u1', trendyolOrder(), lines, { source: 'trendyol' });
    expect(again).toMatchObject({ skipped: true, live: null });
    expect(h.db.order.update).not.toHaveBeenCalled();
    expect(h.db.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it('a later sync never nulls a locally created label / tracking number', async () => {
    await upsertMarketplaceOrder('u1', trendyolOrder(), lines, { source: 'trendyol' });
    Object.assign(h.state.orders[0], { trackingNumber: 'MNG123', labelStatus: 'created', shippingLabelUrl: 'x' });
    const r = await upsertMarketplaceOrder('u1', trendyolOrder({ status: 'Shipped', externalStatus: 'Shipped' }), lines, { source: 'trendyol' });
    expect(r.live?.kind).toBe('shipped');
    expect(h.state.orders[0]).toMatchObject({ trackingNumber: 'MNG123', labelStatus: 'created', shippingLabelUrl: 'x', status: 'Shipped' });
    expect(h.state.items).toHaveLength(1);
    expect(h.state.items[0].id).toBe('i1'); // same row: Shipment/LabelJob references survive
  });

  it('cancellation after a label queues the cancel alert', async () => {
    await upsertMarketplaceOrder('u1', trendyolOrder(), lines, { source: 'trendyol' });
    const r = await upsertMarketplaceOrder('u1', trendyolOrder({ status: 'Cancelled', externalStatus: 'Cancelled' }), lines, { source: 'trendyol' });
    expect(r.live?.kind).toBe('cancelled');
    expect(h.state.effects.map((e) => e.effect)).toEqual(expect.arrayContaining(['cancel_label_alert', 'close_tracking_cancelled']));
  });
});

describe('scripts/lib/safeDb', () => {
  it('dry-run by default; --apply needs KX_ALLOW_PROD_WRITE=1 and a matching --db-host', () => {
    expect(checkApplyAllowed({ apply: false, envAllow: '1', dbHostArg: 'h', actualHost: 'h' })).toEqual({ write: false });
    expect(checkApplyAllowed({ apply: true, envAllow: undefined, dbHostArg: 'h', actualHost: 'h' }).error).toMatch(/KX_ALLOW_PROD_WRITE/);
    expect(checkApplyAllowed({ apply: true, envAllow: '1', dbHostArg: null, actualHost: 'h' }).error).toMatch(/--db-host/);
    expect(checkApplyAllowed({ apply: true, envAllow: '1', dbHostArg: 'other', actualHost: 'localhost' }).error).toMatch(/does not match/);
    expect(checkApplyAllowed({ apply: true, envAllow: '1', dbHostArg: 'localhost', actualHost: 'localhost' })).toEqual({ write: true });
  });

  it('parses args and the DB host without exposing credentials', () => {
    expect(parseArgs(['--apply', '--db-host=localhost', '--user=u1', '--limit=5'])).toMatchObject({ apply: true, dbHost: 'localhost', userId: 'u1', limit: 5 });
    expect(parseDbHost('postgresql://kx:secret@localhost:5432/kolayxport?schema=public')).toBe('localhost');
    expect(parseDbHost(undefined)).toBeNull();
  });
});
