// /api/media/watermark-originals — the stored originals of watermarked photos (lib/media/watermarkOriginals.ts).
//   GET ?marketplace=etsy&listingIds=a,b → { originals: [{ id, listingId, rank, createdAt }] } (latest per slot)
//   GET ?id=…                             → the original image bytes (owner only); used to restore a slot
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { WATERMARK_MARKETPLACES, readOriginalFile } from '@/lib/media/watermarkOriginals';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (typeof req.query.id === 'string') {
    const row = await prisma.watermarkOriginal.findFirst({ where: { id: req.query.id, userId: user.id } });
    const bytes = row ? await readOriginalFile(user.id, row.fileKey) : null;
    if (!row || !bytes) return res.status(404).end();
    res.setHeader('Content-Type', row.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).send(bytes);
  }
  const marketplace = String(req.query.marketplace ?? '');
  if (!(WATERMARK_MARKETPLACES as readonly string[]).includes(marketplace)) return res.status(400).json({ error: 'marketplace' });
  const listingIds = String(req.query.listingIds ?? '').split(',').map((x) => x.trim()).filter((x) => /^[\w-]{1,64}$/.test(x)).slice(0, 500);
  if (!listingIds.length) return res.status(200).json({ originals: [] });
  const rows = await prisma.watermarkOriginal.findMany({ where: { userId: user.id, marketplace, listingId: { in: listingIds } }, orderBy: { createdAt: 'desc' } });
  const seen = new Set<string>();
  const originals = rows.filter((r) => { const k = `${r.listingId}:${r.rank}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => ({ id: r.id, listingId: r.listingId, rank: r.rank, createdAt: r.createdAt.toISOString() }));
  return res.status(200).json({ originals });
}
