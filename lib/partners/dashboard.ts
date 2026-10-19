// lib/partners/dashboard.ts — data for the partner's own dashboard (/app/ortaklik, docs/gtm/referral-spec.md §4.2).
// A partner sees only their own referrals, masked: "A*** Y" (first letter of first name + *** + first letter of the
// surname), plan + interval, status, bounty. Never e-mails, store names or full names.
import prisma from '@/lib/prisma';
import { EXCLUSION_USER_SELECT } from './acquisition';
import { promoteDueBounties } from './bounty';

const DAY_MS = 86_400_000;
const ACTIVATION_DAYS = 7;

/** "Ayşe Nur Yılmaz" → "A*** Y"; one word → "A***"; nothing → "***". */
export function maskName(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '***';
  const first = parts[0][0].toLocaleUpperCase('tr-TR');
  if (parts.length === 1) return `${first}***`;
  return `${first}*** ${parts[parts.length - 1][0].toLocaleUpperCase('tr-TR')}`;
}

export type ReferralStatus = 'deneme' | 'aktif' | 'odedi' | 'iptal';

/** Signup → deneme, a store connected → aktif, any plan payment → ödedi, subscription ended → iptal. */
export function referralStatus(u: { subscriptionStatus: string | null; paid: boolean; activated: boolean }): ReferralStatus {
  if (u.subscriptionStatus === 'canceled' || u.subscriptionStatus === 'expired' || u.subscriptionStatus === 'unpaid') return 'iptal';
  if (u.paid) return 'odedi';
  if (u.activated) return 'aktif';
  return 'deneme';
}

/** The partner this login may see, or null. Shopify-connected accounts never see referral money (App Store 1.2.1). */
export async function partnerForUser(userId: string) {
  const [partner, user] = await Promise.all([
    prisma.partner.findUnique({ where: { userId }, select: { id: true, code: true, name: true, status: true, stripeRecipientId: true, email: true, promoCodeText: true, stripePromotionCode: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: EXCLUSION_USER_SELECT }),
  ]);
  if (!partner || partner.status === 'terminated' || !user) return null;
  const shopify = user.billingProvider === 'shopify' || user.billingProvider === 'shopify_free' || user.subscriptionPlan === 'shopify_free' || user.shopifyShops.length > 0;
  return shopify ? null : partner;
}

type Money = Record<string, number>;
const add = (m: Money, cur: string, v: number) => { m[cur] = (m[cur] ?? 0) + v; };

export async function loadPartnerDashboard(partnerId: string, now = new Date()) {
  await promoteDueBounties(now);
  const acquisitions = await prisma.userAcquisition.findMany({
    where: { partnerId },
    orderBy: { capturedAt: 'desc' },
    take: 500,
    select: {
      userId: true,
      capturedAt: true,
      user: { select: { name: true, createdAt: true, subscriptionPlan: true, subscriptionStatus: true, billingInterval: true } },
    },
  });
  const userIds = acquisitions.map((a) => a.userId);
  const [bounties, payments, etsy, shopify, wix, payouts] = await Promise.all([
    prisma.partnerCommission.findMany({ where: { partnerId }, select: { userId: true, kind: true, status: true, currency: true, commissionMinor: true, paidAt: true, payableAt: true } }),
    prisma.partnerPaymentEvent.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } }),
    prisma.etsyShop.findMany({ where: { userId: { in: userIds } }, select: { userId: true, createdAt: true } }),
    prisma.shopifyShop.findMany({ where: { userId: { in: userIds } }, select: { userId: true, createdAt: true } }),
    prisma.wixSite.findMany({ where: { userId: { in: userIds } }, select: { userId: true, createdAt: true } }),
    prisma.partnerPayout.findMany({ where: { partnerId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, period: true, amountMinor: true, currency: true, status: true, paidAt: true, createdAt: true } }),
  ]);
  const paid = new Set(payments.map((p) => p.userId));
  const firstStore = new Map<string, Date>();
  for (const s of [...etsy, ...shopify, ...wix]) {
    if (!s.userId) continue;
    const prev = firstStore.get(s.userId);
    if (!prev || s.createdAt < prev) firstStore.set(s.userId, s.createdAt);
  }
  const byUser = new Map<string, typeof bounties>();
  for (const b of bounties) byUser.set(b.userId, [...(byUser.get(b.userId) ?? []), b]);

  const totals = { signups: acquisitions.length, activated: 0, paying: 0, pending: {} as Money, payable: {} as Money, paid: {} as Money };
  for (const b of bounties) {
    if (b.status === 'pending') add(totals.pending, b.currency, b.commissionMinor);
    if (b.status === 'payable') add(totals.payable, b.currency, b.commissionMinor);
    if (b.status === 'paid') add(totals.paid, b.currency, b.commissionMinor);
  }
  const referrals = acquisitions.map((a, i) => {
    const store = firstStore.get(a.userId);
    const activated = Boolean(store && store.getTime() - a.user.createdAt.getTime() <= ACTIVATION_DAYS * DAY_MS);
    if (activated) totals.activated++;
    if (paid.has(a.userId)) totals.paying++;
    const own = (byUser.get(a.userId) ?? []).filter((b) => b.kind !== 'reversal');
    const live = own.filter((b) => b.status !== 'void');
    const bounty = live.length
      ? { amountMinor: live.reduce((s, b) => s + b.commissionMinor, 0), currency: live[0].currency, status: live.some((b) => b.status === 'pending') ? 'pending' : live.every((b) => b.status === 'paid') ? 'paid' : 'payable', payableAt: live[0].payableAt }
      : own.length ? { amountMinor: 0, currency: own[0].currency, status: 'void', payableAt: null } : null;
    return {
      // Row key only: position in this list, not a user id.
      key: `r${i + 1}`,
      name: maskName(a.user.name),
      plan: a.user.subscriptionPlan,
      interval: a.user.billingInterval,
      status: referralStatus({ subscriptionStatus: a.user.subscriptionStatus, paid: paid.has(a.userId), activated }),
      signedUpAt: a.capturedAt,
      bounty,
    };
  });
  return { totals, referrals, payouts };
}
