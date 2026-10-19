// lib/billing/modules.ts — pricing v2 module add-ons (docs/gtm/pricing-v2.md §3 "Modules"). Pure helpers are
// isomorphic; `loadAccountModules` is server-only (Prisma). Modules extend the plan, they never replace it:
//  - financials / arbitrage / bulkPhotoStudio → that Pro feature on a plan without it
//  - extraStore (quantity n) → +n connected stores
//  - extraOrders (quantity n) → +500 orders a month on Aylık, +6.000 a year on a yearly package (planLimits.ts)
import type { Feature } from './types';

export type ModuleKey = 'financials' | 'arbitrage' | 'bulkPhotoStudio' | 'extraStore' | 'extraOrders';
export const MODULE_KEYS: readonly ModuleKey[] = ['financials', 'arbitrage', 'bulkPhotoStudio', 'extraStore', 'extraOrders'];
const FEATURE_MODULES: readonly Feature[] = ['financials', 'arbitrage', 'bulkPhotoStudio'];

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === 'string' && (MODULE_KEYS as readonly string[]).includes(v);
}

/** What an account's active modules add. JSON-safe (it travels in /api/user/settings → entitlement). */
export interface AccountModules {
  features: Feature[];
  extraStores: number;
  extraOrders: number;
}

export const NO_MODULES: AccountModules = Object.freeze({ features: [], extraStores: 0, extraOrders: 0 }) as AccountModules;

interface ModuleRow { module: string; quantity: number; status: string; currentPeriodEnd: Date | string | null }

/** Active rows → what they add. A row counts while status is active and its period has not ended. */
export function summarizeModules(rows: readonly ModuleRow[], now: Date = new Date()): AccountModules {
  const out: AccountModules = { features: [], extraStores: 0, extraOrders: 0 };
  for (const r of rows) {
    if (r.status !== 'active') continue;
    if (r.currentPeriodEnd && new Date(r.currentPeriodEnd).getTime() <= now.getTime()) continue;
    const qty = Math.max(0, Math.floor(r.quantity || 0));
    if ((FEATURE_MODULES as readonly string[]).includes(r.module)) {
      if (qty > 0 && !out.features.includes(r.module as Feature)) out.features.push(r.module as Feature);
    } else if (r.module === 'extraStore') out.extraStores += qty;
    else if (r.module === 'extraOrders') out.extraOrders += qty;
  }
  return out;
}

/** Validates the `modules` block of a settings payload. */
export function normalizeModules(raw: unknown): AccountModules {
  if (!raw || typeof raw !== 'object') return NO_MODULES;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const features = Array.isArray(r.features) ? (r.features.filter((f) => (FEATURE_MODULES as readonly unknown[]).includes(f)) as Feature[]) : [];
  return { features, extraStores: n(r.extraStores), extraOrders: n(r.extraOrders) };
}

/** Plan features plus module features (a module never turns a plan feature off). */
export function withModuleFeatures(features: Record<Feature, boolean>, modules: AccountModules | null | undefined): Record<Feature, boolean> {
  if (!modules?.features.length) return features;
  const out = { ...features };
  for (const f of modules.features) out[f] = true;
  return out;
}

/** Server: the account's active modules. Never throws (a missing table or DB hiccup means "no modules"). */
export async function loadAccountModules(userId: string, now: Date = new Date()): Promise<AccountModules> {
  try {
    const { default: prisma } = await import('@/lib/prisma');
    const rows = await prisma.billingModule.findMany({ where: { userId, status: 'active' }, select: { module: true, quantity: true, status: true, currentPeriodEnd: true } });
    return summarizeModules(rows, now);
  } catch {
    return NO_MODULES;
  }
}
