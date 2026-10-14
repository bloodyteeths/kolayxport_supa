/**
 * Go-live preview (W2, T11/T12). Server-only.
 *
 * previewStock({ live }) lists, per item and link, the remote quantity, the
 * hub target and what Go Live would send, plus totals: pushes,
 * deactivations, disabled variations, drops over 50% and each channel's
 * oversell window. Live reads are capped at 50 links per request (the rest
 * use the last seen quantity and are flagged).
 *
 * POST /api/stock/preview?live=1 also returns a confirm token (15 min,
 * HMAC over the user and the plan hash) that PUT /api/stock/settings
 * {dryRun:false} requires. The plan hash covers what Go Live will aim for —
 * every managed link's target and its zero-stock effect, the zero-stock
 * action and the channel switch — and NOT the remote reads (those change by
 * the minute and every push reads fresh anyway), so Go Live can recompute it
 * without network calls and refuse when the plan changed since the preview.
 */
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getAdapter, OVERSELL_WINDOW_MINUTES } from './adapters';
import type { StockLinkRow } from './adapters/types';
import { computeLinkTarget, decideSendQty } from './math';
import type { StockChannel } from './types';

export const LIVE_READ_CAP = 50;
export const CONFIRM_TOKEN_TTL_MS = 15 * 60 * 1000;

export type PreviewLink = {
  linkId: string;
  channel: string;
  accountRef: string;
  externalId: string;
  variantRef: string;
  title: string | null;
  remoteSku: string | null;
  status: string;
  remote: number | null;
  remoteSource: 'live' | 'last_seen' | 'none';
  target: number;
  wouldSend: number | null;
  effect: 'none' | 'set' | 'deactivate' | 'disable_variation' | 'unsupported';
  bigDrop: boolean;
};

export type PreviewItem = {
  stockItemId: string;
  sku: string;
  title: string | null;
  imageUrl: string | null;
  onHand: number;
  status: string;
  links: PreviewLink[];
};

export type PreviewResult = {
  items: PreviewItem[];
  totals: { pushes: number; deactivations: number; disabledVariations: number; bigDrops: number; liveReads: number; cappedLinks: number; needsReview: number };
  oversellWindowMinutes: Partial<Record<StockChannel, number>>;
  planHash: string;
  requiresTypedConfirm: boolean;
};

export async function previewStock(userId: string, opts: { live: boolean }): Promise<PreviewResult> {
  const settings = await prisma.stockSettings.findUnique({ where: { userId } });
  const zeroAction = settings?.etsyZeroStockAction || 'disable_variation';
  const items = await prisma.stockItem.findMany({
    where: { userId },
    include: { links: { where: { status: { in: ['active', 'unsupported'] } } } },
    orderBy: { displaySku: 'asc' },
  });

  // Live reads (capped).
  const remote = new Map<string, number>();
  let liveReads = 0;
  let capped = 0;
  if (opts.live) {
    const writable = items.flatMap((i) => i.links.filter((l) => l.status === 'active')) as StockLinkRow[];
    const toRead = writable.slice(0, LIVE_READ_CAP);
    capped = Math.max(0, writable.length - toRead.length);
    const byChannel = new Map<string, StockLinkRow[]>();
    for (const l of toRead) byChannel.set(l.channel, [...(byChannel.get(l.channel) || []), l]);
    for (const [channel, ls] of Array.from(byChannel.entries())) {
      const adapter = getAdapter(channel);
      if (!adapter) continue;
      const m = await adapter.readQuantities(userId, ls).catch(() => new Map<string, { qty: number }>());
      for (const [id, v] of Array.from(m.entries())) remote.set(id, v.qty);
      liveReads += m.size;
    }
  }

  // Etsy listing shapes (single product vs multi) for the zero-stock effect.
  const etsyListingIds = Array.from(new Set(items.flatMap((i) => i.links.filter((l) => l.channel === 'etsy').map((l) => `${l.accountRef}|${l.externalId}`))));
  const multiProduct = new Set<string>();
  for (const key of etsyListingIds) {
    const [shopId, listingId] = key.split('|');
    try {
      const n = await prisma.etsyListingOffering.count({ where: { etsyShopId: shopId, etsyListingId: BigInt(listingId) } });
      if (n > 1) multiProduct.add(key);
    } catch {
      /* ignore */
    }
  }

  const totals = { pushes: 0, deactivations: 0, disabledVariations: 0, bigDrops: 0, liveReads, cappedLinks: capped, needsReview: 0 };
  const plan: string[] = [];
  const out: PreviewItem[] = [];
  for (const item of items) {
    if (item.status === 'needs_review') totals.needsReview++;
    const links: PreviewLink[] = [];
    for (const l of item.links) {
      const target = computeLinkTarget({ onHand: item.onHand, safetyBuffer: item.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty });
      const live = remote.get(l.id);
      const r = live ?? l.lastSeenRemoteQty ?? null;
      const src: PreviewLink['remoteSource'] = live !== undefined ? 'live' : l.lastSeenRemoteQty !== null ? 'last_seen' : 'none';
      let wouldSend: number | null = null;
      let effect: PreviewLink['effect'] = 'none';
      if (l.status !== 'active' || item.status !== 'active' || item.tracking !== 'tracked') {
        effect = l.status === 'unsupported' ? 'unsupported' : 'none';
      } else {
        wouldSend = r === null ? target : decideSendQty(target, r, 'seed');
        if (wouldSend !== null) {
          effect = 'set';
          if (wouldSend === 0 && l.channel === 'etsy') {
            const multi = multiProduct.has(`${l.accountRef}|${l.externalId}`) && l.variantRef !== '*';
            effect = multi && zeroAction !== 'deactivate_listing' ? 'disable_variation' : 'deactivate';
          }
        }
      }
      const bigDrop = wouldSend !== null && r !== null && r > 0 && wouldSend < r * 0.5;
      if (l.status === 'active' && item.status === 'active' && item.tracking === 'tracked') {
        plan.push(planEntry({ linkId: l.id, channel: l.channel, target, multi: multiProduct.has(`${l.accountRef}|${l.externalId}`) && l.variantRef !== '*', zeroAction }));
      }
      if (effect === 'set' || effect === 'deactivate' || effect === 'disable_variation') {
        totals.pushes++;
      }
      if (effect === 'deactivate') totals.deactivations++;
      if (effect === 'disable_variation') totals.disabledVariations++;
      if (bigDrop) totals.bigDrops++;
      links.push({
        linkId: l.id,
        channel: l.channel,
        accountRef: l.accountRef,
        externalId: l.externalId,
        variantRef: l.variantRef,
        title: l.title,
        remoteSku: l.remoteSku,
        status: l.status,
        remote: r,
        remoteSource: src,
        target,
        wouldSend,
        effect,
        bigDrop,
      });
    }
    out.push({ stockItemId: item.id, sku: item.displaySku, title: item.title, imageUrl: item.imageUrl, onHand: item.onHand, status: item.status, links });
  }

  const channels = new Set(items.flatMap((i) => i.links.map((l) => l.channel as StockChannel)));
  const oversellWindowMinutes: Partial<Record<StockChannel, number>> = {};
  for (const ch of Array.from(channels)) oversellWindowMinutes[ch] = OVERSELL_WINDOW_MINUTES[ch];

  const header = `za:${zeroAction}|ch:${[...(settings?.channels || [])].sort().join(',')}`;
  const planHash = hashPlan(header, plan);
  return { items: out, totals, oversellWindowMinutes, planHash, requiresTypedConfirm: totals.deactivations + totals.disabledVariations > 0 };
}

/** Pure: one managed link's planned outcome (target + what a 0 would do on Etsy). */
export function planEntry(a: { linkId: string; channel: string; target: number; multi: boolean; zeroAction: string }): string {
  let zero = '';
  if (a.target === 0 && a.channel === 'etsy') zero = a.multi && a.zeroAction !== 'deactivate_listing' ? ':dv' : ':da';
  return `${a.linkId}:${a.target}${zero}`;
}

export function hashPlan(header: string, entries: string[]): string {
  return crypto.createHash('sha256').update([header, ...[...entries].sort()].join('\n')).digest('hex');
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.STOCK_TOKEN_SECRET || 'kx-stock-dev-secret';
}

export function issueConfirmToken(userId: string, planHash: string, requiresTypedConfirm: boolean, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, h: planHash, t: requiresTypedConfirm ? 1 : 0, e: now + CONFIRM_TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyConfirmToken(token: string | null | undefined, userId: string, now = Date.now()): { ok: true; planHash: string; requiresTypedConfirm: boolean } | { ok: false; reason: 'missing' | 'invalid' | 'expired' } {
  if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'missing' };
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' };
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.u !== userId) return { ok: false, reason: 'invalid' };
    if (typeof p.e !== 'number' || p.e < now) return { ok: false, reason: 'expired' };
    return { ok: true, planHash: String(p.h), requiresTypedConfirm: !!p.t };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
