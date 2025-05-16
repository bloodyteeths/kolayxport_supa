import { describe, it, expect } from 'vitest';
import { fetchVeeqoOrders } from '../../lib/veeqoService';

// Minimal Response mock for node-fetch
class MockResponse {
  ok = true;
  status = 200;
  headers = new Map();
  redirected = false;
  statusText = 'OK';
  url = '';
  type = 'default';
  body = null;
  bodyUsed = false;
  constructor(private data: any) {}
  async json() { return this.data; }
  async text() { return JSON.stringify(this.data); }
  clone() { return this; }
  async arrayBuffer() { return new ArrayBuffer(0); }
  async blob() { return new Blob(); }
  async formData() { return new FormData(); }
}

global.fetch = async (url: any, opts: any) => {
  return new MockResponse(mockData) as unknown as Response;
};

let mockData: any[] = [];

describe('fetchVeeqoOrders', () => {
  it('returns zero items for empty line_items', async () => {
    mockData = [{
      id: '1',
      created_at: '2023-01-01T00:00:00Z',
      status: 'pending',
      currency_code: 'USD',
      total_price: 10,
      notes: null,
      deliver_to: {},
      line_items: [],
    }];
    const result = await fetchVeeqoOrders('user1', 'apikey');
    expect(result[0].items).toEqual([]);
  });

  it('maps a single line_item with all fields', async () => {
    mockData = [{
      id: '2',
      created_at: '2023-01-01T00:00:00Z',
      status: 'pending',
      currency_code: 'USD',
      total_price: 20,
      notes: null,
      deliver_to: { first_name: 'A', last_name: 'B' },
      line_items: [{
        id: 'li1',
        quantity: 1,
        price_per_unit: 5,
        total_price: 5,
        title: 'Product',
        notes: 'Note',
        image_url: 'img.jpg',
        sellable: { product_title: 'Product', sku_code: 'SKU', variant_options_string: 'Red' },
      }],
    }];
    const result = await fetchVeeqoOrders('user1', 'apikey');
    expect(result[0].items[0]).toMatchObject({
      remoteLineId: 'li1',
      sku: 'SKU',
      productName: 'Product',
      quantity: 1,
      unitPrice: 5,
      totalPrice: 5,
      image: 'img.jpg',
      variantInfo: 'Red',
      notes: 'Note',
    });
  });

  it('maps multiple line_items', async () => {
    mockData = [{
      id: '3',
      created_at: '2023-01-01T00:00:00Z',
      status: 'pending',
      currency_code: 'USD',
      total_price: 30,
      notes: null,
      deliver_to: { first_name: 'A', last_name: 'B' },
      line_items: [
        { id: 'li1', quantity: 1, price_per_unit: 5, total_price: 5, title: 'P1', notes: 'N1', image_url: 'i1.jpg', sellable: { product_title: 'P1', sku_code: 'S1', variant_options_string: 'V1' } },
        { id: 'li2', quantity: 2, price_per_unit: 10, total_price: 20, title: 'P2', notes: null, image_url: null, sellable: { product_title: 'P2', sku_code: 'S2', variant_options_string: null } },
      ],
    }];
    const result = await fetchVeeqoOrders('user1', 'apikey');
    expect(result[0].items.length).toBe(2);
    expect(result[0].items[0].remoteLineId).toBe('li1');
    expect(result[0].items[1].remoteLineId).toBe('li2');
  });

  it('handles missing sellable or notes gracefully', async () => {
    mockData = [{
      id: '4',
      created_at: '2023-01-01T00:00:00Z',
      status: 'pending',
      currency_code: 'USD',
      total_price: 40,
      notes: null,
      deliver_to: { first_name: 'A', last_name: 'B' },
      line_items: [
        { id: 'li1', quantity: 1, price_per_unit: 5, total_price: 5, title: 'P1', notes: null, image_url: null, sellable: null },
      ],
    }];
    const result = await fetchVeeqoOrders('user1', 'apikey');
    expect(result[0].items[0].sku).toBe('UNKNOWN');
    expect(result[0].items[0].variantInfo).toBeNull();
    expect(result[0].items[0].notes).toBeNull();
  });
}); 