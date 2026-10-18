// GET /api/ai/video/listing-photos?mp=<etsy|ebay|shopify|trendyol|wix>&id=<listing id>&store=<shop id>
// → { photos: [{ id, src, fullSrc }] } — every photo of the seller's listing, for the Video Studio's start / end frame
// and reference images. Session user only (Etsy: the user's shop token; caches: rows owned by the user).
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getEtsyAccessToken } from '@/lib/etsy/etsyToken';
import { callEtsyAPI } from '@/lib/etsy/http';

type Photo = { id: string; src: string; fullSrc: string };

function fromJsonImages(v: unknown): Photo[] {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((x: any, i: number) => {
      const url = typeof x === 'string' ? x : x?.src || x?.url || x?.imageUrl || x?.image?.url || '';
      return url ? { id: String(x?.id ?? i), src: String(url), fullSrc: String(url) } : null;
    })
    .filter((p): p is Photo => Boolean(p));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const mp = String(req.query.mp || '');
  const id = String(req.query.id || '');
  const store = String(req.query.store || '');
  if (!id) return res.status(400).json({ code: 'badRequest' });
  try {
    let photos: Photo[] = [];
    if (mp === 'etsy') {
      // The shop must belong to the session user (getEtsyAccessToken checks ownership).
      const token = await getEtsyAccessToken(store, user.id);
      const data = await callEtsyAPI(`/listings/${encodeURIComponent(id)}/images`, token);
      photos = (data?.results ?? []).map((img: any) => ({ id: String(img.listing_image_id), src: img.url_570xN || img.url_fullxfull, fullSrc: img.url_fullxfull || img.url_570xN }));
    } else if (mp === 'ebay') {
      const row = await prisma.ebayListing.findFirst({ where: { userId: user.id, sku: id }, select: { imageUrls: true, imageUrl: true } });
      let urls = row?.imageUrls?.length ? row.imageUrls : row?.imageUrl ? [row.imageUrl] : [];
      if (!urls.length) {
        // A new listing (local SKU, not on eBay yet): its photos are the open draft's staged picture URLs.
        const draft = await prisma.ebayListingDraft.findFirst({
          where: { userId: user.id, sku: id, status: { in: ['draft', 'failed', 'conflict'] } },
          orderBy: { updatedAt: 'desc' },
          select: { inventoryPatch: true },
        });
        const staged = (draft?.inventoryPatch as { product?: { imageUrls?: unknown } } | null)?.product?.imageUrls;
        urls = Array.isArray(staged) ? staged.filter((u): u is string => typeof u === 'string') : [];
      }
      photos = urls.map((u, i) => ({ id: String(i), src: u, fullSrc: u }));
    } else if (mp === 'shopify') {
      const row = await prisma.shopifyProduct.findFirst({ where: { userId: user.id, shopifyProductId: id }, select: { images: true } });
      photos = fromJsonImages(row?.images);
    } else if (mp === 'trendyol') {
      const row = await prisma.trendyolProduct.findFirst({ where: { userId: user.id, barcode: id }, select: { images: true } });
      photos = fromJsonImages(row?.images);
    } else if (mp === 'wix') {
      const row = await prisma.wixProduct.findFirst({ where: { userId: user.id, wixProductId: id }, select: { images: true } });
      photos = fromJsonImages(row?.images);
    } else {
      return res.status(400).json({ code: 'badMarketplace' });
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json({ photos: photos.filter((p) => /^https:\/\//.test(p.fullSrc)).slice(0, 24) });
  } catch (err: any) {
    logger.warn('Video studio listing photos failed', { userId: user.id, mp, error: err?.message });
    return res.status(502).json({ code: 'photosFailed' });
  }
}
