import { describe, it, expect, vi } from 'vitest';
import { diffItem, upsertOrderItems, type UpsertLine } from '@/lib/orders/itemUpsert';

/** Minimal in-memory OrderItem table with Shipment / LabelJob references. */
function fakeDb(rows: any[], refs: { shipments?: string[]; labelJobs?: string[] } = {}) {
  const items = rows.map((r) => ({ ...r }));
  let seq = 0;
  const db = {
    items,
    orderItem: {
      findMany: vi.fn(async ({ where }: any) => items.filter((i) => i.orderId === where.orderId)),
      update: vi.fn(async ({ where, data }: any) => {
        const row = items.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `new-${++seq}`, ...data };
        items.push(row);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.id.in;
        const deletable = ids.filter((id) => !(refs.shipments || []).includes(id) && !(refs.labelJobs || []).includes(id));
        for (const id of deletable) items.splice(items.findIndex((i) => i.id === id), 1);
        return { count: deletable.length };
      }),
    },
  };
  return db;
}

const line = (over: Partial<UpsertLine> = {}): UpsertLine => ({
  lineKey: 'tx-1',
  productName: 'Wooden box',
  quantity: 1,
  unitPrice: 20,
  weightKg: 0.5,
  sku: 'BOX',
  image: 'https://img/1.jpg',
  variantInfo: '',
  notes: '',
  orderNumber: '100',
  ...over,
});

const stored = (over: any = {}) => ({
  id: 'item-1',
  orderId: 'o1',
  uniqueLineKey: 'tx-1',
  remoteLineId: 'tx-1',
  marketplaceKey: 'tx-1',
  productName: 'Wooden box',
  quantity: 1,
  unitPrice: { toString: () => '20.00' },
  totalPrice: { toString: () => '20.00' },
  weightKg: 0.5,
  weightEditedAt: null,
  harmonizedCode: '',
  countryOfMfg: '',
  sku: 'BOX',
  image: 'https://img/1.jpg',
  variantInfo: '',
  notes: '',
  orderNumber: '100',
  shipBy: null,
  listingRef: null,
  variantRef: null,
  variantValueKey: null,
  recipientEmail: null,
  ...over,
});

describe('upsertOrderItems', () => {
  it('re-sync of an unchanged order touches nothing (keeps ids => Shipment/LabelJob rows survive)', async () => {
    const db = fakeDb([stored()]);
    const r = await upsertOrderItems(db as any, 'o1', [line()]);
    expect(r).toMatchObject({ created: 0, updated: 0, unchanged: 1, deleted: 0 });
    expect(db.orderItem.update).not.toHaveBeenCalled();
    expect(db.orderItem.create).not.toHaveBeenCalled();
    expect(db.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it('updates only the changed fields in place', async () => {
    const db = fakeDb([stored()]);
    await upsertOrderItems(db as any, 'o1', [line({ quantity: 2 })]);
    expect(db.orderItem.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { quantity: 2, totalPrice: 40 } });
    expect(db.items[0].id).toBe('item-1');
  });

  it('never overwrites a manual weight edit', async () => {
    const db = fakeDb([stored({ weightKg: 1.2, weightEditedAt: new Date() })]);
    await upsertOrderItems(db as any, 'o1', [line({ weightKg: 0.5 })]);
    expect(db.orderItem.update).not.toHaveBeenCalled();
  });

  it('cancel/line removal after a label: referenced rows are kept, unreferenced stale rows deleted', async () => {
    const db = fakeDb([stored(), stored({ id: 'item-2', uniqueLineKey: 'tx-2', remoteLineId: 'tx-2', marketplaceKey: 'tx-2' }), stored({ id: 'item-3', uniqueLineKey: 'tx-3', remoteLineId: 'tx-3', marketplaceKey: 'tx-3' })], {
      labelJobs: ['item-2'],
    });
    const r = await upsertOrderItems(db as any, 'o1', [line()]);
    expect(db.orderItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['item-2', 'item-3'] }, orderId: 'o1', shipments: { none: {} }, labelJobs: { none: {} } },
    });
    expect(r.deleted).toBe(1);
    expect(r.keptReferenced).toBe(1);
    expect(db.items.map((i) => i.id).sort()).toEqual(['item-1', 'item-2']);
  });

  it('an empty incoming line list never deletes anything', async () => {
    const db = fakeDb([stored()]);
    await upsertOrderItems(db as any, 'o1', []);
    expect(db.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it('creates new lines with a unique remoteLineId (no "" collisions) and matches legacy rows by remoteLineId', async () => {
    const db = fakeDb([stored({ uniqueLineKey: null, marketplaceKey: null })]);
    const r = await upsertOrderItems(db as any, 'o1', [line(), line({ lineKey: '100-1', productName: 'Card' })]);
    expect(r.created).toBe(1);
    const created = db.items.find((i) => i.productName === 'Card');
    expect(created.remoteLineId).toBe('100-1');
    expect(created.uniqueLineKey).toBe('100-1');
    // legacy row got its missing keys filled
    expect(db.items[0].uniqueLineKey).toBe('tx-1');
  });
});

describe('diffItem', () => {
  it('does not blank an existing image when the marketplace sends none', () => {
    expect(diffItem(stored(), line({ image: '' }))).toEqual({});
  });
  it('writes listing/variant refs when they appear', () => {
    expect(diffItem(stored(), line({ listingRef: '123', variantRef: 'abc', variantValueKey: 'def' }))).toEqual({
      listingRef: '123',
      variantRef: 'abc',
      variantValueKey: 'def',
    });
  });
});
