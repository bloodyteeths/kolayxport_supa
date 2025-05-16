import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import prisma from '../../lib/prisma';
import { createServer } from 'http';
import handler from '../../pages/api/orders/sync';

// Mock Supabase auth
vi.mock('../../lib/supabase', () => ({
  getSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null })
    }
  })
}));

// Mock fetchVeeqoOrders to return a known order with line_items
vi.mock('../../lib/veeqoService', () => ({
  fetchVeeqoOrders: async () => ([{
    order: {
      id: 'order1',
      marketplace: 'Veeqo',
      marketplaceKey: 'order1',
      customerName: 'Test Customer',
      status: 'pending',
      created_at: new Date().toISOString(),
    },
    items: [
      {
        remoteLineId: 'li1',
        sku: 'SKU1',
        productName: 'Product 1',
        quantity: 1,
        unitPrice: 10,
        totalPrice: 10,
        image: 'img1.jpg',
        variantInfo: 'Red',
        notes: 'Note 1',
      },
      {
        remoteLineId: 'li2',
        sku: 'SKU2',
        productName: 'Product 2',
        quantity: 2,
        unitPrice: 20,
        totalPrice: 40,
        image: 'img2.jpg',
        variantInfo: 'Blue',
        notes: 'Note 2',
      },
    ],
  }]),
  fetchShippoOrders: async () => ([]),
}));

// Mock userIntegrationSettings
vi.mock('../../lib/prisma', async () => {
  const actual = await vi.importActual<any>('../../lib/prisma');
  return {
    ...actual,
    userIntegrationSettings: {
      findUnique: async () => ({ veeqoApiKey: 'fake', shippoToken: 'fake' }),
    },
  };
});

function runApiHandler(handler) {
  return supertest(createServer((req, res) => handler(req, res)));
}

describe('/api/orders/sync integration', () => {
  beforeAll(async () => {
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
  });
  afterAll(async () => {
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
  });

  it('creates orders and nested items with correct fields', async () => {
    const api = runApiHandler(handler);
    const res = await api.post('/api/orders/sync').send();
    expect(res.status).toBe(200);
    const orders = await prisma.order.findMany({ include: { items: true } });
    expect(orders.length).toBe(1);
    expect(orders[0].items.length).toBe(2);
    expect(orders[0].items[0]).toMatchObject({
      image: 'img1.jpg',
      variantInfo: 'Red',
      notes: 'Note 1',
    });
    expect(orders[0].items[1]).toMatchObject({
      image: 'img2.jpg',
      variantInfo: 'Blue',
      notes: 'Note 2',
    });
  });
}); 