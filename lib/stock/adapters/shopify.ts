/**
 * Shopify stock adapter (W2, T8). Server-only.
 *
 * Identity: accountRef = ShopifyShop.id, externalId = product id,
 * variantRef = inventory_item_id. Location = StockSettings.shopifyLocationId,
 * else the shop's primary location.
 *
 * Write = Admin GraphQL inventorySetQuantities (API 2024-10, the version the
 * existing client uses) with compareQuantity = the fresh read: a concurrent
 * sale makes Shopify reject the write (COMPARE_QUANTITY_STALE); we re-read and
 * retry once. NOTE: from API 2026-04 the compare field is renamed
 * changeFromQuantity — update both together if API_VERSION is bumped.
 */
import prisma from '@/lib/prisma';
import { getValidAccessToken } from '@/lib/integrations/shopifyClient';
import { decideSendQty } from '../math';
import type { RemoteCandidate } from '../matching';
import {
  ACCOUNT_CHANGED_PATCH,
  errMsg,
  failAll,
  type PushResult,
  type RemoteQty,
  type StockAdapter,
} from './types';

const API_VERSION = '2024-10';

type Ctx = { domain: string; token: string };

async function ctxFor(userId: string, accountRef: string): Promise<Ctx | null> {
  const shop = await prisma.shopifyShop.findFirst({ where: { id: accountRef, userId, isActive: true }, select: { id: true, shopDomain: true } });
  if (!shop) return null;
  const token = await getValidAccessToken(shop.id);
  return { domain: shop.shopDomain, token };
}

async function gql(ctx: Ctx, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://${ctx.domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': ctx.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
  const json = JSON.parse(text);
  if (json.errors?.length) throw Object.assign(new Error(`Shopify GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`), { status: 400 });
  return json.data;
}

async function primaryLocationId(ctx: Ctx): Promise<string | null> {
  const data = await gql(ctx, '{ location { id } }', {});
  const gid = String(data?.location?.id || '');
  return gid ? gid.split('/').pop() || null : null;
}

async function readLevels(ctx: Ctx, itemIds: string[], locationId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < itemIds.length; i += 50) {
    const ids = itemIds.slice(i, i + 50).join(',');
    const res = await fetch(
      `https://${ctx.domain}/admin/api/${API_VERSION}/inventory_levels.json?inventory_item_ids=${encodeURIComponent(ids)}&location_ids=${encodeURIComponent(locationId)}`,
      { headers: { 'X-Shopify-Access-Token': ctx.token }, signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw Object.assign(new Error(`Shopify inventory_levels ${res.status}`), { status: res.status });
    const json = await res.json();
    for (const lvl of json?.inventory_levels || []) {
      if (lvl?.available === null || lvl?.available === undefined) continue;
      out.set(String(lvl.inventory_item_id), Math.trunc(Number(lvl.available)));
    }
  }
  return out;
}

const SET_MUTATION = `
mutation kxStockSet($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
    userErrors { code field message }
  }
}`;

async function setQuantity(ctx: Ctx, itemId: string, locationId: string, qty: number, compare: number): Promise<{ ok: true } | { ok: false; stale: boolean; error: string }> {
  const data = await gql(ctx, SET_MUTATION, {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: false,
      quantities: [
        {
          inventoryItemId: `gid://shopify/InventoryItem/${itemId}`,
          locationId: `gid://shopify/Location/${locationId}`,
          quantity: qty,
          compareQuantity: compare,
        },
      ],
    },
  });
  const errs: any[] = data?.inventorySetQuantities?.userErrors || [];
  if (!errs.length) return { ok: true };
  const stale = errs.some((e) => String(e?.code || '').includes('COMPARE_QUANTITY') || /compare/i.test(String(e?.message || '')));
  return { ok: false, stale, error: JSON.stringify(errs).slice(0, 300) };
}

export const shopifyAdapter: StockAdapter = {
  channel: 'shopify',
  supportsWrite: true,

  async listAccounts(userId) {
    const shops = await prisma.shopifyShop.findMany({ where: { userId, isActive: true }, select: { id: true, shopDomain: true, shopName: true } });
    return shops.map((s) => ({ accountRef: s.id, label: s.shopName || s.shopDomain }));
  },

  async ownsAccount(userId, accountRef) {
    return !!(await prisma.shopifyShop.findFirst({ where: { id: accountRef, userId, isActive: true }, select: { id: true } }));
  },

  async listCandidates(userId) {
    const accounts = await shopifyAdapter.listAccounts(userId);
    const out: RemoteCandidate[] = [];
    for (const acc of accounts) {
      const products = await prisma.shopifyProduct.findMany({
        where: { userId, shopifyShopId: acc.accountRef, status: { not: 'archived' } },
        select: { shopifyProductId: true, title: true, variants: true, thumbnailUrl: true, status: true },
      });
      for (const p of products) {
        const variants: any[] = Array.isArray(p.variants) ? (p.variants as any[]) : [];
        for (const v of variants) {
          if (!v?.inventory_item_id || v?.fulfillment_service === 'gift_card') continue;
          const tracked = v?.inventory_management === 'shopify';
          out.push({
            channel: 'shopify',
            accountRef: acc.accountRef,
            accountLabel: acc.label,
            externalId: String(p.shopifyProductId),
            variantRef: String(v.inventory_item_id),
            variantValueKey: v?.id ? String(v.id) : null,
            sku: v?.sku || null,
            title: p.title,
            variantLabel: v?.title && v.title !== 'Default Title' ? String(v.title) : null,
            imageUrl: p.thumbnailUrl,
            quantity: Math.max(0, Math.trunc(Number(v?.inventory_quantity) || 0)),
            state: p.status,
            supportsWrite: tracked,
            unsupportedReason: tracked ? null : 'untracked',
          });
        }
      }
    }
    return out;
  },

  async readQuantities(userId, links) {
    const out = new Map<string, RemoteQty>();
    const byAcc = new Map<string, typeof links>();
    for (const l of links) byAcc.set(l.accountRef, [...(byAcc.get(l.accountRef) || []), l]);
    for (const [acc, group] of Array.from(byAcc.entries())) {
      try {
        const ctx = await ctxFor(userId, acc);
        if (!ctx) continue;
        const settings = await prisma.stockSettings.findUnique({ where: { userId }, select: { shopifyLocationId: true } });
        const loc = group[0].locationRef || settings?.shopifyLocationId || (await primaryLocationId(ctx));
        if (!loc) continue;
        const levels = await readLevels(ctx, group.map((l) => l.variantRef), loc);
        for (const l of group) {
          const q = levels.get(l.variantRef);
          if (q !== undefined) out.set(l.id, { qty: Math.max(0, q) });
        }
      } catch {
        /* unreadable */
      }
    }
    return out;
  },

  async pushQuantities(userId, items, { settings }) {
    const results: PushResult[] = [];
    const byAcc = new Map<string, typeof items>();
    for (const it of items) byAcc.set(it.link.accountRef, [...(byAcc.get(it.link.accountRef) || []), it]);
    for (const [acc, group] of Array.from(byAcc.entries())) {
      let ctx: Ctx | null = null;
      try {
        ctx = await ctxFor(userId, acc);
      } catch (err) {
        results.push(...failAll(group, errMsg(err), { retryable: true }));
        continue;
      }
      if (!ctx) {
        results.push(...failAll(group, 'account_not_owned', { retryable: false, linkPatch: ACCOUNT_CHANGED_PATCH }));
        continue;
      }
      for (const it of group) {
        try {
          const loc = it.link.locationRef || settings.shopifyLocationId || (await primaryLocationId(ctx));
          if (!loc) throw Object.assign(new Error('no_location'), { status: 400 });
          let attempt = 0;
          // One compare-and-set retry after a concurrent change.
          for (;;) {
            const fresh = (await readLevels(ctx, [it.link.variantRef], loc)).get(it.link.variantRef);
            if (fresh === undefined) {
              results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: false, error: 'inventory_level_missing', linkPatch: { status: 'unsupported', statusReason: 'untracked_or_location' } });
              break;
            }
            const send = decideSendQty(it.targetQty, Math.max(0, fresh), it.reason);
            if (send === null) {
              results.push({ pushId: it.pushId, linkId: it.link.id, status: 'skipped', freshRemoteQty: fresh, sentQty: fresh, remoteQtyAfter: fresh });
              break;
            }
            const r = await setQuantity(ctx, it.link.variantRef, loc, send, fresh);
            if (r.ok) {
              results.push({ pushId: it.pushId, linkId: it.link.id, status: 'applied', freshRemoteQty: fresh, sentQty: send, remoteQtyAfter: send });
              break;
            }
            if (r.stale && attempt === 0) {
              attempt++;
              continue;
            }
            results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: r.stale, freshRemoteQty: fresh, error: r.error });
            break;
          }
        } catch (err) {
          const status = Number((err as any)?.status);
          const timeout = (err as any)?.name === 'TimeoutError';
          results.push({
            pushId: it.pushId,
            linkId: it.link.id,
            status: timeout ? 'unknown' : 'failed',
            retryable: !Number.isFinite(status) || status >= 500 || status === 429,
            error: errMsg(err),
          });
        }
      }
    }
    return results;
  },
};
