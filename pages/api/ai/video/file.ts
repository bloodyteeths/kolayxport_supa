// GET /api/ai/video/file?id=<job> — the finished mp4, owner only (session user). Supports Range for <video> seeking.
import fs from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { VIDEO_UPLOAD_ROOT } from '@/lib/ai/video';

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).end();
  const id = String(req.query.id || '');
  const job = id ? await prisma.aiVideoJob.findFirst({ where: { id, userId: user.id, status: 'done' } }) : null;
  if (!job?.filePath) return res.status(404).end();
  const file = path.resolve(job.filePath);
  if (!file.startsWith(path.resolve(VIDEO_UPLOAD_ROOT))) return res.status(404).end();
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(file); } catch { return res.status(404).end(); }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="kolayxport-video-${job.id}.mp4"`);
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
