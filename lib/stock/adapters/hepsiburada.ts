/**
 * Hepsiburada stock adapter. Server-only.
 *
 * Identity: accountRef = Mağaza ID (merchantId), externalId = hbSku (what stock-uploads key on); the merchant SKU
 * is the candidate SKU. Candidates come from the HepsiburadaListing cache (lib/hepsiburada/listingSync.ts).
 * Fresh read = listings filtered by hbSku. Writes go through `stock-uploads` (max 1000 rows) and are asynchronous:
 * 'awaiting_batch' + the upload id, resolved through `resolveBatch` (HepsiburadaUploadBatch keeps the record).
 * Listings fulfilled by HB's warehouse (isFulfilledByHB) are never written: HB owns that stock.
 * Gated by MARKETPLACE_HEPSIBURADA / ALLOW_HEPSIBURADA_USERS; with the platform flag off it stays 'coming_soon'.
 * No compare-and-set exists on HB: a sale between our read and our write can still be overwritten.
 */
import prisma from '@/lib/prisma';
import { isHepsiburadaEnabled, MARKETPLACE_HEPSIBURADA } from '@/lib/config';
import { createHepsiburadaClient, type HepsiburadaClient } from '@/lib/hepsiburada/client';
import { HB_CREDENTIAL_SELECT } from '@/lib/hepsiburada/server';
import { interpretUpload, submitHbUpload } from '@/lib/hepsiburada/uploads';
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

const MAX_QTY = 20000;

async function clientFor(userId: string, accountRef: string): Promise<HepsiburadaClient | null> {
  if (!isHepsiburadaEnabled(userId)) return null;
  const cred = await prisma.credential.findUnique({ where: { userId }, select: HB_CREDENTIAL_SELECT });
  if (!cred?.hepsiburadaMerchantId || cred.hepsiburadaMerchantId.trim() !== String(accountRef)) return null;
  return createHepsiburadaClient(cred);
}

/** Current HB stock per hbSku (missing = listing not found). */
async function freshBySkus(client: HepsiburadaClient, hbSkus: string[]): Promise<Map<string, { qty: number; fbh: boolean }>> {
  const out = new Map<string, { qty: number; fbh: boolean }>();
  for (let i = 0; i < hbSkus.length; i += 50) {
    const chunk = hbSkus.slice(i, i + 50);
    const res = await client.listListings({ offset: 0, limit: chunk.length, hbSkuList: chunk });
    for (const l of res?.listings || []) {
      if (!l.hepsiburadaSku) continue;
      out.set(String(l.hepsiburadaSku), { qty: Math.max(0, Math.trunc(Number(l.availableStock) || 0)), fbh: !!l.isFulfilledByHB });
    }
  }
  return out;
}

export const hepsiburadaAdapter: StockAdapter = {
  channel: 'hepsiburada',
  supportsWrite: MARKETPLACE_HEPSIBURADA,
  ...(MARKETPLACE_HEPSIBURADA ? {} : { unsupportedReason: 'coming_soon' }),

  async listAccounts(userId) {
    if (!isHepsiburadaEnabled(userId)) return [];
    const cred = await prisma.credential.findUnique({ where: { userId }, select: HB_CREDENTIAL_SELECT });
    const mid = cred?.hepsiburadaMerchantId?.trim();
    return mid && cred?.hepsiburadaApiKey ? [{ accountRef: mid, label: 'Hepsiburada' }] : [];
  },

  async ownsAccount(userId, accountRef) {
    const cred = await prisma.credential.findUnique({ where: { userId }, select: { hepsiburadaMerchantId: true } });
    return !!cred?.hepsiburadaMerchantId && cred.hepsiburadaMerchantId.trim() === String(accountRef);
  },

  async listCandidates(userId) {
    const accounts = await hepsiburadaAdapter.listAccounts(userId);
    if (!accounts.length) return [];
    const merchantId = accounts[0].accountRef;
    const rows = await prisma.hepsiburadaListing.findMany({
      where: { userId, merchantId },
      select: { hbSku: true, merchantSku: true, title: true, availableStock: true, thumbnailUrl: true, isSalable: true, isFulfilledByHB: true, isSuspended: true },
    });
    return rows.map<RemoteCandidate>((r) => ({
      channel: 'hepsiburada',
      accountRef: merchantId,
      accountLabel: accounts[0].label,
      externalId: r.hbSku,
      variantRef: '',
      variantValueKey: null,
      sku: r.merchantSku || r.hbSku,
      variantLabel: r.merchantSku && r.merchantSku !== r.hbSku ? r.hbSku : null,
      title: r.title || r.merchantSku || r.hbSku,
      imageUrl: r.thumbnailUrl,
      quantity: r.availableStock,
      state: r.isSalable ? 'active' : r.isSuspended ? 'inactive' : 'pending',
      supportsWrite: !r.isFulfilledByHB,
    }));
  },

  async readQuantities(userId, links, opts) {
    const out = new Map<string, RemoteQty>();
    if (!links.length) return out;
    if (opts?.cacheOnly) {
      const rows = await prisma.hepsiburadaListing.findMany({
        where: { userId, hbSku: { in: links.map((l) => l.externalId) } },
        select: { hbSku: true, merchantId: true, availableStock: true },
      });
      for (const l of links) {
        const r = rows.find((x) => x.hbSku === l.externalId && x.merchantId === l.accountRef);
        if (r) out.set(l.id, { qty: r.availableStock });
      }
      return out;
    }
    const accountRef = links[0].accountRef;
    const client = await clientFor(userId, accountRef);
    if (!client) return out;
    const mine = links.filter((l) => l.accountRef === accountRef);
    try {
      const fresh = await freshBySkus(client, mine.map((l) => l.externalId));
      for (const l of mine) {
        const f = fresh.get(l.externalId);
        if (f) out.set(l.id, { qty: f.qty });
      }
    } catch {
      /* unreadable */
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
      let fresh: Map<string, { qty: number; fbh: boolean }>;
      try {
        fresh = await freshBySkus(client, group.map((it) => it.link.externalId));
      } catch (err) {
        results.push(...group.map((it) => ({ pushId: it.pushId, linkId: it.link.id, status: 'failed' as const, retryable: isRetryableHttp(err), error: errMsg(err) })));
        continue;
      }
      const toSend: Array<{ it: (typeof group)[number]; fresh: number; send: number }> = [];
      for (const it of group) {
        const f = fresh.get(it.link.externalId);
        if (!f) {
          results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: false, error: 'listing_not_found', linkPatch: { status: 'paused', statusReason: 'listing_removed' } });
          continue;
        }
        if (f.fbh) {
          results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: false, error: 'fulfilled_by_hepsiburada', linkPatch: { status: 'unsupported', statusReason: 'fulfilled_by_hepsiburada' } });
          continue;
        }
        const send = decideSendQty(Math.min(MAX_QTY, it.targetQty), f.qty, it.reason);
        if (send === null) {
          results.push({ pushId: it.pushId, linkId: it.link.id, status: 'skipped', freshRemoteQty: f.qty, sentQty: f.qty, remoteQtyAfter: f.qty });
        } else {
          toSend.push({ it, fresh: f.qty, send });
        }
      }
      if (!toSend.length) continue;
      try {
        const batches = await submitHbUpload(
          userId, client, 'stock',
          toSend.map((c) => ({ hepsiburadaSku: c.it.link.externalId, availableStock: c.send })),
          { source: 'stock' },
        );
        let offset = 0;
        for (const b of batches) {
          for (const c of toSend.slice(offset, offset + b.items.length)) {
            results.push({ pushId: c.it.pushId, linkId: c.it.link.id, status: 'awaiting_batch', freshRemoteQty: c.fresh, sentQty: c.send, externalRef: b.uploadId });
          }
          offset += b.items.length;
        }
      } catch (err) {
        for (const c of toSend) {
          results.push({ pushId: c.it.pushId, linkId: c.it.link.id, status: 'failed', retryable: isRetryableHttp(err), freshRemoteQty: c.fresh, error: errMsg(err) });
        }
      }
    }
    return results;
  },

  async resolveBatch(userId, accountRef, batchRef) {
    const client = await clientFor(userId, accountRef);
    if (!client) return { done: true, error: 'account_not_owned', failedBarcodes: undefined };
    const outcome = interpretUpload(await client.getUpload('stock', batchRef));
    if (outcome.state === 'pending') return { done: false };
    await prisma.hepsiburadaUploadBatch.updateMany({
      where: { userId, kind: 'stock', uploadId: batchRef, status: 'pending' },
      data: { status: outcome.state, resolvedAt: new Date(), errors: outcome.state === 'done' ? outcome.failedSkus : { error: outcome.error } },
    });
    if (outcome.state === 'failed') return { done: true, error: outcome.error, failedBarcodes: undefined };
    return { done: true, failedBarcodes: new Set(Object.keys(outcome.failedSkus)) };
  },
};
