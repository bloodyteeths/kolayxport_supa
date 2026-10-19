// lib/partners/report.ts — partner report (docs/gtm/referral-spec.md §4), admin only. Counts and money, never who
// signed up (KVKK): per partner signups / activated / trialing / paying / revenue / commission, plus an "unattributed"
// block grouped by utm_source.
//
// Activated = a marketplace connected ≤ 7 days after signup:
//  - store rows with a timestamp (EtsyShop, ShopifyShop, WixSite) created within 7 days  → source 'store'
//  - token-only marketplaces (eBay, Amazon, Trendyol, Hepsiburada) have no connection timestamp, so the proxy is a
//    first synced order within 7 days, or "connected right now" while the user is still inside the 7 days → 'proxy'.
//    The proxy undercounts sellers who connected one of those but had no order yet (footnote in the UI / CSV).
import prisma from '@/lib/prisma';
import { MARKETPLACE_PROVIDERS, getConnectionStatus } from '@/lib/integrations/connectionStatus';

const DAY_MS = 86_400_000;
export const ACTIVATION_DAYS = 7;
const PAID_PLANS = new Set(['starter', 'growth', 'pro', 'enterprise']);

export interface ReportUser {
  userId: string;
  partnerId: string | null;
  refCode: string | null;
  utmSource: string | null;
  signedUpAt: Date;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  billingProvider: string | null;
  activation: 'store' | 'proxy' | null;
}

export interface MoneyRow {
  partnerId: string;
  currency: string;
  status: string;
  netMinor: number;
  commissionMinor: number;
}

export interface PartnerRow {
  partnerId: string | null;
  code: string;
  name: string;
  status: string;
  signups: number;
  activated: number;
  activatedStore: number;
  activatedProxy: number;
  trialing: number;
  paying: number;
  /** per currency, minor units */
  netRevenue: Record<string, number>;
  commissionPending: Record<string, number>;
  commissionPayable: Record<string, number>;
  commissionPaid: Record<string, number>;
}

export interface PartnerReport {
  month: string | null;
  partners: PartnerRow[];
  unattributed: Array<{ utmSource: string; signups: number; activated: number; paying: number }>;
  totals: { signups: number; activated: number; paying: number };
  footnote: string;
}

export const ACTIVATION_FOOTNOTE =
  'Activated: Etsy / Shopify / Wix counted by connection date; eBay / Amazon / Trendyol / Hepsiburada are a proxy (first synced order within 7 days, or connected now during the first 7 days) and undercount sellers with no order yet.';

const isTrialing = (u: ReportUser) => u.subscriptionStatus === 'trialing' || u.subscriptionPlan === 'trial';
const isPaying = (u: ReportUser) =>
  u.billingProvider === 'stripe' && u.subscriptionStatus === 'active' && PAID_PLANS.has(String(u.subscriptionPlan));

const add = (m: Record<string, number>, cur: string, v: number) => { m[cur] = (m[cur] ?? 0) + v; };

/** Pure aggregation (unit-tested). */
export function buildReport(
  month: string | null,
  partners: Array<{ id: string; code: string; name: string; status: string }>,
  users: ReportUser[],
  money: MoneyRow[],
): PartnerReport {
  const rows = new Map<string, PartnerRow>();
  const empty = (p: { id: string | null; code: string; name: string; status: string }): PartnerRow => ({
    partnerId: p.id, code: p.code, name: p.name, status: p.status, signups: 0, activated: 0, activatedStore: 0, activatedProxy: 0,
    trialing: 0, paying: 0, netRevenue: {}, commissionPending: {}, commissionPayable: {}, commissionPaid: {},
  });
  for (const p of partners) rows.set(p.id, empty(p));
  const unattributed = new Map<string, { utmSource: string; signups: number; activated: number; paying: number }>();
  for (const u of users) {
    if (u.partnerId && rows.has(u.partnerId)) {
      const r = rows.get(u.partnerId)!;
      r.signups++;
      if (u.activation) {
        r.activated++;
        if (u.activation === 'store') r.activatedStore++; else r.activatedProxy++;
      }
      if (isTrialing(u)) r.trialing++;
      if (isPaying(u)) r.paying++;
    } else {
      const key = u.utmSource || (u.refCode ? `ref:${u.refCode}` : '(direct)');
      const g = unattributed.get(key) ?? { utmSource: key, signups: 0, activated: 0, paying: 0 };
      g.signups++;
      if (u.activation) g.activated++;
      if (isPaying(u)) g.paying++;
      unattributed.set(key, g);
    }
  }
  for (const m of money) {
    const r = rows.get(m.partnerId);
    if (!r) continue;
    if (m.status !== 'void') add(r.netRevenue, m.currency, m.netMinor);
    if (m.status === 'pending') add(r.commissionPending, m.currency, m.commissionMinor);
    if (m.status === 'payable') add(r.commissionPayable, m.currency, m.commissionMinor);
    if (m.status === 'paid') add(r.commissionPaid, m.currency, m.commissionMinor);
  }
  const partnerRows = [...rows.values()].sort((a, b) => b.signups - a.signups || a.code.localeCompare(b.code));
  return {
    month,
    partners: partnerRows,
    unattributed: [...unattributed.values()].sort((a, b) => b.signups - a.signups),
    totals: {
      signups: users.length,
      activated: users.filter((u) => u.activation).length,
      paying: users.filter(isPaying).length,
    },
    footnote: ACTIVATION_FOOTNOTE,
  };
}

/** "YYYY-MM" → [start, end) in UTC, or null for all time. */
export function monthRange(month: string | null | undefined): { start: Date; end: Date } | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

async function activationFor(userId: string, signedUpAt: Date, now: Date): Promise<'store' | 'proxy' | null> {
  const deadline = new Date(signedUpAt.getTime() + ACTIVATION_DAYS * DAY_MS);
  const within = { lte: deadline };
  const [etsy, shopify, wix] = await Promise.all([
    prisma.etsyShop.count({ where: { userId, createdAt: within } }),
    prisma.shopifyShop.count({ where: { userId, createdAt: within } }),
    prisma.wixSite.count({ where: { userId, createdAt: within } }),
  ]);
  if (etsy + shopify + wix > 0) return 'store';
  if ((await prisma.order.count({ where: { userId, createdAt: within } })) > 0) return 'proxy';
  if (now < deadline) {
    try {
      const status = await getConnectionStatus(userId);
      if (MARKETPLACE_PROVIDERS.some((p) => status.connections[p]?.connected)) return 'proxy';
    } catch {
      /* status is best-effort */
    }
  }
  return null;
}

export async function loadPartnerReport(month: string | null, now = new Date()): Promise<PartnerReport> {
  const range = monthRange(month);
  const [partners, acquisitions] = await Promise.all([
    prisma.partner.findMany({ select: { id: true, code: true, name: true, status: true }, orderBy: { code: 'asc' } }),
    prisma.userAcquisition.findMany({
      where: range ? { capturedAt: { gte: range.start, lt: range.end } } : {},
      select: {
        userId: true, partnerId: true, refCode: true, utmSource: true,
        user: { select: { createdAt: true, subscriptionPlan: true, subscriptionStatus: true, billingProvider: true } },
      },
    }),
  ]);
  const users: ReportUser[] = [];
  for (const a of acquisitions) {
    users.push({
      userId: a.userId,
      partnerId: a.partnerId,
      refCode: a.refCode,
      utmSource: a.utmSource,
      signedUpAt: a.user.createdAt,
      subscriptionPlan: a.user.subscriptionPlan,
      subscriptionStatus: a.user.subscriptionStatus,
      billingProvider: a.user.billingProvider,
      activation: await activationFor(a.userId, a.user.createdAt, now),
    });
  }
  const money = await prisma.partnerCommission.groupBy({
    by: ['partnerId', 'currency', 'status'],
    where: range ? { paidAt: { gte: range.start, lt: range.end } } : {},
    _sum: { netMinor: true, commissionMinor: true },
  });
  return buildReport(
    range ? month! : null,
    partners,
    users,
    money.map((m) => ({ partnerId: m.partnerId, currency: m.currency, status: m.status, netMinor: m._sum.netMinor ?? 0, commissionMinor: m._sum.commissionMinor ?? 0 })),
  );
}

/** CSV with counts and money only (no user identifiers). */
export function reportToCsv(r: PartnerReport): string {
  const money = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => `${(v / 100).toFixed(2)} ${c.toUpperCase()}`).join(' + ');
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [
    ['code', 'name', 'status', 'signups', 'activated', 'activated_store', 'activated_proxy', 'trialing', 'paying', 'net_revenue', 'commission_pending', 'commission_payable', 'commission_paid'].join(','),
    ...r.partners.map((p) => [p.code, p.name, p.status, p.signups, p.activated, p.activatedStore, p.activatedProxy, p.trialing, p.paying, money(p.netRevenue), money(p.commissionPending), money(p.commissionPayable), money(p.commissionPaid)].map(esc).join(',')),
    '',
    'unattributed_source,signups,activated,paying',
    ...r.unattributed.map((u) => [u.utmSource, u.signups, u.activated, u.paying].map(esc).join(',')),
    '',
    `# ${r.footnote}`,
  ];
  return `${lines.join('\n')}\n`;
}
