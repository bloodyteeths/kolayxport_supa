import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/stock/adapters', () => ({ getAdapter: () => null, OVERSELL_WINDOW_MINUTES: {} }));

import {
  computeLinkTarget, computeSeedQty, decideSendQty, groupNeedsReview, mergePushReason, pushBackoffMs, reasonAllowsRaise,
} from '@/lib/stock/math';
import { buildTimelineEntries, orderRef } from '@/lib/stock/timeline';
import { issueConfirmToken, verifyConfirmToken } from '@/lib/stock/preview';
import { typedMatches, GO_LIVE_WORDS, RESTORE_WORDS } from '@/lib/stock/goLive';
import { proposeSku } from '@/lib/stock/skuGen';
import { sanitizeSettingsPatch, isStockLive, isStockSyncActive } from '@/lib/stock/settings';

describe('computeLinkTarget', () => {
  it('applies buffers, units per sale and the listing cap', () => {
    expect(computeLinkTarget({ onHand: 10 })).toBe(10);
    expect(computeLinkTarget({ onHand: 10, safetyBuffer: 2, buffer: 1 })).toBe(7);
    expect(computeLinkTarget({ onHand: 10, unitsPerSale: 3 })).toBe(3);
    expect(computeLinkTarget({ onHand: 10, maxListedQty: 4 })).toBe(4);
    expect(computeLinkTarget({ onHand: -3 })).toBe(0);
    expect(computeLinkTarget({ onHand: 2, safetyBuffer: 5 })).toBe(0);
  });
});

describe('decideSendQty', () => {
  it('never raises a remote above its fresh read for sale / remote_adjust / reconcile', () => {
    for (const reason of ['sale', 'remote_adjust', 'reconcile']) {
      expect(decideSendQty(8, 5, reason)).toBeNull(); // would raise -> keep 5
      expect(decideSendQty(3, 5, reason)).toBe(3);
      expect(reasonAllowsRaise(reason)).toBe(false);
    }
  });
  it('cancel / manual / seed / restore / adjust may raise', () => {
    for (const reason of ['cancel', 'manual', 'seed', 'restore', 'adjust']) expect(decideSendQty(8, 5, reason)).toBe(8);
  });
  it('equal -> nothing to send', () => {
    expect(decideSendQty(5, 5, 'manual')).toBeNull();
  });
});

describe('mergePushReason', () => {
  it('keeps the right to raise when collapsing enqueues', () => {
    expect(mergePushReason('cancel', 'sale')).toBe('cancel');
    expect(mergePushReason('sale', 'manual')).toBe('manual');
    expect(mergePushReason('sale', 'remote_adjust')).toBe('remote_adjust');
  });
});

describe('seed', () => {
  it('policy min subtracts reserved units; etsy_master uses Etsy; manual needs input', () => {
    const remote = [
      { channel: 'etsy', qty: 7 },
      { channel: 'trendyol', qty: 5 },
    ];
    expect(computeSeedQty({ policy: 'min', remote, reservedUnits: 2, subtractReserved: true })).toBe(3);
    expect(computeSeedQty({ policy: 'min', remote, reservedUnits: 2, subtractReserved: false })).toBe(5);
    expect(computeSeedQty({ policy: 'etsy_master', remote, reservedUnits: 0, subtractReserved: true })).toBe(7);
    expect(computeSeedQty({ policy: 'manual', remote, reservedUnits: 0, subtractReserved: true })).toBeNull();
    expect(computeSeedQty({ policy: 'min', remote, reservedUnits: 99, subtractReserved: true })).toBe(0);
  });
  it('groupNeedsReview', () => {
    expect(groupNeedsReview([3, 4])).toBe(false);
    expect(groupNeedsReview([0, 4])).toBe(true);
    expect(groupNeedsReview([120, 110])).toBe(true);
    expect(groupNeedsReview([1, 10])).toBe(true);
    expect(groupNeedsReview([])).toBe(true);
  });
  it('backoff schedule', () => {
    expect([1, 2, 3, 4, 5, 6].map(pushBackoffMs)).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000, 7_200_000]);
  });
});

describe('timeline', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 15, 14, m));
  it('a remote drop explained by a later sale is shown as that sale', () => {
    const ledger = [
      { id: 'd', kind: 'remote_adjust', delta: -1, qtyAfter: 9, channel: 'etsy', linkId: 'L', orderKey: null, actor: 'system', note: 'unattributed_drop', createdAt: at(1) },
      { id: 's', kind: 'sale', delta: -1, qtyAfter: 8, channel: 'etsy', linkId: 'L', orderKey: 'etsy:123', actor: 'system', note: 'counted_via_remote_drop:1', createdAt: at(2) },
      { id: 'r', kind: 'remote_adjust', delta: 1, qtyAfter: 9, channel: 'etsy', linkId: 'L', orderKey: 'etsy:123', actor: 'system', note: 'reattributed_to_sale', createdAt: at(2) },
    ];
    const pushes = [{ id: 'p', linkId: 'T', status: 'applied', reason: 'sale', targetQty: 9, freshRemoteQty: 10, sentQty: 9, externalRef: null, lastError: null, createdAt: at(3), appliedAt: at(3), updatedAt: at(3) }];
    const entries = buildTimelineEntries(ledger, pushes, [], new Map([['L', 'etsy'], ['T', 'trendyol']]));
    expect(entries.map((e) => e.kind)).toEqual(['pushApplied', 'sale', 'remoteDropMatched']);
    expect(entries[0].params).toMatchObject({ channel: 'trendyol', from: 10, to: 9 });
    expect(entries[2].params).toMatchObject({ order: '123' });
  });
  it('orderRef', () => {
    expect(orderRef('etsy:4202333842')).toBe('4202333842');
    expect(orderRef('shopify:veeqo:91')).toBe('91');
  });
});

describe('go-live token and typed confirmation', () => {
  it('token is bound to the user and expires after 15 min', () => {
    const now = Date.now();
    const tok = issueConfirmToken('u1', 'hash', true, now);
    expect(verifyConfirmToken(tok, 'u1', now + 1000)).toEqual({ ok: true, planHash: 'hash', requiresTypedConfirm: true });
    expect(verifyConfirmToken(tok, 'u2', now)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyConfirmToken(tok, 'u1', now + 16 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyConfirmToken(tok.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 'u1', now).ok).toBe(false);
    expect(verifyConfirmToken(undefined, 'u1')).toEqual({ ok: false, reason: 'missing' });
  });
  it('typed words in both languages', () => {
    expect(typedMatches('canlı', GO_LIVE_WORDS)).toBe(true);
    expect(typedMatches(' live ', GO_LIVE_WORDS)).toBe(true);
    expect(typedMatches('geri al', RESTORE_WORDS)).toBe(true);
    expect(typedMatches('nope', GO_LIVE_WORDS)).toBe(false);
  });
});

describe('settings', () => {
  it('dry run is active but not live; disabled is neither', () => {
    expect(isStockSyncActive({ enabled: true })).toBe(true);
    expect(isStockLive({ enabled: true, dryRun: true })).toBe(false);
    expect(isStockLive({ enabled: true, dryRun: false })).toBe(true);
    expect(isStockSyncActive({ enabled: false })).toBe(false);
    expect(isStockSyncActive(null)).toBe(false);
  });
  it('global kill switch', () => {
    process.env.STOCK_SYNC_GLOBAL_DISABLE = '1';
    expect(isStockLive({ enabled: true, dryRun: false })).toBe(false);
    delete process.env.STOCK_SYNC_GLOBAL_DISABLE;
  });
  it('sanitizeSettingsPatch drops unknown keys and bad values (enabled/dryRun are not patchable)', () => {
    expect(sanitizeSettingsPatch({ enabled: true, dryRun: false, restockOnCancel: false, etsyZeroStockAction: 'boom', channels: ['etsy', 'x'] })).toEqual({ restockOnCancel: false, channels: ['etsy'] });
  });
});

describe('proposeSku', () => {
  it('builds prefix-listing[-nn]', () => {
    expect(proposeSku('kx', '1234567890', 0, 1)).toBe('KX-4567890');
    expect(proposeSku('', '1234567890', 1, 3)).toBe('KX-4567890-02');
  });
});
