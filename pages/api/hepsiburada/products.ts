/**
 * Hepsiburada listings & products. `?action=`:
 *   GET  list            ?page=&size=&q=          HepsiburadaListing cache (paged, search)
 *   POST sync                                     refresh the cache from HB (listings + catalog content)
 *   GET  detail          ?hbSku=                  cache row + HB catalog content (best effort)
 *   POST update_price_stock { items:[{hbSku, price?, stock?, dispatchTime?, maxPurchasableQuantity?}], source? }
 *                                                 direct async upload (bulk/quick tools); returns batch ids
 *   POST activate | deactivate { hbSku }
 *   GET  batch_status    ?batchId=                resolve one HepsiburadaUploadBatch
 *   POST create          { categoryId, merchantSku, barcode, title, description, brand, price?, stock?, vatRate,
 *                          warrantyMonths, weightKg, images[], variantGroupId?, attributes{} }  catalog import
 *   GET  create_status   ?trackingId=             import progress / validation results
 *   POST fastlisting     { barcode, merchantSku, price, stock, dispatchTime? }  list a product HB already has
 * Grid edits go through CatalogDraft (/api/catalog-drafts, marketplace 'hepsiburada'), not here.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { requireHepsiburada, sendHbError } from '@/lib/hepsiburada/server';
import { syncHepsiburadaListingsForUser } from '@/lib/hepsiburada/listingSync';
import { resolveHbUpload, submitHbUpload, type HbUploadItem } from '@/lib/hepsiburada/uploads';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  maxDuration: 300,
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const numOrUndef = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export interface HbCreateInput {
  categoryId: number;
  merchantSku: string;
  barcode?: string;
  title: string;
  description: string;
  brand: string;
  vatRate: number;
  warrantyMonths: number;
  weightKg?: number;
  images: string[];
  variantGroupId?: string;
  price?: number;
  stock?: number;
  attributes?: Record<string, string>;
}

const HB_VAT_RATES = [0, 1, 10, 20];

/** Validate the creator body → HB import item, or an error list. Pure (tested). */
export function buildImportItem(merchantId: string, body: any): { item: Record<string, unknown> } | { errors: string[] } {
  const errors: string[] = [];
  const categoryId = Number(body?.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) errors.push('categoryId');
  const merchantSku = str(body?.merchantSku);
  if (!merchantSku || merchantSku.length > 100) errors.push('merchantSku');
  const title = str(body?.title);
  if (!title || title.length > 200) errors.push('title');
  const description = str(body?.description);
  if (!description) errors.push('description');
  const brand = str(body?.brand);
  if (!brand) errors.push('brand');
  const vatRate = Number(body?.vatRate);
  if (!HB_VAT_RATES.includes(vatRate)) errors.push('vatRate');
  const warranty = Number(body?.warrantyMonths ?? 0);
  if (!Number.isInteger(warranty) || warranty < 0 || warranty > 120) errors.push('warrantyMonths');
  const images: string[] = Array.isArray(body?.images) ? body.images.map(str).filter((u: string) => /^https:\/\//i.test(u)) : [];
  if (!images.length) errors.push('images');
  const barcode = str(body?.barcode);
  if (barcode && !/^[A-Za-z0-9-]{4,40}$/.test(barcode)) errors.push('barcode');
  const weight = numOrUndef(body?.weightKg);
  if (weight !== undefined && (weight < 0 || weight > 1000)) errors.push('weightKg');
  if (errors.length) return { errors };

  const attributes: Record<string, unknown> = {
    merchantSku,
    VaryantGroupID: str(body?.variantGroupId) || merchantSku,
    ...(barcode ? { Barcode: barcode } : {}),
    UrunAdi: title,
    UrunAciklamasi: description,
    Marka: brand,
    GarantiSuresi: warranty,
    ...(weight !== undefined ? { kg: String(weight) } : {}),
    tax_vat_rate: String(vatRate),
    ...(numOrUndef(body?.price) !== undefined ? { price: String(numOrUndef(body?.price)) } : {}),
    ...(numOrUndef(body?.stock) !== undefined ? { stock: String(Math.trunc(numOrUndef(body?.stock)!)) } : {}),
  };
  images.slice(0, 5).forEach((url, i) => { attributes[`Image${i + 1}`] = url; });
  const extra = body?.attributes && typeof body.attributes === 'object' ? body.attributes : {};
  for (const [k, v] of Object.entries(extra)) {
    if (!k || attributes[k] !== undefined) continue;
    const val = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    if (val) attributes[k] = val;
  }
  return { item: { categoryId, merchant: merchantId, attributes } };
}

/** `update_price_stock` body item → upload row. Pure (tested). */
export function toUploadItem(raw: any): HbUploadItem | null {
  const hbSku = str(raw?.hbSku ?? raw?.hepsiburadaSku);
  if (!hbSku) return null;
  const item: HbUploadItem = { hepsiburadaSku: hbSku };
  const merchantSku = str(raw?.merchantSku);
  if (merchantSku) item.merchantSku = merchantSku;
  const price = numOrUndef(raw?.price);
  if (price !== undefined && price > 0) item.price = Math.round(price * 100) / 100;
  const stock = numOrUndef(raw?.stock ?? raw?.availableStock);
  if (stock !== undefined && stock >= 0) item.availableStock = Math.trunc(stock);
  const dispatch = numOrUndef(raw?.dispatchTime);
  if (dispatch !== undefined && dispatch >= 0) item.dispatchTime = Math.trunc(dispatch);
  const maxQty = numOrUndef(raw?.maxPurchasableQuantity ?? raw?.maximumPurchasableQuantity);
  if (maxQty !== undefined && maxQty >= 1) item.maximumPurchasableQuantity = Math.trunc(maxQty);
  return item.price !== undefined || item.availableStock !== undefined || item.dispatchTime !== undefined || item.maximumPurchasableQuantity !== undefined ? item : null;
}

function serializeListing(r: any) {
  return { ...r, price: r.price === null || r.price === undefined ? null : Number(r.price) };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = str(req.query.action);
  const ctx = await requireHepsiburada(req, res);
  if (!ctx) return;
  const { userId, client, merchantId } = ctx;

  try {
    if (action === 'list' && req.method === 'GET') {
      const page = Math.max(0, Number(req.query.page) || 0);
      const size = Math.min(200, Math.max(1, Number(req.query.size) || 50));
      const q = str(req.query.q);
      const where: Prisma.HepsiburadaListingWhereInput = {
        userId,
        merchantId,
        ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { hbSku: { contains: q, mode: 'insensitive' } }, { merchantSku: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q, mode: 'insensitive' } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.hepsiburadaListing.findMany({ where, skip: page * size, take: size, orderBy: { syncedAt: 'desc' }, select: { raw: false, id: true, hbSku: true, merchantSku: true, barcode: true, title: true, brand: true, categoryId: true, categoryName: true, thumbnailUrl: true, price: true, availableStock: true, dispatchTime: true, maximumPurchasableQuantity: true, isSalable: true, isSuspended: true, isLocked: true, isFrozen: true, isFulfilledByHB: true, deactivationReasons: true, syncedAt: true } }),
        prisma.hepsiburadaListing.count({ where }),
      ]);
      return res.status(200).json({ listings: rows.map(serializeListing), total, page, size });
    }

    if (action === 'sync' && req.method === 'POST') {
      const result = await syncHepsiburadaListingsForUser(userId);
      return res.status(200).json({ success: true, ...result });
    }

    if (action === 'detail' && req.method === 'GET') {
      const hbSku = str(req.query.hbSku ?? req.query.id);
      if (!hbSku) return res.status(400).json({ error: 'hbSku is required' });
      const row = await prisma.hepsiburadaListing.findUnique({ where: { userId_merchantId_hbSku: { userId, merchantId, hbSku } } });
      if (!row) return res.status(404).json({ error: 'Listing not found', code: 'not_found' });
      let content: unknown = null;
      try {
        const data: any = await client.productByHbSku(hbSku);
        content = data?.data ?? data;
      } catch (err) {
        logger.warn('[HEPSIBURADA] product detail failed', { userId, hbSku, error: (err as Error)?.message });
      }
      const pending = await prisma.hepsiburadaUploadBatch.findMany({
        where: { userId, merchantId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, kind: true, items: true, createdAt: true },
      });
      const pendingForSku = pending.filter((b) => Array.isArray(b.items) && (b.items as any[]).some((i) => i?.hepsiburadaSku === hbSku)).map(({ items: _i, ...b }) => b);
      return res.status(200).json({ listing: serializeListing(row), content, pendingUploads: pendingForSku });
    }

    if (action === 'update_price_stock' && req.method === 'POST') {
      const raw = Array.isArray(req.body?.items) ? req.body.items : [];
      const items = raw.map(toUploadItem).filter((x: HbUploadItem | null): x is HbUploadItem => !!x);
      if (!items.length) return res.status(400).json({ error: 'items[] with hbSku and a value are required' });
      if (items.length > 5000) return res.status(400).json({ error: 'At most 5000 items per request' });
      // Fulfilled-by-HB listings: HB owns their stock.
      const fbh = await prisma.hepsiburadaListing.findMany({
        where: { userId, merchantId, isFulfilledByHB: true, hbSku: { in: items.map((i: HbUploadItem) => i.hepsiburadaSku) } },
        select: { hbSku: true },
      });
      const fbhSet = new Set(fbh.map((x) => x.hbSku));
      const refused = items.filter((i: HbUploadItem) => fbhSet.has(i.hepsiburadaSku) && i.availableStock !== undefined).map((i: HbUploadItem) => i.hepsiburadaSku);
      const sendable = items.filter((i: HbUploadItem) => !(fbhSet.has(i.hepsiburadaSku) && i.availableStock !== undefined));
      if (!sendable.length) return res.status(409).json({ error: 'Stock of fulfilled-by-Hepsiburada listings cannot be changed', refused });
      const source = str(req.body?.source) === 'bulk' ? 'bulk' : 'editor';
      // The inventory upload replaces the listing row: fill untouched values from the cache.
      const cached = await prisma.hepsiburadaListing.findMany({
        where: { userId, merchantId, hbSku: { in: sendable.map((i: HbUploadItem) => i.hepsiburadaSku) } },
        select: { hbSku: true, merchantSku: true, price: true, availableStock: true, dispatchTime: true, maximumPurchasableQuantity: true },
      });
      const bySku = new Map(cached.map((c) => [c.hbSku, c]));
      const full = sendable.map((i: HbUploadItem) => {
        const c = bySku.get(i.hepsiburadaSku);
        return {
          hepsiburadaSku: i.hepsiburadaSku,
          merchantSku: i.merchantSku ?? c?.merchantSku ?? undefined,
          price: i.price ?? (c?.price != null ? Number(c.price) : undefined),
          availableStock: i.availableStock ?? c?.availableStock,
          dispatchTime: i.dispatchTime ?? c?.dispatchTime ?? undefined,
          maximumPurchasableQuantity: i.maximumPurchasableQuantity ?? c?.maximumPurchasableQuantity ?? undefined,
        } as HbUploadItem;
      });
      const missing = full.filter((i: HbUploadItem) => i.price === undefined || i.availableStock === undefined).map((i: HbUploadItem) => i.hepsiburadaSku);
      if (missing.length) return res.status(409).json({ error: 'Pull listings first: price or stock unknown for some listings', missing });
      const batches = await submitHbUpload(userId, client, 'inventory', full, { source });
      return res.status(202).json({ batches: batches.map((b) => ({ batchId: b.batchId, uploadId: b.uploadId, count: b.items.length })), refused });
    }

    if ((action === 'activate' || action === 'deactivate') && req.method === 'POST') {
      const hbSku = str(req.body?.hbSku);
      if (!hbSku) return res.status(400).json({ error: 'hbSku is required' });
      if (action === 'activate') await client.activateListing(hbSku);
      else await client.deactivateListing(hbSku);
      await prisma.hepsiburadaListing.updateMany({ where: { userId, merchantId, hbSku }, data: { isSalable: action === 'activate' } });
      return res.status(200).json({ ok: true });
    }

    if (action === 'batch_status' && req.method === 'GET') {
      const batchId = str(req.query.batchId);
      const batch = await prisma.hepsiburadaUploadBatch.findFirst({ where: { id: batchId, userId } });
      if (!batch) return res.status(404).json({ error: 'Batch not found' });
      if (batch.status !== 'pending') return res.status(200).json({ status: batch.status, errors: batch.errors });
      const outcome = await resolveHbUpload(client, batch);
      return res.status(200).json(
        outcome.state === 'pending' ? { status: 'pending' }
          : outcome.state === 'done' ? { status: 'done', failed: outcome.failedSkus }
            : { status: 'failed', error: outcome.error },
      );
    }

    if (action === 'create' && req.method === 'POST') {
      const built = buildImportItem(merchantId, req.body);
      if ('errors' in built) return res.status(400).json({ error: 'Invalid product', fields: built.errors });
      const data: any = await client.importProducts([built.item]);
      const trackingId = String(data?.data?.trackingId ?? data?.trackingId ?? '');
      if (!trackingId) return res.status(502).json({ error: 'Hepsiburada returned no tracking id', details: data });
      await prisma.hepsiburadaUploadBatch.create({
        data: { userId, merchantId, kind: 'import', uploadId: trackingId, source: 'editor', itemCount: 1, items: [built.item] as unknown as Prisma.InputJsonValue },
      });
      return res.status(202).json({ trackingId });
    }

    if (action === 'create_status' && req.method === 'GET') {
      const trackingId = str(req.query.trackingId);
      if (!trackingId) return res.status(400).json({ error: 'trackingId is required' });
      const data: any = await client.importStatus(trackingId);
      const rows: any[] = Array.isArray(data?.data) ? data.data : [];
      const first = rows[0] ?? null;
      const status = String(first?.importStatus ?? first?.productStatus ?? '').toUpperCase();
      const done = ['SUCCESS', 'MATCHED', 'CREATED'].some((s) => status.includes(s));
      const failed = !done && ['FAIL', 'REJECT', 'MISSING_INFO', 'BLOCKED'].some((s) => status.includes(s));
      if (done || failed) {
        await prisma.hepsiburadaUploadBatch.updateMany({
          where: { userId, kind: 'import', uploadId: trackingId, status: 'pending' },
          data: { status: done ? 'done' : 'failed', resolvedAt: new Date(), errors: (first?.validationResults ?? null) as Prisma.InputJsonValue },
        });
      }
      return res.status(200).json({ status: done ? 'done' : failed ? 'failed' : 'pending', rawStatus: status || null, validation: first?.validationResults ?? [], hbSku: first?.hbSku ?? null, raw: first });
    }

    if (action === 'fastlisting' && req.method === 'POST') {
      const barcode = str(req.body?.barcode);
      const merchantSku = str(req.body?.merchantSku);
      const productName = str(req.body?.title) || merchantSku;
      const price = numOrUndef(req.body?.price);
      const stock = numOrUndef(req.body?.stock);
      if (!barcode || !merchantSku || !price || price <= 0 || stock === undefined || stock < 0) {
        return res.status(400).json({ error: 'barcode, merchantSku, price and stock are required' });
      }
      const data = await client.fastListing([{
        merchant: merchantId, merchantSku, productName, barcode, price: String(price), stock: String(Math.trunc(stock)),
      }]);
      return res.status(202).json({ ok: true, result: data });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (err) {
    logger.warn('[HEPSIBURADA] products action failed', { action, userId, error: (err as Error)?.message });
    return sendHbError(res, err);
  }
}
