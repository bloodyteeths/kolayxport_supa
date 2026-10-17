// POST /api/ai/video/source-video  (raw body: the video file, Content-Type video/*) → { photos: [{ ref, url }] }
// The seller's own video of the product (e.g. a phone video of the dress): its sharpest frames, spread over the clip,
// become product photos the Video Studio uses as anchor frames and references. The video itself is not kept.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { framesFromVideo, sourceDir, sourceUrlOf } from '@/lib/ai/videoSources';

export const config = { api: { bodyParser: false, responseLimit: false } };

const MAX_BYTES = 200 * 1024 * 1024;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const type = String(req.headers['content-type'] || '');
  if (!/^video\//.test(type)) return res.status(400).json({ code: 'unsupportedVideo' });
  if (Number(req.headers['content-length'] || 0) > MAX_BYTES) return res.status(413).json({ code: 'videoTooLarge' });

  const dir = sourceDir(user.id);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `_in_${crypto.randomBytes(8).toString('hex')}`);
  try {
    await new Promise<void>((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(tmp);
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { req.destroy(); out.destroy(); reject(Object.assign(new Error('too large'), { code: 'videoTooLarge' })); }
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      req.pipe(out);
    });
    const refs = await framesFromVideo(user.id, tmp, 6);
    if (!refs.length) return res.status(422).json({ code: 'noFrames' });
    return res.status(200).json({ photos: refs.map((ref) => ({ ref, url: sourceUrlOf(ref) })) });
  } catch (err: any) {
    if (err?.code === 'videoTooLarge') return res.status(413).json({ code: 'videoTooLarge' });
    logger.warn('Video studio: frames from video failed', { userId: user.id, error: err?.message });
    return res.status(422).json({ code: 'unreadableVideo' });
  } finally {
    await fs.promises.unlink(tmp).catch(() => undefined);
  }
}
