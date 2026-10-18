// GET /api/ebay-drafts/media-preview?id=<EbayDraftMedia id> — streams a staged file (the editor's video tile and
// player before Send). Session user only; open drafts only; files under the eBay draft upload root only.
// Honours `Range` (206): iPhone Safari plays a <video> only from a server that answers byte ranges.
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { draftUploadRoot } from '@/lib/ebay/draftService';
import { parseRange } from '@/lib/ebay/byteRange';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  const media = await prisma.ebayDraftMedia.findFirst({
    where: { id, draft: { userId: user.id, status: { in: ['draft', 'failed', 'conflict', 'syncing'] } } },
  });
  if (!media?.localPath) return res.status(404).json({ error: 'Media not found' });

  const absolutePath = path.resolve(media.localPath);
  if (!absolutePath.startsWith(draftUploadRoot() + path.sep)) return res.status(403).json({ error: 'Forbidden' });
  let size: number;
  try {
    size = (await fs.promises.stat(absolutePath)).size;
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', media.contentType || (media.kind === 'video' ? 'video/mp4' : 'image/jpeg'));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Accept-Ranges', 'bytes');
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
    fs.createReadStream(absolutePath, { start: range.start, end: range.end }).pipe(res);
    return undefined;
  }
  res.setHeader('Content-Length', String(size));
  fs.createReadStream(absolutePath).pipe(res);
  return undefined;
}
