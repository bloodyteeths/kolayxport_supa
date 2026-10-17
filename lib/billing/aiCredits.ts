// lib/billing/aiCredits.ts — AI kredisi: what image and video generation cost, what each plan includes per month,
// and the credit packs a seller can buy on top. ISOMORPHIC and pure (the studio shows the same numbers the server
// charges; test/billing/aiCredits.test.ts).
//
// 1 credit ≈ $0.01 of Google cost (Vertex, 2026-10): Veo 3.1 Fast $0.10–0.12/s (4K $0.30), Veo 3.1 $0.40/s (4K $0.60),
// Nano Banana Pro $0.134 per image. Packs sell at $0.017–0.03 per credit. Text AI (titles, tags, replies) is not
// metered. Failed generations are refunded (Google does not bill them either).
import { DECIDED_PLAN_LIMITS, type PlanKey } from './planLimits';
import type { Currency } from './types';

export type VideoQuality = 'fast' | 'best';
export type VideoResolution = '720p' | '1080p' | '4k';

/** One generated image (2K, Nano Banana Pro). */
export const IMAGE_CREDITS = 15;

/** Video credits per second of output, per generated variant. */
export const VIDEO_CREDITS_PER_SEC: Readonly<Record<VideoQuality, Record<VideoResolution, number>>> = {
  fast: { '720p': 10, '1080p': 12, '4k': 30 },
  best: { '720p': 40, '1080p': 40, '4k': 60 },
};

/** Veo extends by 7 s at 720p. */
export const EXTEND_SECONDS = 7;

export function videoCredits(v: { quality: string; resolution: string; durationSec: number; variants?: number }): number {
  const q: VideoQuality = v.quality === 'best' ? 'best' : 'fast';
  const r: VideoResolution = v.resolution === '4k' ? '4k' : v.resolution === '1080p' ? '1080p' : '720p';
  const n = Math.min(4, Math.max(1, Math.round(v.variants ?? 1)));
  return VIDEO_CREDITS_PER_SEC[q][r] * Math.max(1, Math.round(v.durationSec)) * n;
}

export function extendCredits(quality: string): number {
  return videoCredits({ quality, resolution: '720p', durationSec: EXTEND_SECONDS });
}

export function imageCredits(count = 1): number {
  return IMAGE_CREDITS * Math.max(1, Math.round(count));
}

/** Monthly AI kredisi of a plan (null = unlimited). Comes from the decided plan table so pricing copy matches. */
export function monthlyAllowance(plan: PlanKey): number | null {
  return DECIDED_PLAN_LIMITS[plan].limits.aiCredits;
}

export type CreditPackId = 'p500' | 'p1500' | 'p5000' | 'p15000';
export type CreditPack = { id: CreditPackId; credits: number; price: Record<Currency, number>; popular?: boolean };

/** One-time packs (never expire). TRY ≈ USD × 40, rounded to a …99 price. */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'p500', credits: 500, price: { TRY: 599, USD: 15 } },
  { id: 'p1500', credits: 1500, price: { TRY: 1599, USD: 39 } },
  { id: 'p5000', credits: 5000, price: { TRY: 3999, USD: 99 }, popular: true },
  { id: 'p15000', credits: 15000, price: { TRY: 9999, USD: 249 } },
];

export function creditPack(id: unknown): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** Saving of a pack against the smallest pack's price per credit, in whole percent. */
export function packSaving(pack: CreditPack, currency: Currency): number {
  const base = CREDIT_PACKS[0].price[currency] / CREDIT_PACKS[0].credits;
  const per = pack.price[currency] / pack.credits;
  return Math.max(0, Math.round((1 - per / base) * 100));
}

/** Calendar month (UTC) the plan allowance belongs to: "2026-10". */
export function creditPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First day of the next month (UTC) — when the plan allowance renews. */
export function creditPeriodEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** GET /api/ai/credits */
export type CreditBalance = {
  plan: PlanKey;
  /** This month's allowance (null = unlimited), what was used of it, and what is left. */
  monthly: { allowance: number | null; used: number; remaining: number | null; renewsAt: string };
  /** Purchased credits left (never expire). */
  packs: number;
  /** remaining + packs (null = unlimited). */
  total: number | null;
  /** How credits can be bought: Stripe checkout, Shopify billing (Shopify-billed accounts), or not at all. */
  channel: 'stripe' | 'shopify' | null;
  /** Shopify-connected / neutral account: no prices, packs or buy buttons anywhere (App Store rule 1.2.1). */
  neutral: boolean;
  currency: Currency;
  recent: { id: string; delta: number; kind: string; feature: string | null; createdAt: string }[];
};

/** Can this balance pay `cost`? Pure. */
export function canAfford(b: Pick<CreditBalance, 'total'> | null | undefined, cost: number): boolean {
  if (!b) return true; // unknown: let the server decide
  return b.total === null || b.total >= cost;
}
