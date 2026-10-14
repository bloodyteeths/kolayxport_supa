import { describe, expect, it, vi } from 'vitest';

// observe.ts pulls in prisma / notifications / live; the pure helpers under test need none of them.
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolve: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishLive: vi.fn() }));

import { classifyObservation, splitSaleAgainstOrigin } from '@/lib/stock/math';
import { matchOfferingForLink } from '@/lib/stock/observe';

/**
 * Tiny in-memory model of the hub + one Etsy origin link, driven only by the
 * pure functions the engine uses (classifyObservation / splitSaleAgainstOrigin).
 */
function model(onHand: number, lastSeen: number) {
  const s = { onHand, lastSeen: lastSeen as number | null, lastSeenTs: 100 as number | null, drop: 0 };
  return {
    s,
    observe(R: number, ts: number, echo = false) {
      const c = classifyObservation({ remoteQty: R, remoteUpdatedTs: ts, lastSeenRemoteQty: s.lastSeen, lastSeenRemoteTs: s.lastSeenTs, isOwnEcho: echo });
      if (c.kind === 'stale_ignored') return c.kind;
      if (c.kind === 'unattributed_drop') {
        s.onHand += c.delta!;
        s.drop += -c.delta!;
      }
      s.lastSeen = R;
      s.lastSeenTs = Math.max(ts, s.lastSeenTs ?? 0);
      return c.kind;
    },
    sale(qty: number) {
      const r = splitSaleAgainstOrigin({ qty, unitsPerSale: 1, unattributedDrop: s.drop, lastSeenRemoteQty: s.lastSeen });
      s.onHand += r.netOnHandDelta;
      s.drop = r.nextUnattributedDrop;
      s.lastSeen = r.nextLastSeenRemoteQty;
      return r;
    },
  };
}

describe('classifyObservation', () => {
  it('baseline on first sight', () => {
    expect(classifyObservation({ remoteQty: 5, remoteUpdatedTs: 10, lastSeenRemoteQty: null, lastSeenRemoteTs: null, isOwnEcho: false }).kind).toBe('baseline');
  });
  it('stale when older than what we saw', () => {
    expect(classifyObservation({ remoteQty: 3, remoteUpdatedTs: 9, lastSeenRemoteQty: 5, lastSeenRemoteTs: 10, isOwnEcho: false }).kind).toBe('stale_ignored');
  });
  it('echo wins over a delta', () => {
    expect(classifyObservation({ remoteQty: 3, remoteUpdatedTs: 11, lastSeenRemoteQty: 5, lastSeenRemoteTs: 10, isOwnEcho: true }).kind).toBe('echo');
  });
  it('expected / drop / increase', () => {
    const base = { remoteUpdatedTs: 11, lastSeenRemoteQty: 5, lastSeenRemoteTs: 10, isOwnEcho: false };
    expect(classifyObservation({ ...base, remoteQty: 5 })).toEqual({ kind: 'expected', delta: 0 });
    expect(classifyObservation({ ...base, remoteQty: 3 })).toEqual({ kind: 'unattributed_drop', delta: -2 });
    expect(classifyObservation({ ...base, remoteQty: 8 })).toEqual({ kind: 'increase_alert', delta: 3 });
  });
});

describe('sale vs remote drop ordering (counts once)', () => {
  it('drop seen first, order second: onHand reduced exactly once', () => {
    const m = model(10, 5);
    expect(m.observe(4, 101)).toBe('unattributed_drop');
    expect(m.s.onHand).toBe(9);
    const r = m.sale(1);
    expect(r.absorbedQty).toBe(1);
    expect(m.s.onHand).toBe(9);
    expect(m.s.drop).toBe(0);
    // 7 days later an unrelated refresh shows the same 4 -> nothing more.
    expect(m.observe(4, 999999)).toBe('expected');
    expect(m.s.onHand).toBe(9);
  });

  it('order first, drop second: onHand reduced exactly once', () => {
    const m = model(10, 5);
    m.sale(1);
    expect(m.s.onHand).toBe(9);
    expect(m.s.lastSeen).toBe(4);
    expect(m.observe(4, 101)).toBe('expected');
    expect(m.s.onHand).toBe(9);
  });

  it('partial absorption: 2 sold, only 1 seen as a drop', () => {
    const m = model(10, 5);
    m.observe(4, 101);
    const r = m.sale(2);
    expect(r).toMatchObject({ absorbedQty: 1, restQty: 1 });
    expect(m.s.onHand).toBe(8);
    expect(m.s.lastSeen).toBe(3);
    expect(m.observe(3, 102)).toBe('expected');
    expect(m.s.onHand).toBe(8);
  });

  it('our own push echo produces no ledger movement', () => {
    const m = model(10, 5);
    expect(m.observe(4, 101, true)).toBe('echo');
    expect(m.s.onHand).toBe(10);
    expect(m.s.lastSeen).toBe(4);
  });

  it('an increase is never adopted automatically', () => {
    const m = model(10, 5);
    expect(m.observe(9, 101)).toBe('increase_alert');
    expect(m.s.onHand).toBe(10);
  });

  it('units per sale scale the hub delta', () => {
    const r = splitSaleAgainstOrigin({ qty: 2, unitsPerSale: 3, unattributedDrop: 1, lastSeenRemoteQty: 10 });
    expect(r).toMatchObject({ absorbedQty: 1, restQty: 1, saleUnits: 6, absorbedUnits: 3, netOnHandDelta: -3, nextLastSeenRemoteQty: 9 });
  });
});

describe('matchOfferingForLink', () => {
  const offerings = [
    { variantKey: 'k1', variantValueKey: 'v1', productId: null, sku: 'ABC-1', quantity: 3, isEnabled: true },
    { variantKey: 'k2', variantValueKey: 'v2', productId: null, sku: 'abc-2', quantity: 0, isEnabled: false },
  ];
  it('matches by variantKey', () => {
    expect(matchOfferingForLink({ variantRef: 'k2', variantValueKey: null, remoteSku: null }, offerings)?.offering.sku).toBe('abc-2');
  });
  it('re-points by unique variantValueKey', () => {
    const m = matchOfferingForLink({ variantRef: 'gone', variantValueKey: 'v1', remoteSku: null }, offerings);
    expect(m).toMatchObject({ repoint: true });
    expect(m?.offering.variantKey).toBe('k1');
  });
  it('falls back to normalized SKU', () => {
    expect(matchOfferingForLink({ variantRef: 'gone', variantValueKey: null, remoteSku: 'ABC-2' }, offerings)?.offering.variantKey).toBe('k2');
  });
  it('shared quantity link takes the minimum enabled offering', () => {
    expect(matchOfferingForLink({ variantRef: '*', variantValueKey: null, remoteSku: null }, offerings)?.offering.quantity).toBe(3);
  });
  it('no match -> null', () => {
    expect(matchOfferingForLink({ variantRef: 'x', variantValueKey: 'y', remoteSku: 'zzz' }, offerings)).toBeNull();
  });
});
