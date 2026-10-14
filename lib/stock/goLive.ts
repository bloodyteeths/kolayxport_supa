/**
 * Go Live, dry-run report and snapshot restore (W2, T12). Server-only.
 *
 * Go Live requires a fresh confirm token from POST /api/stock/preview?live=1
 * (15 min), plus a typed confirmation when the plan deactivates listings or
 * disables variations. It snapshots every active link's remote quantity
 * (kept 7 days) before the first write.
 *
 * Restore sets each link back to max(0, snapshot qty - units sold on that
 * item since Go Live), then disables sync. Typed confirmation required.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAdapter } from './adapters';
import type { PushItem, PushResult, StockLinkRow } from './adapters/types';
import { computeLinkTarget } from './math';
import { enqueuePushes } from './engine';
import { getStockSettings, isStockSyncActive, updateStockSettings, invalidateStockSettings } from './settings';
import { previewStock, verifyConfirmToken, CONFIRM_TOKEN_TTL_MS } from './preview';
import { processState } from '@/lib/processState';

// Confirm tokens are single-use (per process; the app runs as one instance).
const usedTokens = processState('stock.goLiveTokens', () => new Map<string, number>());

function consumeToken(token: string): boolean {
  const now = Date.now();
  for (const [k, exp] of Array.from(usedTokens.entries())) if (exp < now) usedTokens.delete(k);
  if (usedTokens.has(token)) return false;
  usedTokens.set(token, now + CONFIRM_TOKEN_TTL_MS);
  return true;
}

export const SNAPSHOT_TTL_MS = 7 * 24 * 3600 * 1000;
export const GO_LIVE_WORDS = ['CANLI', 'LIVE'];
export const RESTORE_WORDS = ['GERİ AL', 'GERI AL', 'RESTORE'];

export function typedMatches(input: unknown, words: string[]): boolean {
  const v = String(input ?? '').trim().toLocaleUpperCase('tr-TR');
  const v2 = String(input ?? '').trim().toUpperCase();
  return words.some((w) => w === v || w === v2);
}

export type GoLiveError = 'not_enabled' | 'already_live' | 'token_missing' | 'token_invalid' | 'token_expired' | 'typed_confirm_required' | 'plan_changed';

export async function goLive(userId: string, a: { confirmToken?: string; typedConfirm?: string }): Promise<{ ok: true; snapshotId: string; links: number } | { ok: false; error: GoLiveError }> {
  const settings = await getStockSettings(userId, { fresh: true });
  if (!isStockSyncActive(settings)) return { ok: false, error: 'not_enabled' };
  if (!settings!.dryRun) return { ok: false, error: 'already_live' };
  const v = verifyConfirmToken(a.confirmToken, userId);
  if (!v.ok) return { ok: false, error: v.reason === 'missing' ? 'token_missing' : v.reason === 'expired' ? 'token_expired' : 'token_invalid' };
  // The seller confirmed a specific plan: recompute it (no network) and refuse
  // if targets, zero-stock effects, links or settings changed since the preview.
  const current = await previewStock(userId, { live: false });
  if (current.planHash !== v.planHash) return { ok: false, error: 'plan_changed' };
  const typedNeeded = v.requiresTypedConfirm || current.requiresTypedConfirm;
  if (typedNeeded && !typedMatches(a.typedConfirm, GO_LIVE_WORDS)) return { ok: false, error: 'typed_confirm_required' };
  if (!consumeToken(String(a.confirmToken))) return { ok: false, error: 'token_invalid' };

  // Snapshot every active link's remote quantity (fresh read; last seen as fallback).
  const links = (await prisma.stockLink.findMany({ where: { userId, status: 'active' } })) as StockLinkRow[];
  const fresh = new Map<string, number>();
  const byChannel = new Map<string, StockLinkRow[]>();
  for (const l of links) byChannel.set(l.channel, [...(byChannel.get(l.channel) || []), l]);
  for (const [channel, ls] of Array.from(byChannel.entries())) {
    const adapter = getAdapter(channel);
    if (!adapter) continue;
    const m = await adapter.readQuantities(userId, ls).catch(() => new Map<string, { qty: number }>());
    for (const [id, q] of Array.from(m.entries())) fresh.set(id, q.qty);
  }
  const data = links.map((l) => ({ linkId: l.id, remoteQty: fresh.get(l.id) ?? l.lastSeenRemoteQty ?? null, source: fresh.has(l.id) ? 'live' : 'last_seen' }));
  const now = new Date();
  const snap = await prisma.stockSnapshot.create({ data: { userId, reason: 'go_live', takenAt: now, expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS), data } });

  // Dry-run rows are history; the live plan starts clean.
  await prisma.stockPush.updateMany({ where: { userId, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: 'go_live' } });
  await updateStockSettings(userId, { dryRun: false, goLiveAt: now });
  void logger.info('stock.go_live', { userId, links: links.length, snapshotId: snap.id });

  const items = await prisma.stockItem.findMany({ where: { userId, status: 'active', tracking: 'tracked' }, select: { id: true } });
  for (const i of items) await enqueuePushes(i.id, 'seed');
  return { ok: true, snapshotId: snap.id, links: links.length };
}

/** Units sold (net of cancels) on an item since `since`. */
async function soldSince(stockItemId: string, since: Date): Promise<number> {
  const rows = await prisma.stockLedger.findMany({
    where: { stockItemId, createdAt: { gte: since }, kind: { in: ['sale', 'sale_adjust', 'cancel'] } },
    select: { delta: true },
  });
  return Math.max(0, -rows.reduce((s, r) => s + r.delta, 0));
}

export async function restoreSnapshot(userId: string, a: { snapshotId?: string; typedConfirm?: string }) {
  if (!typedMatches(a.typedConfirm, RESTORE_WORDS)) return { ok: false as const, error: 'typed_confirm_required' };
  const snap = a.snapshotId
    ? await prisma.stockSnapshot.findFirst({ where: { id: a.snapshotId, userId } })
    : await prisma.stockSnapshot.findFirst({ where: { userId, restoredAt: null, expiresAt: { gt: new Date() } }, orderBy: { takenAt: 'desc' } });
  if (!snap) return { ok: false as const, error: 'snapshot_not_found' };
  if (snap.restoredAt) return { ok: false as const, error: 'already_restored' };
  if (snap.expiresAt.getTime() < Date.now()) return { ok: false as const, error: 'snapshot_expired' };

  // Stop all automatic writes first.
  await updateStockSettings(userId, { enabled: false, dryRun: true });
  await prisma.stockPush.updateMany({ where: { userId, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: 'restore' } });
  invalidateStockSettings(userId);

  const rows: Array<{ linkId: string; remoteQty: number | null }> = Array.isArray(snap.data) ? (snap.data as any[]) : [];
  const links = (await prisma.stockLink.findMany({ where: { userId, id: { in: rows.map((r) => r.linkId) } } })) as StockLinkRow[];
  const linkById = new Map(links.map((l) => [l.id, l]));
  const soldCache = new Map<string, number>();
  const settings = (await getStockSettings(userId, { fresh: true }))!;
  const byChannel = new Map<string, PushItem[]>();
  for (const r of rows) {
    const l = linkById.get(r.linkId);
    if (!l || r.remoteQty === null || r.remoteQty === undefined) continue;
    if (!soldCache.has(l.stockItemId)) soldCache.set(l.stockItemId, await soldSince(l.stockItemId, snap.takenAt));
    const sold = Math.ceil((soldCache.get(l.stockItemId) || 0) / Math.max(1, l.unitsPerSale));
    const target = Math.max(0, r.remoteQty - sold);
    const push = await prisma.stockPush.create({
      data: { userId, stockItemId: l.stockItemId, linkId: l.id, reason: 'restore', targetQty: target, status: 'in_flight', claimedAt: new Date(), attempts: 1 },
    });
    byChannel.set(l.channel, [...(byChannel.get(l.channel) || []), { pushId: push.id, link: l, targetQty: target, reason: 'restore' }]);
  }
  let applied = 0;
  let failed = 0;
  for (const [channel, items] of Array.from(byChannel.entries())) {
    const adapter = getAdapter(channel);
    if (!adapter?.supportsWrite) {
      await prisma.stockPush.updateMany({ where: { id: { in: items.map((i) => i.pushId) } }, data: { status: 'failed', lastError: 'unsupported' } });
      failed += items.length;
      continue;
    }
    const results: PushResult[] = await adapter.pushQuantities(userId, items, { settings }).catch((err) =>
      items.map((i): PushResult => ({ pushId: i.pushId, linkId: i.link.id, status: 'failed', error: err instanceof Error ? err.message : String(err) })),
    );
    for (const r of results) {
      const ok = r.status === 'applied' || r.status === 'skipped' || r.status === 'awaiting_batch';
      await prisma.stockPush.update({
        where: { id: r.pushId },
        data: { status: r.status === 'retry' ? 'failed' : r.status, appliedAt: ok ? new Date() : null, sentQty: r.sentQty ?? null, freshRemoteQty: r.freshRemoteQty ?? null, remoteQtyAfter: r.remoteQtyAfter ?? null, externalRef: r.externalRef ?? null, lastError: r.error ?? null },
      });
      if (ok) applied++;
      else failed++;
    }
  }
  await prisma.stockSnapshot.update({ where: { id: snap.id }, data: { restoredAt: new Date() } });
  return { ok: true as const, applied, failed };
}

/**
 * Dry-run report: pushes that would have been sent, and oversell risks that
 * would have been prevented (a sale on one channel while another channel's
 * listing still showed more than the hub could cover).
 */
export async function dryRunReport(userId: string) {
  const settings = await getStockSettings(userId);
  const since = settings?.enabledAt ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const pushes = await prisma.stockPush.findMany({
    where: { userId, status: 'dry_run', createdAt: { gte: since } },
    select: { linkId: true, targetQty: true, freshRemoteQty: true },
  });
  const links = await prisma.stockLink.findMany({ where: { userId, status: 'active' } });
  const linkById = new Map(links.map((l) => [l.id, l]));
  const byChannel: Record<string, number> = {};
  for (const p of pushes) {
    const ch = linkById.get(p.linkId)?.channel || 'unknown';
    byChannel[ch] = (byChannel[ch] || 0) + 1;
  }
  const sales = await prisma.stockLedger.findMany({
    where: { userId, kind: { in: ['sale', 'sale_adjust'] }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { stockItemId: true, channel: true, qtyAfter: true, orderKey: true, createdAt: true },
  });
  const items = await prisma.stockItem.findMany({ where: { userId }, select: { id: true, safetyBuffer: true, displaySku: true } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const risks: Array<{ sku: string; soldOn: string | null; exposedOn: string; shown: number; available: number; at: string }> = [];
  for (const s of sales) {
    const item = itemById.get(s.stockItemId);
    if (!item) continue;
    for (const l of links) {
      if (l.stockItemId !== s.stockItemId || l.channel === s.channel || l.lastSeenRemoteQty === null) continue;
      const available = computeLinkTarget({ onHand: s.qtyAfter, safetyBuffer: item.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty });
      if (l.lastSeenRemoteQty > available) {
        risks.push({ sku: item.displaySku, soldOn: s.channel, exposedOn: l.channel, shown: l.lastSeenRemoteQty, available, at: s.createdAt.toISOString() });
      }
    }
  }
  return { since: since.toISOString(), wouldHaveSent: pushes.length, byChannel, oversellRisksPrevented: risks.length, examples: risks.slice(0, 20) };
}
