import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { orders: [] as any[], items: [] as any[], effects: [] as any[], seq: 0, failKeys: new Set<string>(), pages: [] as any[][], shopUpdates: [] as any[] };
  const id = (p: string) => `${p}${++state.seq}`;
  const match = (row: any, where: any) => Object.entries(where || {}).every(([k, v]) => row[k] === v);
  const db: any = {
    etsyShop: {
      findFirst: async () => ({ shopName: 'BelleCoutureGifts' }),
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ userId: 'u1', shopId: '777', isActive: true, needsReauth: false, orderPollCursor: 1000 }),
      update: async ({ data }: any) => {
        state.shopUpdates.push(data);
        return {};
      },
    },
    etsyListing: { findMany: async () => [] },
    order: {
      create: async ({ data }: any) => {
        if (state.orders.some((o) => o.userId === data.userId && o.marketplace === data.marketplace && o.marketplaceKey === data.marketplaceKey)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: id('order-'), deliveredAt: null, cancelledAt: null, shippedAt: null, shippedLate: null, orderHash: null, itemsHash: null, ...data };
        state.orders.push(row);
        return row;
      },
      findMany: async ({ where }: any) => {
        if (state.failKeys.has(where.marketplaceKey)) throw new Error('boom');
        return state.orders.filter((o) => match(o, where));
      },
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.orders.find((o) => o.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    orderItem: {
      findMany: async ({ where }: any) => state.items.filter((i) => i.orderId === where.orderId),
      create: async ({ data }: any) => {
        const row = { id: id('item-'), ...data };
        state.items.push(row);
        return row;
      },
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.items.find((i) => i.id === where.id), data)),
      deleteMany: async () => ({ count: 0 }),
    },
    orderEffect: {
      findFirst: async ({ where }: any) => state.effects.find((e) => e.orderId === where.orderId) || null,
      findMany: async ({ where }: any) => state.effects.filter((e) => e.orderId === where.orderId && where.effect.in.includes(e.effect)),
      createMany: async ({ data }: any) => {
        for (const d of data) if (!state.effects.some((e) => e.orderId === d.orderId && e.effect === d.effect)) state.effects.push({ ...d });
        return { count: data.length };
      },
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: async (fn: any) => fn(db),
  };
  return { state, db, publishOrderEvent: vi.fn(), kick: vi.fn(), hook: vi.fn() };
});

vi.mock('@/lib/prisma', () => ({ default: h.db }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/admin/events', () => ({ logIntegrationEvent: vi.fn(), logSystemEvent: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishOrderEvent: h.publishOrderEvent, publishLive: vi.fn() }));
vi.mock('@/lib/orderSync', () => ({ getEtsyExtensionAddress: async () => ({ name: 'Jane', street1: '1 Main St', city: 'Austin', postal: '78701', country: 'US' }) }));
vi.mock('@/lib/hooks/statusUpdateHook', () => ({ batchExecuteStatusUpdateHook: h.hook }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveNotification: vi.fn(), resolveByPrefix: vi.fn(), NOTIFICATION_LINKS: { labels: '/app/labels' } }));
vi.mock('@/lib/orders/orderEffects', async (orig) => ({ ...(await orig<any>()), kickOrderEffects: h.kick }));
vi.mock('@/lib/integrations/etsyOrderSync', async (orig) => ({
  ...(await orig<any>()),
  fetchReceiptsPage: async () => ({ results: h.state.pages.shift() || [] }),
}));

import { upsertEtsyReceipt, runEtsyOrderIncremental, __resetReceiptFailures } from '@/lib/orders/etsyLifecycle';

const nowS = Math.floor(Date.now() / 1000);
const receipt = (over: any = {}) => ({
  receipt_id: 3456789012,
  status: 'Paid',
  was_paid: true,
  is_shipped: false,
  name: 'Jane Doe',
  first_line: null,
  city: null,
  zip: null,
  country_iso: null,
  currency_code: 'USD',
  grandtotal: { amount: 4500, divisor: 100 },
  created_timestamp: nowS - 600,
  updated_timestamp: nowS - 60,
  shipments: [],
  transactions: [
    {
      transaction_id: 9001,
      listing_id: 555,
      title: 'Keepsake box',
      quantity: 1,
      price: { amount: 4500, divisor: 100 },
      expected_ship_date: nowS + 2 * 86400,
      variations: [
        { property_id: 200, value_id: 1213, formatted_name: 'Color', formatted_value: 'Walnut' },
        { property_id: 54, value_id: null, formatted_name: 'Personalization', formatted_value: 'For Mia' },
      ],
    },
  ],
  ...over,
});

beforeEach(() => {
  h.state.orders.length = 0;
  h.state.items.length = 0;
  h.state.effects.length = 0;
  h.state.failKeys.clear();
  h.state.pages.length = 0;
  h.state.shopUpdates.length = 0;
  __resetReceiptFailures();
  h.db.order.update.mockClear();
  h.db.$executeRaw.mockClear();
  h.publishOrderEvent.mockClear();
  h.db.orderItem.update.mockClear();
  h.hook.mockClear();
});

describe('upsertEtsyReceipt', () => {
  it('order.paid creates the order with source/shipByAt/listing+variant refs and publishes a live "new" event', async () => {
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'webhook', eventTypes: new Set(['order.paid']) });
    expect(r).toMatchObject({ created: true, status: 'PAID', liveKind: 'new' });
    const order = h.state.orders[0];
    expect(order).toMatchObject({ source: 'etsy-api', marketplace: 'BelleCoutureGifts', marketplaceKey: '3456789012' });
    expect(order.shipByAt).toBeInstanceOf(Date);
    expect(order.lastEventAt).toBeInstanceOf(Date);
    // extension address used because Etsy withheld it
    expect(JSON.parse(order.shippingAddress)).toMatchObject({ street1: '1 Main St', city: 'Austin' });
    const item = h.state.items[0];
    expect(item).toMatchObject({ listingRef: '555', remoteLineId: '9001' });
    expect(item.variantRef).toMatch(/^[0-9a-f]{40}$/); // personalization (no value_id) excluded from the key
    expect(r.effectsQueued).toHaveLength(2);
    expect(r.effectsQueued).toEqual(expect.arrayContaining(['notify_new', expect.stringMatching(/^stock_apply:[0-9a-f]{16}:open$/)]));
    expect(h.publishOrderEvent).toHaveBeenCalledWith('u1', expect.objectContaining({ id: order.id }), 'new');
  });

  it('paid then shipped ends as one SHIPPED order; items untouched; shipped effects queued; live "shipped"', async () => {
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'webhook', eventTypes: new Set(['order.paid']) });
    const shipped = receipt({ is_shipped: true, was_shipped: true, status: 'Completed', shipments: [{ tracking_code: '1Z999', shipment_notification_timestamp: nowS - 30 }] });
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: shipped, source: 'webhook', eventTypes: new Set(['order.shipped']) });
    expect(h.state.orders).toHaveLength(1);
    expect(r).toMatchObject({ created: false, status: 'SHIPPED', liveKind: 'shipped' });
    expect(h.state.orders[0]).toMatchObject({ status: 'SHIPPED', trackingNumber: '1Z999' });
    expect(h.state.orders[0].shippedAt).toBeInstanceOf(Date);
    expect(h.db.orderItem.update).not.toHaveBeenCalled();
    expect(r.effectsQueued.sort()).toEqual(['close_tracking_shipped', 'shipped_external']);
    expect(h.hook).toHaveBeenCalledWith([h.state.orders[0].id], 'u1');
  });

  it('shipped before paid (coalesced) creates directly as SHIPPED without a new-order alert', async () => {
    const shipped = receipt({ is_shipped: true, was_shipped: true, shipments: [{ tracking_code: '1Z1' }] });
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: shipped, source: 'webhook', eventTypes: new Set(['order.paid', 'order.shipped']) });
    expect(r).toMatchObject({ created: true, status: 'SHIPPED', liveKind: 'updated' });
    const notifyNew = h.state.effects.find((e) => e.effect === 'notify_new');
    expect(notifyNew.status).toBe('done');
  });

  it('re-delivery of an unchanged receipt writes no effects and publishes nothing', async () => {
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'poll' });
    h.publishOrderEvent.mockClear();
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'poll' });
    expect(r.liveKind).toBeNull();
    expect(r.effectsQueued).toEqual([]);
    expect(h.publishOrderEvent).not.toHaveBeenCalled();
  });

  it('a Trendyol order with the same numeric key is never updated', async () => {
    h.state.orders.push({ id: 'ty-1', userId: 'u1', marketplace: 'Trendyol', marketplaceKey: '3456789012', source: 'trendyol', rawData: { orderNumber: 'X' }, status: 'Created' });
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'poll' });
    expect(r.created).toBe(true);
    expect(h.state.orders.find((o) => o.id === 'ty-1').status).toBe('Created');
    expect(h.state.orders).toHaveLength(2);
  });

  it('an old receipt imported by backfill is silent (no sound, notify_new done)', async () => {
    const old = receipt({ created_timestamp: nowS - 5 * 86400, updated_timestamp: nowS - 5 * 86400 });
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: old, source: 'reconcile' });
    expect(r.liveKind).toBe('updated');
    expect(h.state.effects.find((e) => e.effect === 'notify_new').status).toBe('done');
  });

  it('cancel after paid derives restock + tracking close + label alert', async () => {
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'webhook' });
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt({ status: 'Canceled', is_dead: true }), source: 'webhook', eventTypes: new Set(['order.canceled']) });
    expect(r).toMatchObject({ status: 'CANCELLED', liveKind: 'cancelled' });
    expect(r.effectsQueued).toHaveLength(3);
    expect(r.effectsQueued).toEqual(expect.arrayContaining(['cancel_label_alert', 'close_tracking_cancelled', expect.stringMatching(/^stock_apply:.*:cancelled$/)]));
    expect(h.state.orders[0].cancelledAt).toBeInstanceOf(Date);
  });

  it('stores the shop id under a KX-owned rawData key (receipts carry no shop_id)', async () => {
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'webhook' });
    expect(h.state.orders[0].rawData).toMatchObject({ receipt_id: 3456789012, _kxShopId: '777' });
  });

  it('an unchanged receipt does not rewrite the order row (no updatedAt bump), only lastRemoteCheckAt via raw SQL', async () => {
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'poll' });
    h.state.orders[0].lastRemoteCheckAt = new Date(Date.now() - 60 * 60 * 1000);
    h.db.order.update.mockClear();
    h.db.$executeRaw.mockClear();
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'reconcile' });
    expect(h.db.order.update).not.toHaveBeenCalled();
    // advisory lock + lastRemoteCheckAt
    expect(h.db.$executeRaw).toHaveBeenCalledTimes(2);
    expect(r.effectsQueued).toEqual([]);
    // fresh check: no write at all besides the lock
    h.db.$executeRaw.mockClear();
    h.state.orders[0].lastRemoteCheckAt = new Date();
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'reconcile' });
    expect(h.db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(h.db.order.update).not.toHaveBeenCalled();
  });

  it('pre-W4 row with backfilled hashes and an already-cancelled state stays quiet (no stale cancel alert)', async () => {
    const cancelled = receipt({ status: 'Canceled', is_dead: true });
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: cancelled, source: 'reconcile' });
    // simulate a pre-W4 row: no OrderEffect rows, hashes filled by the backfill script (stale)
    h.state.effects.length = 0;
    h.state.orders[0].orderHash = 'backfilled';
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: cancelled, source: 'reconcile' });
    expect(r.effectsQueued).not.toContain('cancel_label_alert');
    expect(h.state.effects.find((e) => e.effect === 'cancel_label_alert').status).toBe('done');
  });

  it('pre-W4 open row that is cancelled now still raises the cancel alert', async () => {
    await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt(), source: 'poll' });
    h.state.effects.length = 0;
    h.state.orders[0].orderHash = 'backfilled';
    const r = await upsertEtsyReceipt({ userId: 'u1', shopId: '777', receipt: receipt({ status: 'Canceled', is_dead: true }), source: 'poll' });
    expect(r.effectsQueued).toContain('cancel_label_alert');
  });
});

describe('runEtsyOrderIncremental', () => {
  it('one failing receipt does not stop the others and holds the cursor for a bounded number of runs', async () => {
    const good = receipt({ receipt_id: 111, updated_timestamp: 2000 });
    const bad = receipt({ receipt_id: 222, updated_timestamp: 1500 });
    h.state.failKeys.add('222');
    h.state.pages.push([bad, good]);
    const r1 = await runEtsyOrderIncremental('777', { maxPages: 1 });
    expect(r1).toMatchObject({ receipts: 1, failed: 1, failedReceiptIds: ['222'] });
    expect(h.state.orders.map((o) => o.marketplaceKey)).toEqual(['111']);
    expect(h.state.shopUpdates.at(-1).orderPollCursor).toBe(1500); // held at the failed receipt

    h.state.pages.push([bad, good]);
    await runEtsyOrderIncremental('777', { maxPages: 1 });
    expect(h.state.shopUpdates.at(-1).orderPollCursor).toBe(1500);

    h.state.pages.push([bad, good]);
    await runEtsyOrderIncremental('777', { maxPages: 1 });
    expect(h.state.shopUpdates.at(-1).orderPollCursor).toBe(2000); // third failure: skipped, cursor moves on
  });
});

