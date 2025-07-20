import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import supertest from 'supertest';
import prisma from '../../lib/prisma';
import syncHandler from '../../pages/api/orders/sync';
import upsHandler from '../../pages/api/labels/ups';
import fedexHandler from '../../pages/api/orders/[orderId]/generate-label';

// Mock Supabase auth
vi.mock('../../lib/supabase', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => ({ 
        data: { user: { id: 'test-user-id' } }, 
        error: null 
      })),
    },
  })),
}));

// Mock order sync functionality
vi.mock('../../lib/orderSync', () => ({
  syncAllOrders: vi.fn(() => ({
    newOrders: 5,
    updatedOrders: 2,
    skippedOrders: 0,
    failedOrders: 0,
    errors: [],
  })),
}));

// Mock UPS functionality  
vi.mock('../../lib/ups/ups.credentials', () => ({
  getUpsCredentialsForUser: vi.fn(() => ({
    upsApiKey: 'test-key',
    upsApiSecret: 'test-secret',
    upsAccountNumber: 'test-account',
  })),
}));

vi.mock('../../lib/ups/createUpsShipment', () => ({
  createUpsShipment: vi.fn(() => ({
    success: true,
    trackingNumber: 'TEST123456',
    labelUrl: 'https://test.com/label.pdf',
  })),
}));

describe('Usage Limiting Integration Tests', () => {
  let testUserId = 'test-user-id';

  beforeEach(async () => {
    // Clean up test data
    await prisma.shipment.deleteMany({ where: { order: { userId: testUserId } } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: testUserId } } });
    await prisma.order.deleteMany({ where: { userId: testUserId } });
    await prisma.credential.deleteMany({ where: { userId: testUserId } });
    await prisma.shipperProfile.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe('Order Sync API with Usage Limiting', () => {
    it('should successfully sync orders and increment counter for trial user', async () => {
      // Setup trial user with some usage
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'trialing',
          orderSyncCount: 10,
          labelCount: 0,
          trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Setup credentials
      await prisma.credential.create({
        data: {
          userId: testUserId,
          veeqoApiKey: 'test-veeqo-key',
        },
      });

      const api = supertest(createServer((req, res) => syncHandler(req, res)));
      const response = await api.post('/api/orders/sync').send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        newOrders: expect.any(Number),
        updatedOrders: expect.any(Number),
      });

      // Verify counter was incremented
      const updatedUser = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.orderSyncCount).toBe(11);
    });

    it('should return 402 when trial sync limit exceeded', async () => {
      // Setup trial user at limit
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'trialing',
          orderSyncCount: 50, // At trial limit
          labelCount: 0,
          trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const api = supertest(createServer((req, res) => syncHandler(req, res)));
      const response = await api.post('/api/orders/sync').send({});

      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({
        error: 'Payment Required',
        details: 'Trial limit reached.',
      });

      // Verify counter was NOT incremented
      const updatedUser = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.orderSyncCount).toBe(50);
    });

    it('should allow unlimited syncs for enterprise plan', async () => {
      // Setup enterprise user with high usage
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'active',
          subscriptionPlan: 'enterprise',
          orderSyncCount: 10000,
          labelCount: 5000,
        },
      });

      await prisma.credential.create({
        data: {
          userId: testUserId,
          veeqoApiKey: 'test-veeqo-key',
        },
      });

      const api = supertest(createServer((req, res) => syncHandler(req, res)));
      const response = await api.post('/api/orders/sync').send({});

      expect(response.status).toBe(200);
    });
  });

  describe('UPS Label API with Usage Limiting', () => {
    it('should generate label and increment counter for active starter user', async () => {
      // Setup active starter user
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'active',
          subscriptionPlan: 'starter',
          orderSyncCount: 0,
          labelCount: 50, // Under starter limit of 100
        },
      });

      // Setup required data
      await prisma.shipperProfile.create({
        data: {
          userId: testUserId,
          shipperName: 'Test Company',
          shipperPersonName: 'Test Person',
          shipperPhoneNumber: '1234567890',
          shipperStreet1: '123 Test St',
          shipperCity: 'Test City',
          shipperStateCode: 'CA',
          shipperPostalCode: '12345',
          shipperCountryCode: 'US',
        },
      });

      const orderId = 'test-order-id';
      await prisma.order.create({
        data: {
          id: orderId,
          userId: testUserId,
          marketplaceOrderId: 'MARKET-123',
          marketplace: 'test',
          orderDate: new Date(),
          shipByDate: new Date(),
          status: 'pending',
        },
      });

      const api = supertest(createServer((req, res) => upsHandler(req, res)));
      const response = await api.post('/api/labels/ups').send({
        userId: testUserId,
        orderId: orderId,
        recipient: {
          name: 'John Doe',
          street1: '456 Test Ave',
          city: 'Test Town',
          state: 'NY',
          postal: '54321',
          country: 'US',
          phone: '9876543210',
        },
        package: {
          weight: 1.5,
        },
        serviceType: '03',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        trackingNumber: expect.any(String),
        labelUrl: expect.any(String),
      });

      // Verify counter was incremented
      const updatedUser = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.labelCount).toBe(51);
    });

    it('should return 402 when starter label limit exceeded', async () => {
      // Setup starter user at limit
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'active',
          subscriptionPlan: 'starter',
          orderSyncCount: 0,
          labelCount: 100, // At starter limit
        },
      });

      const api = supertest(createServer((req, res) => upsHandler(req, res)));
      const response = await api.post('/api/labels/ups').send({
        userId: testUserId,
        orderId: 'test-order',
        recipient: {},
        package: {},
        serviceType: '03',
      });

      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({
        error: 'Payment Required',
        details: 'label limit reached for your plan.',
      });
    });
  });

  describe('FedEx Label API with Usage Limiting', () => {
    it('should return 402 when growth plan label limit exceeded', async () => {
      // Setup growth user at limit
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'active',
          subscriptionPlan: 'growth',
          orderSyncCount: 0,
          labelCount: 500, // At growth limit
        },
      });

      const api = supertest(createServer((req, res) => {
        // Simulate the orderId from URL params
        req.query = { orderId: 'test-order-id' };
        return fedexHandler(req, res);
      }));
      
      const response = await api.post('/api/orders/test-order-id/generate-label').send({
        line_items: [{ id: '1', title: 'Test Item' }],
      });

      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({
        error: 'Payment Required',
        details: 'label limit reached for your plan.',
      });
    });
  });

  describe('Trial Expiration', () => {
    it('should block all operations when trial expired', async () => {
      // Setup expired trial user
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test@example.com',
          subscriptionStatus: 'trialing',
          orderSyncCount: 10,
          labelCount: 5,
          trialExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
        },
      });

      // Test sync API
      const syncApi = supertest(createServer((req, res) => syncHandler(req, res)));
      const syncResponse = await syncApi.post('/api/orders/sync').send({});
      expect(syncResponse.status).toBe(402);

      // Test label API
      const labelApi = supertest(createServer((req, res) => upsHandler(req, res)));
      const labelResponse = await labelApi.post('/api/labels/ups').send({});
      expect(labelResponse.status).toBe(402);
    });
  });
});