// lib/billing/featureMap.ts — pro-gating §3.1: the single mapping of Pro features to surfaces, copy and
// previews. Founder decision D-P1 (Sales stays free) flips here: add `sales: 'financials'` to
// `REPORTS_TAB_FEATURE` and nothing else changes.
//
// Which plan includes which feature mirrors tiers.md §1 `PLANS[*].features` (trial and Pro/Enterprise on,
// Starter/Growth off). The entitlement endpoint is the runtime truth (`Entitlement.features`);
// `PLAN_FEATURES` is only for copy that names a plan (Billing "Included in your plan", pricing page) and
// for the `/api/user/settings` fallback.
import type { Feature, PlanKey } from './types';

const ALL_ON: Readonly<Record<Feature, boolean>> = { arbitrage: true, financials: true, bulkPhotoStudio: true };
const ALL_OFF: Readonly<Record<Feature, boolean>> = { arbitrage: false, financials: false, bulkPhotoStudio: false };

export const PLAN_FEATURES: Readonly<Record<PlanKey, Readonly<Record<Feature, boolean>>>> = {
  trial: ALL_ON,
  starter: ALL_OFF,
  growth: ALL_OFF,
  pro: ALL_ON,
  enterprise: ALL_ON,
  // Shopify-installed merchants are never charged (App Store 1.2.1), so nothing may look locked behind a plan.
  shopify_free: ALL_ON,
};

/** The cheapest plan that includes every Pro feature. */
export const FEATURE_PLAN = 'pro' as const;

export interface FeatureCopy {
  /** Keys under the `pro` namespace. */
  titleKey: string;
  bodyKey: string;
  pointsKeys: readonly [string, string, string];
  /** Billing "Included in your plan" row label (under `billing`). */
  billingLabelKey: string;
  /** Static screenshot (pro-gating G-pro-3, `public/previews/*`); `-tr` variant for Turkish. */
  preview: { base: string; altKey: string };
}

export const FEATURE_COPY: Readonly<Record<Feature, FeatureCopy>> = {
  financials: {
    titleKey: 'feature.financials.title',
    bodyKey: 'feature.financials.body',
    pointsKeys: ['feature.financials.p1', 'feature.financials.p2', 'feature.financials.p3'],
    billingLabelKey: 'features.financials',
    preview: { base: '/previews/profit', altKey: 'feature.financials.title' },
  },
  bulkPhotoStudio: {
    titleKey: 'feature.bulkPhotoStudio.title',
    bodyKey: 'feature.bulkPhotoStudio.body',
    pointsKeys: ['feature.bulkPhotoStudio.p1', 'feature.bulkPhotoStudio.p2', 'feature.bulkPhotoStudio.p3'],
    billingLabelKey: 'features.bulkPhotoStudio',
    preview: { base: '/previews/photo-studio', altKey: 'feature.bulkPhotoStudio.title' },
  },
  arbitrage: {
    titleKey: 'feature.arbitrage.title',
    bodyKey: 'feature.arbitrage.body',
    pointsKeys: ['feature.arbitrage.p1', 'feature.arbitrage.p2', 'feature.arbitrage.p3'],
    billingLabelKey: 'features.arbitrage',
    preview: { base: '/previews/price-gap', altKey: 'feature.arbitrage.title' },
  },
};

/**
 * Preview screenshots are produced by G-pro-3 (M9 / M7 / R4). Until a file exists the locked state renders
 * without the image (never a broken <img>). The producing PR flips its entry to true.
 */
export const PREVIEW_READY: Readonly<Record<Feature, boolean>> = { financials: false, bulkPhotoStudio: false, arbitrage: false };

/** `src` / `srcSet` for a feature preview in the UI locale. */
export function previewImage(feature: Feature, locale: string): { src: string; srcSet: string } {
  const base = FEATURE_COPY[feature].preview.base + (locale === 'tr' ? '-tr' : '');
  return { src: `${base}.png`, srcSet: `${base}.png 1x, ${base}@2x.png 2x` };
}

/** Reports tabs → the feature that gates them (D-P1: Sales is free). */
export const REPORTS_TAB_FEATURE: Readonly<Record<string, Feature | null>> = {
  sales: null,
  profit: 'financials',
  payouts: 'financials',
  transactions: 'financials',
};

/** The feature that gates a Reports tab, or null when the tab is in every plan. */
export function isTabGated(tab: string | null | undefined): Feature | null {
  if (!tab) return null;
  return REPORTS_TAB_FEATURE[tab] ?? null;
}

/** pro-gating §3.2: "See plans" target. */
export function seePlansHref(feature: Feature): string {
  return `/fiyatlandirma?plan=${FEATURE_PLAN}&from=${encodeURIComponent(feature)}`;
}

/** pro-gating §1: "Reactivate" target for a paused account. */
export const REACTIVATE_HREF = '/ayarlar?tab=billing';

export function isFeature(v: unknown): v is Feature {
  return v === 'arbitrage' || v === 'financials' || v === 'bulkPhotoStudio';
}
