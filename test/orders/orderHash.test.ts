import { describe, it, expect } from 'vitest';
import { computeItemsHash, computeOrderHash, itemsHashFromDbRows, lineKeyFor } from '@/lib/orders/orderHash';
import { linesFromUIOrder } from '@/lib/orders/itemUpsert';

describe('computeOrderHash', () => {
  const base = { status: 'PAID', externalStatus: 'Paid', totalPrice: 25.5, trackingNumber: null, shipByAt: new Date('2026-10-16T10:00:00Z') };

  it('is stable for equivalent inputs (case, number formatting, seconds)', () => {
    expect(computeOrderHash(base)).toBe(
      computeOrderHash({ status: 'paid', externalStatus: 'PAID', totalPrice: '25.50', trackingNumber: '', shipByAt: '2026-10-16T10:00:42Z' }),
    );
  });

  it('changes when status, total, tracking or ship-by change', () => {
    const h = computeOrderHash(base);
    expect(computeOrderHash({ ...base, status: 'SHIPPED' })).not.toBe(h);
    expect(computeOrderHash({ ...base, totalPrice: 26 })).not.toBe(h);
    expect(computeOrderHash({ ...base, trackingNumber: '1Z999' })).not.toBe(h);
    expect(computeOrderHash({ ...base, shipByAt: new Date('2026-10-17T10:00:00Z') })).not.toBe(h);
  });

  it('accepts Prisma Decimal-like totals', () => {
    expect(computeOrderHash({ ...base, totalPrice: { toString: () => '25.5' } })).toBe(computeOrderHash(base));
  });
});

describe('computeItemsHash', () => {
  const lines = [
    { lineKey: 'tx-1', quantity: 1, unitPrice: 10, sku: 'A', image: 'https://img/1.jpg' },
    { lineKey: 'tx-2', quantity: 2, unitPrice: 5, sku: 'B', image: '' },
  ];

  it('is order-independent', () => {
    expect(computeItemsHash(lines)).toBe(computeItemsHash([...lines].reverse()));
  });

  it('only cares whether an image is present, not which URL', () => {
    expect(computeItemsHash(lines)).toBe(computeItemsHash([{ ...lines[0], image: 'https://img/other.jpg' }, lines[1]]));
    expect(computeItemsHash(lines)).not.toBe(computeItemsHash([{ ...lines[0], image: '' }, lines[1]]));
  });

  it('changes with quantity, price, sku and line set', () => {
    const h = computeItemsHash(lines);
    expect(computeItemsHash([{ ...lines[0], quantity: 3 }, lines[1]])).not.toBe(h);
    expect(computeItemsHash([{ ...lines[0], unitPrice: 11 }, lines[1]])).not.toBe(h);
    expect(computeItemsHash([{ ...lines[0], sku: 'Z' }, lines[1]])).not.toBe(h);
    expect(computeItemsHash([lines[0]])).not.toBe(h);
  });
});

describe('null-hash rollout: stored rows hash like incoming lines', () => {
  it('a UI order and its stored items produce the same itemsHash (no rewrite on first sync)', () => {
    const ui = {
      marketplaceKey: '3456',
      orderNumber: '3456',
      line_items: [
        { id: '111', title: 'Box', value: 19.99, quantity: 1, weight: 0.5, sku: 'BOX-1', image: 'https://i/1.jpg' },
        { id: '', title: 'Card', value: 2, quantity: 3, weight: 0.1, sku: '', image: '' },
      ],
    };
    const lines = linesFromUIOrder(ui);
    expect(lines.map((l) => l.lineKey)).toEqual(['111', '3456-1']);
    const incoming = computeItemsHash(lines.map((l) => ({ lineKey: l.lineKey, quantity: l.quantity, unitPrice: l.unitPrice, sku: l.sku, image: l.image })));

    // Rows as the legacy writer stored them: remoteLineId '' for the id-less line, key in uniqueLineKey, Decimal prices.
    const stored = itemsHashFromDbRows([
      { id: 'a', uniqueLineKey: '111', remoteLineId: '111', quantity: 1, unitPrice: { toString: () => '19.99' }, sku: 'BOX-1', image: 'https://i/1.jpg' },
      { id: 'b', uniqueLineKey: '3456-1', remoteLineId: '', quantity: 3, unitPrice: { toString: () => '2.00' }, sku: '', image: '' },
    ]);
    expect(stored).toBe(incoming);
  });

  it('lineKeyFor falls back to `${orderKey}-${index}`', () => {
    expect(lineKeyFor(undefined, 'K', 2)).toBe('K-2');
    expect(lineKeyFor(' 9 ', 'K', 2)).toBe('9');
  });
});
