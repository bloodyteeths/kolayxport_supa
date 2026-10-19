// lib/billing/pricingV2.ts — pricing v2 flag + catalog (docs/gtm/pricing-v2.md §3). The catalog is the PROPOSED
// price list (+KDV, TRY) for Atilla to confirm; P3 (Stripe prices), P2 (iyzico / PayTR checkout) and P4 (pricing
// page) read it from here. Until PRICING_V2=1 nothing sells the v2 plans: the plan keys, limits, features and
// modules are recognised everywhere (lib/billing/planLimits.ts, featureMap.ts, modules.ts) so an admin can assign
// them for testing, and the live pricing page / checkout stay on today's ladder.
import { DECIDED_PLAN_LIMITS, EXTRA_ORDERS_PER_UNIT, type V2PlanKey } from './planLimits';
import type { ModuleKey } from './modules';

/** Server flag. The client never decides prices; it reads what the server sends. */
export function pricingV2Enabled(): boolean {
  return process.env.PRICING_V2 === '1' || process.env.PRICING_V2 === 'true';
}

export interface V2PlanOffer {
  key: V2PlanKey;
  interval: 'month' | 'year';
  /** TRY, +KDV, whole lira; null = quote (Kurumsal). */
  priceTry: number | null;
  /** Most taksit offered on a yearly package (iyzico / PayTR); 1 = single payment. */
  maxInstallments: number;
}

export const V2_PLANS: readonly V2PlanOffer[] = [
  { key: 'aylik', interval: 'month', priceTry: 2999, maxInstallments: 1 },
  { key: 'baslangic_yil', interval: 'year', priceTry: 29990, maxInstallments: 6 },
  { key: 'buyume_yil', interval: 'year', priceTry: 54990, maxInstallments: 9 },
  { key: 'pro_yil', interval: 'year', priceTry: 89990, maxInstallments: 12 },
  { key: 'kurumsal', interval: 'year', priceTry: null, maxInstallments: 12 },
];

/** Module prices, TRY +KDV: per month on Aylık, per year on a yearly package. */
export const V2_MODULE_PRICES: Readonly<Record<ModuleKey, { month: number; year: number }>> = {
  financials: { month: 990, year: 9900 },
  arbitrage: { month: 990, year: 9900 },
  bulkPhotoStudio: { month: 790, year: 7900 },
  extraStore: { month: 490, year: 4900 },
  extraOrders: { month: 490, year: 4900 },
};

/** KDV rate for "+KDV" prices (the total shown at checkout). */
export const KDV_RATE = 0.2;

export function withKdv(priceTry: number): number {
  return Math.round(priceTry * (1 + KDV_RATE) * 100) / 100;
}

/**
 * pricing-v2 §3 UI rule: when a yearly account's modules cost more than moving up a package, suggest the package
 * ("Büyüme/Pro yıllık daha uygun") with the difference. Aylık compares against the yearly packages per year.
 * Returns null when no package is cheaper.
 */
export function cheaperPackage(
  plan: V2PlanKey,
  modules: Partial<Record<ModuleKey, number>>,
): { plan: V2PlanKey; savingTry: number } | null {
  const base = V2_PLANS.find((p) => p.key === plan);
  if (!base || base.priceTry === null) return null;
  const perYear = base.interval === 'month' ? 12 : 1;
  const unit = base.interval === 'month' ? 'month' : 'year';
  const modulesCost = (Object.entries(modules) as Array<[ModuleKey, number]>).reduce((s, [k, q]) => s + (q > 0 ? V2_MODULE_PRICES[k][unit] * q : 0), 0);
  const current = (base.priceTry + modulesCost) * perYear;
  // A suggestion must cover what the account has now: stores, orders a year and the Pro features it bought.
  const cur = DECIDED_PLAN_LIMITS[plan].limits;
  const needStores = cur.connectedStores === null ? null : cur.connectedStores + (modules.extraStore ?? 0);
  const ordersPerYear = cur.orders === null ? null : cur.orders * perYear + (modules.extraOrders ?? 0) * EXTRA_ORDERS_PER_UNIT[unit] * perYear;
  const needsPro = (modules.financials ?? 0) + (modules.arbitrage ?? 0) + (modules.bulkPhotoStudio ?? 0) > 0;
  const covers = (have: number | null, need: number | null) => have === null || (need !== null && have >= need);
  const candidates = V2_PLANS.filter((p) => {
    if (p.interval !== 'year' || p.priceTry === null || p.key === plan) return false;
    if (needsPro && p.key !== 'pro_yil') return false;
    const l = DECIDED_PLAN_LIMITS[p.key].limits;
    return covers(l.connectedStores, needStores) && covers(l.orders, ordersPerYear);
  });
  let best: { plan: V2PlanKey; savingTry: number } | null = null;
  for (const c of candidates) {
    const saving = current - (c.priceTry as number);
    if (saving > 0 && (!best || saving > best.savingTry)) best = { plan: c.key, savingTry: saving };
  }
  return best;
}
