// lib/ai/videoPublish.ts — sends a finished Video Studio video to the seller's listing (SERVER ONLY).
// Founder 2026-10-17: "add to listing" must not be download-and-upload. Per marketplace:
//  - eBay: Media API (lib/ebay/mediaApi: createVideo → uploadVideo → wait for LIVE), then the
//    listing: Inventory API `product.videoIds` (eBay shows one video per listing) or, for listings made on eBay
//    (legacy-<itemId>), Trading ReviseFixedPriceItem VideoDetails.VideoID. Scope sell.inventory.
//  - Shopify: stagedUploadsCreate (VIDEO) → upload to the staged target → productUpdate(media:) (Shopify processes it).
//  - Wix: product media from a signed public URL of the video (Wix imports it).
//  - Amazon and Trendyol publish no video upload API: the studio downloads the file and links the seller panel.
// Etsy goes through the staged listing editor (Sync to Etsy), not this module.
import fs from 'fs';
import prisma from '@/lib/prisma';
import { getUserAccessToken } from '@/lib/integrations/ebayClient';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';
import { sanitizeInventoryItemPayload } from '@/lib/ebay/payloadRules';
import { legacyEbayItemId } from '@/lib/ebay/legacy';
import { setLegacyItemVideo } from '@/lib/ebay/legacyTrading';
import { EbayMediaError, uploadEbayVideoFile, waitForEbayVideo } from '@/lib/ebay/mediaApi';
import { getValidAccessToken } from '@/lib/integrations/shopifyClient';
import { shopifyGraphqlUrl } from '@/lib/integrations/shopifyApiVersion';
import { createWixClient } from '@/lib/integrations/wixClient';
import { ensureWixCatalogVersion, wixCatalogOptionsForSite } from '@/lib/integrations/wixSiteCatalog';
import { signImagePath } from '@/lib/images/signedImageUrl';
import { appBaseUrl } from '@/lib/billing/stripeAccountServer';

export const PUBLISH_MARKETPLACES = ['ebay', 'shopify', 'wix'] as const;
export type PublishMarketplace = (typeof PUBLISH_MARKETPLACES)[number];

/** Where a seller uploads the video by hand (no API). */
export const MANUAL_UPLOAD_LINKS: Record<'amazon' | 'trendyol', string> = {
  amazon: 'https://sellercentral.amazon.com/gp/help/external/200216080',
  trendyol: 'https://partner.trendyol.com/',
};

export class PublishError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

/** Signed public URL of a video file (marketplaces fetch it without a session). */
export function publicVideoUrl(jobId: string, origin?: string): string {
  return `${appBaseUrl(origin)}/api/ai/video/public?${new URLSearchParams({ id: jobId, sig: signImagePath(`video:${jobId}`) })}`;
}

// ── eBay ─────────────────────────────────────────────────────────────────────────────────────────

const EBAY_API = 'https://api.ebay.com';

/** Media API upload + wait for LIVE (lib/ebay/mediaApi); errors mapped to the studio's publish keys. */
async function ebayUploadVideo(token: string, file: string, title: string): Promise<string> {
  try {
    const videoId = await uploadEbayVideoFile(token, file, title);
    // Up to 4 minutes here: the studio sends in the background and polls the job.
    const r = await waitForEbayVideo(token, videoId, { timeoutMs: 240_000 });
    if (r.state !== 'live') throw new PublishError('processing', 'eBay is still processing the video');
    return videoId;
  } catch (err) {
    if (err instanceof EbayMediaError) {
      if (err.code === 'RECONNECT') throw new PublishError('reconnect', err.message);
      if (err.code === 'TOO_LARGE') throw new PublishError('tooLarge', err.message);
      if (err.code === 'REJECTED') throw new PublishError('rejected', err.message);
    }
    throw err;
  }
}

async function publishEbay(userId: string, sku: string, file: string, title: string): Promise<{ remoteId: string }> {
  const row = await prisma.ebayListing.findFirst({ where: { userId, sku }, select: { marketplaceId: true, title: true } });
  if (!row) throw new PublishError('listingNotFound', 'eBay listing not found');
  const token = await getUserAccessToken(userId);
  const videoId = await ebayUploadVideo(token, file, title || row.title);
  const legacyId = legacyEbayItemId(sku);
  if (legacyId) {
    await setLegacyItemVideo(token, legacyId, videoId);
  } else {
    const url = `${EBAY_API}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
    const item = await callEbayRateLimited<any>(url, { token, marketplaceId: row.marketplaceId });
    // eBay shows one video per listing: the new one replaces the old one.
    const next = { ...item, product: { ...(item?.product ?? {}), videoIds: [videoId] } };
    await callEbayRateLimited(url, { token, marketplaceId: row.marketplaceId, options: { method: 'PUT', body: JSON.stringify(sanitizeInventoryItemPayload(next)) } });
  }
  return { remoteId: videoId };
}

// ── Shopify ──────────────────────────────────────────────────────────────────────────────────────

async function shopifyGql(shopDomain: string, token: string, query: string, variables: Record<string, unknown>) {
  const r = await fetch(shopifyGraphqlUrl(shopDomain), {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j: any = await r.json().catch(() => null);
  if (r.status === 401 || r.status === 403) throw new PublishError('reconnect', `Shopify ${r.status}`);
  if (!r.ok || j?.errors) throw new Error(`Shopify GraphQL ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  return j.data;
}

async function publishShopify(userId: string, productId: string, file: string, title: string): Promise<{ remoteId: string }> {
  const row = await prisma.shopifyProduct.findFirst({ where: { userId, shopifyProductId: productId }, select: { shopifyShopId: true } });
  if (!row) throw new PublishError('listingNotFound', 'Shopify product not found');
  const shop = await prisma.shopifyShop.findFirst({ where: { id: row.shopifyShopId, userId, isActive: true } });
  if (!shop) throw new PublishError('reconnect', 'Shopify store not connected');
  const token = await getValidAccessToken(shop.id);
  const buf = await fs.promises.readFile(file);
  const filename = `kolayxport-video-${productId}.mp4`;
  const staged = await shopifyGql(shop.shopDomain, token, `
    mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
    }`, { input: [{ resource: 'VIDEO', filename, mimeType: 'video/mp4', fileSize: String(buf.length), httpMethod: 'POST' }] });
  const target = staged?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error(`Shopify staged upload refused: ${JSON.stringify(staged?.stagedUploadsCreate?.userErrors ?? null).slice(0, 300)}`);
  const form = new FormData();
  for (const p of target.parameters ?? []) form.append(p.name, p.value);
  form.append('file', new Blob([new Uint8Array(buf)], { type: 'video/mp4' }), filename);
  const up = await fetch(target.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`Shopify video upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  // productUpdate(media:) — productCreateMedia is deprecated on current API versions.
  const created = await shopifyGql(shop.shopDomain, token, `
    mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
      productUpdate(product: $product, media: $media) { product { id } userErrors { field message } }
    }`, { product: { id: `gid://shopify/Product/${productId}` }, media: [{ originalSource: target.resourceUrl, mediaContentType: 'VIDEO', alt: title.slice(0, 120) }] });
  const errs = created?.productUpdate?.userErrors ?? [];
  if (errs.length) throw new PublishError('rejected', `Shopify: ${errs.map((e: any) => e.message).join('; ').slice(0, 200)}`);
  return { remoteId: String(created?.productUpdate?.product?.id ?? '') };
}

// ── Wix ──────────────────────────────────────────────────────────────────────────────────────────

async function publishWix(userId: string, productId: string, jobId: string, origin?: string): Promise<{ remoteId: string }> {
  const row = await prisma.wixProduct.findFirst({ where: { userId, wixProductId: productId }, select: { wixSiteId: true } });
  if (!row) throw new PublishError('listingNotFound', 'Wix product not found');
  const site = await prisma.wixSite.findFirst({ where: { id: row.wixSiteId, userId, isActive: true } });
  if (!site) throw new PublishError('reconnect', 'Wix site not connected');
  const client = createWixClient(
    { wixAccessToken: site.accessToken, wixSiteId: site.siteId, wixInstanceId: site.instanceId || site.siteId, wixTokenExpiresAt: site.tokenExpiresAt },
    async (creds) => {
      await prisma.wixSite.update({ where: { id: site.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } }).catch(() => undefined);
    },
    wixCatalogOptionsForSite(site),
  );
  await ensureWixCatalogVersion(client);
  await client.addProductMedia(productId, [{ url: publicVideoUrl(jobId, origin) }]);
  return { remoteId: '' };
}

/** Sends the video to the listing it was made for. */
export async function publishVideo(input: { userId: string; jobId: string; file: string; marketplace: PublishMarketplace; listingId: string; title: string; origin?: string }): Promise<{ remoteId: string }> {
  if (input.marketplace === 'ebay') return publishEbay(input.userId, input.listingId, input.file, input.title);
  if (input.marketplace === 'shopify') return publishShopify(input.userId, input.listingId, input.file, input.title);
  return publishWix(input.userId, input.listingId, input.jobId, input.origin);
}
