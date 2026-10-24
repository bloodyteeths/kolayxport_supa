/**
 * Etsy stock adapter (W2, T8). Server-only.
 *
 * Push = per listing, inside withListingInventoryLock + withEtsyBudget(Critical):
 *   fresh GET inventory -> quantity-only payload (structure asserted) -> PUT.
 *
 * Zero stock (founder decision): multi-product listings disable the variation
 * (is_enabled=false, quantity left as is); single-product / shared-quantity
 * listings — or etsyZeroStockAction 'deactivate_listing' — PATCH
 * state=inactive and mark deactivatedByStock. Reactivation only when the
 * listing is 'inactive', we deactivated it and nothing changed its state since
 * (EtsyListing.stateChangedAt <= deactivatedAt). Expired / sold_out listings
 * are never PATCHed.
 *
 * Effective remote quantity = is_enabled ? quantity : 0.
 */
import prisma from '@/lib/prisma';
import { etsyFetch, etsyAuthHeaders } from '@/lib/etsy/http';
import { EtsyPriority, withEtsyBudget } from '@/lib/etsy/rateBudget';
import { withListingInventoryLock } from '@/lib/etsy/inventoryLock';
import { isEtsyDeferError } from '@/lib/etsy/webhooks/types';
import { getEtsyAccessToken } from '@/lib/etsy/etsyToken';
import { SHARED_QUANTITY_KEY } from '@/lib/etsy/variantKey';
import { computeLinkTarget, decideSendQty, reasonAllowsRaise } from '../math';
import {
  StructureChangedError,
  buildQuantityOnlyInventoryPayload,
  expandChangesToQuantityGroups,
  payloadAllZero,
  productsFromInventory,
  type QuantityChange,
} from '../etsyInventoryPayload';
import { normalizeSku } from '../normalize';
import type { RemoteCandidate } from '../matching';
import {
  ACCOUNT_CHANGED_PATCH,
  errMsg,
  failAll,
  type PushItem,
  type PushResult,
  type RemoteQty,
  type StockAdapter,
  type StockLinkRow,
} from './types';
import { ETSY_OPENAPI_BASE } from '@/lib/etsy/apiBase';

const ETSY_API = ETSY_OPENAPI_BASE;

class EtsyHttpError extends Error {
  constructor(public status: number, body: string) {
    super(`Etsy ${status}: ${body.slice(0, 300)}`);
  }
}

async function etsyJson(url: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await etsyFetch(
    url,
    { ...init, headers: { ...etsyAuthHeaders(token), 'Content-Type': 'application/json', ...(init.headers as any) } },
    { priority: EtsyPriority.Critical, deferOn429: true },
  );
  if (!res.ok) throw new EtsyHttpError(res.status, await res.text().catch(() => ''));
  if (res.status === 204) return {};
  return res.json();
}

type InvRow = ReturnType<typeof productsFromInventory>[number];

function effQty(r: { quantity: number; isEnabled: boolean }): number {
  return r.isEnabled ? Math.max(0, r.quantity) : 0;
}

/** Pure: rows of the GET that a link controls. */
export function rowsForLink(link: Pick<StockLinkRow, 'variantRef' | 'variantValueKey' | 'remoteSku'>, rows: InvRow[]): { rows: InvRow[]; repoint?: InvRow } {
  if (link.variantRef === SHARED_QUANTITY_KEY) return { rows };
  if (link.variantRef === '') return { rows: rows.length === 1 ? rows : [] };
  const byKey = rows.filter((r) => r.variantKey === link.variantRef);
  if (byKey.length) return { rows: byKey };
  if (link.variantValueKey) {
    const byVal = rows.filter((r) => r.variantValueKey === link.variantValueKey);
    if (byVal.length === 1) return { rows: byVal, repoint: byVal[0] };
  }
  const sku = normalizeSku(link.remoteSku);
  if (sku) {
    const bySku = rows.filter((r) => normalizeSku(r.sku) === sku);
    if (bySku.length === 1) return { rows: bySku, repoint: bySku[0] };
  }
  return { rows: [] };
}

async function ownedShop(userId: string, shopId: string) {
  return prisma.etsyShop.findFirst({ where: { userId, shopId: String(shopId), isActive: true }, select: { shopId: true, shopName: true } });
}

export const etsyAdapter: StockAdapter = {
  channel: 'etsy',
  supportsWrite: true,

  async listAccounts(userId) {
    const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true, shopName: true } });
    return shops.map((s) => ({ accountRef: s.shopId, label: s.shopName || `Etsy ${s.shopId}` }));
  },

  async ownsAccount(userId, accountRef) {
    return !!(await ownedShop(userId, accountRef));
  },

  async listCandidates(userId) {
    const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true, shopName: true } });
    const out: RemoteCandidate[] = [];
    for (const shop of shops) {
      const listings = await prisma.etsyListing.findMany({
        where: { etsyShopId: shop.shopId, state: { in: ['active', 'inactive', 'sold_out'] } },
        select: {
          etsyListingId: true,
          title: true,
          state: true,
          quantity: true,
          hasVariations: true,
          quantityOnProperty: true,
          thumbnailUrl170x135: true,
          thumbnailUrl75x75: true,
          offerings: { select: { variantKey: true, variantValueKey: true, sku: true, quantity: true, isEnabled: true, propertyValues: true } },
        },
      });
      for (const l of listings) {
        const base = {
          channel: 'etsy',
          accountRef: shop.shopId,
          accountLabel: shop.shopName || shop.shopId,
          externalId: String(l.etsyListingId),
          title: l.title,
          imageUrl: l.thumbnailUrl170x135 || l.thumbnailUrl75x75 || null,
          state: l.state,
          supportsWrite: true,
        };
        const offs = l.offerings || [];
        if (offs.length === 0) {
          // Not yet in the offering cache (W3 fills it on refresh): only simple listings are usable.
          if (!l.hasVariations) out.push({ ...base, variantRef: '', variantValueKey: '', sku: null, quantity: l.quantity });
          continue;
        }
        if (offs.length > 1 && (!l.quantityOnProperty || l.quantityOnProperty.length === 0)) {
          const skus = Array.from(new Set(offs.map((o) => normalizeSku(o.sku)).filter(Boolean)));
          out.push({
            ...base,
            variantRef: SHARED_QUANTITY_KEY,
            variantValueKey: SHARED_QUANTITY_KEY,
            sku: skus.length === 1 ? offs.find((o) => o.sku)?.sku ?? null : null,
            quantity: Math.min(...offs.map((o) => (o.isEnabled ? o.quantity : 0))),
          });
          continue;
        }
        for (const o of offs) {
          out.push({
            ...base,
            variantRef: o.variantKey,
            variantValueKey: o.variantValueKey,
            sku: o.sku,
            variantLabel: variantLabel(o.propertyValues),
            quantity: o.isEnabled ? o.quantity : 0,
          });
        }
      }
    }
    return out;
  },

  async readQuantities(userId, links, opts) {
    const out = new Map<string, RemoteQty>();
    const byListing = groupBy(links, (l) => `${l.accountRef}|${l.externalId}`);
    for (const [key, group] of Array.from(byListing.entries())) {
      const [shopId, listingId] = key.split('|');
      if (opts?.cacheOnly) {
        let id: bigint;
        try {
          id = BigInt(listingId);
        } catch {
          continue;
        }
        const offs = await prisma.etsyListingOffering.findMany({
          where: { etsyShopId: shopId, etsyListingId: id },
          select: { variantKey: true, variantValueKey: true, sku: true, quantity: true, isEnabled: true, remoteUpdatedTs: true },
        });
        const rows = offs.map((o) => ({ ...o, quantityKey: '', productId: null }));
        for (const link of group) {
          const r = rowsForLink(link, rows as any).rows;
          if (r.length) out.set(link.id, { qty: Math.min(...r.map(effQty)), remoteUpdatedTs: Math.max(...offs.map((o) => o.remoteUpdatedTs)) });
        }
        continue;
      }
      if (!(await ownedShop(userId, shopId))) continue;
      try {
        const token = await getEtsyAccessToken(shopId, userId);
        const inv = await etsyJson(`${ETSY_API}/listings/${listingId}/inventory`, token);
        const rows = productsFromInventory(inv);
        for (const link of group) {
          const r = rowsForLink(link, rows).rows;
          if (r.length) out.set(link.id, { qty: Math.min(...r.map(effQty)) });
        }
      } catch {
        /* unreadable -> missing */
      }
    }
    return out;
  },

  async pushQuantities(userId, items, ctx) {
    const results: PushResult[] = [];
    const byListing = groupBy(items, (i) => `${i.link.accountRef}|${i.link.externalId}`);
    for (const [key, group] of Array.from(byListing.entries())) {
      const [shopId, listingId] = key.split('|');
      if (!(await ownedShop(userId, shopId))) {
        results.push(...failAll(group, 'account_not_owned', { retryable: false, linkPatch: ACCOUNT_CHANGED_PATCH }));
        continue;
      }
      try {
        const r = await withListingInventoryLock(listingId, () =>
          withEtsyBudget({ shopId, userId, priority: EtsyPriority.Critical, deferOn429: true }, () =>
            pushListing(userId, shopId, listingId, group, ctx.settings.etsyZeroStockAction),
          ),
        );
        results.push(...r);
      } catch (err) {
        if (isEtsyDeferError(err)) {
          results.push(...group.map((g) => ({ pushId: g.pushId, linkId: g.link.id, status: 'retry' as const, deferMs: (err as any).retryAfterMs || 30_000, error: errMsg(err) })));
        } else if (err instanceof EtsyHttpError && (err.status === 401 || err.status === 403)) {
          results.push(...failAll(group, errMsg(err), { retryable: true }));
        } else {
          results.push(...failAll(group, errMsg(err), { retryable: !(err instanceof EtsyHttpError) || err.status >= 500 || err.status === 429 }));
        }
      }
    }
    return results;
  },
};

type PlanRow = { item: PushItem; fresh: number; send: number | null; target: number; rowEff: number; rows: InvRow[]; repoint?: InvRow };

export type ListingPushPlan = {
  plan: PlanRow[];
  missing: PushItem[];
  changes: Map<string, QuantityChange>;
  wantDeactivate: boolean;
  wantReactivate: boolean;
  /** Reactivating only: effective quantity each managed sibling link will show. */
  siblingEff: Map<string, number>;
};

export type SiblingLink = {
  link: Pick<StockLinkRow, 'id' | 'variantRef' | 'variantValueKey' | 'remoteSku'>;
  /** Hub target, or null when the sibling's item is not tracked/active (rows left as they are). */
  target: number | null;
};

/**
 * Pure: what one listing push writes.
 *
 * rowEff is the quantity a controlled row should hold: the target for reasons
 * that may raise, else min(target, raw remote). `ourInactive` = the listing is
 * inactive because WE deactivated it for stock; then every link's effective
 * remote is 0 and only a raising reason can ask for reactivation.
 *
 * `reactivating` (second pass, once the listing state allowed it): every
 * managed sibling link on the listing gets its current hub target too
 * (lower-only against its stored row), so reactivating never exposes a
 * variant at a stale quantity the hub no longer covers.
 */
export function planListingPush(a: {
  rows: InvRow[];
  group: PushItem[];
  siblings: SiblingLink[];
  zeroAction: string;
  ourInactive: boolean;
  reactivating: boolean;
}): ListingPushPlan {
  const multi = a.rows.length > 1;
  const changes = new Map<string, QuantityChange>();
  const plan: PlanRow[] = [];
  const missing: PushItem[] = [];
  const siblingEff = new Map<string, number>();
  let wantDeactivate = false;
  let wantReactivate = false;

  const applyRow = (r: InvRow, eff: number, variantRef: string) => {
    if (eff > 0) {
      const ch: QuantityChange = {};
      if (r.quantity !== eff) ch.quantity = eff;
      if (!r.isEnabled) ch.isEnabled = true;
      if (Object.keys(ch).length) changes.set(r.variantKey, { ...(changes.get(r.variantKey) || {}), ...ch });
    } else if (multi && a.zeroAction !== 'deactivate_listing' && variantRef !== SHARED_QUANTITY_KEY) {
      if (r.isEnabled) changes.set(r.variantKey, { ...(changes.get(r.variantKey) || {}), isEnabled: false });
    } else {
      wantDeactivate = true;
    }
  };

  for (const item of a.group) {
    const m = rowsForLink(item.link, a.rows);
    if (!m.rows.length) {
      missing.push(item);
      continue;
    }
    const rawFresh = Math.min(...m.rows.map(effQty));
    const fresh = a.ourInactive ? 0 : rawFresh;
    const target = Math.max(0, Math.trunc(item.targetQty));
    const raising = reasonAllowsRaise(item.reason);
    const rowEff = raising ? target : Math.min(target, rawFresh);
    let send = decideSendQty(target, fresh, item.reason);
    if (a.reactivating) send = rowEff === fresh ? null : rowEff;
    plan.push({ item, fresh, send, target, rowEff, rows: m.rows, repoint: m.repoint });
    if (a.ourInactive && raising && rowEff > 0) wantReactivate = true;
  }

  for (const p of plan) for (const r of p.rows) applyRow(r, p.rowEff, p.item.link.variantRef);

  if (a.reactivating) {
    for (const s of a.siblings) {
      if (s.target === null) continue;
      const m = rowsForLink(s.link, a.rows);
      if (!m.rows.length) continue;
      const eff = Math.min(Math.max(0, Math.trunc(s.target)), Math.min(...m.rows.map(effQty)));
      siblingEff.set(s.link.id, eff);
      for (const r of m.rows) applyRow(r, eff, s.link.variantRef);
    }
  }
  return { plan, missing, changes, wantDeactivate, wantReactivate, siblingEff };
}

async function pushListing(userId: string, shopId: string, listingId: string, group: PushItem[], zeroAction: string): Promise<PushResult[]> {
  const token = await getEtsyAccessToken(shopId, userId);
  const inv = await etsyJson(`${ETSY_API}/listings/${listingId}/inventory`, token);
  const rows = productsFromInventory(inv);
  const results: PushResult[] = [];

  // Every other active link on this listing: a deactivation covers them too, and
  // a reactivation must bring their rows to the hub first.
  const groupIds = group.map((g) => g.link.id);
  const siblingRows = await prisma.stockLink.findMany({
    where: { userId, channel: 'etsy', accountRef: String(shopId), externalId: String(listingId), status: 'active', id: { notIn: groupIds } },
    include: { stockItem: { select: { onHand: true, safetyBuffer: true, tracking: true, status: true } } },
  });
  const siblings: SiblingLink[] = siblingRows.map((l) => ({
    link: l,
    target:
      l.stockItem && l.stockItem.tracking === 'tracked' && l.stockItem.status === 'active'
        ? computeLinkTarget({ onHand: l.stockItem.onHand, safetyBuffer: l.stockItem.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty })
        : null,
  }));
  const flagged = [...group.map((g) => g.link), ...siblingRows].filter((l) => l.deactivatedByStock);

  // Listing state is needed up front when we may have deactivated it (effective qty 0 then).
  let state = null as string | null;
  const fetchState = async () => {
    if (state === null) {
      const listing = await etsyJson(`${ETSY_API}/listings/${listingId}`, token);
      state = String(listing?.state || '').toLowerCase();
    }
    return state;
  };
  if (flagged.length) await fetchState();
  const ourInactive = flagged.length > 0 && state === 'inactive';

  let planned = planListingPush({ rows, group, siblings, zeroAction, ourInactive, reactivating: false });
  let reactivating = false;
  if (planned.wantReactivate && !planned.wantDeactivate) {
    // Reactivate only when nothing else changed the listing's state since we deactivated it.
    const cached = await prisma.etsyListing.findFirst({
      where: { etsyShopId: shopId, etsyListingId: BigInt(listingId) },
      select: { stateChangedAt: true },
    });
    const deactAt = flagged.map((l) => l.deactivatedAt).filter(Boolean).sort((x, y) => (y as Date).getTime() - (x as Date).getTime())[0] as Date | undefined;
    const untouched = !cached?.stateChangedAt || !deactAt || cached.stateChangedAt.getTime() <= deactAt.getTime() + 60_000;
    if (untouched) {
      planned = planListingPush({ rows, group, siblings, zeroAction, ourInactive, reactivating: true });
      reactivating = true;
    }
  }
  const { plan, missing, siblingEff } = planned;
  let { wantDeactivate } = planned;
  for (const item of missing) {
    results.push({ pushId: item.pushId, linkId: item.link.id, status: 'failed', retryable: false, error: 'variant_missing', linkPatch: { status: 'unsupported', statusReason: 'variant_missing' } });
  }

  let payload: any = null;
  if (planned.changes.size) {
    try {
      // Etsy keeps one quantity per quantity_on_property group: widen each change
      // to its group (conflicts resolve to the minimum, oversell-safe).
      const changes = expandChangesToQuantityGroups(inv, planned.changes);
      payload = buildQuantityOnlyInventoryPayload(inv, changes);
    } catch (err) {
      if (err instanceof StructureChangedError) {
        return [
          ...results,
          ...plan.map((p) => ({ pushId: p.item.pushId, linkId: p.item.link.id, status: 'failed' as const, retryable: false, error: err.message, linkPatch: { status: 'unsupported', statusReason: 'structure' } })),
        ];
      }
      throw err;
    }
    // Never leave an active listing with nothing purchasable: deactivate instead.
    if (payloadAllZero(payload)) {
      wantDeactivate = true;
      payload = null;
    }
  }
  const doReactivate = reactivating && !wantDeactivate && state === 'inactive';

  // Listing state (one call) only when a state change is on the table.
  if (wantDeactivate) await fetchState();

  let remoteAfter: InvRow[] | null = null;
  if (payload) {
    try {
      const putRes = await etsyJson(`${ETSY_API}/listings/${listingId}/inventory?max_variations_supported=3`, token, { method: 'PUT', body: JSON.stringify(payload) });
      remoteAfter = productsFromInventory(putRes);
    } catch (err) {
      if (err instanceof EtsyHttpError) throw err;
      // Timeout / network on a write: it may have landed. Verify on the next pass.
      return [
        ...results,
        ...plan.map((p) => ({ pushId: p.item.pushId, linkId: p.item.link.id, status: 'unknown' as const, freshRemoteQty: p.fresh, sentQty: ourInactive ? 0 : p.send ?? p.fresh, error: errMsg(err) })),
      ];
    }
  }

  const now = new Date();
  let deactivated = false;
  if (wantDeactivate && state === 'active') {
    await etsyJson(`${ETSY_API}/shops/${shopId}/listings/${listingId}`, token, { method: 'PATCH', body: JSON.stringify({ state: 'inactive' }) });
    deactivated = true;
    // The whole listing sells 0 now: every link on it is "deactivated by stock",
    // so the observation that follows is our own state, not a drop or a pause.
    if (siblingRows.length) {
      await prisma.stockLink.updateMany({
        where: { id: { in: siblingRows.map((l) => l.id) } },
        data: { deactivatedByStock: true, deactivatedAt: now, lastSeenRemoteQty: 0, lastSeenAt: now },
      });
    }
  }
  let reactivated = false;
  if (doReactivate) {
    await etsyJson(`${ETSY_API}/shops/${shopId}/listings/${listingId}`, token, { method: 'PATCH', body: JSON.stringify({ state: 'active' }) });
    reactivated = true;
    for (const l of siblingRows) {
      const eff = siblingEff.get(l.id);
      await prisma.stockLink.update({
        where: { id: l.id },
        data: { deactivatedByStock: false, deactivatedAt: null, ...(eff !== undefined ? { lastSeenRemoteQty: eff, lastSeenAt: now } : {}) },
      });
    }
  }
  const stillInactive = (ourInactive && !reactivated) || deactivated;

  for (const p of plan) {
    const afterRows = remoteAfter ? rowsForLink(p.item.link, remoteAfter).rows : null;
    const after = stillInactive ? 0 : afterRows && afterRows.length ? Math.min(...afterRows.map(effQty)) : p.send ?? p.fresh;
    const changed = !!payload || deactivated || reactivated;
    const linkPatch: PushResult['linkPatch'] = {};
    if (deactivated) {
      linkPatch.deactivatedByStock = true;
      linkPatch.deactivatedAt = now;
    } else if (reactivated) {
      linkPatch.deactivatedByStock = false;
      linkPatch.deactivatedAt = null;
    }
    if (p.repoint) {
      linkPatch.variantRef = p.repoint.variantKey;
      linkPatch.variantValueKey = p.repoint.variantValueKey;
    }
    results.push({
      pushId: p.item.pushId,
      linkId: p.item.link.id,
      status: changed && (p.send !== null || deactivated || reactivated) ? 'applied' : 'skipped',
      freshRemoteQty: p.fresh,
      sentQty: stillInactive ? 0 : p.send ?? p.fresh,
      remoteQtyAfter: after,
      externalRef: deactivated ? 'deactivated' : reactivated ? 'reactivated' : null,
      linkPatch: Object.keys(linkPatch).length ? linkPatch : undefined,
    });
  }
  return results;
}

function variantLabel(propertyValues: unknown): string | null {
  if (!Array.isArray(propertyValues)) return null;
  const parts = propertyValues
    .map((pv: any) => {
      const vals = Array.isArray(pv?.values) ? pv.values.join('/') : pv?.value ?? '';
      return pv?.property_name ? `${pv.property_name}: ${vals}` : String(vals);
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ').slice(0, 120) : null;
}

export function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = key(t);
    const arr = m.get(k);
    if (arr) arr.push(t);
    else m.set(k, [t]);
  }
  return m;
}
