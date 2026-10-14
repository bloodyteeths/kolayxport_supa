import { describe, expect, it } from 'vitest';
import { buildOrderLiveEvent, publishLive, publishOrderEvent } from '@/lib/live/publish';

describe('live publish stubs', () => {
  it('never throw', () => {
    expect(() => publishLive('', null as any)).not.toThrow();
    expect(() => publishLive('u1', { type: 'invalidate', keys: ['/api/orders'] })).not.toThrow();
    expect(() => publishOrderEvent('u1', null as any, 'new')).not.toThrow();
    expect(() => publishOrderEvent('u1', { id: 'o1' }, 'new')).not.toThrow();
  });

  it('builds a JSON-safe order event', () => {
    const ev = buildOrderLiveEvent(
      {
        id: 'o1',
        marketplace: 'etsy',
        marketplaceKey: '123',
        orderNumber: '123',
        source: 'etsy-api',
        status: 'pending',
        customerName: 'Jane',
        totalPrice: { toString: () => '42.50' },
        currency: 'USD',
        createdAt: new Date('2026-10-15T10:00:00Z'),
        items: [{ quantity: 2 }, { quantity: null }],
      },
      'new',
    );
    expect(ev).toEqual({
      type: 'order',
      kind: 'new',
      order: {
        id: 'o1',
        marketplace: 'etsy',
        marketplaceKey: '123',
        orderNumber: '123',
        source: 'etsy-api',
        status: 'pending',
        customerName: 'Jane',
        totalPrice: 42.5,
        currency: 'USD',
        itemCount: 3,
        createdAt: '2026-10-15T10:00:00.000Z',
        uiOrderDate: null,
        shipByAt: null,
      },
    });
    expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
  });
});
