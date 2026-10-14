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

import { quietForExistingWrite, deriveOrderEffects } from '@/lib/orders/orderEffects';
import { hasLegacyOrderLabel } from '@/lib/orders/orderStatus';
import { pickEtsyShopCandidates, shopIdHintFromRaw, withKxShopId } from '@/lib/orders/etsyShopResolve';
import { buildLifecycleFlags } from '@/lib/orders/lifecycleFlags';
import { evaluateLabelGuard } from '@/lib/orders/labelGuard';

describe('quietForExistingWrite (pre-W4 rows keyed on "no OrderEffect yet", not orderHash NULL)', () => {
  it('unseeded row whose state class did not change is quiet', () => {
    expect(quietForExistingWrite({ seeded: false, prevClass: 'cancelled', nextClass: 'cancelled' })).toBe(true);
    expect(quietForExistingWrite({ seeded: false, prevClass: 'open', nextClass: 'open' })).toBe(true);
  });
  it('unseeded row with a real transition alerts (cancel after label is not swallowed)', () => {
    expect(quietForExistingWrite({ seeded: false, prevClass: 'open', nextClass: 'cancelled' })).toBe(false);
    const fx = deriveOrderEffects({ statusClass: 'cancelled', itemsHash: 'abc', quiet: false, includeStock: false, includeShipped: false });
    expect(fx.find((e) => e.effect === 'cancel_label_alert')?.status).toBe('pending');
  });
  it('Etsy: an old remote change stays quiet even across a class change', () => {
    expect(quietForExistingWrite({ seeded: false, prevClass: 'open', nextClass: 'cancelled', remoteChangeOld: true })).toBe(true);
  });
  it('a row already seen by the pipeline is never quiet', () => {
    expect(quietForExistingWrite({ seeded: true, prevClass: 'open', nextClass: 'open' })).toBe(false);
    expect(quietForExistingWrite({ seeded: true, prevClass: 'open', nextClass: 'cancelled', remoteChangeOld: true })).toBe(false);
  });
});

describe('Etsy shop resolution (receipts carry no shop_id)', () => {
  const shops = [
    { shopId: '1', shopName: 'BelleCoutureGifts', isDefault: true },
    { shopId: '2', shopName: 'WoodKeepsakes', isDefault: false },
  ];
  it('KX-stored shop id wins', () => {
    const raw = withKxShopId({ receipt_id: 9 }, '2');
    expect(shopIdHintFromRaw(raw)).toBe('2');
    expect(pickEtsyShopCandidates(shops, { marketplace: 'BelleCoutureGifts', rawData: raw })).toEqual({ candidates: ['2'], resolved: true });
  });
  it('falls back to the shop name stored as marketplace', () => {
    expect(pickEtsyShopCandidates(shops, { marketplace: 'WoodKeepsakes', rawData: { receipt_id: 9 } })).toEqual({ candidates: ['2'], resolved: true });
  });
  it('ambiguous: all shops, default first, not resolved', () => {
    expect(pickEtsyShopCandidates(shops, { marketplace: 'Etsy', rawData: { receipt_id: 9 } })).toEqual({ candidates: ['1', '2'], resolved: false });
  });
  it('single shop is resolved', () => {
    expect(pickEtsyShopCandidates([shops[1]], { marketplace: 'Etsy', rawData: {} })).toEqual({ candidates: ['2'], resolved: true });
  });
  it('a hint for a shop the user no longer has is ignored', () => {
    expect(pickEtsyShopCandidates(shops, { marketplace: 'WoodKeepsakes', rawData: { _kxShopId: '99' } }).candidates).toEqual(['2']);
  });
});

describe('order-level (FedEx) label voided manually', () => {
  it('hasLegacyOrderLabel ignores a voided label even with a stored URL', () => {
    expect(hasLegacyOrderLabel({ labelStatus: 'created', shippingLabelUrl: 'x' })).toBe(true);
    expect(hasLegacyOrderLabel({ labelStatus: null, shippingLabelUrl: 'x' })).toBe(true);
    expect(hasLegacyOrderLabel({ labelStatus: 'voided', shippingLabelUrl: 'x' })).toBe(false);
  });
  it('lifecycle flags clear cancelledAfterLabel and voidTargetId after the void', () => {
    const base = {
      id: 'o1',
      status: 'CANCELLED',
      externalStatus: null,
      source: 'veeqo',
      rawData: null,
      trackingNumber: '7777',
      labelStatus: 'created',
      shippingLabelUrl: 'https://x/label.pdf',
      cancelledAt: new Date(),
      shipByAt: null,
      shippedLate: null,
      deliveredAt: null,
      returnWindowEndsAt: null,
      lastEventAt: null,
      manualShippingCost: null,
      manualShippingCostCurrency: null,
      shipments: [],
      _count: { trackingSubmissions: 0 },
    };
    expect(buildLifecycleFlags(base as any)).toMatchObject({ cancelledAfterLabel: true, voidTargetId: 'order:o1' });
    expect(buildLifecycleFlags({ ...base, labelStatus: 'voided' } as any)).toMatchObject({ cancelledAfterLabel: false, voidTargetId: null });
  });
  it('label guard: a voided order-level label no longer counts as a KolayXport label', () => {
    const g = evaluateLabelGuard({
      status: 'SHIPPED',
      externalStatus: null,
      lastEventAt: new Date(),
      trackingNumber: null,
      labelStatus: 'voided',
      shippingLabelUrl: 'x',
      shipments: [],
      trackingSubmissions: 0,
    });
    expect(g).toMatchObject({ ok: false, code: 'ORDER_SHIPPED_EXTERNALLY' });
  });
});
