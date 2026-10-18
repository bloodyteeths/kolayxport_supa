// /api/ebay-drafts/video — eBay listing video helpers for the editor's Photos section. Nothing here changes eBay.
//  GET  ?videoId=<id>             → { video: { videoId, status, thumbnailUrl?, playUrl? } } (Media API getVideo, for
//                                   the tile / player of the listing's current video). 403 VIDEO_RECONNECT when
//                                   the eBay token cannot read the Media API (reconnect eBay).
//  POST { sku, jobId, isNew? }    → stages a finished Video Studio video (AiVideoJob) for this listing's draft:
//                                   the file is copied server side (no download + upload on the phone).
// Session user only.
import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import fs from 'fs';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getUserAccessToken } from '@/lib/integrations/ebayClient';
import { EbayMediaError, EBAY_VIDEO_MAX_BYTES, getEbayVideo } from '@/lib/ebay/mediaApi';
import { stageDraftVideoFile, toSerializable } from '@/lib/ebay/draftService';
import { ebayDraftErrorResponse, isEbayDraftError } from '@/lib/ebay/draftErrors';

const VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const videoId = String(req.query.videoId || '');
      if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: 'videoId is required', code: 'BAD_REQUEST' });
      try {
        const token = await getUserAccessToken(user.id);
        const video = await getEbayVideo(token, videoId);
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.status(200).json({ video });
      } catch (err) {
        if (err instanceof EbayMediaError && err.code === 'RECONNECT') {
          return res.status(403).json({ error: err.message, code: 'VIDEO_RECONNECT', key: 'draftSync.videoReconnect' });
        }
        throw err;
      }
    }

    if (req.method === 'POST') {
      const sku = String(req.body?.sku || '').trim();
      const jobId = String(req.body?.jobId || '').trim();
      if (!sku || !jobId) return res.status(400).json({ error: 'sku and jobId are required', code: 'BAD_REQUEST' });
      const job = await prisma.aiVideoJob.findFirst({ where: { id: jobId, userId: user.id, status: 'done' } });
      if (!job?.filePath || !fs.existsSync(job.filePath)) return res.status(404).json({ error: 'Video not found', code: 'NOT_FOUND' });
      const size = (await fs.promises.stat(job.filePath)).size;
      if (size > EBAY_VIDEO_MAX_BYTES) {
        return res.status(413).json({ error: 'File is larger than 150 MB', code: 'VIDEO_TOO_LARGE', key: 'draftSync.videoTooLarge' });
      }
      const staged = await stageDraftVideoFile({
        userId: user.id,
        sku,
        sourcePath: job.filePath,
        filename: `ai-video-${job.id}${path.extname(job.filePath) || '.mp4'}`,
        contentType: 'video/mp4',
        payload: { source: 'ai', jobId: job.id },
        isNew: req.body?.isNew === true,
      });
      return res.status(200).json({ success: true, draftId: staged.draftId, media: toSerializable(staged.media) });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    if (!isEbayDraftError(err)) logger.error('eBay draft video request failed', err, { userId: user.id });
    const { status, body } = ebayDraftErrorResponse(err, 'Video request failed');
    return res.status(status).json(body);
  }
}
