/**
 * eBay stock adapter (W2, T8). Server-only.
 *
 * Identity: accountRef = 'default' (one eBay account per user, Credential),
 * externalId = inventory SKU, locationRef = offerId. Fresh read = GET offer
 * (availableQuantity), falling back to the inventory item. Write =
 * bulk_update_price_quantity (max 25 per call) — never the inventory_item PUT
 * (that replaces the whole item). Legacy (non-Inventory-API) listings are
 * unsupported. eBay has no compare-and-set.
 */
import prisma from '@/lib/prisma';
import { callEbayAPI, EbayNotConnectedError, getUserAccessToken } from '@/lib/integrations/ebayClient';
import { decideSendQty } from '../math';
import type { RemoteCandidate } from '../matching';
import { ACCOUNT_CHANGED_PATCH, errMsg, failAll, isRetryableHttp, type PushResult, type RemoteQty, type StockAdapter, type StockLinkRow } from './types';

export const EBAY_ACCOUNT_REF = 'default';
const MAX_BULK = 25;

async function hasEbay(userId: string): Promise<boolean> {
  const c = await prisma.credential.findUnique({ where: { userId }, select: { ebayAccessToken: true } });
  return !!c?.ebayAccessToken;
}

async function freshQty(token: string, link: StockLinkRow): Promise<number | null> {
  if (link.locationRef) {
    try {
      const offer = await callEbayAPI(`/sell/inventory/v1/offer/${encodeURIComponent(link.locationRef)}`, token);
      if (offer?.availableQuantity !== undefined && offer?.availableQuantity !== null) return Math.max(0, Math.trunc(Number(offer.availableQuantity)));
    } catch (err) {
      if (!/\b404\b/.test(errMsg(err))) throw err;
    }
  }
  const item = await callEbayAPI(`/sell/inventory/v1/inventory_item/${encodeURIComponent(link.externalId)}`, token);
  const q = item?.availability?.shipToLocationAvailability?.quantity;
  return q === undefined || q === null ? null : Math.max(0, Math.trunc(Number(q)));
}

/** Pure: token errors that mean the eBay connection is really gone (pause), vs transient (retry). */
export function isEbayAuthGone(err: unknown): boolean {
  if (err instanceof EbayNotConnectedError) return true;
  const msg = errMsg(err);
  if (!/token refresh failed/i.test(msg)) return false;
  return /invalid_grant|\b(400|401)\b/i.test(msg);
}

export const ebayAdapter: StockAdapter = {
  channel: 'ebay',
  supportsWrite: true,

  async listAccounts(userId) {
    return (await hasEbay(userId)) ? [{ accountRef: EBAY_ACCOUNT_REF, label: 'eBay' }] : [];
  },

  async ownsAccount(userId, accountRef) {
    return accountRef === EBAY_ACCOUNT_REF && (await hasEbay(userId));
  },

  async listCandidates(userId) {
    if (!(await hasEbay(userId))) return [];
    const rows = await prisma.ebayListing.findMany({
      where: { userId, status: { notIn: ['DELETED', 'ENDED', 'WITHDRAWN'] } },
      select: { sku: true, offerId: true, title: true, quantity: true, imageUrl: true, status: true, isLegacy: true },
    });
    return rows.map<RemoteCandidate>((r) => {
      const writable = !r.isLegacy && !!r.offerId;
      return {
        channel: 'ebay',
        accountRef: EBAY_ACCOUNT_REF,
        accountLabel: 'eBay',
        externalId: r.sku,
        variantRef: '',
        variantValueKey: r.offerId,
        sku: r.sku,
        title: r.title,
        imageUrl: r.imageUrl,
        quantity: r.quantity,
        state: r.status,
        supportsWrite: writable,
        unsupportedReason: writable ? null : r.isLegacy ? 'legacy_listing' : 'no_offer',
      };
    });
  },

  async readQuantities(userId, links, opts) {
    const out = new Map<string, RemoteQty>();
    if (!links.length) return out;
    if (opts?.cacheOnly) {
      const rows = await prisma.ebayListing.findMany({ where: { userId, sku: { in: links.map((l) => l.externalId) } }, select: { sku: true, quantity: true } });
      for (const l of links) {
        const r = rows.find((x) => x.sku === l.externalId);
        if (r) out.set(l.id, { qty: r.quantity });
      }
      return out;
    }
    let token: string;
    try {
      token = await getUserAccessToken(userId);
    } catch {
      return out;
    }
    for (const l of links) {
      try {
        const q = await freshQty(token, l);
        if (q !== null) out.set(l.id, { qty: q });
      } catch {
        /* unreadable */
      }
    }
    return out;
  },

  async pushQuantities(userId, items) {
    const results: PushResult[] = [];
    const own = items.filter((i) => i.link.accountRef === EBAY_ACCOUNT_REF);
    const foreign = items.filter((i) => i.link.accountRef !== EBAY_ACCOUNT_REF);
    if (foreign.length) results.push(...failAll(foreign, 'account_not_owned', { retryable: false, linkPatch: ACCOUNT_CHANGED_PATCH }));
    if (!own.length) return results;
    let token: string;
    try {
      token = await getUserAccessToken(userId);
    } catch (err) {
      // Only a missing connection or a rejected refresh token means the account
      // changed; network / 5xx hiccups during refresh are retried, never pause.
      if (isEbayAuthGone(err)) results.push(...failAll(own, errMsg(err), { retryable: false, linkPatch: ACCOUNT_CHANGED_PATCH }));
      else results.push(...failAll(own, errMsg(err), { retryable: true }));
      return results;
    }
    const toSend: Array<{ it: (typeof own)[number]; fresh: number; send: number }> = [];
    for (const it of own) {
      try {
        const fresh = await freshQty(token, it.link);
        if (fresh === null) {
          results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: false, error: 'quantity_unreadable', linkPatch: { status: 'unsupported', statusReason: 'no_inventory_item' } });
          continue;
        }
        const send = decideSendQty(it.targetQty, fresh, it.reason);
        if (send === null) results.push({ pushId: it.pushId, linkId: it.link.id, status: 'skipped', freshRemoteQty: fresh, sentQty: fresh, remoteQtyAfter: fresh });
        else toSend.push({ it, fresh, send });
      } catch (err) {
        results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: isRetryableHttp(err), error: errMsg(err) });
      }
    }
    for (let i = 0; i < toSend.length; i += MAX_BULK) {
      const chunk = toSend.slice(i, i + MAX_BULK);
      try {
        const res = await callEbayAPI('/sell/inventory/v1/bulk_update_price_quantity', token, {
          method: 'POST',
          body: JSON.stringify({
            requests: chunk.map((c) => ({
              sku: c.it.link.externalId,
              shipToLocationAvailability: { quantity: c.send },
              ...(c.it.link.locationRef ? { offers: [{ offerId: c.it.link.locationRef, availableQuantity: c.send }] } : {}),
            })),
          }),
        });
        const responses: any[] = Array.isArray(res?.responses) ? res.responses : [];
        for (const c of chunk) {
          const r = responses.find((x) => String(x?.sku) === c.it.link.externalId && (!c.it.link.locationRef || !x?.offerId || String(x.offerId) === c.it.link.locationRef))
            ?? responses.find((x) => String(x?.sku) === c.it.link.externalId);
          const ok = r && Number(r.statusCode) >= 200 && Number(r.statusCode) < 300;
          results.push(
            ok
              ? { pushId: c.it.pushId, linkId: c.it.link.id, status: 'applied', freshRemoteQty: c.fresh, sentQty: c.send, remoteQtyAfter: c.send }
              : r
                ? { pushId: c.it.pushId, linkId: c.it.link.id, status: 'failed', retryable: Number(r.statusCode) >= 500, freshRemoteQty: c.fresh, error: JSON.stringify(r.errors || r).slice(0, 300) }
                : { pushId: c.it.pushId, linkId: c.it.link.id, status: 'unknown', freshRemoteQty: c.fresh, sentQty: c.send },
          );
        }
      } catch (err) {
        for (const c of chunk) {
          results.push({ pushId: c.it.pushId, linkId: c.it.link.id, status: 'failed', retryable: isRetryableHttp(err), freshRemoteQty: c.fresh, error: errMsg(err) });
        }
      }
    }
    return results;
  },
};
