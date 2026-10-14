import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/admin/events', () => ({ logSystemEvent: vi.fn(), logIntegrationEvent: vi.fn(), logShippingEvent: vi.fn() }));
vi.mock('@/lib/notifications', () => ({
  notify: vi.fn(),
  resolveNotification: vi.fn(),
  resolveByPrefix: vi.fn(),
  notificationKeys: { orderSync: (p: string) => `ordersync:${p}` },
  NOTIFICATION_LINKS: { labels: '/app/labels' },
}));

import { classifyOrderStatus, isCancelledStatus, isRecentOrderDate, liveKindForOrderWrite, mapEtsyReceiptStatus } from '@/lib/orders/orderStatus';
import { deriveOrderEffects, effectKind, nextRetryDelayMs, EFFECT_MAX_ATTEMPTS } from '@/lib/orders/orderEffects';
import { evaluateLabelGuard } from '@/lib/orders/labelGuard';
import { buildLifecycleFlags } from '@/lib/orders/lifecycleFlags';
import { shouldPollShop } from '@/lib/orders/jobs';
import { returnDaysFromPolicies } from '@/lib/orders/returnPolicy';

describe('order status vocabulary', () => {
  it('cancel spellings on status or externalStatus', () => {
    expect(isCancelledStatus('canceled')).toBe(true);
    expect(isCancelledStatus('PAID', 'Fully Refunded')).toBe(true);
    expect(isCancelledStatus('Refunded')).toBe(true);
    expect(isCancelledStatus('SHIPPED')).toBe(false);
  });
  it('classification', () => {
    expect(classifyOrderStatus('shipped')).toBe('shipped');
    expect(classifyOrderStatus('SHIPPED', null, new Date())).toBe('delivered');
    expect(classifyOrderStatus('AWAITING_FULFILLMENT')).toBe('open');
    expect(classifyOrderStatus('Created')).toBe('open');
  });
  it('Etsy receipt status: cancel wins over was_paid/was_shipped', () => {
    expect(mapEtsyReceiptStatus({ was_paid: true, was_shipped: true, status: 'Canceled' })).toBe('CANCELLED');
    expect(mapEtsyReceiptStatus({ was_paid: true, was_shipped: true })).toBe('SHIPPED');
    expect(mapEtsyReceiptStatus({ was_paid: true })).toBe('PAID');
  });
});

describe('live event kind for an order write', () => {
  it("'new' only for a freshly created, open, recent order", () => {
    expect(liveKindForOrderWrite({ created: true, next: 'open', changed: true, recent: true })).toBe('new');
    expect(liveKindForOrderWrite({ created: true, next: 'open', changed: true, recent: false })).toBe('updated');
    expect(liveKindForOrderWrite({ created: true, next: 'cancelled', changed: true, recent: true })).toBe('updated');
  });
  it('transitions and no-ops', () => {
    expect(liveKindForOrderWrite({ created: false, prev: 'open', next: 'cancelled', changed: true, recent: false })).toBe('cancelled');
    expect(liveKindForOrderWrite({ created: false, prev: 'open', next: 'shipped', changed: true, recent: false })).toBe('shipped');
    expect(liveKindForOrderWrite({ created: false, prev: 'shipped', next: 'delivered', changed: false, recent: false })).toBe('delivered');
    expect(liveKindForOrderWrite({ created: false, prev: 'open', next: 'open', changed: true, recent: false })).toBe('updated');
    expect(liveKindForOrderWrite({ created: false, prev: 'open', next: 'open', changed: false, recent: false })).toBeNull();
  });
  it('recent window', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    expect(isRecentOrderDate('2026-10-15T00:00:00Z', now)).toBe(true);
    expect(isRecentOrderDate('2026-10-13T00:00:00Z', now)).toBe(false);
    expect(isRecentOrderDate(null, now)).toBe(true);
  });
});

describe('state-derived effects', () => {
  const names = (xs: { effect: string }[]) => xs.map((x) => effectKind(x.effect));

  it('paid order: notify_new pending + stock', () => {
    const e = deriveOrderEffects({ statusClass: 'open', itemsHash: 'abcdef0123456789xyz', quiet: false });
    expect(e).toEqual([
      { effect: 'notify_new', status: 'pending' },
      { effect: 'stock_apply:abcdef0123456789:open', status: 'pending' },
    ]);
  });

  it('paid -> shipped, shipped-before-paid and coalesced paid+shipped all derive the same shipped set (state, not edge)', () => {
    const viaShipped = deriveOrderEffects({ statusClass: 'shipped', itemsHash: 'h', quiet: false });
    expect(names(viaShipped)).toEqual(['notify_new', 'stock_apply', 'close_tracking_shipped', 'shipped_external']);
    // notify_new for a non-open order is born done (no "new order" alert for an already shipped order)
    expect(viaShipped[0].status).toBe('done');
  });

  it('cancelled: restock key flips, tracking queue closes, label alert', () => {
    const e = deriveOrderEffects({ statusClass: 'cancelled', itemsHash: 'h', quiet: false });
    expect(e.map((x) => x.effect)).toEqual(['notify_new', 'stock_apply:h:cancelled', 'close_tracking_cancelled', 'cancel_label_alert']);
  });

  it('quiet (historical/backfill) suppresses alerts but keeps housekeeping', () => {
    const e = deriveOrderEffects({ statusClass: 'cancelled', itemsHash: 'h', quiet: true });
    const byKind = Object.fromEntries(e.map((x) => [effectKind(x.effect), x.status]));
    expect(byKind).toMatchObject({ notify_new: 'done', cancel_label_alert: 'done', close_tracking_cancelled: 'pending', stock_apply: 'pending' });
  });

  it('non-Etsy writers can opt out of stock and shipped effects', () => {
    const e = deriveOrderEffects({ statusClass: 'shipped', itemsHash: 'h', quiet: false, includeStock: false, includeShipped: false });
    expect(names(e)).toEqual(['notify_new']);
  });

  it('delivered adds delivered_metrics', () => {
    expect(names(deriveOrderEffects({ statusClass: 'delivered', itemsHash: null, quiet: false }))).toContain('delivered_metrics');
  });

  it('retry backoff [30s, 2m, 10m, 1h] then failed after 6 attempts', () => {
    expect([1, 2, 3, 4, 5].map(nextRetryDelayMs)).toEqual([30_000, 120_000, 600_000, 3_600_000, 3_600_000]);
    expect(EFFECT_MAX_ATTEMPTS).toBe(6);
  });
});

describe('label guard decision', () => {
  const base = {
    status: 'PAID',
    externalStatus: 'Paid',
    lastEventAt: null as Date | null,
    trackingNumber: null,
    labelStatus: null,
    shippingLabelUrl: null,
    shipments: [] as any[],
    trackingSubmissions: 0,
  };

  it('allows open orders', () => expect(evaluateLabelGuard(base)).toEqual({ ok: true }));

  it('409 ORDER_CANCELLED for cancelled/refunded (case-insensitive), unless overridden', () => {
    expect(evaluateLabelGuard({ ...base, status: 'canceled' })).toMatchObject({ ok: false, httpStatus: 409, code: 'ORDER_CANCELLED' });
    expect(evaluateLabelGuard({ ...base, status: 'REFUNDED' })).toMatchObject({ code: 'ORDER_CANCELLED' });
    expect(evaluateLabelGuard({ ...base, status: 'CANCELLED' }, true)).toEqual({ ok: true });
  });

  it('409 ORDER_SHIPPED_EXTERNALLY only when the marketplace said so and no KX label exists', () => {
    const shipped = { ...base, status: 'SHIPPED', lastEventAt: new Date() };
    expect(evaluateLabelGuard(shipped)).toMatchObject({ code: 'ORDER_SHIPPED_EXTERNALLY' });
    expect(evaluateLabelGuard({ ...shipped, lastEventAt: null })).toEqual({ ok: true });
    expect(evaluateLabelGuard({ ...shipped, trackingSubmissions: 1 })).toEqual({ ok: true }); // submit-tracking 'shipped'
    expect(evaluateLabelGuard({ ...shipped, shipments: [{ status: 'created', trackingNumber: '1Z', pdfUrl: null, voidedAt: null }] })).toEqual({ ok: true });
    expect(evaluateLabelGuard({ ...shipped, shipments: [{ status: 'voided', trackingNumber: '1Z', pdfUrl: null, voidedAt: new Date() }] })).toMatchObject({ ok: false });
  });
});

describe('lifecycle flags', () => {
  const row = (over: any = {}) => ({
    id: 'o1',
    status: 'PAID',
    externalStatus: 'Paid',
    source: 'etsy-api',
    rawData: { receipt_id: 1, shipments: [] },
    trackingNumber: null,
    labelStatus: null,
    shippingLabelUrl: null,
    cancelledAt: null,
    shipByAt: null,
    shippedLate: null,
    deliveredAt: null,
    returnWindowEndsAt: null,
    lastEventAt: null,
    manualShippingCost: null,
    manualShippingCostCurrency: null,
    shipments: [],
    _count: { trackingSubmissions: 0 },
    ...over,
  });

  it('cancelled after an active UPS label exposes the void target and label cost', () => {
    const f = buildLifecycleFlags(
      row({
        status: 'CANCELLED',
        manualShippingCost: { toString: () => '12.5' },
        manualShippingCostCurrency: 'USD',
        shipments: [{ id: 's1', carrier: 'UPS', status: 'created', trackingNumber: '1Z', pdfUrl: 'x', voidedAt: null }],
      }),
    );
    expect(f).toMatchObject({ cancelled: true, cancelledAfterLabel: true, voidTargetId: 's1', labelCost: 12.5, dispatchState: null });
  });

  it('FedEx order-level label voids via order:<id>', () => {
    const f = buildLifecycleFlags(row({ status: 'CANCELLED', labelStatus: 'created' }));
    expect(f.voidTargetId).toBe('order:o1');
    expect(f.cancelledAfterLabel).toBe(true);
  });

  it('late, dispatch state and shipped externally', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(buildLifecycleFlags(row({ shipByAt: new Date('2026-10-14T12:00:00Z'), trackingNumber: '1Z' }), now)).toMatchObject({ late: true, dispatchState: 'label_not_pushed' });
    expect(buildLifecycleFlags(row({ status: 'SHIPPED', lastEventAt: now, rawData: { receipt_id: 1, shipments: [{ tracking_code: 'X' }] } }), now)).toMatchObject({
      shippedExternally: true,
      dispatchState: 'shipped_on_etsy',
    });
  });
});

describe('incremental poll gating', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  it('skips reauth shops and shops with healthy webhooks polled within the hour', () => {
    expect(shouldPollShop({ needsReauth: true, lastOrderPollAt: null, lastWebhookAt: null }, now).poll).toBe(false);
    expect(shouldPollShop({ needsReauth: false, lastOrderPollAt: new Date(now - 30 * 60_000), lastWebhookAt: new Date(now - 60 * 60_000) }, now)).toEqual({ poll: false, reason: 'webhooks_healthy' });
    expect(shouldPollShop({ needsReauth: false, lastOrderPollAt: new Date(now - 90 * 60_000), lastWebhookAt: new Date(now - 60 * 60_000) }, now).poll).toBe(true);
    expect(shouldPollShop({ needsReauth: false, lastOrderPollAt: new Date(now - 5 * 60_000), lastWebhookAt: new Date(now - 7 * 3600_000) }, now)).toEqual({ poll: true, reason: 'no_recent_webhooks' });
  });
});

describe('return policy', () => {
  it('longest deadline among accepting policies; null when none accept; fallback 30', () => {
    expect(returnDaysFromPolicies([{ accepts_returns: true, return_deadline: 14 }, { accepts_exchanges: true, return_deadline: 30 }])).toBe(30);
    expect(returnDaysFromPolicies([{ accepts_returns: false, accepts_exchanges: false, return_deadline: 30 }])).toBeNull();
    expect(returnDaysFromPolicies([])).toBe(30);
  });
});
