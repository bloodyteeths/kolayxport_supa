/**
 * Generate SKUs for Etsy offerings that have none (W2, T11). Server-only.
 *
 * Never writes to Etsy: each listing's SKU change is STAGED as an Etsy draft
 * through draftService.upsertDraftPatch (the seller reviews it and presses
 * "Sync to Etsy"). Listings whose draft already stages inventory changes are
 * skipped so the seller's staged edits are never clobbered. Variation
 * listings get per-variation SKUs only when sku_on_property already covers
 * the variation properties (changing that is a structural edit left to the
 * seller in the editor).
 */
import prisma from '@/lib/prisma';
import { callEtsyAPI } from '@/lib/etsy/http';
import { getEtsyAccessToken } from '@/lib/etsy/etsyToken';
import { normalizeSku } from './normalize';

export type SkuProposal = {
  listingId: string;
  title: string | null;
  status: 'ok' | 'skipped';
  reason?: 'draft_has_inventory' | 'sku_not_per_variation' | 'already_has_sku' | 'not_found' | 'error';
  products: Array<{ index: number; label: string | null; sku: string }>;
};

/** Pure: proposed SKU for product `index` of a listing. */
export function proposeSku(prefix: string, listingId: string, index: number, total: number): string {
  const p = (normalizeSku(prefix) || 'KX').replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'KX';
  const base = `${p}-${String(listingId).slice(-7)}`;
  return total > 1 ? `${base}-${String(index + 1).padStart(2, '0')}` : base;
}

function propertyIdsOf(products: any[]): number[] {
  const s = new Set<number>();
  for (const p of products) for (const pv of p?.property_values || []) if (Number(pv?.property_id)) s.add(Number(pv.property_id));
  return Array.from(s);
}

export async function generateEtsySkus(userId: string, a: { shopId: string; listingIds: string[]; prefix?: string; apply: boolean }): Promise<SkuProposal[]> {
  const shop = await prisma.etsyShop.findFirst({ where: { userId, shopId: String(a.shopId), isActive: true }, select: { shopId: true } });
  if (!shop) throw new Error('shop_not_owned');
  const ids = Array.from(new Set(a.listingIds.map(String))).slice(0, 50);
  const token = await getEtsyAccessToken(shop.shopId, userId);
  const out: SkuProposal[] = [];
  for (const listingId of ids) {
    let title: string | null = null;
    try {
      const cached = await prisma.etsyListing.findFirst({ where: { etsyShopId: shop.shopId, etsyListingId: BigInt(listingId) }, select: { title: true } });
      title = cached?.title ?? null;
      const staged = await prisma.etsyListingDraft.findFirst({
        where: { userId, etsyShopId: shop.shopId, etsyListingId: BigInt(listingId), status: { in: ['draft', 'failed', 'conflict'] } },
        select: { inventoryPatch: true },
      });
      const patch = staged?.inventoryPatch as any;
      if (patch && typeof patch === 'object' && Object.keys(patch).length) {
        out.push({ listingId, title, status: 'skipped', reason: 'draft_has_inventory', products: [] });
        continue;
      }
      const inv = await callEtsyAPI(`/listings/${listingId}/inventory`, token);
      const products: any[] = (inv?.products || []).filter((p: any) => !p?.is_deleted);
      if (!products.length) {
        out.push({ listingId, title, status: 'skipped', reason: 'not_found', products: [] });
        continue;
      }
      const propIds = propertyIdsOf(products);
      const skuOn: number[] = Array.isArray(inv?.sku_on_property) ? inv.sku_on_property.map(Number) : [];
      const perVariation = products.length > 1 && propIds.length > 0 && propIds.every((p) => skuOn.includes(p));
      const shared = products.length > 1 && !perVariation;
      if (shared && skuOn.length > 0) {
        out.push({ listingId, title, status: 'skipped', reason: 'sku_not_per_variation', products: [] });
        continue;
      }
      const missing = products.map((p, i) => ({ p, i })).filter(({ p }) => !normalizeSku(p?.sku));
      if (!missing.length) {
        out.push({ listingId, title, status: 'skipped', reason: 'already_has_sku', products: [] });
        continue;
      }
      const total = perVariation ? products.length : 1;
      const proposals = (perVariation ? missing : [{ p: products[0], i: 0 }]).map(({ p, i }) => ({
        index: i,
        label: (p?.property_values || []).map((pv: any) => (pv?.values || []).join('/')).join(', ') || null,
        sku: proposeSku(a.prefix || 'KX', listingId, i, total),
      }));
      if (a.apply) {
        const nextProducts = products.map((p, i) => {
          if (perVariation) {
            const prop = proposals.find((x) => x.index === i);
            return prop ? { ...p, sku: prop.sku } : p;
          }
          return { ...p, sku: normalizeSku(p?.sku) ? p.sku : proposals[0].sku };
        });
        const { upsertDraftPatch } = await import('@/lib/etsy/draftService');
        await upsertDraftPatch({
          userId,
          shopId: shop.shopId,
          listingId,
          inventory: {
            products: nextProducts,
            price_on_property: inv.price_on_property ?? [],
            quantity_on_property: inv.quantity_on_property ?? [],
            sku_on_property: inv.sku_on_property ?? [],
            ...(inv.readiness_state_on_property ? { readiness_state_on_property: inv.readiness_state_on_property } : {}),
          },
        });
      }
      out.push({ listingId, title, status: 'ok', products: proposals });
    } catch {
      out.push({ listingId, title, status: 'skipped', reason: 'error', products: [] });
    }
  }
  return out;
}
