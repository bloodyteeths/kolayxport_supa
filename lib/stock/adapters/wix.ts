/**
 * Wix stock adapter (W2, T8). Server-only.
 *
 * Founder decision: Wix stock WRITES ship only once the absolute inventory
 * write is verified for the connected site (Catalog V1: Stores V2 inventory
 * PATCH; Catalog V3: Inventory Items V3 bulk update — the client picks the
 * right one per site, see lib/integrations/wixCatalogV3.ts). Until the
 * operator sets STOCK_WIX_WRITE_VERIFIED=1 (after a manual test on a test
 * product), supportsWrite=false with reason 'catalog_v3_or_unverified':
 * links can be created and quantities are read/observed, nothing is written.
 *
 * Identity: accountRef = WixSite.id, externalId = Wix productId,
 * variantRef = variantId (V1 default variant id is all zeros; V3 single
 * variant products have a real variant id).
 */
import prisma from '@/lib/prisma';
import { createWixClient, type WixApiClient } from '@/lib/integrations/wixClient';
import { wixCatalogOptionsForSite } from '@/lib/integrations/wixSiteCatalog';
import { decideSendQty } from '../math';
import type { RemoteCandidate } from '../matching';
import { ACCOUNT_CHANGED_PATCH, errMsg, failAll, isRetryableHttp, type PushResult, type RemoteQty, type StockAdapter } from './types';

export function wixWriteVerified(): boolean {
  const v = String(process.env.STOCK_WIX_WRITE_VERIFIED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

async function clientFor(userId: string, accountRef: string): Promise<WixApiClient | null> {
  const site = await prisma.wixSite.findFirst({ where: { id: accountRef, userId, isActive: true } });
  if (!site) return null;
  return createWixClient(
    { wixAccessToken: site.accessToken, wixSiteId: site.siteId, wixInstanceId: site.instanceId || site.siteId, wixTokenExpiresAt: site.tokenExpiresAt },
    async (creds) => {
      try {
        await prisma.wixSite.update({ where: { id: site.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
      } catch {
        /* token persistence is best effort */
      }
    },
    wixCatalogOptionsForSite(site),
  );
}

function variantQty(inv: any, variantId: string): number | null {
  const vs: any[] = Array.isArray(inv?.variants) ? inv.variants : [];
  const v = vs.find((x) => String(x?.variantId) === variantId) ?? (vs.length === 1 && !variantId ? vs[0] : undefined);
  if (!v || v.quantity === undefined || v.quantity === null) return null;
  return Math.max(0, Math.trunc(Number(v.quantity)));
}

export const wixAdapter: StockAdapter = {
  channel: 'wix',
  get supportsWrite() {
    return wixWriteVerified();
  },
  get unsupportedReason() {
    return wixWriteVerified() ? undefined : 'catalog_v3_or_unverified';
  },

  async listAccounts(userId) {
    const sites = await prisma.wixSite.findMany({ where: { userId, isActive: true }, select: { id: true, siteName: true, siteUrl: true, siteId: true } });
    return sites.map((s) => ({ accountRef: s.id, label: s.siteName || s.siteUrl || `Wix ${s.siteId.slice(0, 8)}` }));
  },

  async ownsAccount(userId, accountRef) {
    return !!(await prisma.wixSite.findFirst({ where: { id: accountRef, userId, isActive: true }, select: { id: true } }));
  },

  async listCandidates(userId) {
    const accounts = await wixAdapter.listAccounts(userId);
    const out: RemoteCandidate[] = [];
    const writable = wixWriteVerified();
    for (const acc of accounts) {
      const products = await prisma.wixProduct.findMany({
        where: { userId, wixSiteId: acc.accountRef },
        select: { wixProductId: true, title: true, variants: true, sku: true, quantity: true, thumbnailUrl: true, visible: true, trackInventory: true },
      });
      for (const p of products) {
        const variants: any[] = Array.isArray(p.variants) ? (p.variants as any[]) : [];
        if (!variants.length) {
          out.push({
            channel: 'wix', accountRef: acc.accountRef, accountLabel: acc.label, externalId: p.wixProductId, variantRef: '',
            sku: p.sku, title: p.title, imageUrl: p.thumbnailUrl, quantity: p.quantity, state: p.visible ? 'active' : 'hidden',
            supportsWrite: writable && p.trackInventory, unsupportedReason: !p.trackInventory ? 'untracked' : writable ? null : 'catalog_v3_or_unverified',
          });
          continue;
        }
        for (const v of variants) {
          const tracked = v?.stock?.trackQuantity === true;
          const choices = v?.choices && typeof v.choices === 'object' ? Object.values(v.choices).join(' / ') : '';
          out.push({
            channel: 'wix',
            accountRef: acc.accountRef,
            accountLabel: acc.label,
            externalId: p.wixProductId,
            variantRef: String(v?.id || ''),
            sku: v?.variant?.sku || p.sku || null,
            title: p.title,
            variantLabel: choices || null,
            imageUrl: p.thumbnailUrl,
            quantity: Math.max(0, Math.trunc(Number(v?.stock?.quantity ?? 0))),
            state: p.visible ? 'active' : 'hidden',
            supportsWrite: writable && tracked,
            unsupportedReason: !tracked ? 'untracked' : writable ? null : 'catalog_v3_or_unverified',
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
      const client = await clientFor(userId, acc).catch(() => null);
      if (!client) continue;
      const byProduct = new Map<string, typeof group>();
      for (const l of group) byProduct.set(l.externalId, [...(byProduct.get(l.externalId) || []), l]);
      for (const [productId, ls] of Array.from(byProduct.entries())) {
        try {
          const inv = await client.getInventoryItem(productId);
          for (const l of ls) {
            const q = variantQty(inv, l.variantRef);
            if (q !== null) out.set(l.id, { qty: q });
          }
        } catch {
          /* unreadable */
        }
      }
    }
    return out;
  },

  async pushQuantities(userId, items) {
    if (!wixWriteVerified()) {
      return failAll(items, 'catalog_v3_or_unverified', { retryable: false, linkPatch: { status: 'unsupported', statusReason: 'catalog_v3_or_unverified' } });
    }
    const results: PushResult[] = [];
    const byAcc = new Map<string, typeof items>();
    for (const it of items) byAcc.set(it.link.accountRef, [...(byAcc.get(it.link.accountRef) || []), it]);
    for (const [acc, group] of Array.from(byAcc.entries())) {
      const client = await clientFor(userId, acc).catch(() => null);
      if (!client) {
        results.push(...failAll(group, 'account_not_owned', { retryable: false, linkPatch: ACCOUNT_CHANGED_PATCH }));
        continue;
      }
      const byProduct = new Map<string, typeof group>();
      for (const it of group) byProduct.set(it.link.externalId, [...(byProduct.get(it.link.externalId) || []), it]);
      for (const [productId, its] of Array.from(byProduct.entries())) {
        try {
          const inv = await client.getInventoryItem(productId);
          const plan = its.map((it) => {
            const fresh = variantQty(inv, it.link.variantRef);
            return { it, fresh, send: fresh === null ? null : decideSendQty(it.targetQty, fresh, it.reason) };
          });
          const sends = plan.filter((p) => p.fresh !== null && p.send !== null);
          for (const p of plan) {
            if (p.fresh === null) results.push({ pushId: p.it.pushId, linkId: p.it.link.id, status: 'failed', retryable: false, error: 'variant_missing', linkPatch: { status: 'unsupported', statusReason: 'variant_missing' } });
            else if (p.send === null) results.push({ pushId: p.it.pushId, linkId: p.it.link.id, status: 'skipped', freshRemoteQty: p.fresh, sentQty: p.fresh, remoteQtyAfter: p.fresh });
          }
          if (!sends.length) continue;
          await client.setInventoryVariantQuantities(productId, sends.map((p) => ({ variantId: p.it.link.variantRef, quantity: p.send as number })));
          for (const p of sends) results.push({ pushId: p.it.pushId, linkId: p.it.link.id, status: 'applied', freshRemoteQty: p.fresh, sentQty: p.send, remoteQtyAfter: p.send });
        } catch (err) {
          for (const it of its) {
            if (results.some((r) => r.pushId === it.pushId)) continue;
            results.push({ pushId: it.pushId, linkId: it.link.id, status: 'failed', retryable: isRetryableHttp(err), error: errMsg(err) });
          }
        }
      }
    }
    return results;
  },
};
