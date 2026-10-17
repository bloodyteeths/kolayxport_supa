// Video Studio API. Session user only: every job is read and written with userId = session user.
// POST   /api/ai/video   new take:   { mode, sources: { start, end, references }, direction, aspectRatio, durationSec,
//                                     resolution, quality, variants, seed, listingRef, title }
//                        follow-up:  { parentId, instruction, direction? }   → new version (same sources, + change)
//                        extend:     { extendOf, instruction? }              → +7 s continuation of a finished video
// GET    /api/ai/video?ids=a,b  jobs (polls Veo while running; stores the mp4s when done) · no ids: the library
// PATCH  /api/ai/video   { id, favorite?, title? }
// DELETE /api/ai/video?id=  the video and its file
// Sources are https URLs (listing photos) or `upload:<id>` (pages/api/ai/video/source).
import fs from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { logUsage } from '@/lib/ai/gemini';
import { isUnsafeUrl } from '@/lib/ai/safeUrl';
import { directVideo, negativePrompt, normalizeDirection, type VideoDirection } from '@/lib/ai/videoDirector';
import { cropInPlace, muteInPlace, originalOf, pollVideo, saveVideo, startVideo, veoConstraints, VIDEO_SOURCE_ROOT, VIDEO_UPLOAD_ROOT, type VideoMedia } from '@/lib/ai/video';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RUNNING_PER_USER = 4;
const STALE_MS = 20 * 60 * 1000;

type Job = NonNullable<Awaited<ReturnType<typeof prisma.aiVideoJob.findFirst>>>;

export function viewJob(j: Job) {
  return {
    id: j.id, parentId: j.parentId, groupId: j.groupId, variantIndex: j.variantIndex, status: j.status, mode: j.mode,
    instruction: j.instruction, aspectRatio: j.aspectRatio, durationSec: j.durationSec, resolution: j.resolution,
    quality: j.quality, seed: j.seed, model: j.model, provider: j.provider, errorKey: j.errorKey, favorite: j.favorite,
    listingRef: j.listingRef, title: j.title, direction: j.direction, sourceUrl: j.sourceUrl, endUrl: j.endUrl,
    referenceUrls: j.referenceUrls, createdAt: j.createdAt,
    url: j.status === 'done' ? `/api/ai/video/file?id=${encodeURIComponent(j.id)}` : null,
  };
}

/** A source → image bytes. `upload:<id>` reads the seller's own upload (path checked); URLs are https + public. */
async function loadSource(userId: string, ref: string | null | undefined): Promise<VideoMedia | null> {
  if (!ref) return null;
  if (ref.startsWith('upload:')) {
    const id = ref.slice(7).replace(/[^a-f0-9]/g, '');
    if (!id) return null;
    const dir = path.join(VIDEO_SOURCE_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''));
    const file = (await fs.promises.readdir(dir).catch(() => [] as string[])).find((f) => f.startsWith(`${id}.`));
    if (!file) return null;
    const buf = await fs.promises.readFile(path.join(dir, file));
    const ext = path.extname(file).slice(1).toLowerCase();
    return { data: buf.toString('base64'), mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  }
  if (isUnsafeUrl(ref)) return null;
  // Etsy CDN: ask for the full-size photo (570xN thumbnails make soft videos).
  const full = ref.replace(/il_\d+x\w+\./, 'il_fullxfull.');
  for (const u of full === ref ? [ref] : [full, ref]) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!buf.length || buf.length > MAX_IMAGE_BYTES || !ct.startsWith('image/')) continue;
      return { data: buf.toString('base64'), mimeType: ct };
    } catch { /* next */ }
  }
  return null;
}

/** Polls a running job once; when done stores every variant (siblings share the group). */
async function refresh(job: Job): Promise<Job> {
  if (job.status !== 'running' || !job.operation) return job;
  if (Date.now() - new Date(job.createdAt).getTime() > STALE_MS) {
    return prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'failed', errorKey: 'videoFailed', errorDetail: 'timed out' } });
  }
  try {
    const r = await pollVideo({ operation: job.operation, provider: job.provider, model: job.model });
    if (!r.done) return job;
    const ms = Date.now() - new Date(job.createdAt).getTime();
    if (!r.ok) {
      void logUsage({ userId: job.userId, feature: 'video.generate', model: job.model, ok: false, ms, refine: Boolean(job.parentId), error: r.detail });
      return prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'failed', errorKey: r.errorKey, errorDetail: r.detail } });
    }
    // Claim the job first so two pollers never save it twice.
    const claimed = await prisma.aiVideoJob.updateMany({ where: { id: job.id, status: 'running', operation: job.operation }, data: { operation: null } });
    if (!claimed.count) return (await prisma.aiVideoJob.findFirst({ where: { id: job.id } })) ?? job;
    const dir = job.direction as VideoDirection | null;
    const mute = dir?.audio === 'none';
    // 1:1 / 4:5 are centre crops of the 9:16 / 16:9 Veo output (marketplace format, lib/ai/videoTargets).
    const finish = async (file: string) => {
      if (mute) await muteInPlace(file).catch(() => undefined);
      if (dir?.format === '1:1' || dir?.format === '4:5') await cropInPlace(file, dir.format).catch((e) => logger.warn('AI video crop failed', { error: e?.message }));
    };
    const { id: _id, createdAt: _c, updatedAt: _u, ...base } = job;
    for (let i = 1; i < r.videos.length; i++) {
      const sib = await prisma.aiVideoJob.create({ data: { ...base, direction: (job.direction as any) ?? undefined, status: 'running', variantIndex: i, operation: null } });
      const file = await saveVideo(job.userId, sib.id, r.videos[i]);
      await finish(file);
      await prisma.aiVideoJob.update({ where: { id: sib.id }, data: { status: 'done', filePath: file } });
    }
    const filePath = await saveVideo(job.userId, job.id, r.videos[0]);
    await finish(filePath);
    void logUsage({ userId: job.userId, feature: 'video.generate', model: job.model, ok: true, ms, refine: Boolean(job.parentId), images: job.durationSec * r.videos.length });
    return prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'done', filePath } });
  } catch (err: any) {
    logger.warn('AI video poll failed', { jobId: job.id, error: err?.message });
    return job;
  }
}

async function changesOf(userId: string, start: Job | null): Promise<string[]> {
  const out: string[] = [];
  for (let p: Job | null = start, n = 0; p && n < 30; n++) {
    if (p.instruction && p.mode !== 'edit') out.unshift(p.instruction);
    p = p.parentId ? await prisma.aiVideoJob.findFirst({ where: { id: p.parentId, userId } }) : null;
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const ids = String(req.query.ids || req.query.id || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
      if (!ids.length) {
        const where: Record<string, unknown> = { userId: user.id };
        if (req.query.favorite === '1') where.favorite = true;
        if (typeof req.query.listing === 'string' && req.query.listing) where.listingRef = req.query.listing;
        const recent = await prisma.aiVideoJob.findMany({ where, orderBy: { createdAt: 'desc' }, take: 60 });
        const fresh = await Promise.all(recent.map((j) => (j.status === 'running' ? refresh(j) : j)));
        return res.status(200).json({ jobs: fresh.map(viewJob) });
      }
      const jobs = await prisma.aiVideoJob.findMany({ where: { userId: user.id, id: { in: ids } }, orderBy: { createdAt: 'asc' } });
      const fresh = await Promise.all(jobs.map(refresh));
      // Variants created on completion belong to the asked groups: return them too.
      const groups = Array.from(new Set(fresh.map((j) => j.groupId).filter(Boolean))) as string[];
      const siblings = groups.length ? await prisma.aiVideoJob.findMany({ where: { userId: user.id, groupId: { in: groups }, id: { notIn: ids } } }) : [];
      return res.status(200).json({ jobs: [...fresh, ...siblings].map(viewJob) });
    }

    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const data: Record<string, unknown> = {};
      if (typeof req.body?.favorite === 'boolean') data.favorite = req.body.favorite;
      if (typeof req.body?.title === 'string') data.title = req.body.title.trim().slice(0, 140) || null;
      const r = await prisma.aiVideoJob.updateMany({ where: { id, userId: user.id }, data });
      return r.count ? res.status(200).json({ ok: true }) : res.status(404).json({ code: 'notFound' });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      const job = await prisma.aiVideoJob.findFirst({ where: { id, userId: user.id } });
      if (!job) return res.status(404).json({ code: 'notFound' });
      if (job.filePath && path.resolve(job.filePath).startsWith(path.resolve(VIDEO_UPLOAD_ROOT))) {
        await fs.promises.unlink(job.filePath).catch(() => undefined);
        await fs.promises.unlink(originalOf(job.filePath)).catch(() => undefined);
      }
      // Follow-ups keep working: their parent link is cleared; their own sources and direction stay.
      await prisma.aiVideoJob.updateMany({ where: { parentId: id, userId: user.id }, data: { parentId: null } });
      await prisma.aiVideoJob.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
      return res.status(405).json({ code: 'methodNotAllowed' });
    }

    const running = await prisma.aiVideoJob.count({ where: { userId: user.id, status: 'running', createdAt: { gt: new Date(Date.now() - STALE_MS) } } });
    if (running >= RUNNING_PER_USER) return res.status(429).json({ code: 'videoBusy' });

    const body = req.body || {};
    // ── Extend: continue a finished video by 7 s ──
    if (body.extendOf) {
      const src = await prisma.aiVideoJob.findFirst({ where: { id: String(body.extendOf), userId: user.id, status: 'done' } });
      if (!src?.filePath) return res.status(404).json({ code: 'notFound' });
      const direction = normalizeDirection(src.direction ?? {});
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 400) : '';
      const changes = [...(await changesOf(user.id, src)), ...(instruction ? [instruction] : [])];
      // A square / 4:5 video is a crop: extend Veo's uncropped original, then crop the result again.
      const orig = originalOf(src.filePath);
      const input = (await fs.promises.stat(orig).then(() => true).catch(() => false)) ? orig : src.filePath;
      const video = { data: (await fs.promises.readFile(input)).toString('base64'), mimeType: 'video/mp4' };
      const genAspect = (src.direction as any)?.genAspect === '16:9' || src.aspectRatio === '16:9' ? '16:9' : '9:16';
      const started = await startVideo({
        mode: 'extend', prompt: directVideo(direction, [...changes, 'Continue the same shot seamlessly from the last frame']), negativePrompt: negativePrompt(direction),
        video, aspectRatio: genAspect, durationSec: 7, resolution: '720p', quality: src.quality === 'best' ? 'best' : 'fast', audio: direction.audio !== 'none',
      });
      const job = await prisma.aiVideoJob.create({
        data: {
          userId: user.id, parentId: src.id, provider: started.provider, model: started.model, status: 'running', mode: 'extend',
          prompt: src.prompt, instruction: instruction || null, direction: { ...(src.direction as any), ...direction, genAspect } as any, sourceUrl: src.sourceUrl, endUrl: src.endUrl,
          referenceUrls: src.referenceUrls, aspectRatio: src.aspectRatio, durationSec: src.durationSec + 7, resolution: '720p',
          quality: src.quality, operation: started.operation, listingRef: src.listingRef, title: src.title,
        },
      });
      const withGroup = await prisma.aiVideoJob.update({ where: { id: job.id }, data: { groupId: job.id } });
      return res.status(200).json({ job: viewJob(withGroup) });
    }

    // ── New take or follow-up ──
    let parent: Job | null = null;
    if (body.parentId) {
      parent = await prisma.aiVideoJob.findFirst({ where: { id: String(body.parentId), userId: user.id } });
      if (!parent) return res.status(404).json({ code: 'notFound' });
    }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 400) : '';
    if (parent && !instruction && !body.direction) return res.status(400).json({ code: 'instructionRequired' });

    const direction = normalizeDirection(body.direction ?? parent?.direction ?? {});
    const parentMode = parent?.mode;
    const mode: 'image' | 'interpolate' | 'reference' = parent
      ? (parentMode === 'interpolate' || parentMode === 'reference' ? parentMode : 'image')
      : direction.mode;
    const startRef: string | null = parent ? parent.sourceUrl : body.sources?.start ?? null;
    const endRef: string | null = parent ? parent.endUrl : body.sources?.end ?? null;
    const refRefs: string[] = parent ? parent.referenceUrls : (Array.isArray(body.sources?.references) ? body.sources.references.slice(0, 3).map(String) : []);

    const image = mode === 'reference' ? null : await loadSource(user.id, startRef);
    if (mode !== 'reference' && !image) return res.status(400).json({ code: 'imageRequired' });
    const lastFrame = mode === 'interpolate' ? await loadSource(user.id, endRef) : null;
    if (mode === 'interpolate' && !lastFrame) return res.status(400).json({ code: 'endImageRequired' });
    const references = mode === 'reference' ? (await Promise.all(refRefs.map((r) => loadSource(user.id, r)))).filter((x): x is VideoMedia => Boolean(x)) : [];
    if (mode === 'reference' && !references.length) return res.status(400).json({ code: 'referencesRequired' });

    const changes = [...(await changesOf(user.id, parent)), ...(instruction ? [instruction] : [])];
    // Veo renders 16:9 / 9:16; the client sends the generation aspect (from the format and the photo orientation).
    const aspectRatio = (body.aspectRatio ?? (parent?.aspectRatio === '16:9' ? '16:9' : parent?.aspectRatio === '1:1' || parent?.aspectRatio === '4:5' ? (parent?.direction as any)?.genAspect : parent?.aspectRatio)) === '16:9' ? '16:9' : '9:16';
    (direction as any).genAspect = aspectRatio;
    const { durationSec, resolution } = veoConstraints({ mode, durationSec: Number(body.durationSec ?? parent?.durationSec ?? 8), resolution: String(body.resolution ?? parent?.resolution ?? '720p') });
    const quality = (body.quality ?? parent?.quality) === 'best' ? 'best' : 'fast';
    const variants = Math.min(4, Math.max(1, Number(body.variants ?? 1) || 1));
    const seedRaw = body.seed;
    const seed = seedRaw !== undefined && seedRaw !== null && seedRaw !== '' && Number.isFinite(Number(seedRaw)) ? Math.round(Number(seedRaw)) : (parent?.seed ?? null);
    const prompt = directVideo(direction, changes);

    const started = await startVideo({
      mode, prompt, negativePrompt: negativePrompt(direction), image: image ?? undefined, lastFrame: lastFrame ?? undefined, references,
      aspectRatio, durationSec, resolution, quality, variants, seed, audio: direction.audio !== 'none',
    });
    const job = await prisma.aiVideoJob.create({
      data: {
        userId: user.id, parentId: parent?.id ?? null, provider: started.provider, model: started.model, status: 'running', mode,
        prompt, instruction: instruction || null, direction: direction as any, sourceUrl: startRef, endUrl: endRef, referenceUrls: refRefs,
        aspectRatio: direction.format ?? aspectRatio, durationSec, resolution, quality, seed, operation: started.operation,
        listingRef: (parent?.listingRef ?? (typeof body.listingRef === 'string' ? body.listingRef.slice(0, 120) : null)) || null,
        title: (parent?.title ?? (typeof body.title === 'string' ? body.title.slice(0, 140) : null)) || null,
      },
    });
    const withGroup = await prisma.aiVideoJob.update({ where: { id: job.id }, data: { groupId: job.id } });
    return res.status(200).json({ job: viewJob(withGroup) });
  } catch (err: any) {
    logger.error('AI video request failed', err, { userId: user.id });
    return res.status(502).json({ code: 'videoFailed' });
  }
}
