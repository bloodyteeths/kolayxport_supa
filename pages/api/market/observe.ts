/**
 * POST /api/market/observe — a marketplace page as the seller's browser showed it (KolayXport extension, with the
 * seller's consent to share). Body: { mkt: 'trendyol'|'hepsiburada', pageType: 'search'|'product'|'store',
 * parserVersion, ...page } where a search/category page carries the marketSnapshot shape ({ query | categoryId,
 * page, total, items }), a product page { product: {...} } and a store page { store: {...}, items? }.
 *
 * Validated as untrusted input (lib/market/ingest), written to the shared crowd tables without any userId; the
 * contribution is counted separately. Session or extension Bearer auth; 60 pages/min per user.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { userRateLimit, writeShared } from '@/lib/research/etsySearch';
import { parseSnapshot, snapshotKey, SNAPSHOT_TTL_MS } from '@/lib/research/marketSnapshot';
import { ingestProduct, ingestSearch, parseProductPage, parseStorePage, recordContribution, recordIngestStat, upsertSeller } from '@/lib/market/ingest';

export const config = { api: { bodyParser: { sizeLimit: '768kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!userRateLimit(user.id, 'market:observe', 60)) return res.status(429).json({ error: 'rate_limited' });

  const body = req.body ?? {};
  const pageType = String(body.pageType ?? '');
  const parserVersion = String(body.parserVersion ?? req.headers['x-extension-version'] ?? 'unknown');
  const mkt = String(body.mkt ?? '');

  try {
    if (pageType === 'search') {
      // Category pages have no query: key them by category id.
      const categoryId = typeof body.categoryId === 'string' || typeof body.categoryId === 'number' ? String(body.categoryId).slice(0, 30) : null;
      const snap = parseSnapshot({ ...body, query: body.query || (categoryId ? `c:${categoryId}` : '') });
      if (!snap) { await recordIngestStat(mkt, pageType, parserVersion, false); return res.status(400).json({ error: 'bad_request' }); }
      const page = Math.max(1, Math.min(50, Math.floor(Number(body.page) || 1)));
      const r = await ingestSearch(snap, { page, queryKey: categoryId && !body.query ? `c:${categoryId}` : undefined });
      // Page 1 of a keyword search also feeds Product finder's 24 h answer.
      if (page === 1 && body.query) await writeShared(snapshotKey(snap.mkt, snap.query), snap, SNAPSHOT_TTL_MS, snap.capturedAt);
      await Promise.all([recordContribution(user.id, snap.mkt, r.products), recordIngestStat(mkt, pageType, parserVersion, true)]);
      return res.status(200).json({ ok: true, products: r.products });
    }
    if (pageType === 'product') {
      const pp = parseProductPage(body);
      if (!pp) { await recordIngestStat(mkt, pageType, parserVersion, false); return res.status(400).json({ error: 'bad_request' }); }
      await ingestProduct(pp);
      await Promise.all([recordContribution(user.id, pp.mkt, 1), recordIngestStat(mkt, pageType, parserVersion, true)]);
      return res.status(200).json({ ok: true, products: 1 });
    }
    if (pageType === 'store') {
      const store = parseStorePage(body);
      if (!store) { await recordIngestStat(mkt, pageType, parserVersion, false); return res.status(400).json({ error: 'bad_request' }); }
      await upsertSeller(store);
      let products = 0;
      const grid = Array.isArray(body.items) && body.items.length ? parseSnapshot({ mkt: body.mkt, query: `s:${store.sellerId}`, total: store.productCount, items: body.items }) : null;
      if (grid) products = (await ingestSearch(grid, { queryKey: `s:${store.sellerId}`, source: 'store' })).products;
      await Promise.all([recordContribution(user.id, store.mkt, products), recordIngestStat(mkt, pageType, parserVersion, true)]);
      return res.status(200).json({ ok: true, products });
    }
    await recordIngestStat(mkt, pageType, parserVersion, false);
    return res.status(400).json({ error: 'bad_request' });
  } catch (err) {
    logger.warn('[market/observe] ingest failed', { pageType, mkt, error: (err as Error)?.message });
    return res.status(500).json({ error: 'ingest_failed' });
  }
}
