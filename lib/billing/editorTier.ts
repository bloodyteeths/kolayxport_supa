// lib/billing/editorTier.ts — the Etsy bulk listing editor inside the existing plans (orchestrator/Atilla decision
// 2026-10-24, no standalone editor plan). One tier per plan; locked capabilities show "upgrade to unlock" in the UI
// and are refused on the server where the server can see them (send size, scheduling, bulk AI).
//
//   basic  Aylık, Başlangıç (+ legacy starter)    grid + price/tags/Set field/state actions, max 100 listings per send
//   plus   Büyüme (+ legacy growth)                 + find & replace, scheduled send, CSV import/export, 500 per send
//   pro    Pro, Kurumsal (+ legacy pro/enterprise)  + bulk AI, templates, copy to another shop, unlimited per send
//   trial and Shopify-installed accounts           pro (they keep everything)
// Photo Studio stays on its own `bulkPhotoStudio` feature (Pro or the module).
import type { PlanKey } from './types';

export type EditorTier = 'basic' | 'plus' | 'pro';
export type EditorCapability = 'findReplace' | 'schedule' | 'csv' | 'ai' | 'templates' | 'copyToShop';

export interface EditorLimits {
  /** Max listings in one "Send N changes" (null = no cap besides Etsy's daily fair share). */
  maxPerSend: number | null;
  capabilities: Readonly<Record<EditorCapability, boolean>>;
}

const NONE = { findReplace: false, schedule: false, csv: false, ai: false, templates: false, copyToShop: false } as const;
export const EDITOR_LIMITS: Readonly<Record<EditorTier, EditorLimits>> = {
  basic: { maxPerSend: 100, capabilities: NONE },
  plus: { maxPerSend: 500, capabilities: { ...NONE, findReplace: true, schedule: true, csv: true } },
  pro: { maxPerSend: null, capabilities: { findReplace: true, schedule: true, csv: true, ai: true, templates: true, copyToShop: true } },
};

const TIER_BY_PLAN: Readonly<Record<PlanKey, EditorTier>> = {
  trial: 'pro',
  shopify_free: 'pro',
  starter: 'basic',
  aylik: 'basic',
  baslangic_yil: 'basic',
  growth: 'plus',
  buyume_yil: 'plus',
  pro: 'pro',
  pro_yil: 'pro',
  enterprise: 'pro',
  kurumsal: 'pro',
};

/** Pure: the editor tier for a plan (unknown plans get basic). */
export function editorTierForPlan(plan: PlanKey | string | null | undefined): EditorTier {
  return (plan && (TIER_BY_PLAN as Record<string, EditorTier>)[plan]) || 'basic';
}

export function editorAllows(tier: EditorTier, cap: EditorCapability): boolean {
  return EDITOR_LIMITS[tier].capabilities[cap];
}

/** Pure: is a send of `count` listings within the tier's cap? */
export function sendWithinCap(tier: EditorTier, count: number): boolean {
  const max = EDITOR_LIMITS[tier].maxPerSend;
  return max === null || count <= max;
}

/** The cheapest tier that unlocks a capability (for the upgrade prompt). */
export function tierFor(cap: EditorCapability): EditorTier {
  return EDITOR_LIMITS.plus.capabilities[cap] ? 'plus' : 'pro';
}

/** The 402 body the editor UI understands (limitType 'editor'). */
export function editorLockedBody(tier: EditorTier, reason: EditorCapability | 'sendSize', extra: Record<string, unknown> = {}) {
  return { error: 'Payment Required', limitType: 'editor' as const, reason, tier, requiredTier: reason === 'sendSize' ? (tier === 'basic' ? 'plus' : 'pro') : tierFor(reason), ...extra };
}
