// POST /api/ai/video/publish { id, marketplace?, listingId? } → 202 { job } — sends a finished video to the listing
// it was made for (job.listingRef "<marketplace>:<listingId>[:<store>]") on eBay, Shopify or Wix (lib/ai/videoPublish).
// Runs in the background (eBay processes uploads for up to a few minutes); the studio polls the job's `published`.
// An explicit seller action (the studio asks first): the listing changes on the marketplace. Session user only.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { MANUAL_UPLOAD_LINKS, PUBLISH_MARKETPLACES, PublishError, publishVideo, type PublishMarketplace } from '@/lib/ai/videoPublish';
import { viewJob } from './index';

type Published = Record<string, { status: 'sending' | 'done' | 'failed'; listingId: string; remoteId?: string; error?: string; at: string }>;

async function setPublished(id: string, mp: string, value: Published[string]) {
  const job = await prisma.aiVideoJob.findFirst({ where: { id }, select: { published: true } });
  const next = { ...((job?.published as Published | null) ?? {}), [mp]: value };
  await prisma.aiVideoJob.update({ where: { id }, data: { published: next as any } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const job = await prisma.aiVideoJob.findFirst({ where: { id: String(req.body?.id || ''), userId: user.id, status: 'done' } });
  if (!job?.filePath) return res.status(404).json({ code: 'notFound' });
  const [refMp, refId] = (job.listingRef ?? '').split(':');
  const mp = String(req.body?.marketplace || refMp || '');
  const listingId = String(req.body?.listingId || (mp === refMp ? refId : '') || '');
  if (mp === 'amazon' || mp === 'trendyol') return res.status(409).json({ code: 'noVideoApi', link: MANUAL_UPLOAD_LINKS[mp] });
  if (!(PUBLISH_MARKETPLACES as readonly string[]).includes(mp)) return res.status(400).json({ code: 'badMarketplace' });
  if (!listingId) return res.status(400).json({ code: 'listingRequired' });
  const current = (job.published as Published | null)?.[mp];
  if (current?.status === 'sending' && Date.now() - new Date(current.at).getTime() < 10 * 60_000) return res.status(409).json({ code: 'publishBusy' });

  await setPublished(job.id, mp, { status: 'sending', listingId, at: new Date().toISOString() });
  void (async () => {
    try {
      const r = await publishVideo({ userId: user.id, jobId: job.id, file: job.filePath as string, marketplace: mp as PublishMarketplace, listingId, title: job.title ?? '', origin: req.headers.origin });
      await setPublished(job.id, mp, { status: 'done', listingId, remoteId: r.remoteId, at: new Date().toISOString() });
    } catch (err: any) {
      logger.warn('AI video publish failed', { jobId: job.id, mp, error: err?.message });
      await setPublished(job.id, mp, { status: 'failed', listingId, error: err instanceof PublishError ? err.key : 'failed', at: new Date().toISOString() }).catch(() => undefined);
    }
  })();
  const fresh = await prisma.aiVideoJob.findFirst({ where: { id: job.id } });
  return res.status(202).json({ job: viewJob(fresh ?? job) });
}
