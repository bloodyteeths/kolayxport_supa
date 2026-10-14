/**
 * Trendyol stock adapter (W2, T8). Server-only.
 *
 * Identity: externalId = barcode (what price-and-inventory updates by);
 * candidates expose stockCode (merchant SKU) as the SKU and the barcode as
 * the fallback. Fresh read = product listing filtered by barcode. Writes go
 * through updatePriceAndInventory (quantity only, max 1000 items) and are
 * asynchronous: status 'awaiting_batch' + batchRequestId, resolved by the
 * worker via getBatchStatus for up to 24 h. No compare-and-set exists on
 * Trendyol: a sale between our read and our write can still be overwritten.
 */
import prisma from '@/lib/prisma';
import { createTrendyolClient, type TrendyolApiClient } from '@/lib/integrations/trendyolApiClient';
import { decideSendQty } from '../math';
import type { RemoteCandidate } from '../matching';
import {
  ACCOUNT_CHANGED_PATCH,
  errMsg,
  failAll,
  isRetryableHttp,
  type PushResult,
  type RemoteQty,
  type StockAdapter,
} from './types';

const MAX_BATCH = 1000;
const MAX_QTY = 20000;

async function clientFor(userId: string, accountRef: string): Promise<TrendyolApiClient | null> {
  const cred = await prisma.credential.findUnique({
    where: { userId },
    select: { trendyolSupplierId: true, trendyolApiKey: true, trendyolApiSecret: true },
  });
  if (!cred?.trendyolSupplierId || String(cred.trendyolSupplierId) !== String(accountRef)) return null;
  if (!cred.trendyolApiKey || !cred.trendyolApiSecret) return null;
  return createTrendyolClient(cred);
}

async function freshByBarcode(client: TrendyolApiClient, barcode: string): Promise<number | null> {
  const page = await client.getProducts({ barcode, size: 5 });
  const p = (page?.content || []).find((x: any) => String(x?.barcode) === barcode);
  if (!p) return null;
  return Math.max(0, Math.trunc(Number(p.quantity) || 0));
}

export const trendyolAdapter: StockAdapter = {
  channel: 'trendyol',
  supportsWrite: true,

  async listAccounts(userId) {
    const cred = await prisma.credential.findUnique({ where: { userId }, select: { trendyolSupplierId: true, trendyolApiKey: true } });
    return cred?.trendyolSupplierId && cred.trendyolApiKey ? [{ accountRef: cred.trendyolSupplierId, label: `Trendyol ${cred.trendyolSupplierId}` }] : [];
  },

  async ownsAccount(userId, accountRef) {
    const cred = await prisma.credential.findUnique({ where: { userId }, select: { trendyolSupplierId: true } });
    return !!cred?.trendyolSupplierId && String(cred.trendyolSupplierId) === String(accountRef);
  },

  async listCandidates(userId) {
    const accounts = await trendyolAdapter.listAccounts(userId);
    if (!accounts.length) return [];
    const supplierId = accounts[0].accountRef;
    const rows = await prisma.trendyolProduct.findMany({
      where: { userId, supplierId, archived: false, blacklisted: false },
      select: { barcode: true, stockCode: true, title: true, quantity: true, thumbnailUrl: true, onSale: true, approved: true },
    });
    return rows.map<RemoteCandidate>((r) => ({
      channel: 'trendyol',
      accountRef: supplierId,
      accountLabel: accounts[0].label,
      externalId: r.barcode,
      variantRef: '',
      variantValueKey: null,
      sku: r.stockCode || r.barcode,
      variantLabel: r.stockCode && r.stockCode !== r.barcode ? r.barcode : null,
      title: r.title,
      imageUrl: r.thumbnailUrl,
      quantity: r.quantity,
      state: r.onSale ? 'active' : r.approved ? 'inactive' : 'pending',
      supportsWrite: true,
    }));
  },

  async readQuantities(userId, links, opts) {
    const out = new Map<string, RemoteQty>();
    if (!links.length) return out;
    if (opts?.cacheOnly) {
      const rows = await prisma.trendyolProduct.findMany({
        where: { userId, barcode: { in: links.map((l) => l.externalId) } },
        select: { barcode: true, supplierId: true, quantity: true },
      });
      for (const l of links) {
        const r = rows.find((x) => x.barcode === l.externalId && x.supplierId === l.accountRef);
        if (r) out.set(l.id, { qty: r.quantity });
      }
      return out;
    }
    const client = await clientFor(userId, links[0].accountRef);
    if (!client) return out;
    for (const l of links) {
      if (l.accountRef !== links[0].accountRef) continue;
      try {
        const q = await freshByBarcode(client, l.externalId);
        if (q !== null) out.set(l.id, { qty: q });
      } catch {
        /* unreadable */
      }
    }
    return out;
  },

  async pushQuantities(userId, items) {
    const results: PushResult[] = [];
    const byAccount = new Map<string, typeof items>();
    for (const it of items) byAccount.set(it.link.accountRef, [...(byAccount.get(it.link.accountRef) || []), it]);
    for (const [accountRef, group] of Array.from(byAccount.entries())) {
      const client = await clientFor(userId, accountRef);
      if (!client) {
        results.push(...failAll(group, 'account_not_owned', { retryable: false, linkPatch: ACCOUNT_CHANGED_PATCH }));
        continue;
      }
      const toSend: Array<{ it: (typeof group)[number]; fresh: number; send: number }> = [];
      for (const it of group) {
        try {
          const fresh = await freshByBarcode(client, it.link.externalId);
          if (fresh === null) {
            results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: false, error: 'barcode_not_found', linkPatch: { status: 'paused', statusReason: 'listing_removed' } });
            continue;
          }
          const send = decideSendQty(Math.min(MAX_QTY, it.targetQty), fresh, it.reason);
          if (send === null) {
            results.push({ pushId: it.pushId, linkId: it.link.id, status: 'skipped', freshRemoteQty: fresh, sentQty: fresh, remoteQtyAfter: fresh });
          } else {
            toSend.push({ it, fresh, send });
          }
        } catch (err) {
          results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: isRetryableHttp(err), error: errMsg(err) });
        }
      }
      for (let i = 0; i < toSend.length; i += MAX_BATCH) {
        const chunk = toSend.slice(i, i + MAX_BATCH);
        try {
          const res = await client.updatePriceAndInventory(chunk.map((c) => ({ barcode: c.it.link.externalId, quantity: c.send })));
          const batchId = res?.batchRequestId ? String(res.batchRequestId) : null;
          for (const c of chunk) {
            results.push({
              pushId: c.it.pushId,
              linkId: c.it.link.id,
              status: batchId ? 'awaiting_batch' : 'unknown',
              freshRemoteQty: c.fresh,
              sentQty: c.send,
              externalRef: batchId,
            });
          }
        } catch (err) {
          for (const c of chunk) {
            results.push({ pushId: c.it.pushId, linkId: c.it.link.id, status: 'failed', retryable: isRetryableHttp(err), freshRemoteQty: c.fresh, error: errMsg(err) });
          }
        }
      }
    }
    return results;
  },

  async resolveBatch(userId, accountRef, batchRef) {
    const client = await clientFor(userId, accountRef);
    if (!client) return { done: true, error: 'account_not_owned', failedBarcodes: undefined };
    const st = await client.getBatchStatus(batchRef);
    const status = String(st?.status || '').toUpperCase();
    const items: any[] = Array.isArray(st?.items) ? st.items : [];
    const failed = new Set<string>(
      items.filter((x) => String(x?.status || '').toUpperCase() === 'FAILED').map((x) => String(x?.requestItem?.barcode ?? x?.requestItem?.product?.barcode ?? '')),
    );
    const done = status === 'COMPLETED' || (items.length > 0 && items.every((x) => ['SUCCESS', 'FAILED'].includes(String(x?.status || '').toUpperCase())));
    return { done, failedBarcodes: failed };
  },
};
