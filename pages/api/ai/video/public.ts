// GET /api/ai/video/public?id=<job>&sig=<hmac> — a finished video for a marketplace to fetch (Wix imports product
// media from a URL, without our session). Only with the HMAC the server put in that URL (lib/ai/videoPublish).
import fs from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { VIDEO_UPLOAD_ROOT } from '@/lib/ai/video';
import { verifyImagePathSignature } from '@/lib/images/signedImageUrl';

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = String(req.query.id || '');
  if (!id || !verifyImagePathSignature(`video:${id}`, req.query.sig)) return res.status(403).end();
  const job = await prisma.aiVideoJob.findFirst({ where: { id, status: 'done' }, select: { filePath: true } });
  if (!job?.filePath) return res.status(404).end();
  const file = path.resolve(job.filePath);
  if (!file.startsWith(path.resolve(VIDEO_UPLOAD_ROOT))) return res.status(404).end();
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(file); } catch { return res.status(404).end(); }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) { res.status(416).setHeader('Content-Range', `bytes */${stat.size}`); return res.end(); }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', String(stat.size));
  fs.createReadStream(file).pipe(res);
}
