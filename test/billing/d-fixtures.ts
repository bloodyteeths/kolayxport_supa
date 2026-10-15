// Entitlement fixtures for the group D / G-pro-2 tests (settings §9.3 rows, pro-gating §2 columns).
import type { Entitlement } from '@/lib/billing/types';

export const NOW = new Date('2026-10-15T09:00:00Z');
const day = 86_400_000;
export const inDays = (n: number) => new Date(NOW.getTime() + n * day).toISOString();

const ON = { arbitrage: true, financials: true, bulkPhotoStudio: true };
const OFF = { arbitrage: false, financials: false, bulkPhotoStudio: false };

export function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    plan: 'growth',
    state: 'active',
    stripeUpsell: true,
    interval: 'month',
    currency: 'TRY',
    foundingMember: false,
    trialEndsAt: null,
    graceEndsAt: null,
    currentPeriodEnd: inDays(17),
    cancelAtPeriodEnd: false,
    period: { start: inDays(-13), end: inDays(17) },
    meters: {
      orders: { used: 1442, limit: 2000 },
      labels: { used: 400, limit: 1000 },
      connectedStores: { used: 3, limit: 5 },
      aiCredits: { used: 610, limit: 1500 },
    },
    features: OFF,
    ...over,
  };
}

export const F = {
  trial: () => ent({
    plan: 'trial', state: 'trial', interval: null, currency: null, trialEndsAt: inDays(14), currentPeriodEnd: null,
    period: { start: inDays(0), end: inDays(14) }, features: ON,
    meters: { orders: { used: 96, limit: 150 }, labels: { used: 12, limit: 30 }, connectedStores: { used: 2, limit: 3 }, aiCredits: { used: 41, limit: 100 } },
  }),
  trialEnding: () => ent({ ...F.trial(), trialEndsAt: inDays(2) }),
  grace: () => ent({ ...F.trial(), state: 'grace', trialEndsAt: inDays(-1), graceEndsAt: inDays(2) }),
  expired: () => ent({ plan: 'trial', state: 'expired', interval: null, currency: null, trialEndsAt: inDays(-10), period: null, features: OFF }),
  growth: () => ent(),
  growthFounding: () => ent({ foundingMember: true, meters: { ...ent().meters, labels: { used: 820, limit: 1000 } } }),
  growthCanceling: () => ent({ cancelAtPeriodEnd: true }),
  pastDue: () => ent({ state: 'past_due_grace', graceEndsAt: inDays(3) }),
  pro: () => ent({ plan: 'pro', features: ON, meters: { orders: { used: 10, limit: 6000 } } }),
  enterprise: () => ent({ plan: 'enterprise', state: 'enterprise', stripeUpsell: false, features: ON, meters: { orders: { used: 10, limit: null } } }),
  shopify: () => ent({
    plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false, interval: null, currency: null, features: OFF,
    meters: { orders: { used: 300, limit: null }, labels: { used: 50, limit: null }, connectedStores: { used: 1, limit: 1 }, aiCredits: { used: 260, limit: 300 } },
  }),
};
