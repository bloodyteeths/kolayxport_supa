// POST /api/ai/video/source  { image: { data (base64), mimeType } } → { ref: 'upload:<id>', url }
// GET  /api/ai/video/source?id=<id>  → the image (owner only)
// The seller's own photos for the Video Studio (start / end frame, reference images). Stored per user on the VPS.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { VIDEO_SOURCE_ROOT } from '@/lib/ai/video';

export const config = { api: { bodyParser: { sizeLimit: '14mb' } } };

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 10 * 1024 * 1024;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const dir = path.join(VIDEO_SOURCE_ROOT, user.id.replace(/[^a-zA-Z0-9_-]/g, ''));

  if (req.method === 'POST') {
    const mime = String(req.body?.image?.mimeType || '');
    const ext = EXT[mime];
    if (!ext) return res.status(400).json({ code: 'unsupportedImage' });
    const buf = Buffer.from(String(req.body?.image?.data || '').replace(/^data:image\/[\w.+-]+;base64,/, ''), 'base64');
    if (!buf.length || buf.length > MAX) return res.status(400).json({ code: 'imageTooLarge' });
    const id = crypto.randomBytes(12).toString('hex');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, `${id}.${ext}`), buf);
    return res.status(200).json({ ref: `upload:${id}`, url: `/api/ai/video/source?id=${id}` });
  }

  if (req.method === 'GET') {
    const id = String(req.query.id || '').replace(/[^a-f0-9]/g, '');
    const file = id ? (await fs.promises.readdir(dir).catch(() => [] as string[])).find((f) => f.startsWith(`${id}.`)) : null;
    if (!file) return res.status(404).end();
    const ext = path.extname(file).slice(1);
    res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(path.join(dir, file)).pipe(res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ code: 'methodNotAllowed' });
}
