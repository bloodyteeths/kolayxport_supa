import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  const media = await prisma.etsyDraftMedia.findFirst({
    where: { id, draft: { userId: user.id, status: { in: ['draft', 'failed', 'conflict', 'syncing'] } } },
    include: { draft: true },
  });

  if (!media?.localPath) return res.status(404).json({ error: 'Media not found' });

  const absolutePath = path.resolve(media.localPath);
  const uploadRoot = path.resolve(process.env.ETSY_DRAFT_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'etsy-drafts'));
  if (!absolutePath.startsWith(uploadRoot + path.sep)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'File not found' });

  res.setHeader('Content-Type', media.contentType || (media.kind === 'video' ? 'video/mp4' : 'image/jpeg'));
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(absolutePath).pipe(res);
}
