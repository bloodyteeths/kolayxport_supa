import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextApiRequest, NextApiResponse } from 'next';
import { withUsageLimiter } from '../../lib/middleware/withUsageLimiter';
import prisma from '../../lib/prisma';

// Mock dependencies
vi.mock('../../lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../lib/supabase', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => ({ data: { user: { id: 'test-user-id' } } })),
    },
  })),
}));

describe('withUsageLimiter middleware', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;
  let mockHandler: any;

  beforeEach(() => {
    req = {};
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      incrementUsage: undefined,
    };
    mockHandler = vi.fn();
    vi.clearAllMocks();
  });

  describe('Order Sync Usage Limiting', () => {
    const wrappedHandler = withUsageLimiter(mockHandler, 'orderSync');

    it('should allow sync when under trial limit', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'trialing',
        subscriptionPlan: null,
        orderSyncCount: 10,
        labelCount: 0,
        trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).toHaveBeenCalled();
      expect(res.incrementUsage).toBeDefined();
      expect(res.status).not.toHaveBeenCalledWith(402);
    });

    it('should block sync when trial limit exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'trialing',
        subscriptionPlan: null,
        orderSyncCount: 50, // Trial limit is 50
        labelCount: 0,
        trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Payment Required',
        details: 'Trial limit reached.',
      });
    });

    it('should allow sync for active starter plan under limit', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'active',
        subscriptionPlan: 'starter',
        orderSyncCount: 150, // Starter limit is 200
        labelCount: 0,
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).toHaveBeenCalled();
      expect(res.incrementUsage).toBeDefined();
    });

    it('should block sync when starter plan limit exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'active',
        subscriptionPlan: 'starter',
        orderSyncCount: 200, // Starter limit is 200
        labelCount: 0,
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Payment Required',
        details: 'orderSync limit reached for your plan.',
      });
    });

    it('should increment orderSyncCount when incrementUsage is called', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'active',
        subscriptionPlan: 'starter',
        orderSyncCount: 100,
        labelCount: 0,
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);
      
      // Verify incrementUsage function was attached
      expect(res.incrementUsage).toBeDefined();
      
      // Call incrementUsage
      await res.incrementUsage!();
      
      // Verify the database update
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: { orderSyncCount: { increment: 1 } },
      });
    });
  });

  describe('Label Generation Usage Limiting', () => {
    const wrappedHandler = withUsageLimiter(mockHandler, 'label');

    it('should allow label generation when under trial limit', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'trialing',
        subscriptionPlan: null,
        orderSyncCount: 0,
        labelCount: 5, // Trial limit is 10
        trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).toHaveBeenCalled();
      expect(res.incrementUsage).toBeDefined();
    });

    it('should block label generation when growth plan limit exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'active',
        subscriptionPlan: 'growth',
        orderSyncCount: 0,
        labelCount: 500, // Growth limit is 500
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Payment Required',
        details: 'label limit reached for your plan.',
      });
    });

    it('should increment labelCount when incrementUsage is called', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'active',
        subscriptionPlan: 'growth',
        orderSyncCount: 0,
        labelCount: 100,
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);
      
      // Call incrementUsage
      await res.incrementUsage!();
      
      // Verify the database update
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: { labelCount: { increment: 1 } },
      });
    });

    it('should allow unlimited usage for enterprise plan', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'active',
        subscriptionPlan: 'enterprise',
        orderSyncCount: 10000,
        labelCount: 10000,
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).toHaveBeenCalled();
      expect(res.incrementUsage).toBeDefined();
      expect(res.status).not.toHaveBeenCalledWith(402);
    });
  });

  describe('Edge Cases', () => {
    const wrappedHandler = withUsageLimiter(mockHandler, 'orderSync');

    it('should block access when trial has expired', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'trialing',
        subscriptionPlan: null,
        orderSyncCount: 10,
        labelCount: 0,
        trialExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Payment Required',
        details: 'No active subscription.',
      });
    });

    it('should block access when subscription is not active', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        subscriptionStatus: 'canceled',
        subscriptionPlan: 'starter',
        orderSyncCount: 10,
        labelCount: 0,
        trialExpiresAt: null,
      });

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    });

    it('should handle user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await wrappedHandler(req as NextApiRequest, res as NextApiResponse);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Payment Required',
        details: 'User not found',
      });
    });
  });
});