/**
 * Linking, confirmation and seeding (W2, T11). Server-only.
 *
 * Seed policy (founder decision A, default 'min'): the lowest fresh remote
 * quantity across the item's channels, minus units sold but not yet shipped
 * (toggle). Groups that need review (any 0, any >= 100, max/min > 5, or a
 * shared pool with differing quantities) are never seeded automatically: the
 * item stays 'needs_review' until the seller enters a number.
 *
 * Seeding happens when the seller enables sync (dry run) — enabledAt =
 * seededAt — and, for items confirmed later, at confirm time.
 */
import prisma from '@/lib/prisma';
import { getAdapter } from './adapters';
import type { StockLinkRow } from './adapters/types';
import { normalizeSku } from './normalize';
import { computeSeedQty, groupNeedsReview } from './math';
import { enqueuePushes, seedItem } from './engine';
import { getStockSettings, isStockSyncActive, updateStockSettings } from './settings';
import { deriveOrderKey, resolveOrderChannel } from './orderKey';
import { connectedDirectChannels } from './orders';

export const OPEN_ORDER_STATUSES = [
  'awaiting_fulfillment', 'AWAITING_FULFILLMENT', 'awaiting_shipment', 'AWAITING_SHIPMENT', 'paid', 'PAID',
  'created', 'Created', 'CREATED', 'pending', 'PENDING', 'processing', 'PROCESSING', 'unshipped', 'UNSHIPPED', 'new', 'NEW',
];

export type LinkMemberInput = {
  channel: string;
  accountRef: string;
  externalId: string;
  variantRef?: string;
  variantValueKey?: string | null;
  remoteSku?: string | null;
  title?: string | null;
  matchType?: 'auto_exact' | 'suggested_loose' | 'manual';
};

export class StockOwnershipError extends Error {
  constructor(public channel: string, public accountRef: string) {
    super(`account_not_owned:${channel}:${accountRef}`);
  }
}

/** Fails closed unless the user owns every referenced account. */
export async function assertMembersOwned(userId: string, members: LinkMemberInput[]): Promise<void> {
  const checked = new Set<string>();
  for (const m of members) {
    const k = `${m.channel}|${m.accountRef}`;
    if (checked.has(k)) continue;
    const adapter = getAdapter(m.channel);
    if (!adapter || !(await adapter.ownsAccount(userId, String(m.accountRef)))) throw new StockOwnershipError(m.channel, m.accountRef);
    checked.add(k);
  }
}

/** Create/get the hub item and attach the members as ACTIVE links. */
export async function confirmGroup(
  userId: string,
  g: { sku: string; title?: string | null; imageUrl?: string | null; members: LinkMemberInput[]; seedQty?: number | null; needsReview?: boolean },
  actor: string,
): Promise<{ stockItemId: string; links: number; seeded: boolean; needsReview: boolean }> {
  const sku = normalizeSku(g.sku);
  if (!sku) throw new Error('invalid_sku');
  if (!g.members.length) throw new Error('no_members');
  await assertMembersOwned(userId, g.members);

  const item = await prisma.stockItem.upsert({
    where: { userId_sku: { userId, sku } },
    create: { userId, sku, displaySku: String(g.sku).trim().slice(0, 120), title: g.title?.slice(0, 300) ?? null, imageUrl: g.imageUrl ?? null, status: 'needs_review' },
    update: { ...(g.title ? { title: g.title.slice(0, 300) } : {}), ...(g.imageUrl ? { imageUrl: g.imageUrl } : {}) },
  });

  const now = new Date();
  for (const m of g.members) {
    const adapter = getAdapter(m.channel);
    const supports = !!adapter?.supportsWrite;
    const data = {
      stockItemId: item.id,
      variantValueKey: m.variantValueKey ?? null,
      remoteSku: m.remoteSku ?? null,
      title: m.title?.slice(0, 300) ?? null,
      matchType: m.matchType ?? 'manual',
      status: supports ? 'active' : 'unsupported',
      statusReason: supports ? null : adapter?.unsupportedReason ?? 'unsupported',
      confirmedAt: now,
      ...(m.channel === 'ebay' && m.variantValueKey ? { locationRef: m.variantValueKey } : {}),
    };
    await prisma.stockLink.upsert({
      where: {
        userId_channel_accountRef_externalId_variantRef: {
          userId,
          channel: m.channel,
          accountRef: String(m.accountRef),
          externalId: String(m.externalId),
          variantRef: m.variantRef ?? '',
        },
      },
      create: { userId, channel: m.channel, accountRef: String(m.accountRef), externalId: String(m.externalId), variantRef: m.variantRef ?? '', ...data },
      update: data,
    });
  }

  const settings = await getStockSettings(userId, { fresh: true });
  let seeded = false;
  let needsReview = !!g.needsReview;
  if (isStockSyncActive(settings) && item.seededAt) {
    // New links joining an already-seeded item: baseline them and align them to the hub.
    await recordBaselines(userId);
    await enqueuePushes(item.id, 'seed');
  } else if (isStockSyncActive(settings) && !item.seededAt) {
    // Sync already on: seed this item now.
    const r = await seedItems(userId, { onlyItemIds: [item.id], manualQty: g.seedQty !== undefined && g.seedQty !== null ? { [item.id]: g.seedQty } : {}, actor });
    seeded = r.seeded > 0;
    needsReview = r.needsReview.includes(item.id);
  } else if (g.seedQty !== undefined && g.seedQty !== null && !isStockSyncActive(settings)) {
    // Seller typed the real count before enabling: seed now (no pushes happen while disabled).
    await prisma.stockItem.update({ where: { id: item.id }, data: { status: 'active' } });
    const r = await seedItem({ userId, stockItemId: item.id, qty: g.seedQty, actor, idempotencyKey: `seed:${userId}:${item.id}:manual:${Date.now()}`, note: 'manual' });
    seeded = r.status === 'applied';
    needsReview = false;
  }
  const links = await prisma.stockLink.count({ where: { stockItemId: item.id } });
  return { stockItemId: item.id, links, seeded, needsReview };
}

/** Units sold on open, unshipped orders per stock item (last 30 days). */
export async function reservedUnitsByItem(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const orders = await prisma.order.findMany({
    where: { userId, status: { in: OPEN_ORDER_STATUSES }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
    select: { id: true, marketplace: true, marketplaceKey: true, orderNumber: true, source: true, status: true, rawData: true, items: { select: { sku: true, quantity: true, listingRef: true, variantRef: true, variantValueKey: true } } },
    take: 2000,
  });
  if (!orders.length) return out;
  const direct = await connectedDirectChannels(userId);
  const seenKeys = new Set<string>();
  const links = await prisma.stockLink.findMany({ where: { userId, status: { in: ['active', 'paused', 'unsupported'] } }, select: { stockItemId: true, channel: true, externalId: true, variantRef: true, unitsPerSale: true } });
  const items = await prisma.stockItem.findMany({ where: { userId }, select: { id: true, sku: true } });
  const itemBySku = new Map(items.map((i) => [i.sku, i.id]));
  for (const o of orders) {
    const key = deriveOrderKey(o, { directChannels: direct });
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const ch = resolveOrderChannel(o).channel;
    for (const line of o.items) {
      const qty = Math.max(0, line.quantity || 0);
      let hit = ch && line.listingRef ? links.find((l) => l.channel === ch && l.externalId === line.listingRef && (l.variantRef === (line.variantRef ?? '') || l.variantRef === '*')) : undefined;
      if (!hit && ch && line.sku) hit = links.find((l) => l.channel === ch && l.externalId === String(line.sku).trim());
      const itemId = hit?.stockItemId ?? itemBySku.get(normalizeSku(line.sku) || '');
      if (!itemId) continue;
      out.set(itemId, (out.get(itemId) || 0) + qty * Math.max(1, hit?.unitsPerSale ?? 1));
    }
  }
  return out;
}

/**
 * Seed unseeded items from fresh remote reads. Items whose group needs review
 * (or policy 'manual') are seeded only from manualQty; otherwise they stay
 * 'needs_review' and are never pushed.
 */
export async function seedItems(
  userId: string,
  opts: { onlyItemIds?: string[]; manualQty?: Record<string, number>; actor: string; reseed?: boolean },
): Promise<{ seeded: number; needsReview: string[]; readFailures: number }> {
  const settings = await getStockSettings(userId, { fresh: true });
  const policy = settings?.seedPolicy || 'min';
  const subtract = settings?.seedSubtractReserved ?? true;
  const items = await prisma.stockItem.findMany({
    where: { userId, ...(opts.onlyItemIds ? { id: { in: opts.onlyItemIds } } : {}), ...(opts.reseed ? {} : { seededAt: null }) },
    include: { links: { where: { status: { in: ['active', 'unsupported'] } } } },
  });
  if (!items.length) return { seeded: 0, needsReview: [], readFailures: 0 };

  const allLinks = items.flatMap((i) => i.links) as StockLinkRow[];
  const remote = new Map<string, number>();
  let readFailures = 0;
  const byChannel = new Map<string, StockLinkRow[]>();
  for (const l of allLinks) byChannel.set(l.channel, [...(byChannel.get(l.channel) || []), l]);
  for (const [channel, ls] of Array.from(byChannel.entries())) {
    const adapter = getAdapter(channel);
    if (!adapter) continue;
    try {
      const m = await adapter.readQuantities(userId, ls);
      for (const [id, v] of Array.from(m.entries())) remote.set(id, v.qty);
    } catch {
      /* counted below */
    }
  }
  const reserved = subtract ? await reservedUnitsByItem(userId) : new Map<string, number>();
  const now = new Date();
  let seeded = 0;
  const needsReview: string[] = [];

  for (const item of items) {
    const quantities = item.links.map((l) => ({ channel: l.channel, qty: remote.get(l.id), unitsPerSale: l.unitsPerSale }));
    const missing = quantities.filter((q) => q.qty === undefined).length;
    readFailures += missing;
    // Record the baseline so the first observation is 'expected', not a drop.
    for (const l of item.links) {
      const q = remote.get(l.id);
      if (q !== undefined) await prisma.stockLink.update({ where: { id: l.id }, data: { lastSeenRemoteQty: q, lastSeenAt: now } });
    }
    const known = quantities.filter((q) => q.qty !== undefined) as Array<{ channel: string; qty: number; unitsPerSale: number }>;
    const perChannelQty = new Map<string, Set<number>>();
    for (const q of known) perChannelQty.set(q.channel, new Set([...Array.from(perChannelQty.get(q.channel) || []), q.qty]));
    const sharedConflict = Array.from(perChannelQty.values()).some((s) => s.size > 1);
    const review = missing > 0 || sharedConflict || groupNeedsReview(known.map((k) => k.qty));

    let qty: number | null = null;
    const manual = opts.manualQty?.[item.id];
    if (manual !== undefined && manual !== null && Number.isFinite(Number(manual))) qty = Math.max(0, Math.trunc(Number(manual)));
    else if (!review) qty = computeSeedQty({ policy, remote: known, reservedUnits: reserved.get(item.id) || 0, subtractReserved: subtract });

    if (qty === null) {
      needsReview.push(item.id);
      await prisma.stockItem.update({ where: { id: item.id }, data: { status: 'needs_review' } });
      continue;
    }
    await prisma.stockItem.update({ where: { id: item.id }, data: { status: 'active' } });
    await seedItem({ userId, stockItemId: item.id, qty, actor: opts.actor, idempotencyKey: `seed:${userId}:${item.id}:${now.toISOString()}`, note: manual !== undefined ? 'manual' : policy });
    seeded++;
  }
  return { seeded, needsReview, readFailures };
}

/**
 * Wizard step "enable in dry run": seed every confirmed item, then flip
 * enabled=true (dryRun stays true). enabledAt = seededAt: orders dated before
 * it are never applied. Nothing is written to any marketplace.
 */
export async function enableStockSync(userId: string, opts: { manualQty?: Record<string, number>; actor: string }) {
  const current = await getStockSettings(userId, { fresh: true });
  if (current?.enabled) return { alreadyEnabled: true, seeded: 0, needsReview: [] as string[], readFailures: 0 };
  const result = await seedItems(userId, { manualQty: opts.manualQty, actor: opts.actor });
  await recordBaselines(userId);
  const enabledAt = new Date();
  await updateStockSettings(userId, { enabled: true, dryRun: true, enabledAt, orderScanCursorAt: enabledAt, orderScanCursorId: '' });
  // Dry-run rows: what WOULD be sent (the worker never calls a marketplace in dry run).
  const items = await prisma.stockItem.findMany({ where: { userId, status: 'active', tracking: 'tracked' }, select: { id: true } });
  for (const i of items) await enqueuePushes(i.id, 'seed');
  return { alreadyEnabled: false, ...result };
}

/** Turn stock sync off (keeps items/links/ledger). Pending pushes are superseded. */
export async function disableStockSync(userId: string) {
  await updateStockSettings(userId, { enabled: false, dryRun: true });
  await prisma.stockPush.updateMany({ where: { userId, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: 'disabled' } });
}

/** Fresh remote reads for active links that have no baseline yet. */
export async function recordBaselines(userId: string): Promise<number> {
  const links = (await prisma.stockLink.findMany({ where: { userId, status: 'active', lastSeenRemoteQty: null } })) as StockLinkRow[];
  if (!links.length) return 0;
  const byChannel = new Map<string, StockLinkRow[]>();
  for (const l of links) byChannel.set(l.channel, [...(byChannel.get(l.channel) || []), l]);
  let n = 0;
  const now = new Date();
  for (const [channel, ls] of Array.from(byChannel.entries())) {
    const adapter = getAdapter(channel);
    if (!adapter) continue;
    const m = await adapter.readQuantities(userId, ls).catch(() => new Map<string, { qty: number }>());
    for (const [id, v] of Array.from(m.entries())) {
      await prisma.stockLink.update({ where: { id }, data: { lastSeenRemoteQty: v.qty, lastSeenAt: now } });
      n++;
    }
  }
  return n;
}
