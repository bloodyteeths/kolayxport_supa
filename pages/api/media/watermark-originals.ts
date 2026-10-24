// /api/media/watermark-originals — the stored originals of watermarked photos (lib/media/watermarkOriginals.ts).
//   GET ?marketplace=etsy&listingIds=a,b → { originals: [{ id, listingId, rank, createdAt }] } (latest per slot)
//   GET ?id=…                             → the original image bytes (owner only); used to restore a slot
//   POST { marketplace, listings: [{ listingId, photos: [{ imageId, rank, url }] }] }
//        → { matches: [{ id, listingId, rank, match: { imageId, rank } | null }] }
//        Restore guard: each stored original is matched to the photo we placed (perceptual hash of the watermarked
//        photo) among the listing's CURRENT photos. No match = the seller replaced it: never overwritten.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { WATERMARK_MARKETPLACES, readOriginalFile } from '@/lib/media/watermarkOriginals';
import { loadImageForUser } from '@/lib/images/ownImage';
import { matchesSignature } from '@/lib/media/watermark';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'POST') return match(user.id, req, res);
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

type Photo = { imageId: number; rank: number; url: string };

async function match(userId: string, req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const marketplace = String(body.marketplace ?? '');
  if (!(WATERMARK_MARKETPLACES as readonly string[]).includes(marketplace)) return res.status(400).json({ error: 'marketplace' });
  const listings = (Array.isArray(body.listings) ? body.listings : []).slice(0, 100) as Array<{ listingId?: unknown; photos?: unknown }>;
  const matches: Array<{ id: string; listingId: string; rank: number; match: { imageId: number; rank: number } | null }> = [];
  for (const l of listings) {
    const listingId = String(l.listingId ?? '');
    if (!/^[\w-]{1,64}$/.test(listingId)) continue;
    const rows = await prisma.watermarkOriginal.findMany({ where: { userId, marketplace, listingId }, orderBy: { updatedAt: 'desc' } });
    const seen = new Set<number>();
    const latest = rows.filter((r) => (seen.has(r.rank) ? false : (seen.add(r.rank), true)));
    if (!latest.length) continue;
    const photos = (Array.isArray(l.photos) ? l.photos : []).slice(0, 30).filter((p): p is Photo =>
      !!p && typeof (p as Photo).imageId === 'number' && typeof (p as Photo).rank === 'number' && typeof (p as Photo).url === 'string');
    const bytes = await Promise.all(photos.map(async (p) => {
      const img = await loadImageForUser(userId, p.url);
      return img ? Buffer.from(img.data, 'base64') : null;
    }));
    const used = new Set<number>();
    for (const r of latest) {
      // Prefer the slot it was placed in; otherwise any current photo that is the one we placed (it may have moved).
      const order = photos.map((p, i) => i).sort((a, b) => Number(photos[b].rank === r.rank) - Number(photos[a].rank === r.rank));
      let found = -1;
      for (const i of order) {
        if (used.has(i) || !bytes[i]) continue;
        if ((await matchesSignature(r.markHash, bytes[i] as Buffer)).ok) { found = i; break; }
      }
      if (found >= 0) used.add(found);
      matches.push({ id: r.id, listingId, rank: r.rank, match: found >= 0 ? { imageId: photos[found].imageId, rank: photos[found].rank } : null });
    }
  }
  return res.status(200).json({ matches });
}
