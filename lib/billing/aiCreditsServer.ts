// lib/billing/aiCreditsServer.ts — AI kredisi ledger (SERVER ONLY). Every image / video generation spends credits
// BEFORE the Google call and refunds them when it fails, so a seller can never go below zero and never pays for a
// failure. Spends draw from this month's plan allowance first, then from purchased packs (which never expire).
// One Postgres advisory lock per user serialises spends, so two tabs cannot overdraw.
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { accountEntitlement } from './requireFeature';
import { creditPeriod, creditPeriodEnd, monthlyAllowance, type CreditBalance } from './aiCredits';
import type { Currency, PlanKey } from './types';

export class NoCreditsError extends Error {
  readonly status = 402;
  constructor(readonly need: number, readonly balance: number | null, readonly neutral: boolean) {
    super('Not enough AI credits');
    this.name = 'NoCreditsError';
  }

  /** The 402 body: the global interceptor opens the "buy credits" dialog for limitType 'aiCredit'. */
  body() {
    return { error: 'Payment Required', code: 'noCredits', limitType: 'aiCredit' as const, need: this.need, balance: this.balance, neutral: this.neutral };
  }
}

export function isNoCreditsError(err: unknown): err is NoCreditsError {
  return Boolean(err) && (err as { name?: unknown }).name === 'NoCreditsError';
}

/** The platform-wide daily safety limit was reached (all users together): generation pauses until tomorrow (UTC). */
export class AiBudgetError extends Error {
  readonly status = 503;
  constructor() {
    super('Daily AI generation budget reached');
    this.name = 'AiBudgetError';
  }

  body() {
    return { error: 'Service Unavailable', code: 'aiBudget' };
  }
}

export function isAiBudgetError(err: unknown): err is AiBudgetError {
  return Boolean(err) && (err as { name?: unknown }).name === 'AiBudgetError';
}

/** Credits all users may spend per UTC day (≈ $0.01 each). Guards against a leaked account or a runaway script. */
export function dailyCreditCap(): number {
  const v = Number(process.env.AI_DAILY_CREDIT_CAP);
  return Number.isFinite(v) && v >= 0 ? v : 30_000;
}

type Tx = Prisma.TransactionClient;
type Info = { plan: PlanKey; allowance: number | null; channel: CreditBalance['channel']; neutral: boolean };

async function planInfo(userId: string): Promise<Info> {
  const a = await accountEntitlement(userId);
  if (!a) return { plan: 'trial', allowance: 0, channel: null, neutral: true };
  const allowance = a.ent.state === 'expired' ? 0 : monthlyAllowance(a.ent.plan);
  // Shopify App Store rule: a Shopify-billed account pays through Shopify billing, never Stripe.
  const channel: CreditBalance['channel'] = a.shopify ? (process.env.SHOPIFY_API_KEY ? 'shopify' : null) : 'stripe';
  return { plan: a.ent.plan, allowance, channel, neutral: a.neutral };
}

async function lock(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`aic:${userId}`}))) AS l`;
}

async function sums(tx: Tx | typeof prisma, userId: string, period: string) {
  const rows = await tx.aiCreditEntry.groupBy({
    by: ['bucket'],
    where: { userId, OR: [{ bucket: 'pack' }, { bucket: 'plan', period }] },
    _sum: { delta: true },
  });
  const plan = rows.find((r) => r.bucket === 'plan')?._sum.delta ?? 0;
  const pack = rows.find((r) => r.bucket === 'pack')?._sum.delta ?? 0;
  return { planUsed: Math.max(0, -plan), packs: Math.max(0, pack) };
}

export async function getCreditBalance(userId: string, currency: Currency = 'TRY'): Promise<CreditBalance> {
  const info = await planInfo(userId);
  const now = new Date();
  const { planUsed, packs } = await sums(prisma, userId, creditPeriod(now));
  const remaining = info.allowance === null ? null : Math.max(0, info.allowance - planUsed);
  const recent = await prisma.aiCreditEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  return {
    plan: info.plan,
    monthly: { allowance: info.allowance, used: planUsed, remaining, renewsAt: creditPeriodEnd(now).toISOString() },
    packs,
    total: remaining === null ? null : remaining + packs,
    channel: info.channel,
    currency,
    recent: recent.map((e) => ({ id: e.id, delta: e.delta, kind: e.kind, feature: e.feature, createdAt: e.createdAt.toISOString() })),
  };
}

/**
 * Spends `cost` credits for `ref` (a job id or request id). Throws NoCreditsError (402) when the plan allowance +
 * packs cannot cover it. Returns how much came from each bucket.
 */
export async function spendCredits(userId: string, cost: number, opts: { feature: 'video' | 'image'; ref: string; note?: string }): Promise<{ fromPlan: number; fromPack: number }> {
  if (!(cost > 0)) return { fromPlan: 0, fromPack: 0 };
  const info = await planInfo(userId);
  const period = creditPeriod();
  return prisma.$transaction(async (tx) => {
    await lock(tx, userId);
    const cap = dailyCreditCap();
    if (cap > 0) {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const today = await tx.aiCreditEntry.aggregate({ where: { kind: { in: ['spend', 'refund'] }, createdAt: { gte: day } }, _sum: { delta: true } });
      if (-(today._sum.delta ?? 0) + cost > cap) {
        logger.error('AI daily credit cap reached: generation paused', undefined, { cap, userId, cost });
        throw new AiBudgetError();
      }
    }
    const { planUsed, packs } = await sums(tx, userId, period);
    const planLeft = info.allowance === null ? Number.POSITIVE_INFINITY : Math.max(0, info.allowance - planUsed);
    const fromPlan = Math.min(planLeft, cost);
    const fromPack = cost - fromPlan;
    if (fromPack > packs) throw new NoCreditsError(cost, info.allowance === null ? null : planLeft + packs, info.neutral);
    const note = opts.note?.slice(0, 200) ?? null;
    if (fromPlan > 0) await tx.aiCreditEntry.create({ data: { userId, delta: -fromPlan, kind: 'spend', bucket: 'plan', period, feature: opts.feature, ref: opts.ref, note } });
    if (fromPack > 0) await tx.aiCreditEntry.create({ data: { userId, delta: -fromPack, kind: 'spend', bucket: 'pack', feature: opts.feature, ref: opts.ref, note } });
    return { fromPlan, fromPack };
  });
}

/**
 * Gives back what `ref` spent (all of it, or `amount`), packs first. `key` makes it idempotent: the same key never
 * refunds twice (a full refund uses 'full'; a partial one, e.g. two of four variants filtered, its own key).
 */
export async function refundCredits(userId: string, ref: string, opts: { amount?: number; key?: string } = {}): Promise<number> {
  const rkey = `${ref}#${opts.key ?? 'full'}`;
  try {
    return await prisma.$transaction(async (tx) => {
      await lock(tx, userId);
      const spent = await tx.aiCreditEntry.findMany({ where: { userId, kind: 'spend', ref } });
      if (!spent.length) return 0;
      const refunded = await tx.aiCreditEntry.findMany({ where: { userId, kind: 'refund', ref: { startsWith: `${ref}#` } } });
      const of = (rows: typeof spent, bucket: string) => rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + Math.abs(r.delta), 0);
      const leftPack = of(spent, 'pack') - of(refunded, 'pack');
      const leftPlan = of(spent, 'plan') - of(refunded, 'plan');
      const amount = Math.min(opts.amount ?? Number.POSITIVE_INFINITY, Math.max(0, leftPack) + Math.max(0, leftPlan));
      if (!(amount > 0)) return 0;
      const toPack = Math.min(Math.max(0, leftPack), amount);
      const toPlan = amount - toPack;
      const feature = spent[0].feature;
      if (toPack > 0) await tx.aiCreditEntry.create({ data: { userId, delta: toPack, kind: 'refund', bucket: 'pack', feature, ref: rkey } });
      if (toPlan > 0) {
        const period = spent.find((r) => r.bucket === 'plan')?.period ?? creditPeriod();
        await tx.aiCreditEntry.create({ data: { userId, delta: toPlan, kind: 'refund', bucket: 'plan', period, feature, ref: rkey } });
      }
      return amount;
    });
  } catch (err: any) {
    if (err?.code === 'P2002') return 0; // this refund key was already used
    throw err;
  }
}

/** Adds purchased credits once per payment `ref` (Stripe checkout session / Shopify purchase). false = already added. */
export async function grantPack(userId: string, credits: number, ref: string, opts: { feature: string; note?: string; kind?: 'purchase' | 'adjust' }): Promise<boolean> {
  if (!(credits > 0) || !ref) return false;
  try {
    await prisma.aiCreditEntry.create({ data: { userId, delta: Math.round(credits), kind: opts.kind ?? 'purchase', bucket: 'pack', feature: opts.feature, ref, note: opts.note?.slice(0, 200) ?? null } });
    return true;
  } catch (err: any) {
    if (err?.code === 'P2002') return false;
    throw err;
  }
}
