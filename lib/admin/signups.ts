// lib/admin/signups.ts — /admin/signups: who signed up, from where, and whether they reached a connected store and a
// first order (turkey-gameplan §4.1: activated = store connected within 7 days). Admin only (the API is withAdmin).
// Contact details are for onboarding follow-up by the KolayXport team only.
// Excluded from every count: admins, reviewer accounts, *.test addresses (isSkippedAccount minus the Shopify rule:
// Shopify sign-ups are real users and are shown, flagged).
import prisma from '@/lib/prisma';
import { MARKETPLACE_PROVIDERS, getConnectionStatus } from '@/lib/integrations/connectionStatus';
import { reviewAccountEmails } from '@/lib/partners/acquisition';
import { activationLine, summarizeActivation, type ActivationSummary } from '@/lib/activation/events';

const DAY_MS = 86_400_000;
export const ACTIVATION_DAYS = 7;

export interface SignupRow {
  createdAt: string;
  name: string | null;
  email: string;
  source: string; // partner code, ref code, utm_source, or "direct"
  via: string | null;
  stores: string[];
  firstOrderAt: string | null;
  activated: boolean; // store connected (or an order) within 7 days of signup
  plan: string | null;
  status: string | null;
  shopify: boolean;
  remindersSent: string[];
  /** First-party activation events (lib/activation/events.ts): visits, checklist, connect clicks, OAuth results. */
  activity: ActivationSummary;
  activityLine: string;
}

export interface Funnel { signups: number; connected: number; withOrder: number; activated: number; connectRate: number; orderRate: number }
export interface SignupsReport { days: number; rows: SignupRow[]; totals: Funnel; byDay: Array<{ day: string } & Funnel>; bySource: Array<{ source: string } & Funnel> }

/** Pure: funnel counts + rates (0..1, 0 when no signups). */
export function funnel(rows: Pick<SignupRow, 'stores' | 'firstOrderAt' | 'activated'>[]): Funnel {
  const signups = rows.length;
  const connected = rows.filter((r) => r.stores.length > 0).length;
  const withOrder = rows.filter((r) => r.firstOrderAt).length;
  const activated = rows.filter((r) => r.activated).length;
  return { signups, connected, withOrder, activated, connectRate: signups ? connected / signups : 0, orderRate: signups ? withOrder / signups : 0 };
}

/** Pure: where a signup came from, most specific first. */
export function sourceOf(acq: { refCode: string | null; utmSource: string | null; partner: { code: string } | null } | null): string {
  if (!acq) return 'direct';
  return acq.partner?.code || acq.refCode || acq.utmSource || 'direct';
}

export function isHiddenAccount(u: { email: string | null; role: string | null }): boolean {
  const email = (u.email || '').toLowerCase();
  return !email || email.endsWith('.test') || u.role === 'admin' || reviewAccountEmails().has(email);
}

export async function loadSignups(days = 30, now: Date = new Date()): Promise<SignupsReport> {
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - days * DAY_MS) } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: {
      id: true, createdAt: true, name: true, email: true, role: true, subscriptionPlan: true, subscriptionStatus: true, billingProvider: true,
      acquisition: { select: { refCode: true, utmSource: true, via: true, partner: { select: { code: true } } } },
      activationEmails: { select: { step: true } },
      shopifyShops: { select: { id: true, createdAt: true }, where: { isActive: true }, take: 1 },
    },
  });
  // Activation events of these users in one query (SyncLog rows, category 'activation').
  const visibleIds = users.filter((u) => !isHiddenAccount(u)).map((u) => u.id);
  const events = visibleIds.length
    ? await prisma.syncLog.findMany({
        where: { category: 'activation', userId: { in: visibleIds } } as any,
        select: { userId: true, message: true, details: true, timestamp: true },
        orderBy: { timestamp: 'asc' },
        take: 20000,
      })
    : [];
  const eventsBy = new Map<string, typeof events>();
  for (const e of events) if (e.userId) eventsBy.set(e.userId, [...(eventsBy.get(e.userId) ?? []), e]);
  const rows: SignupRow[] = [];
  for (const u of users) {
    if (isHiddenAccount(u)) continue;
    const [status, firstOrder] = await Promise.all([
      getConnectionStatus(u.id),
      prisma.order.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    const stores = MARKETPLACE_PROVIDERS.filter((p) => status.connections[p]?.connected);
    // A connection's own date isn't stored for every provider; the first order (or Shopify shop) is the reliable clock.
    const firstSignal = [firstOrder?.createdAt, u.shopifyShops[0]?.createdAt].filter(Boolean).map((d) => d!.getTime()).sort()[0];
    const activated = firstSignal !== undefined
      ? firstSignal - u.createdAt.getTime() <= ACTIVATION_DAYS * DAY_MS
      : stores.length > 0 && now.getTime() - u.createdAt.getTime() <= ACTIVATION_DAYS * DAY_MS;
    rows.push({
      createdAt: u.createdAt.toISOString(),
      name: u.name,
      email: u.email!,
      source: sourceOf(u.acquisition),
      via: u.acquisition?.via ?? null,
      stores,
      firstOrderAt: firstOrder ? firstOrder.createdAt.toISOString() : null,
      activated,
      plan: u.subscriptionPlan,
      status: u.subscriptionStatus,
      shopify: u.billingProvider === 'shopify' || u.billingProvider === 'shopify_free' || u.shopifyShops.length > 0,
      remindersSent: u.activationEmails.map((e) => e.step).sort(),
      ...(() => {
        const activity = summarizeActivation(eventsBy.get(u.id) ?? []);
        return { activity, activityLine: activationLine(activity) };
      })(),
    });
  }
  const group = <K extends string>(key: (r: SignupRow) => K) => {
    const m = new Map<K, SignupRow[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const byDay = Array.from(group((r) => r.createdAt.slice(0, 10)).entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([day, rs]) => ({ day, ...funnel(rs) }));
  const bySource = Array.from(group((r) => r.source).entries()).map(([source, rs]) => ({ source, ...funnel(rs) })).sort((a, b) => b.signups - a.signups);
  return { days, rows, totals: funnel(rows), byDay, bySource };
}

export function signupsToCsv(r: SignupsReport): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['signed_up_at', 'name', 'email', 'source', 'via', 'stores', 'first_order_at', 'activated', 'plan', 'status', 'shopify', 'reminders_sent', 'activity'];
  return [head.join(','), ...r.rows.map((x) => [x.createdAt, x.name, x.email, x.source, x.via, x.stores.join(' '), x.firstOrderAt, x.activated, x.plan, x.status, x.shopify, x.remindersSent.join(' '), x.activityLine].map(esc).join(','))].join('\n');
}
