import { describe, expect, it, vi } from 'vitest';

// Modules under test import prisma / notifications / live; the pure helpers need none of them.
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolve: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishLive: vi.fn() }));

import { planListingPush } from '@/lib/stock/adapters/etsy';
import { isEbayAuthGone } from '@/lib/stock/adapters/ebay';
import { EbayNotConnectedError } from '@/lib/integrations/ebayClient';
import { classifyOfferingRead } from '@/lib/stock/observe';
import { unverifiableAction, UNKNOWN_REPEND_MS } from '@/lib/stock/pushWorker';
import { advanceScanCursor, SCAN_MAX_ORDER_FAILURES } from '@/lib/stock/orders';
import { hashPlan, planEntry } from '@/lib/stock/preview';
import { asPushReason, directionForMaxChange, directionWhenLargerLowers, reasonForTargetEdit } from '@/lib/stock/math';

function row(variantKey: string, quantity: number, isEnabled = true, quantityKey = variantKey) {
  return { variantKey, variantValueKey: variantKey, quantityKey, sku: null, quantity, isEnabled, productId: null };
}
function item(id: string, variantRef: string, targetQty: number, reason: string, deactivatedByStock = false) {
  return { pushId: `p-${id}`, link: { id, variantRef, variantValueKey: variantRef, remoteSku: null, deactivatedByStock } as any, targetQty, reason };
}

describe('planListingPush (Etsy deactivate / reactivate)', () => {
  const rows = [row('X', 1), row('Y', 1), row('Z', 4)];

  it('reactivating brings every managed sibling to the hub first (zero -> disabled)', () => {
    // Listing deactivated by us; X is restocked by a cancel. Y is at 0 on the hub but still shows 1 on Etsy.
    const p = planListingPush({
      rows,
      group: [item('x', 'X', 2, 'cancel', true)],
      siblings: [
        { link: { id: 'y', variantRef: 'Y', variantValueKey: 'Y', remoteSku: null }, target: 0 },
        { link: { id: 'z', variantRef: 'Z', variantValueKey: 'Z', remoteSku: null }, target: 3 },
      ],
      zeroAction: 'disable_variation',
      ourInactive: true,
      reactivating: true,
    });
    expect(p.wantDeactivate).toBe(false);
    expect(p.changes.get('X')).toEqual({ quantity: 2 });
    expect(p.changes.get('Y')).toEqual({ isEnabled: false });
    expect(p.changes.get('Z')).toEqual({ quantity: 3 }); // lowered to the hub, never raised
    expect(p.siblingEff.get('y')).toBe(0);
    expect(p.siblingEff.get('z')).toBe(3);
  });

  it('first pass only asks to reactivate for a raising reason', () => {
    const sale = planListingPush({ rows, group: [item('x', 'X', 2, 'sale', true)], siblings: [], zeroAction: 'disable_variation', ourInactive: true, reactivating: false });
    expect(sale.wantReactivate).toBe(false);
    const cancel = planListingPush({ rows, group: [item('x', 'X', 2, 'cancel', true)], siblings: [], zeroAction: 'disable_variation', ourInactive: true, reactivating: false });
    expect(cancel.wantReactivate).toBe(true);
  });

  it('deactivate_listing mode: a sibling at 0 blocks the reactivation', () => {
    const p = planListingPush({
      rows,
      group: [item('x', 'X', 2, 'cancel', true)],
      siblings: [{ link: { id: 'y', variantRef: 'Y', variantValueKey: 'Y', remoteSku: null }, target: 0 }],
      zeroAction: 'deactivate_listing',
      ourInactive: true,
      reactivating: true,
    });
    expect(p.wantDeactivate).toBe(true);
  });

  it('unmanaged siblings (target null) are left alone', () => {
    const p = planListingPush({
      rows,
      group: [item('x', 'X', 2, 'cancel', true)],
      siblings: [{ link: { id: 'y', variantRef: 'Y', variantValueKey: 'Y', remoteSku: null }, target: null }],
      zeroAction: 'disable_variation',
      ourInactive: true,
      reactivating: true,
    });
    expect(p.changes.has('Y')).toBe(false);
  });

  it('a sale push on an active listing stays lower-only', () => {
    const p = planListingPush({ rows, group: [item('z', 'Z', 9, 'sale')], siblings: [], zeroAction: 'disable_variation', ourInactive: false, reactivating: false });
    expect(p.plan[0].send).toBeNull();
    expect(p.changes.size).toBe(0);
  });
});

describe('classifyOfferingRead (seller-disabled variation is not a sale)', () => {
  it('enabled -> qty', () => expect(classifyOfferingRead({ isEnabled: true, quantity: 5, ourDeactivation: false, weDisabled: false })).toBe('qty'));
  it('our listing deactivation -> zero', () => expect(classifyOfferingRead({ isEnabled: true, quantity: 5, ourDeactivation: true, weDisabled: false })).toBe('zero'));
  it('disabled by our push -> zero', () => expect(classifyOfferingRead({ isEnabled: false, quantity: 5, ourDeactivation: false, weDisabled: true })).toBe('zero'));
  it('disabled with nothing left -> zero', () => expect(classifyOfferingRead({ isEnabled: false, quantity: 0, ourDeactivation: false, weDisabled: false })).toBe('zero'));
  it('seller disabled with stock -> seller_disabled', () => expect(classifyOfferingRead({ isEnabled: false, quantity: 5, ourDeactivation: false, weDisabled: false })).toBe('seller_disabled'));
});

describe('unverifiableAction (unknown pushes do not freeze a link for a day)', () => {
  const now = Date.UTC(2026, 9, 15, 12);
  it('rotates while young', () => expect(unverifiableAction(new Date(now - 60_000), now)).toBe('rotate'));
  it('back to pending after the repend window', () => expect(unverifiableAction(new Date(now - UNKNOWN_REPEND_MS - 1), now)).toBe('repend'));
  it('fails after a day', () => expect(unverifiableAction(new Date(now - 25 * 3600 * 1000), now)).toBe('fail'));
});

describe('advanceScanCursor (failed sale applies are retried)', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 9, 15, 12, m));
  it('advances over successes', () => {
    const c = advanceScanCursor({ at: t(0), id: '' }, [
      { id: 'a', updatedAt: t(1), failed: false, failures: 0 },
      { id: 'b', updatedAt: t(2), failed: false, failures: 0 },
    ]);
    expect(c).toEqual({ at: t(2), id: 'b', blockedBy: null });
  });
  it('stops before the first failed order', () => {
    const c = advanceScanCursor({ at: t(0), id: '' }, [
      { id: 'a', updatedAt: t(1), failed: false, failures: 0 },
      { id: 'b', updatedAt: t(2), failed: true, failures: 1 },
    ]);
    expect(c).toEqual({ at: t(1), id: 'a', blockedBy: 'b' });
  });
  it('gives up on an order that keeps failing', () => {
    const c = advanceScanCursor({ at: t(0), id: '' }, [{ id: 'b', updatedAt: t(2), failed: true, failures: SCAN_MAX_ORDER_FAILURES }]);
    expect(c.blockedBy).toBeNull();
    expect(c.id).toBe('b');
  });
});

describe('isEbayAuthGone (transient token errors never pause links)', () => {
  it('not connected -> gone', () => expect(isEbayAuthGone(new EbayNotConnectedError())).toBe(true));
  it('invalid_grant on refresh -> gone', () => expect(isEbayAuthGone(new Error('eBay token refresh failed: 400 - {"error":"invalid_grant"}'))).toBe(true));
  it('5xx on refresh -> transient', () => expect(isEbayAuthGone(new Error('eBay token refresh failed: 503 - upstream'))).toBe(false));
  it('network error -> transient', () => expect(isEbayAuthGone(new TypeError('fetch failed'))).toBe(false));
});

describe('Go Live plan hash', () => {
  it('ignores entry order, changes with a target or zero effect', () => {
    const a = [planEntry({ linkId: 'l1', channel: 'etsy', target: 3, multi: true, zeroAction: 'disable_variation' }), planEntry({ linkId: 'l2', channel: 'trendyol', target: 0, multi: false, zeroAction: 'disable_variation' })];
    expect(hashPlan('h', a)).toBe(hashPlan('h', [...a].reverse()));
    const sold = [planEntry({ linkId: 'l1', channel: 'etsy', target: 0, multi: true, zeroAction: 'disable_variation' }), a[1]];
    expect(hashPlan('h', sold)).not.toBe(hashPlan('h', a));
    const deact = [planEntry({ linkId: 'l1', channel: 'etsy', target: 0, multi: true, zeroAction: 'deactivate_listing' }), a[1]];
    expect(hashPlan('h', deact)).not.toBe(hashPlan('h', sold));
  });
});

describe('push reasons for edits', () => {
  it('a larger buffer can only lower -> reconcile', () => expect(reasonForTargetEdit(directionWhenLargerLowers(1, 3))).toBe('reconcile'));
  it('a smaller buffer may raise -> adjust', () => expect(reasonForTargetEdit(directionWhenLargerLowers(3, 1))).toBe('adjust'));
  it('unchanged -> nothing', () => expect(reasonForTargetEdit(directionWhenLargerLowers(2, 2))).toBeNull());
  it('removing a max cap may raise', () => expect(reasonForTargetEdit(directionForMaxChange(5, null))).toBe('adjust'));
  it('setting a lower cap lowers', () => expect(reasonForTargetEdit(directionForMaxChange(null, 5))).toBe('reconcile'));
  it('stored reasons map back safely', () => {
    expect(asPushReason('sale')).toBe('sale');
    expect(asPushReason('weird')).toBe('reconcile');
  });
});
