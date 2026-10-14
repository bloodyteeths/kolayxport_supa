/**
 * Dispatch state, ship-by rollup alerts and dispatch health (W4 T12).
 *
 * dispatchState for an open Etsy order:
 *   no_label          — no KolayXport label and no tracking number
 *   label_not_pushed  — a label/tracking exists but Etsy does not show it shipped
 *   shipped_on_etsy   — Etsy shows the receipt shipped (shipments[] / is_shipped)
 *
 * Alerts are ROLLUPS per user, per stage, per local day (dedupeKey
 * `dispatch:<stage>:<localDate>`), never one row per order:
 *   due_tomorrow  — digest, raised once after 09:00 local
 *   due_today     — raised once
 *   overdue       — re-raised only when the count rises
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify, resolveByPrefix, NOTIFICATION_LINKS } from '@/lib/notifications';
import { classifyOrderStatus, hasLegacyOrderLabel, isCancelledStatus } from './orderStatus';

export type DispatchState = 'no_label' | 'label_not_pushed' | 'shipped_on_etsy';
export type DispatchStage = 'due_tomorrow' | 'due_today' | 'overdue';

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';
const DIGEST_HOUR = 9;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** YYYY-MM-DD of `d` in `tz`. */
export function localDateKey(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: safeTimeZone(tz), hour: '2-digit', hourCycle: 'h23' }).format(d);
  return Number(h) % 24;
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function dispatchStage(shipByAt: Date, now: Date, tz: string): DispatchStage | null {
  const sd = localDateKey(shipByAt, tz);
  const today = localDateKey(now, tz);
  if (sd < today) return 'overdue';
  if (sd === today) return 'due_today';
  if (sd === addDaysKey(today, 1)) return 'due_tomorrow';
  return null;
}

/** Shipped after the ship-by DAY (in the seller's timezone). */
export function isShippedLate(shippedAt: Date, shipByAt: Date, tz: string = DEFAULT_TIMEZONE): boolean {
  return localDateKey(shippedAt, tz) > localDateKey(shipByAt, tz);
}

export function etsyReceiptShipped(rawData: any): boolean {
  if (!rawData || typeof rawData !== 'object') return false;
  const ships = Array.isArray(rawData.shipments) ? rawData.shipments : [];
  return ships.some((s: any) => s && (s.tracking_code || s.shipment_notification_timestamp)) || rawData.is_shipped === true;
}

export function computeDispatchState(o: {
  rawData: any;
  trackingNumber?: string | null;
  hasActiveShipment: boolean;
  hasLegacyLabel?: boolean;
}): DispatchState {
  if (etsyReceiptShipped(o.rawData)) return 'shipped_on_etsy';
  if (o.hasActiveShipment || o.hasLegacyLabel || (o.trackingNumber && o.trackingNumber.trim())) return 'label_not_pushed';
  return 'no_label';
}

export type DispatchCandidate = { orderNumber: string; shipByAt: Date; state: DispatchState };

export type DispatchRollup = { stage: DispatchStage; localDate: string; count: number; labelNotPushed: number; orderNumbers: string };

/** Pure: one rollup per stage for today's local date (orders shipped on Etsy are excluded). */
export function buildDispatchRollups(orders: DispatchCandidate[], now: Date, tz: string): DispatchRollup[] {
  const today = localDateKey(now, tz);
  const byStage = new Map<DispatchStage, DispatchCandidate[]>();
  for (const o of orders) {
    if (o.state === 'shipped_on_etsy') continue;
    const stage = dispatchStage(o.shipByAt, now, tz);
    if (!stage) continue;
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(o);
  }
  const out: DispatchRollup[] = [];
  for (const stage of ['overdue', 'due_today', 'due_tomorrow'] as DispatchStage[]) {
    const list = (byStage.get(stage) || []).slice().sort((a, b) => a.shipByAt.getTime() - b.shipByAt.getTime());
    if (list.length === 0) continue;
    out.push({
      stage,
      localDate: today,
      count: list.length,
      labelNotPushed: list.filter((o) => o.state === 'label_not_pushed').length,
      orderNumbers: list.slice(0, 5).map((o) => o.orderNumber).join(', '),
    });
  }
  return out;
}

export function dispatchDedupeKey(stage: DispatchStage, localDate: string): string {
  return `dispatch:${stage}:${localDate}`;
}

/**
 * Pure: how to raise a rollup given the currently stored row (if any).
 *  - 'skip'    : not yet (digest before 09:00)
 *  - 'refresh' : update params silently (onlyIfNew)
 *  - 'raise'   : (re-)raise
 */
export function rollupAction(r: DispatchRollup, existing: { count: number | null; resolved: boolean } | null, hourLocal: number): 'skip' | 'refresh' | 'raise' {
  if (r.stage === 'due_tomorrow' && hourLocal < DIGEST_HOUR && !existing) return 'skip';
  if (!existing || existing.resolved) return 'raise';
  if (r.stage === 'overdue' && existing.count !== null && r.count > existing.count) return 'raise';
  return 'refresh';
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const VOID_STATUSES = new Set(['voided', 'void_requested', 'error', 'failed', 'cancelled', 'canceled']);

function activeShipment(shipments: Array<{ status: string; trackingNumber: string | null; pdfUrl: string | null; voidedAt: Date | null }>): boolean {
  return shipments.some((s) => !s.voidedAt && !VOID_STATUSES.has(String(s.status || '').toLowerCase()) && !!(s.trackingNumber || s.pdfUrl));
}

async function userTimeZone(userId: string): Promise<string> {
  try {
    const s = await (prisma as any).notificationSettings?.findUnique?.({ where: { userId }, select: { timezone: true } });
    return safeTimeZone(s?.timezone);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

async function etsyMarketplacesFor(userId: string): Promise<string[]> {
  const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopName: true } });
  return Array.from(new Set(['Etsy', 'etsy', ...shops.map((s) => s.shopName).filter((n): n is string => !!n)]));
}

function isEtsyDirect(o: { source: string | null; rawData: any }): boolean {
  return o.source === 'etsy-api' || !!(o.rawData && typeof o.rawData === 'object' && (o.rawData as any).receipt_id);
}

/** Open Etsy orders with a ship-by date in [now-30d, now+3d] and their dispatch state. */
export async function loadOpenEtsyDispatch(userId: string, now = new Date()) {
  const marketplaces = await etsyMarketplacesFor(userId);
  const rows = await prisma.order.findMany({
    where: {
      userId,
      marketplace: { in: marketplaces },
      cancelledAt: null,
      shipByAt: { gte: new Date(now.getTime() - 30 * DAY_MS), lte: new Date(now.getTime() + 3 * DAY_MS) },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      externalStatus: true,
      source: true,
      rawData: true,
      trackingNumber: true,
      labelStatus: true,
      shippingLabelUrl: true,
      shipByAt: true,
      shipments: { select: { status: true, trackingNumber: true, pdfUrl: true, voidedAt: true } },
    },
    take: 2000,
  });
  return rows
    .filter((o) => isEtsyDirect(o) && !isCancelledStatus(o.status, o.externalStatus) && o.shipByAt)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      shipByAt: o.shipByAt as Date,
      state: computeDispatchState({
        rawData: o.rawData,
        trackingNumber: o.trackingNumber,
        hasActiveShipment: activeShipment(o.shipments),
        hasLegacyLabel: hasLegacyOrderLabel(o),
      }),
    }));
}

export async function runDispatchAlertsForUser(userId: string, now = new Date()): Promise<{ rollups: number; raised: number }> {
  const tz = await userTimeZone(userId);
  const orders = await loadOpenEtsyDispatch(userId, now);
  const rollups = buildDispatchRollups(orders, now, tz);
  const hour = localHour(now, tz);
  const keep: string[] = [];
  let raised = 0;
  for (const r of rollups) {
    const key = dispatchDedupeKey(r.stage, r.localDate);
    const row = await prisma.notification.findUnique({
      where: { userId_dedupeKey: { userId, dedupeKey: key } },
      select: { params: true, resolvedAt: true },
    });
    const prevCount = row?.params && typeof row.params === 'object' ? Number((row.params as any).count) : null;
    const action = rollupAction(r, row ? { count: Number.isFinite(prevCount as number) ? (prevCount as number) : null, resolved: !!row.resolvedAt } : null, hour);
    if (action === 'skip') continue;
    keep.push(key);
    const type = r.stage === 'overdue' ? 'dispatchOverdue' : r.stage === 'due_today' ? 'dispatchDueToday' : 'dispatchDueTomorrow';
    await notify(userId, {
      type,
      severity: r.stage === 'overdue' ? 'error' : r.stage === 'due_today' ? 'warning' : 'info',
      titleKey: `types.${type}`,
      params: { count: r.count, labelNotPushed: r.labelNotPushed, orderNumbers: r.orderNumbers },
      link: NOTIFICATION_LINKS.labels,
      dedupeKey: key,
      onlyIfNew: action === 'refresh',
      escalateOn: r.stage === 'overdue' ? 'count' : undefined,
    });
    if (action === 'raise') raised++;
  }
  // Clear stages that emptied out today and every previous day's rollups.
  await resolveByPrefix(userId, 'dispatch:', { exceptKeys: keep });
  return { rollups: rollups.length, raised };
}

export async function runDispatchAlerts(now = new Date()): Promise<{ users: number; rollups: number; raised: number }> {
  const shops = await prisma.etsyShop.findMany({ where: { isActive: true }, select: { userId: true }, distinct: ['userId'] });
  let rollups = 0;
  let raised = 0;
  for (const s of shops) {
    try {
      const r = await runDispatchAlertsForUser(s.userId, now);
      rollups += r.rollups;
      raised += r.raised;
    } catch (err) {
      logger.warn('[dispatch] alerts failed for user', { userId: s.userId, error: (err as Error)?.message });
    }
  }
  return { users: shops.length, rollups, raised };
}

// ---------------------------------------------------------------------------
// Dispatch health (Star Seller criterion 1/3)
// ---------------------------------------------------------------------------

export type DispatchHealth = {
  windowDays: number;
  onTimeRate: number | null;
  onTimeWithTrackingRate: number | null;
  shippedCount: number;
  lateCount: number;
  avgHandlingHours: number | null;
  deliveryDaysByCarrier: Array<{ carrier: string; p50: number; p90: number; n: number }>;
  openByState: Record<DispatchState, number>;
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export type HealthRow = {
  shippedAt: Date | null;
  shipByAt: Date | null;
  uiOrderDate: Date | null;
  deliveredAt: Date | null;
  trackingNumber: string | null;
  carrier: string | null;
};

/** Pure aggregation (exported for tests). */
export function aggregateDispatchHealth(rows: HealthRow[], tz: string, windowDays: number, openByState: Record<DispatchState, number>): DispatchHealth {
  const withShipBy = rows.filter((r) => r.shippedAt && r.shipByAt);
  const late = withShipBy.filter((r) => isShippedLate(r.shippedAt!, r.shipByAt!, tz));
  const onTime = withShipBy.length - late.length;
  const onTimeTracked = withShipBy.filter((r) => !isShippedLate(r.shippedAt!, r.shipByAt!, tz) && !!(r.trackingNumber && r.trackingNumber.trim())).length;
  const handling = rows
    .filter((r) => r.shippedAt && r.uiOrderDate && r.shippedAt.getTime() >= r.uiOrderDate.getTime())
    .map((r) => (r.shippedAt!.getTime() - r.uiOrderDate!.getTime()) / 3_600_000);
  const byCarrier = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.shippedAt || !r.deliveredAt || r.deliveredAt.getTime() < r.shippedAt.getTime()) continue;
    const c = (r.carrier || 'other').toUpperCase();
    if (!byCarrier.has(c)) byCarrier.set(c, []);
    byCarrier.get(c)!.push((r.deliveredAt.getTime() - r.shippedAt.getTime()) / DAY_MS);
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    windowDays,
    onTimeRate: withShipBy.length ? onTime / withShipBy.length : null,
    onTimeWithTrackingRate: withShipBy.length ? onTimeTracked / withShipBy.length : null,
    shippedCount: rows.filter((r) => r.shippedAt).length,
    lateCount: late.length,
    avgHandlingHours: handling.length ? round1(handling.reduce((a, b) => a + b, 0) / handling.length) : null,
    deliveryDaysByCarrier: [...byCarrier.entries()]
      .map(([carrier, days]) => {
        const s = days.slice().sort((a, b) => a - b);
        return { carrier, p50: round1(percentile(s, 50)), p90: round1(percentile(s, 90)), n: s.length };
      })
      .sort((a, b) => b.n - a.n),
    openByState,
  };
}

export async function getDispatchHealth(userId: string, days = 90): Promise<DispatchHealth> {
  const windowDays = Math.min(Math.max(Math.trunc(days) || 90, 7), 365);
  const tz = await userTimeZone(userId);
  const since = new Date(Date.now() - windowDays * DAY_MS);
  const marketplaces = await etsyMarketplacesFor(userId);
  const rows = await prisma.order.findMany({
    where: { userId, marketplace: { in: marketplaces }, shippedAt: { gte: since } },
    select: {
      status: true,
      externalStatus: true,
      source: true,
      rawData: true,
      shippedAt: true,
      shipByAt: true,
      uiOrderDate: true,
      deliveredAt: true,
      trackingNumber: true,
      shipments: { select: { carrier: true }, take: 1, orderBy: { createdAt: 'desc' } },
    },
    take: 10000,
  });
  const healthRows: HealthRow[] = rows
    .filter((r) => isEtsyDirect(r) && classifyOrderStatus(r.status, r.externalStatus) !== 'cancelled')
    .map((r) => {
      const ships = Array.isArray((r.rawData as any)?.shipments) ? (r.rawData as any).shipments : [];
      const carrier = r.shipments[0]?.carrier || (ships.length ? ships[ships.length - 1]?.carrier_name : null) || null;
      return {
        shippedAt: r.shippedAt,
        shipByAt: r.shipByAt,
        uiOrderDate: r.uiOrderDate,
        deliveredAt: r.deliveredAt,
        trackingNumber: r.trackingNumber || (ships.length ? ships[ships.length - 1]?.tracking_code : null) || null,
        carrier,
      };
    });
  const open = await loadOpenEtsyDispatch(userId);
  const openByState: Record<DispatchState, number> = { no_label: 0, label_not_pushed: 0, shipped_on_etsy: 0 };
  for (const o of open) openByState[o.state]++;
  return aggregateDispatchHealth(healthRows, tz, windowDays, openByState);
}
