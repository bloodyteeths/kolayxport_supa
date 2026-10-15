// lib/billing/requireFeature: server-side Pro feature gate, mirrors the UI entitlement derivation.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dbUser: null as Record<string, unknown> | null,
  shopifyShops: 0,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: async () => h.dbUser },
    shopifyShop: { count: async () => h.shopifyShops },
  },
}));

import { FeatureLockedError, hasFeature, isFeatureLockedError, requireFeature } from '@/lib/billing/requireFeature';

const DAY = 86_400_000;
const user = (o: Record<string, unknown>) => ({ subscriptionPlan: 'pro', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null, ...o });

beforeEach(() => {
  h.dbUser = user({});
  h.shopifyShops = 0;
});

describe('hasFeature / requireFeature', () => {
  it('pro has bulkPhotoStudio', async () => {
    expect(await hasFeature('u1', 'bulkPhotoStudio')).toEqual({ allowed: true, neutral: false });
    await expect(requireFeature('u1', 'bulkPhotoStudio')).resolves.toMatchObject({ allowed: true });
  });

  it('growth is locked (not neutral) and requireFeature throws the 402 body', async () => {
    h.dbUser = user({ subscriptionPlan: 'growth' });
    expect(await hasFeature('u1', 'bulkPhotoStudio')).toEqual({ allowed: false, neutral: false });
    const err = await requireFeature('u1', 'bulkPhotoStudio').catch((e) => e);
    expect(isFeatureLockedError(err)).toBe(true);
    expect(err).toBeInstanceOf(FeatureLockedError);
    expect(err.status).toBe(402);
    expect(err.body()).toEqual({ error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature: 'bulkPhotoStudio', neutral: false });
  });

  it('an active trial includes it; an expired trial does not', async () => {
    h.dbUser = user({ subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(Date.now() + 5 * DAY) });
    expect((await hasFeature('u1', 'bulkPhotoStudio')).allowed).toBe(true);
    h.dbUser = user({ subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(Date.now() - 30 * DAY) });
    expect((await hasFeature('u1', 'bulkPhotoStudio')).allowed).toBe(false);
  });

  it('shopify_free (provider or an active Shopify store) is locked and neutral', async () => {
    h.shopifyShops = 1;
    expect(await hasFeature('u1', 'bulkPhotoStudio')).toEqual({ allowed: false, neutral: true });
    h.shopifyShops = 0;
    h.dbUser = user({ billingProvider: 'shopify_free' });
    expect((await requireFeature('u1', 'bulkPhotoStudio').catch((e) => e)).neutral).toBe(true);
  });

  it('an unknown user is locked and neutral', async () => {
    h.dbUser = null;
    expect(await hasFeature('nobody', 'bulkPhotoStudio')).toEqual({ allowed: false, neutral: true });
  });
});
