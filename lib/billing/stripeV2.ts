// lib/billing/stripeV2.ts — pricing v2 P3 on Stripe (docs/gtm/pricing-v2.md §4). The v2 prices live on the
// Tamsar, Inc. account with deterministic lookup keys (kx_v2_<item>_<interval>_try, created 2026-10-19) and metadata
// kx_plan / kx_module, so no env ids are needed:
//  - checkout resolves a lookup key → price id (resolveV2PriceId);
//  - the webhook reads item.price.metadata (subscription) or the cached id map (invoice lines) to set the plan
//    and keep BillingModule rows in step with the subscription (syncSubscriptionFromStripe).
// Prices are tax-inclusive full amounts: Tamsar, Inc. sells and adds no KDV (founder, 2026-10-19).
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';
import { V2_PLAN_KEYS, type V2PlanKey } from './planLimits';
import { MODULE_KEYS, isModuleKey, type ModuleKey } from './modules';
import { planFromPriceId } from './stripeAccountServer';

export type V2Item = { kind: 'plan'; key: V2PlanKey; interval: 'month' | 'year' } | { kind: 'module'; key: ModuleKey; interval: 'month' | 'year' };

const SELF_SERVE_PLANS: readonly V2PlanKey[] = V2_PLAN_KEYS.filter((k) => k !== 'kurumsal');
const PLAN_INTERVAL: Record<string, 'month' | 'year'> = { aylik: 'month', baslangic_yil: 'year', buyume_yil: 'year', pro_yil: 'year' };

export function v2LookupKey(key: string, interval: 'month' | 'year'): string {
  return `kx_v2_${key.toLowerCase()}_${interval}_try`;
}

/** Every v2 lookup key: 4 plans (their own interval) + 5 modules × 2 intervals. */
export function allV2LookupKeys(): string[] {
  return [
    ...SELF_SERVE_PLANS.map((k) => v2LookupKey(k, PLAN_INTERVAL[k])),
    ...MODULE_KEYS.flatMap((m) => [v2LookupKey(m, 'month'), v2LookupKey(m, 'year')]),
  ];
}

/** Price metadata → v2 item (subscription items carry the full price object). */
export function v2ItemFromMetadata(meta: Record<string, string> | null | undefined, interval: string | null | undefined): V2Item | null {
  if (!meta || meta.kx_v2 !== '1') return null;
  const iv = interval === 'year' ? 'year' : interval === 'month' ? 'month' : null;
  if (!iv) return null;
  if (meta.kx_plan && (SELF_SERVE_PLANS as readonly string[]).includes(meta.kx_plan)) return { kind: 'plan', key: meta.kx_plan as V2PlanKey, interval: iv };
  if (isModuleKey(meta.kx_module)) return { kind: 'module', key: meta.kx_module, interval: iv };
  return null;
}

let cache: { at: number; byLookup: Map<string, string>; byId: Map<string, V2Item> } | null = null;
const CACHE_MS = 10 * 60_000;

async function priceMaps() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const keys = allV2LookupKeys();
  const byLookup = new Map<string, string>();
  const byId = new Map<string, V2Item>();
  // lookup_keys accepts at most 10 per request.
  for (let i = 0; i < keys.length; i += 10) {
    const page = await stripe.prices.list({ lookup_keys: keys.slice(i, i + 10), active: true, limit: 100 });
    for (const p of page.data) {
      if (p.lookup_key) byLookup.set(p.lookup_key, p.id);
      const item = v2ItemFromMetadata(p.metadata, p.recurring?.interval);
      if (item) byId.set(p.id, item);
    }
  }
  cache = { at: Date.now(), byLookup, byId };
  return cache;
}

/** For tests. */
export function resetV2PriceCache() {
  cache = null;
}

export async function resolveV2PriceId(key: string, interval: 'month' | 'year'): Promise<string | null> {
  return (await priceMaps()).byLookup.get(v2LookupKey(key, interval)) ?? null;
}

export async function v2ItemFromPriceId(priceId: string | null | undefined): Promise<V2Item | null> {
  if (!priceId) return null;
  return (await priceMaps()).byId.get(priceId) ?? null;
}

/** The interval a v2 plan is sold at (Aylık monthly, packages yearly). */
export function v2PlanInterval(key: string): 'month' | 'year' | null {
  return PLAN_INTERVAL[key] ?? null;
}

const SYNC_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Keeps the account in step with its Stripe subscription: the plan item sets subscriptionPlan / billingInterval
 * (v2 via price metadata, today's ladder via env price ids), module items upsert Stripe-provided BillingModule rows,
 * modules no longer on the subscription are canceled. Admin-granted modules are never touched. Shopify-billed
 * accounts are skipped (they never have Stripe subscriptions).
 */
export async function syncSubscriptionFromStripe(userId: string, sub: Stripe.Subscription): Promise<{ plan: string | null; modules: string[] } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { billingProvider: true, subscriptionPlan: true } });
  if (!user || user.billingProvider === 'shopify_free' || user.subscriptionPlan === 'shopify_free') return null;

  let plan: { key: string; interval: 'month' | 'year' } | null = null;
  const modules: Array<{ key: ModuleKey; quantity: number; itemId: string; periodEnd: Date | null }> = [];
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    const v2 = v2ItemFromMetadata(price?.metadata as Record<string, string>, price?.recurring?.interval);
    const periodEnd = (item as { current_period_end?: number }).current_period_end;
    if (v2?.kind === 'plan') plan = { key: v2.key, interval: v2.interval };
    else if (v2?.kind === 'module') modules.push({ key: v2.key, quantity: item.quantity ?? 1, itemId: item.id, periodEnd: periodEnd ? new Date(periodEnd * 1000) : null });
    else if (!plan) {
      const legacy = planFromPriceId(price?.id);
      if (legacy) plan = { key: legacy.plan, interval: legacy.interval };
    }
  }

  const live = SYNC_STATUSES.has(sub.status);
  if (plan && live) {
    await prisma.user.update({ where: { id: userId }, data: { subscriptionPlan: plan.key, billingInterval: plan.interval, subscriptionStatus: sub.status } });
  }

  const keep = live ? modules : [];
  for (const m of keep) {
    await prisma.billingModule.upsert({
      where: { userId_module: { userId, module: m.key } },
      create: { userId, module: m.key, quantity: m.quantity, provider: 'stripe', externalId: m.itemId, status: 'active', currentPeriodEnd: m.periodEnd },
      update: { quantity: m.quantity, provider: 'stripe', externalId: m.itemId, status: 'active', currentPeriodEnd: m.periodEnd },
    });
  }
  await prisma.billingModule.updateMany({
    where: { userId, provider: 'stripe', status: 'active', module: { notIn: keep.map((m) => m.key) } },
    data: { status: 'canceled' },
  });
  return { plan: plan?.key ?? null, modules: keep.map((m) => m.key) };
}

/** Subscription id of a basil invoice (parent.subscription_details), with the pre-basil field as fallback. */
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const basil = invoice.parent?.subscription_details?.subscription;
  if (typeof basil === 'string') return basil;
  if (basil && typeof basil === 'object') return basil.id;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (typeof legacy === 'string') return legacy;
  return legacy?.id ?? null;
}
