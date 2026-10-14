/**
 * Hourly stock reconcile + retention + account changes (W2, T10). Server-only.
 *
 *  - Reads remote quantities for active links (Etsy from the
 *    EtsyListingOffering cache only — no API calls).
 *  - Drift = remote != target with no open push. Alerts as a daily
 *    stockDrift rollup. With autoFixDrift, a lower-only 'reconcile' push is
 *    enqueued for remotes ABOVE the target; remotes below the target are
 *    alert-only (raising is never automatic).
 *  - unattributedDrop expires after 72 h; observations are purged after 30 d.
 */
import prisma from '@/lib/prisma';
import { notify } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import { getAdapter } from './adapters';
import type { StockLinkRow } from './adapters/types';
import { computeLinkTarget } from './math';
import { enqueuePushes, STOCK_PAGE_LINK } from './engine';
import { OPEN_PUSH_STATUSES } from './echo';
import { channelEnabled, getStockSettings, isStockLive, isStockSyncActive } from './settings';
import type { StockChannel } from './types';

const DROP_TTL_MS = 72 * 3600 * 1000;
const OBS_TTL_MS = 30 * 24 * 3600 * 1000;
const PUSH_TTL_MS = 60 * 24 * 3600 * 1000;
const SNAPSHOT_GRACE_MS = 7 * 24 * 3600 * 1000;

export async function runStockReconcile(): Promise<{ users: number; links: number; drift: number; fixed: number }> {
  const users = await prisma.stockSettings.findMany({ where: { enabled: true }, select: { userId: true } });
  let linksChecked = 0;
  let drift = 0;
  let fixed = 0;
  await prisma.stockLink.updateMany({
    where: { unattributedDrop: { gt: 0 }, unattributedDropSince: { lt: new Date(Date.now() - DROP_TTL_MS) } },
    data: { unattributedDrop: 0, unattributedDropSince: null },
  });
  for (const { userId } of users) {
    const settings = await getStockSettings(userId, { fresh: true });
    if (!isStockSyncActive(settings)) continue;
    const links = (await prisma.stockLink.findMany({ where: { userId, status: 'active' }, include: { stockItem: true } })) as Array<StockLinkRow & { stockItem: any }>;
    if (!links.length) continue;
    const open = await prisma.stockPush.findMany({ where: { userId, status: { in: [...OPEN_PUSH_STATUSES, 'pending'] } }, select: { linkId: true } });
    const openSet = new Set(open.map((o) => o.linkId));
    const byChannel = new Map<string, typeof links>();
    for (const l of links) if (channelEnabled(settings, l.channel)) byChannel.set(l.channel, [...(byChannel.get(l.channel) || []), l]);
    let userDrift = 0;
    for (const [channel, ls] of Array.from(byChannel.entries())) {
      const adapter = getAdapter(channel);
      if (!adapter) continue;
      const remote = await adapter.readQuantities(userId, ls, { cacheOnly: channel === 'etsy' }).catch(() => new Map<string, { qty: number }>());
      const now = new Date();
      for (const l of ls) {
        const r = remote.get(l.id);
        if (!r) continue;
        linksChecked++;
        if (channel !== 'etsy') await prisma.stockLink.update({ where: { id: l.id }, data: { lastSeenRemoteQty: r.qty, lastSeenAt: now } });
        if (openSet.has(l.id) || l.stockItem.tracking !== 'tracked' || l.stockItem.status !== 'active') continue;
        const target = computeLinkTarget({ onHand: l.stockItem.onHand, safetyBuffer: l.stockItem.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty });
        if (r.qty === target) continue;
        drift++;
        userDrift++;
        publishLive(userId, { type: 'stock', kind: 'drift', stockItemId: l.stockItemId, linkId: l.id, channel });
        if (r.qty > target && settings!.autoFixDrift && isStockLive(settings)) {
          await enqueuePushes(l.stockItemId, 'reconcile', { onlyLinkIds: [l.id] });
          fixed++;
        }
      }
    }
    if (userDrift > 0) {
      const day = new Date().toISOString().slice(0, 10);
      void notify(userId, {
        type: 'stockDrift',
        severity: 'warning',
        titleKey: 'types.stockDrift',
        params: { count: userDrift, sku: '' },
        link: STOCK_PAGE_LINK,
        dedupeKey: `stock:drift:${day}`,
        escalateOn: 'count',
      });
    }
  }
  return { users: users.length, links: linksChecked, drift, fixed };
}

/** Daily retention: observations 30 d, terminal pushes 60 d, expired snapshots. */
export async function purgeStockHistory(): Promise<{ observations: number; pushes: number; snapshots: number }> {
  const obs = await prisma.stockObservation.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - OBS_TTL_MS) } } });
  const pushes = await prisma.stockPush.deleteMany({
    where: { status: { in: ['applied', 'skipped', 'dry_run', 'superseded'] }, updatedAt: { lt: new Date(Date.now() - PUSH_TTL_MS) } },
  });
  const snaps = await prisma.stockSnapshot.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - SNAPSHOT_GRACE_MS) } } });
  return { observations: obs.count, pushes: pushes.count, snapshots: snaps.count };
}

/** Pause every link of an account (disconnect / ownership change). */
export async function pauseLinksForAccount(userId: string | null, channel: string, accountRef: string, reason = 'account_changed'): Promise<number> {
  const where = { channel, accountRef: String(accountRef), status: { in: ['active', 'suggested', 'error'] }, ...(userId ? { userId } : {}) };
  const ids = (await prisma.stockLink.findMany({ where, select: { id: true } })).map((l) => l.id);
  if (!ids.length) return 0;
  await prisma.stockLink.updateMany({ where: { id: { in: ids } }, data: { status: 'paused', statusReason: reason } });
  await prisma.stockPush.updateMany({ where: { status: 'pending', linkId: { in: ids } }, data: { status: 'superseded', pendingKey: null, lastError: reason } });
  return ids.length;
}

/** An Etsy shop moved to another user or was disconnected: links of any other owner pause. */
export async function onEtsyShopOwnershipChangedImpl(shopId: string, newUserId: string | null): Promise<number> {
  const ids = (
    await prisma.stockLink.findMany({
      where: { channel: 'etsy', accountRef: String(shopId), status: { in: ['active', 'suggested', 'error'] }, ...(newUserId ? { userId: { not: newUserId } } : {}) },
      select: { id: true },
    })
  ).map((l) => l.id);
  if (!ids.length) return 0;
  await prisma.stockLink.updateMany({ where: { id: { in: ids } }, data: { status: 'paused', statusReason: 'account_changed' } });
  await prisma.stockPush.updateMany({ where: { status: 'pending', linkId: { in: ids } }, data: { status: 'superseded', pendingKey: null, lastError: 'account_changed' } });
  return ids.length;
}

/** Users that are LIVE (past Go Live) and have an active link on this channel. */
export async function listUsersWithLiveStockChannelImpl(channel: StockChannel): Promise<string[]> {
  const rows = await prisma.stockSettings.findMany({ where: { enabled: true, dryRun: false }, select: { userId: true, channels: true } });
  const out: string[] = [];
  for (const r of rows) {
    if (r.channels.length && !r.channels.includes(channel)) continue;
    const n = await prisma.stockLink.count({ where: { userId: r.userId, channel, status: 'active' } });
    if (n > 0) out.push(r.userId);
  }
  return out;
}
