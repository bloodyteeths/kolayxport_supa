// lib/billing/requireFeature.ts — server-side Pro feature gate (pro-gating §1 "server first").
//
// The decision mirrors what the UI shows: the account's plan is read from the same User fields
// `/api/user/settings` returns, an active ShopifyShop (or the shopify_free provider) makes the account
// shopify_free, and `entitlementFromSettings` + PLAN_FEATURES decide the feature. So UI and server agree.
//
//   hasFeature(userId, feature)      → { allowed, neutral }   (never throws on "locked")
//   requireFeature(userId, feature)  → resolves when allowed, throws FeatureLockedError otherwise
//
// A route maps FeatureLockedError to:
//   402 { error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature, neutral }
// `neutral` = use Shopify-safe wording (no plans, no prices).
import prisma from '@/lib/prisma';
import { entitlementFromSettings } from './entitlementCore';
import { isNeutralBilling } from './billingState';
import type { Entitlement, Feature } from './types';

export interface FeatureAccess {
  allowed: boolean;
  neutral: boolean;
}

export class FeatureLockedError extends Error {
  readonly status = 402;
  constructor(readonly feature: Feature, readonly neutral: boolean) {
    super(`Feature ${feature} is not included in this plan`);
    this.name = 'FeatureLockedError';
  }

  /** The 402 body the UI's limit interceptor understands. */
  body() {
    return { error: 'Payment Required', limitType: 'feature' as const, reason: 'featureLocked' as const, feature: this.feature, neutral: this.neutral };
  }
}

export function isFeatureLockedError(err: unknown): err is FeatureLockedError {
  return Boolean(err) && (err as { name?: unknown }).name === 'FeatureLockedError';
}

/** The account's entitlement as the UI derives it (plan, state, features); null for an unknown user. */
export async function accountEntitlement(userId: string, now: Date = new Date()): Promise<{ ent: Entitlement; neutral: boolean; shopify: boolean } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionPlan: true, subscriptionStatus: true, billingInterval: true, billingProvider: true, trialExpiresAt: true },
  });
  if (!user) return null;
  const activeShopify = await prisma.shopifyShop.count({ where: { userId, isActive: true } });
  const shopify = user.billingProvider === 'shopify_free' || activeShopify > 0;
  const ent = entitlementFromSettings({
    subscriptionPlan: shopify ? 'shopify_free' : user.subscriptionPlan,
    subscriptionStatus: shopify ? 'active' : user.subscriptionStatus,
    billingInterval: user.billingInterval,
    billingProvider: shopify ? 'shopify_free' : user.billingProvider,
    trialExpiresAt: user.trialExpiresAt ? new Date(user.trialExpiresAt).toISOString() : null,
  }, now);
  if (!ent) return null;
  return { ent, neutral: isNeutralBilling(ent), shopify };
}

/** Non-throwing check. An unknown user is locked (and neutral, so no prices are shown). */
export async function hasFeature(userId: string, feature: Feature, now: Date = new Date()): Promise<FeatureAccess> {
  const a = await accountEntitlement(userId, now);
  if (!a) return { allowed: false, neutral: true };
  return { allowed: a.ent.features[feature] === true, neutral: a.neutral };
}

/** Throws FeatureLockedError unless the account's plan includes `feature`. */
export async function requireFeature(userId: string, feature: Feature, now: Date = new Date()): Promise<FeatureAccess> {
  const access = await hasFeature(userId, feature, now);
  if (!access.allowed) throw new FeatureLockedError(feature, access.neutral);
  return access;
}
