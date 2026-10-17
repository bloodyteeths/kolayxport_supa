// POST /api/ai/video   { sourceUrl | image: {data, mimeType}, prompt, aspectRatio, durationSec, quality }   → new job
// POST /api/ai/video   { parentId, instruction }                                                             → follow-up version
// GET  /api/ai/video?id=<job>   → job (polls Veo while running; stores the mp4 when done)
// GET  /api/ai/video?ids=a,b,c  → several jobs (the version strip)
// Session user only: every job is read and written with userId = session user (no cross-tenant access).
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { logUsage } from '@/lib/ai/gemini';
import { isUnsafeUrl } from '@/lib/ai/safeUrl';
import { pollVideo, saveVideo, startVideo, videoPrompt } from '@/lib/ai/video';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RUNNING_PER_USER = 3;
const STALE_MS = 15 * 60 * 1000;

type Job = Awaited<ReturnType<typeof prisma.aiVideoJob.findFirst>>;

function view(j: NonNullable<Job>) {
  return {
    id: j.id, parentId: j.parentId, status: j.status, prompt: j.prompt, instruction: j.instruction, aspectRatio: j.aspectRatio,
    durationSec: j.durationSec, model: j.model, provider: j.provider, errorKey: j.errorKey, createdAt: j.createdAt,
    url: j.status === 'done' ? `/api/ai/video/file?id=${encodeURIComponent(j.id)}` : null,
  };
}

async function loadImage(body: any): Promise<{ data: string; mimeType: string; sourceUrl: string | null } | null> {
  if (body?.image?.data) {
    const mimeType = typeof body.image.mimeType === 'string' && body.image.mimeType.startsWith('image/') ? body.image.mimeType : 'image/jpeg';
    const data = String(body.image.data).replace(/^data:image\/[\w.+-]+;base64,/, '');
    if (data.length > MAX_IMAGE_BYTES * 1.4) return null;
    return { data, mimeType, sourceUrl: null };
  }
  const url = typeof body?.sourceUrl === 'string' ? body.sourceUrl : '';
  if (!url || isUnsafeUrl(url)) return null;
  // Etsy CDN: ask for the full-size photo (570xN thumbnails make soft videos).
  const full = url.replace(/il_\d+x\w+\./, 'il_fullxfull.');
  for (const u of full === url ? [url] : [full, url]) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!buf.length || buf.length > MAX_IMAGE_BYTES || !ct.startsWith('image/')) continue;
      return { data: buf.toString('base64'), mimeType: ct, sourceUrl: url };
    } catch { /* try the next */ }
  }
  return null;
}

/** Polls a running job once and finalises it (stores the file / records the error). */
async function refresh(job: NonNullable<Job>): Promise<NonNullable<Job>> {
  if (job.status !== 'running' || !job.operation) return job;
  if (Date.now() - new Date(job.createdAt).getTime() > STALE_MS) {
    return prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'failed', errorKey: 'videoFailed', errorDetail: 'timed out' } });
  }
  try {
    const r = await pollVideo({ operation: job.operation, provider: job.provider, model: job.model });
    if (!r.done) return job;
    if (!r.ok) {
      void logUsage({ userId: job.userId, feature: 'video.generate', model: job.model, ok: false, ms: Date.now() - new Date(job.createdAt).getTime(), refine: Boolean(job.parentId), error: r.detail });
      return prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'failed', errorKey: r.errorKey, errorDetail: r.detail } });
    }
    const filePath = await saveVideo(job.userId, job.id, r);
    void logUsage({ userId: job.userId, feature: 'video.generate', model: job.model, ok: true, ms: Date.now() - new Date(job.createdAt).getTime(), refine: Boolean(job.parentId), images: job.durationSec });
    return prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'done', filePath } });
  } catch (err: any) {
    logger.warn('AI video poll failed', { jobId: job.id, error: err?.message });
    return job;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const ids = String(req.query.ids || req.query.id || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      if (!ids.length) {
        const recent = await prisma.aiVideoJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 20 });
        return res.status(200).json({ jobs: recent.map(view) });
      }
      const jobs = await prisma.aiVideoJob.findMany({ where: { userId: user.id, id: { in: ids } }, orderBy: { createdAt: 'asc' } });
      const fresh = await Promise.all(jobs.map(refresh));
      return res.status(200).json({ jobs: fresh.map(view) });
    }

    if (req.method === 'POST') {
      const running = await prisma.aiVideoJob.count({ where: { userId: user.id, status: 'running', createdAt: { gt: new Date(Date.now() - STALE_MS) } } });
      if (running >= RUNNING_PER_USER) return res.status(429).json({ code: 'videoBusy' });

      const body = req.body || {};
      let parent: Job = null;
      if (body.parentId) {
        parent = await prisma.aiVideoJob.findFirst({ where: { id: String(body.parentId), userId: user.id } });
        if (!parent) return res.status(404).json({ code: 'notFound' });
      }
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 400) : '';
      if (parent && !instruction) return res.status(400).json({ code: 'instructionRequired' });

      // A follow-up keeps the first version's photo, description and format (every job stores the original
      // description), plus every change asked so far along the chain.
      const description = parent ? parent.prompt : String(body.prompt || '').trim().slice(0, 1200);
      if (!description) return res.status(400).json({ code: 'promptRequired' });
      const changes: string[] = [];
      for (let p: Job = parent; p; p = p.parentId ? await prisma.aiVideoJob.findFirst({ where: { id: p.parentId, userId: user.id } }) : null) {
        if (p.instruction) changes.unshift(p.instruction);
      }
      if (instruction) changes.push(instruction);

      const image = await loadImage(parent ? { sourceUrl: parent.sourceUrl, image: body.image } : body);
      if (!image) return res.status(400).json({ code: 'imageRequired' });
      const aspectRatio = (parent?.aspectRatio ?? body.aspectRatio) === '16:9' ? '16:9' : '9:16';
      const durationSec = ([4, 6, 8] as const).includes(Number(parent?.durationSec ?? body.durationSec) as 4) ? (Number(parent?.durationSec ?? body.durationSec) as 4 | 6 | 8) : 8;
      const quality = body.quality === 'best' ? 'best' : 'fast';

      const started = await startVideo({ prompt: videoPrompt(description, changes), image, aspectRatio, durationSec, quality });
      const job = await prisma.aiVideoJob.create({
        data: {
          userId: user.id, parentId: parent?.id ?? null, provider: started.provider, model: started.model, status: 'running',
          prompt: description, instruction: instruction || null, sourceUrl: image.sourceUrl ?? parent?.sourceUrl ?? null,
          aspectRatio, durationSec, operation: started.operation,
        },
      });
      return res.status(200).json({ job: view(job) });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  } catch (err: any) {
    logger.error('AI video request failed', err, { userId: user.id });
    return res.status(502).json({ code: 'videoFailed' });
  }
}
