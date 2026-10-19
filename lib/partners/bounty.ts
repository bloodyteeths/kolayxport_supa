// lib/partners/bounty.ts — one-time partner bounties (docs/gtm/referral-spec.md §3). Payment-provider agnostic:
// Stripe calls it today (pages/api/stripe/webhook.ts via lib/partners/stripeBounty.ts); iyzico / PayTR call the same
// two entry points once pricing v2 P2 exists. Callers wrap every call in their own try/catch: a bounty bug must never
// break billing.
//
// Rules (Atilla, 2026-10-19):
//  - Yearly: 25% of the customer's first yearly payment, net of KDV, after discounts; 30% when the partner already had
//    ≥ tierThreshold paying referred customers.
//  - Aylık (monthly): fixed ₺1.500 on the customer's 2nd successful monthly payment.
//  - Upgrade Aylık → yearly within 90 days of the first payment: yearly bounty minus the monthly bounty already earned.
//  - Renewals, modules, AI credit packs: nothing (callers only pass plan subscription payments; history tells renewals).
//  - Shopify-billed / review / admin / excluded customers: nothing (no partnerId on their UserAcquisition, or guarded).
//  - Hold 30 days; refunds before payout void or reduce; after payout a negative reversal row nets the next payout.
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { EXCLUSION_USER_SELECT, isExcluded } from './acquisition';

const DAY_MS = 86_400_000;
export const HOLD_DAYS = 30;
export const UPGRADE_WINDOW_DAYS = 90;
export const YEAR_RATE = 0.25;
export const YEAR_TIER_RATE = 0.3;
export const MONTH_BOUNTY_MINOR = 150_000; // ₺1.500
export const MONTH_BOUNTY_CURRENCY = 'try';
/** Default KDV used only when a provider gives no tax figure on a "+KDV" price. */
export const KDV_RATE = 0.2;

export type PaymentProvider = 'stripe' | 'iyzico' | 'paytr';
export type BountyKind = 'bounty_year' | 'bounty_month' | 'bounty_upgrade' | 'reversal';

export interface PaymentSucceeded {
  userId: string;
  provider: PaymentProvider;
  /** Provider object id of the payment (Stripe invoice id, iyzico/PayTR order id). */
  objectId: string;
  paidAt: Date;
  currency: string;
  grossMinor: number;
  /** KDV in minor units; null when the provider gave none (then a "+KDV" TRY price is split at 20%). */
  taxMinor: number | null;
  planKey?: string | null;
  interval: 'year' | 'month';
}

export interface PaymentRefunded {
  provider: PaymentProvider;
  /** The same object id passed to onPaymentSucceeded. */
  objectId: string;
  /** Cumulative refunded amount (Stripe charge.amount_refunded), minor units. */
  refundedMinor: number;
  totalMinor: number;
}

export type BountyDecision =
  | { kind: 'bounty_year' | 'bounty_month' | 'bounty_upgrade'; amountMinor: number; currency: string; rate: number; reason: string }
  | { kind: null; reason: string };

interface PriorPayment { interval: string; paidAt: Date }

/** Net of KDV. Uses the provider's tax figure; falls back to gross / 1.20 for TRY ("+KDV" prices). */
export function netOfTax(grossMinor: number, taxMinor: number | null, currency: string): { netMinor: number; estimated: boolean } {
  if (taxMinor != null && taxMinor > 0) return { netMinor: Math.max(0, grossMinor - taxMinor), estimated: false };
  if (currency.toLowerCase() === 'try') return { netMinor: Math.round(grossMinor / (1 + KDV_RATE)), estimated: true };
  return { netMinor: grossMinor, estimated: false };
}

/**
 * Pure rule engine (unit-tested). `prior` = this customer's earlier recorded subscription payments, oldest first.
 * `earnedMonthBounty` = a non-void bounty_month already earned for this customer (for the upgrade difference).
 */
export function decideBounty(args: {
  interval: 'year' | 'month';
  paidAt: Date;
  netMinor: number;
  currency: string;
  prior: PriorPayment[];
  earnedMonthBounty: { amountMinor: number; currency: string } | null;
  alreadyHasYearOrUpgrade: boolean;
  payingReferralsBefore: number;
  tierThreshold: number;
}): BountyDecision {
  const { interval, prior } = args;
  if (args.netMinor <= 0) return { kind: null, reason: 'zero amount' };
  if (interval === 'month') {
    if (prior.some((p) => p.interval === 'year')) return { kind: null, reason: 'monthly after yearly' };
    const priorMonths = prior.filter((p) => p.interval === 'month').length;
    if (priorMonths !== 1) return { kind: null, reason: priorMonths === 0 ? 'first monthly payment' : 'monthly renewal' };
    if (args.earnedMonthBounty) return { kind: null, reason: 'monthly bounty already earned' };
    return { kind: 'bounty_month', amountMinor: MONTH_BOUNTY_MINOR, currency: MONTH_BOUNTY_CURRENCY, rate: 0, reason: 'month: 2nd payment' };
  }
  // yearly
  if (args.alreadyHasYearOrUpgrade || prior.some((p) => p.interval === 'year')) return { kind: null, reason: 'yearly renewal' };
  const rate = args.payingReferralsBefore >= args.tierThreshold ? YEAR_TIER_RATE : YEAR_RATE;
  const yearly = Math.round(args.netMinor * rate);
  const firstMonth = prior.find((p) => p.interval === 'month');
  if (!firstMonth) {
    return { kind: 'bounty_year', amountMinor: yearly, currency: args.currency, rate, reason: `year ${Math.round(rate * 100)}%` };
  }
  const days = (args.paidAt.getTime() - firstMonth.paidAt.getTime()) / DAY_MS;
  if (days > UPGRADE_WINDOW_DAYS) return { kind: null, reason: `upgrade after ${Math.floor(days)} days` };
  const already = args.earnedMonthBounty && args.earnedMonthBounty.currency === args.currency ? args.earnedMonthBounty.amountMinor : 0;
  const diff = Math.max(0, yearly - already);
  if (diff <= 0) return { kind: null, reason: 'upgrade difference is zero' };
  return { kind: 'bounty_upgrade', amountMinor: diff, currency: args.currency, rate, reason: `upgrade within ${Math.floor(days)} days: year ${Math.round(rate * 100)}% − month bounty` };
}

/** Is this customer allowed to earn their partner anything? Same exclusions as attribution (acquisition.ts). */
async function eligiblePartner(userId: string) {
  const acq = await prisma.userAcquisition.findUnique({ where: { userId }, select: { partnerId: true } });
  if (!acq?.partnerId) return null;
  const [partner, user] = await Promise.all([
    prisma.partner.findUnique({ where: { id: acq.partnerId }, select: { id: true, status: true, tierThreshold: true, email: true, userId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: EXCLUSION_USER_SELECT }),
  ]);
  if (!partner || partner.status === 'terminated' || !user) return null;
  if (partner.userId === userId || isExcluded(user, partner)) return null;
  return partner;
}

export type SucceededResult = { status: 'recorded'; kind: BountyKind | null; reason: string } | { status: 'skipped'; reason: string } | { status: 'duplicate' };

export async function onPaymentSucceeded(p: PaymentSucceeded): Promise<SucceededResult> {
  const partner = await eligiblePartner(p.userId);
  if (!partner) return { status: 'skipped', reason: 'not a partner referral' };
  if (await prisma.partnerPaymentEvent.findUnique({ where: { objectId: p.objectId }, select: { id: true } })) return { status: 'duplicate' };

  const { netMinor, estimated } = netOfTax(p.grossMinor, p.taxMinor, p.currency);
  if (estimated) logger.warn('Partner bounty: no tax amount, net estimated at 20% KDV', { provider: p.provider, objectId: p.objectId });

  const [prior, monthBounty, yearOrUpgrade, payingBefore] = await Promise.all([
    prisma.partnerPaymentEvent.findMany({ where: { userId: p.userId, paidAt: { lte: p.paidAt } }, orderBy: { paidAt: 'asc' }, select: { interval: true, paidAt: true } }),
    prisma.partnerCommission.findFirst({ where: { userId: p.userId, kind: 'bounty_month', status: { not: 'void' } }, select: { commissionMinor: true, currency: true } }),
    prisma.partnerCommission.count({ where: { userId: p.userId, kind: { in: ['bounty_year', 'bounty_upgrade'] }, status: { not: 'void' } } }),
    prisma.partnerCommission.findMany({
      where: { partnerId: partner.id, kind: { in: ['bounty_year', 'bounty_month', 'bounty_upgrade'] }, status: { not: 'void' }, userId: { not: p.userId } },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const decision = decideBounty({
    interval: p.interval,
    paidAt: p.paidAt,
    netMinor,
    currency: p.currency.toLowerCase(),
    prior,
    earnedMonthBounty: monthBounty ? { amountMinor: monthBounty.commissionMinor, currency: monthBounty.currency } : null,
    alreadyHasYearOrUpgrade: yearOrUpgrade > 0,
    payingReferralsBefore: payingBefore.length,
    tierThreshold: partner.tierThreshold,
  });

  try {
    await prisma.partnerPaymentEvent.create({
      data: { userId: p.userId, provider: p.provider, objectId: p.objectId, interval: p.interval, planKey: p.planKey ?? null, paidAt: p.paidAt, currency: p.currency.toLowerCase(), grossMinor: p.grossMinor, netMinor },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return { status: 'duplicate' };
    throw e;
  }

  if (decision.kind) {
    try {
      await prisma.partnerCommission.create({
        data: {
          partnerId: partner.id,
          userId: p.userId,
          stripeObjectId: p.objectId,
          provider: p.provider,
          kind: decision.kind,
          reason: decision.reason,
          paidAt: p.paidAt,
          currency: decision.currency,
          grossMinor: p.grossMinor,
          taxMinor: p.grossMinor - netMinor,
          netMinor,
          rate: decision.rate,
          earnedMinor: decision.amountMinor,
          commissionMinor: decision.amountMinor,
          status: 'pending',
          payableAt: new Date(p.paidAt.getTime() + HOLD_DAYS * DAY_MS),
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
    }
  }
  return { status: 'recorded', kind: decision.kind, reason: decision.reason };
}

export type RefundedResult = { status: 'none' } | { status: 'voided' | 'reduced' | 'reversed' | 'unchanged'; commissionMinor: number };

export async function onPaymentRefunded(r: PaymentRefunded): Promise<RefundedResult> {
  const row = await prisma.partnerCommission.findUnique({ where: { stripeObjectId: r.objectId } });
  if (!row || row.kind === 'reversal' || r.totalMinor <= 0) return { status: 'none' };
  const ratio = Math.min(1, Math.max(0, r.refundedMinor / r.totalMinor));
  const earned = row.earnedMinor ?? row.commissionMinor;
  const keep = Math.round(earned * (1 - ratio));

  if (row.status !== 'paid') {
    if (row.status === 'void') return { status: 'unchanged', commissionMinor: 0 };
    if (keep <= 0) {
      await prisma.partnerCommission.update({ where: { id: row.id }, data: { status: 'void', commissionMinor: 0, reason: `${row.reason ?? ''}; refunded`.trim() } });
      return { status: 'voided', commissionMinor: 0 };
    }
    if (keep === row.commissionMinor) return { status: 'unchanged', commissionMinor: keep };
    await prisma.partnerCommission.update({ where: { id: row.id }, data: { commissionMinor: keep, reason: `${row.reason ?? ''}; partial refund ${Math.round(ratio * 100)}%`.trim() } });
    return { status: 'reduced', commissionMinor: keep };
  }

  // Already paid: claw back through negative reversal rows netted against later payouts. The id carries the
  // cumulative refunded amount, so a replayed or later partial refund only adds the missing difference.
  const target = -(row.commissionMinor - keep);
  const existing = await prisma.partnerCommission.aggregate({
    where: { kind: 'reversal', stripeObjectId: { startsWith: `${r.objectId}:rev:` } },
    _sum: { commissionMinor: true },
  });
  const delta = target - (existing._sum.commissionMinor ?? 0);
  if (delta >= 0) return { status: 'unchanged', commissionMinor: keep };
  try {
    await prisma.partnerCommission.create({
      data: {
        partnerId: row.partnerId,
        userId: row.userId,
        stripeObjectId: `${r.objectId}:rev:${r.refundedMinor}`,
        provider: row.provider,
        kind: 'reversal',
        reason: `refund after payout (${Math.round(ratio * 100)}%)`,
        paidAt: new Date(),
        currency: row.currency,
        grossMinor: 0,
        taxMinor: 0,
        netMinor: 0,
        rate: 0,
        earnedMinor: delta,
        commissionMinor: delta,
        status: 'payable',
        payableAt: new Date(),
      },
    });
  } catch (e) {
    if ((e as { code?: string })?.code !== 'P2002') throw e;
  }
  return { status: 'reversed', commissionMinor: keep };
}

/** pending → payable once the 30-day hold has passed. Cron + payout run + report all call it. */
export async function promoteDueBounties(now = new Date()): Promise<number> {
  const r = await prisma.partnerCommission.updateMany({ where: { status: 'pending', payableAt: { lte: now } }, data: { status: 'payable' } });
  return r.count;
}
