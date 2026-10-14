/**
 * Engine idempotency with an in-memory fake of the Prisma calls the engine
 * makes (no DB). Covers: duplicate sale dedupe, sale_adjust oscillation,
 * cancel once, unattributed-drop absorption, manual adjust.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const db = vi.hoisted(() => ({ items: new Map<string, Row>(), links: new Map<string, Row>(), ledger: [] as Row[] }));

vi.mock('@/lib/prisma', () => {
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (!sql.includes('INSERT INTO "StockLedger"')) throw new Error('unexpected raw sql');
      const [id, userId, stockItemId, kind, delta, qtyAfter, channel, linkId, orderId, orderKey, idempotencyKey, sourceEventId, actor, note] = values;
      if (db.ledger.some((l) => l.idempotencyKey === idempotencyKey)) return [];
      db.ledger.push({ id, userId, stockItemId, kind, delta, qtyAfter, channel, linkId, orderId, orderKey, idempotencyKey, sourceEventId, actor, note, createdAt: new Date() });
      return [{ id }];
    },
    stockItem: {
      findUnique: async ({ where }: any) => (db.items.has(where.id) ? { ...db.items.get(where.id) } : null),
      update: async ({ where, data }: any) => Object.assign(db.items.get(where.id)!, data),
    },
    stockLink: {
      findFirst: async ({ where }: any) => {
        const l = db.links.get(where.id);
        return l && l.stockItemId === where.stockItemId && l.userId === where.userId ? { ...l } : null;
      },
      update: async ({ where, data }: any) => Object.assign(db.links.get(where.id)!, data),
    },
    stockLedger: {
      findMany: async ({ where }: any) =>
        db.ledger.filter((l) => l.orderKey === where.orderKey && l.stockItemId === where.stockItemId && where.kind.in.includes(l.kind)).map((l) => ({ delta: l.delta })),
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: any) => fn(tx),
    stockItem: { ...tx.stockItem, findUnique: async ({ where }: any) => (db.items.has(where.id) ? { ...db.items.get(where.id), links: [] } : null) },
  };
  return { default: prisma };
});
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => undefined), resolve: vi.fn(async () => undefined) }));
vi.mock('@/lib/live/publish', () => ({ publishLive: vi.fn() }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: async () => null, isStockSyncActive: () => false, channelEnabled: () => true }));

import { applyCancel, applySaleDesired, manualAdjust, seedItem } from '@/lib/stock/engine';

const U = 'user-1';

beforeEach(() => {
  db.items.clear();
  db.links.clear();
  db.ledger.length = 0;
  db.items.set('i1', { id: 'i1', userId: U, sku: 'A', displaySku: 'A', onHand: 10, safetyBuffer: 0, tracking: 'tracked', status: 'active', seededAt: new Date() });
  db.links.set('L', { id: 'L', userId: U, stockItemId: 'i1', channel: 'etsy', unitsPerSale: 1, unattributedDrop: 0, unattributedDropSince: null, lastSeenRemoteQty: 10 });
});

const sale = (desiredUnits: number, orderKey = 'etsy:1') =>
  applySaleDesired({ userId: U, stockItemId: 'i1', orderKey, desiredUnits, channel: 'etsy', originLinkId: 'L' });

describe('engine idempotency', () => {
  it('the same order seen 4 times (webhook, poll, scan, Veeqo copy) counts once', async () => {
    expect((await sale(2)).status).toBe('applied');
    expect((await sale(2)).status).toBe('deduped');
    expect((await sale(2)).status).toBe('deduped');
    expect((await sale(2)).status).toBe('deduped');
    expect(db.items.get('i1')!.onHand).toBe(8);
    expect(db.ledger.filter((l) => l.kind === 'sale')).toHaveLength(1);
    expect(db.links.get('L')!.lastSeenRemoteQty).toBe(8); // expected state lowered on the origin
  });

  it('sale_adjust oscillation 2 -> 3 -> 2 -> 3 nets correctly', async () => {
    await sale(2);
    await sale(3);
    await sale(2);
    await sale(3);
    expect(db.items.get('i1')!.onHand).toBe(7);
    const sum = db.ledger.filter((l) => ['sale', 'sale_adjust'].includes(l.kind)).reduce((s, l) => s + l.delta, 0);
    expect(sum).toBe(-3);
  });

  it('cancel restocks exactly what was sold, once', async () => {
    await sale(2);
    expect((await applyCancel({ userId: U, stockItemId: 'i1', orderKey: 'etsy:1' })).status).toBe('applied');
    expect((await applyCancel({ userId: U, stockItemId: 'i1', orderKey: 'etsy:1' })).status).toBe('noop');
    expect(db.items.get('i1')!.onHand).toBe(10);
  });

  it('cancel of an order never sold is a no-op', async () => {
    expect((await applyCancel({ userId: U, stockItemId: 'i1', orderKey: 'etsy:9' })).status).toBe('noop');
    expect(db.items.get('i1')!.onHand).toBe(10);
  });

  it('a sale already counted as an unattributed drop is absorbed (no double decrement)', async () => {
    // Observation already lowered onHand 10 -> 9 and recorded the drop.
    db.items.get('i1')!.onHand = 9;
    Object.assign(db.links.get('L')!, { unattributedDrop: 1, unattributedDropSince: new Date(), lastSeenRemoteQty: 9 });
    await sale(1);
    expect(db.items.get('i1')!.onHand).toBe(9);
    expect(db.links.get('L')!.unattributedDrop).toBe(0);
    expect(db.links.get('L')!.lastSeenRemoteQty).toBe(9);
    const kinds = db.ledger.map((l) => `${l.kind}:${l.delta}`);
    expect(kinds).toEqual(['sale:-1', 'remote_adjust:1']);
  });

  it('owner mismatch throws (tenant safety)', async () => {
    await expect(applySaleDesired({ userId: 'other', stockItemId: 'i1', orderKey: 'etsy:1', desiredUnits: 1 })).rejects.toThrow('stock_item_owner_mismatch');
  });

  it('manual adjust and seed', async () => {
    expect((await manualAdjust({ userId: U, stockItemId: 'i1', setTo: 4, actor: 'user:u' })).onHandAfter).toBe(4);
    expect((await manualAdjust({ userId: U, stockItemId: 'i1', delta: 3, actor: 'user:u' })).onHandAfter).toBe(7);
    expect((await manualAdjust({ userId: U, stockItemId: 'i1', setTo: 7, actor: 'user:u' })).status).toBe('noop');
    expect((await seedItem({ userId: U, stockItemId: 'i1', qty: 20, actor: 'user:u', idempotencyKey: 'seed:x' })).onHandAfter).toBe(20);
    expect((await seedItem({ userId: U, stockItemId: 'i1', qty: 20, actor: 'user:u', idempotencyKey: 'seed:x' })).status).toBe('deduped');
  });
});
