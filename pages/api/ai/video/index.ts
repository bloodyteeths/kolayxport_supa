// Video Studio API. Session user only: every job is read and written with userId = session user.
// POST   /api/ai/video   new take:   { sources: { start, end, product[] }, direction, aspectRatio, durationSec, resolution,
//                                     quality, variants, seed, listingRef, title, locale }
//                        follow-up:  { parentId, instruction }   → new version (same frames + photos, + the change)
//                        extend:     { extendOf, instruction? }  → +7 s continuation of a finished video
// GET    /api/ai/video?ids=a,b  jobs (polls Veo while running; stores the mp4s when done) · no ids: the library
// PATCH  /api/ai/video   { id, favorite?, title? }
// DELETE /api/ai/video?id=  the video and its file
//
// Product lock (lib/ai/videoProduct): the video starts on a real photo ('image'; a real end photo makes Veo land on
// it too) or on AI keyframes built from ALL the product photos ('scene'). When the shot turns or moves and no end
// photo is given, an AI end keyframe is built from the photos so the side Veo would invent comes from the photos.
// After generation every variant is checked against the photos (qa). AI kredisi (lib/billing/aiCredits) are charged
// before anything starts and refunded when Veo fails or returns fewer variants.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { logUsage } from '@/lib/ai/gemini';
import { directVideo, negativePrompt, normalizeDirection, type VideoDirection } from '@/lib/ai/videoDirector';
import { finishInPlace, originalOf, pollVideo, saveVideo, startVideo, trimInPlace, trimWindow, veoConstraints, VIDEO_UPLOAD_ROOT, type VideoMedia } from '@/lib/ai/video';
import { VIDEO_TARGET_PROFILES } from '@/lib/ai/videoTargets';
import { normalizeProfile } from '@/lib/ai/videoShots';
import { fitToAspect, loadSource, loadSources, saveSourceImage, videoDuration } from '@/lib/ai/videoSources';
import { interpretNotes } from '@/lib/ai/videoNotes';
import { writeVideoPrompt } from '@/lib/ai/videoPromptWriter';
import { checkVideo, extendFrame, generateCheckedKeyframe, keyframePrompt, matchSubjectScale, MAX_PRODUCT_REFS, type VideoQa } from '@/lib/ai/videoProduct';
import { extendCredits, imageCredits, videoCredits } from '@/lib/billing/aiCredits';
import { isAiBudgetError, isNoCreditsError, refundCredits, spendCredits } from '@/lib/billing/aiCreditsServer';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const RUNNING_PER_USER = 4;
const STALE_MS = 20 * 60 * 1000;
/** Shot types that turn or move: the end of the video shows what the first frame does not. */
// Shots whose end the first frame cannot show (the back): an AI end frame is built from the photos. Not for "the next
// pose" shots (walk, pose, twirl, lifestyle): an invented end pose differs in small details from the start photo and Veo
// morphs between the two (those videos scored lowest on production).
const TURNING = new Set(['turntable', 'frontBack']);

type Job = NonNullable<Awaited<ReturnType<typeof prisma.aiVideoJob.findFirst>>>;
type Dir = VideoDirection & {
  genAspect?: '9:16' | '16:9'; variants?: number; locale?: 'tr' | 'en'; autoFixOf?: string; safeRetry?: boolean;
  /** What was left out of the seller's notes / change request, and why (in their language; lib/ai/videoNotes). */
  notesDropped?: string[];
  /** This take's change request as a checked English direction (the seller's words stay in `instruction`). */
  instructionEn?: string;
};

const WORDING_REFUSED = /sensitive words|responsible ai|prompt could not be submitted/i;

export function viewJob(j: Job) {
  return {
    id: j.id, parentId: j.parentId, groupId: j.groupId, variantIndex: j.variantIndex, status: j.status, mode: j.mode,
    instruction: j.instruction, aspectRatio: j.aspectRatio, durationSec: j.durationSec, resolution: j.resolution,
    quality: j.quality, seed: j.seed, model: j.model, provider: j.provider, errorKey: j.errorKey, favorite: j.favorite,
    listingRef: j.listingRef, title: j.title, direction: j.direction, sourceUrl: j.sourceUrl, endUrl: j.endUrl,
    referenceUrls: j.referenceUrls, credits: j.credits, qa: j.qa, published: j.published, createdAt: j.createdAt,
    url: j.status === 'done' ? `/api/ai/video/file?id=${encodeURIComponent(j.id)}` : null,
  };
}

const newJobId = () => `v${crypto.randomBytes(12).toString('hex')}`;
const extOf = (m: VideoMedia): 'jpg' | 'png' | 'webp' => (m.mimeType === 'image/png' ? 'png' : m.mimeType === 'image/webp' ? 'webp' : 'jpg');

/** Marks a job failed once and refunds its credits. */
async function failJob(job: Job, errorKey: string, detail: string): Promise<Job> {
  const r = await prisma.aiVideoJob.updateMany({ where: { id: job.id, status: { in: ['running', 'preparing'] } }, data: { status: 'failed', errorKey, errorDetail: detail.slice(0, 300), operation: null } });
  if (r.count && job.credits > 0) await refundCredits(job.userId, job.id).catch((e) => logger.warn('AI video refund failed', { jobId: job.id, error: e?.message }));
  return (await prisma.aiVideoJob.findFirst({ where: { id: job.id } })) ?? job;
}

/** Below these the best variant is fixed automatically, once (founder: "the video editor should do all that itself"). */
// Founder 2026-10-18: "for everything we need min 9/10". Takes vary a lot (the same settings scored 10/10 and 7/4 on
// the bench), so below 9 the free automatic retry makes two more takes with the check's directions and the best wins.
const AUTO_FIX_MATCH = 9;
const AUTO_FIX_REALISM = 9;
const AUTO_FIX_VARIANTS = 2;
const qaScore = (q: VideoQa) => (q.match ?? 0) * 2 + (q.realism ?? 0);

/**
 * Background: compares each finished variant with the product photos (one at a time). When even the best one
 * changed the product or looks artificial, a corrected version is started from it at once — free, never twice for
 * a take — before the results are stored, so the studio sees the fix as soon as it sees the scores.
 */
async function runQa(jobIds: string[]) {
  const results: { job: Job; qa: VideoQa }[] = [];
  for (const id of jobIds) {
    const job = await prisma.aiVideoJob.findFirst({ where: { id, status: 'done' } });
    if (!job?.filePath) continue;
    try {
      await prisma.aiVideoJob.update({ where: { id }, data: { qa: { status: 'running' } } });
      const refs = await loadSources(job.userId, job.referenceUrls.slice(0, 5));
      const dir = (job.direction ?? {}) as Dir;
      const locale = dir.locale === 'en' ? 'en' : 'tr';
      const check = { userId: job.userId, refs, locale, person: dir.person === true || dir.addPerson === true, profile: normalizeProfile(dir.profile, dir.productKind) } as const;
      let qa: VideoQa = refs.length ? await checkVideo({ ...check, file: job.filePath }) : { status: 'failed' };
      // The problems sit in a few seconds only: cut them away (the marketplace's minimum length kept) and check again.
      if (qa.status === 'done' && ((qa.match ?? 10) < 9 || (qa.realism ?? 10) < 9) && job.mode !== 'edit') {
        const duration = await videoDuration(job.filePath);
        const minSec = Math.max(4, VIDEO_TARGET_PROFILES[dir.target ?? 'etsy']?.minSec ?? 5);
        const win = trimWindow(qa.clean, duration, minSec);
        if (win) {
          await trimInPlace(job.filePath, win.from, win.to);
          const again = await checkVideo({ ...check, file: job.filePath });
          if (again.status === 'done' && qaScore(again) >= qaScore(qa)) qa = { ...again, trimmed: { ...win, of: Math.round(duration * 10) / 10 } };
          else {
            // Not better: put the untrimmed video back.
            await fs.promises.rename(`${job.filePath}.untrimmed.mp4`, job.filePath).catch(() => undefined);
          }
        }
      }
      results.push({ job, qa });
    } catch (err: any) {
      logger.warn('AI video quality check failed', { jobId: id, error: err?.message });
      results.push({ job, qa: { status: 'failed' } });
    }
  }
  const main = results[0]?.job;
  let autoFix: string | null = null;
  let autoFixMode: 'fix' | 'safer' = 'fix';
  const d = (main?.direction ?? {}) as Dir;
  const scored = results.filter((r) => r.qa.status === 'done').sort((a, b) => qaScore(b.qa) - qaScore(a.qa));
  const best = scored[0];
  if (main && best && !d.autoFixOf && main.mode !== 'extend' && main.mode !== 'edit'
    && ((best.qa.match ?? 10) < AUTO_FIX_MATCH || (best.qa.realism ?? 10) < AUTO_FIX_REALISM)) {
    const fixes = [...(best.qa.diffs ?? []), ...(best.qa.issues ?? [])].map((x) => x.fix).filter(Boolean).slice(0, 5);
    // A badly changed product (≤ 4/10) means the shot itself is too hard (an object turned through sides the photos
    // never showed): the fix is a safer shot — the product still, the camera slowly moving in — from the real start.
    const safer = (best.qa.match ?? 10) <= 4;
    const body = safer
      ? { parentId: best.job.id, instruction: 'Keep the product perfectly still and exactly as in the photos; only the camera moves', variants: AUTO_FIX_VARIANTS, dropEnd: true,
          direction: { ...(best.job.direction as object), preset: 'hero', shotText: undefined, showsBack: false } }
      : fixes.length ? { parentId: best.job.id, instruction: fixes.join('. ').slice(0, 400), variants: AUTO_FIX_VARIANTS } : null;
    if (body) {
      const r = await launchTake(main.userId, body, d.locale === 'en' ? 'en' : 'tr', { free: true, autoFixOf: main.groupId ?? main.id })
        .catch((err) => { logger.warn('AI video auto-fix failed to start', { jobId: main.id, error: err?.message }); return null; });
      autoFix = r?.json?.job?.id ?? null;
      if (autoFix && safer) autoFixMode = 'safer';
    }
  }
  for (const r of results) {
    const qa = r.job.id === main?.id && autoFix ? { ...r.qa, autoFix, autoFixMode } : r.qa;
    await prisma.aiVideoJob.update({ where: { id: r.job.id }, data: { qa: qa as any } }).catch(() => undefined);
  }
}

/** Polls a running job once; when done stores every variant (siblings share the group). */
async function refresh(job: Job): Promise<Job> {
  if (job.status !== 'running' && job.status !== 'preparing') return job;
  if (Date.now() - new Date(job.createdAt).getTime() > STALE_MS) return failJob(job, 'videoFailed', 'timed out');
  if (job.status === 'preparing' || !job.operation) return job;
  try {
    const r = await pollVideo({ operation: job.operation, provider: job.provider, model: job.model });
    if (!r.done) return job;
    const ms = Date.now() - new Date(job.createdAt).getTime();
    if (!r.ok) {
      void logUsage({ userId: job.userId, feature: 'video.generate', model: job.model, ok: false, ms, refine: Boolean(job.parentId), error: r.detail });
      // Google refused the wording (not the photos): retry once by itself with the plainest prompt, same frames.
      if (WORDING_REFUSED.test(r.detail) && !(job.direction as Dir | null)?.safeRetry && job.mode !== 'extend') return retrySafe(job);
      return failJob(job, WORDING_REFUSED.test(r.detail) ? 'videoWording' : r.errorKey, r.detail);
    }
    // Claim the job first so two pollers never save it twice.
    const claimed = await prisma.aiVideoJob.updateMany({ where: { id: job.id, status: 'running', operation: job.operation }, data: { operation: null } });
    if (!claimed.count) return (await prisma.aiVideoJob.findFirst({ where: { id: job.id } })) ?? job;
    const dir = (job.direction ?? {}) as Partial<Dir>;
    const finish = (file: string) => finishInPlace(file, { mute: dir.audio === 'none', format: dir.format, grain: dir.grain !== false })
      .catch((e) => logger.warn('AI video finish failed', { jobId: job.id, error: e?.message }));
    const { id: _id, createdAt: _c, updatedAt: _u, ...base } = job;
    const done: string[] = [job.id];
    for (let i = 1; i < r.videos.length; i++) {
      const sib = await prisma.aiVideoJob.create({ data: { ...base, id: newJobId(), direction: (job.direction as any) ?? undefined, qa: undefined, published: undefined, credits: 0, status: 'running', variantIndex: i, operation: null } });
      const file = await saveVideo(job.userId, sib.id, r.videos[i]);
      await finish(file);
      await prisma.aiVideoJob.update({ where: { id: sib.id }, data: { status: 'done', filePath: file } });
      done.push(sib.id);
    }
    const filePath = await saveVideo(job.userId, job.id, r.videos[0]);
    await finish(filePath);
    void logUsage({ userId: job.userId, feature: 'video.generate', model: job.model, ok: true, ms, refine: Boolean(job.parentId), images: job.durationSec * r.videos.length });
    const updated = await prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'done', filePath } });
    // Veo filtered some of the variants: those are refunded.
    const asked = Math.max(1, Number(dir.variants ?? 1));
    if (job.credits > 0 && r.videos.length < asked && job.mode !== 'extend') {
      const per = videoCredits({ quality: job.quality, resolution: job.resolution, durationSec: job.durationSec, variants: 1 });
      void refundCredits(job.userId, job.id, { amount: per * (asked - r.videos.length), key: 'partial' }).catch(() => undefined);
    }
    void runQa(done);
    return updated;
  } catch (err: any) {
    logger.warn('AI video poll failed', { jobId: job.id, error: err?.message });
    return job;
  }
}

/** Restarts a job whose prompt Google refused, with the safe prompt (the same frames; no extra charge). */
async function retrySafe(job: Job): Promise<Job> {
  const raw = (job.direction ?? {}) as Dir;
  const d: Dir = { ...normalizeDirection(raw), genAspect: raw.genAspect, variants: raw.variants, locale: raw.locale, autoFixOf: raw.autoFixOf, safeRetry: true };
  const prompt = directVideo(d, [], { safe: true });
  const claimed = await prisma.aiVideoJob.updateMany({ where: { id: job.id, status: 'running', operation: job.operation }, data: { status: 'preparing', operation: null, prompt, direction: d as any } });
  if (!claimed.count) return (await prisma.aiVideoJob.findFirst({ where: { id: job.id } })) ?? job;
  const fresh = (await prisma.aiVideoJob.findFirst({ where: { id: job.id } })) ?? job;
  const start = await loadSource(job.userId, job.sourceUrl);
  const end = job.endUrl ? await loadSource(job.userId, job.endUrl) : null;
  const aspectRatio: '9:16' | '16:9' = raw.genAspect === '16:9' ? '16:9' : '9:16';
  void prepareAndStart({
    job: fresh, direction: d, prompt, aspectRatio, durationSec: job.durationSec, resolution: job.resolution, quality: job.quality === 'best' ? 'best' : 'fast',
    variants: Math.max(1, Number(raw.variants ?? 1)), seed: job.seed, start, end, products: [], aiStart: false, aiEnd: false, changes: [],
  });
  logger.info('AI video: wording refused by Google, retrying with the safe prompt', { jobId: job.id });
  return fresh;
}

async function changesOf(userId: string, start: Job | null): Promise<string[]> {
  const out: string[] = [];
  for (let p: Job | null = start, n = 0; p && n < 30; n++) {
    if (p.instruction && p.mode !== 'edit') out.unshift((p.direction as Dir | null)?.instructionEn || p.instruction);
    p = p.parentId ? await prisma.aiVideoJob.findFirst({ where: { id: p.parentId, userId } }) : null;
  }
  return out;
}

type Launch = {
  job: Job; direction: Dir; prompt: string; aspectRatio: '9:16' | '16:9'; durationSec: number; resolution: string;
  quality: 'fast' | 'best'; variants: number; seed: number | null;
  start: VideoMedia | null; end: VideoMedia | null; products: VideoMedia[]; aiStart: boolean; aiEnd: boolean;
  /** Follow-ups so far (English), for the AI prompt writer. */
  changes: string[];
};

/** Builds the missing keyframes (Nano Banana Pro, from every product photo), then starts Veo. Runs in the background. */
async function prepareAndStart(l: Launch) {
  const { job, direction: d } = l;
  try {
    let start = l.start;
    let startRef = job.sourceUrl;
    if (l.aiStart) {
      // Checked against the photos and redrawn when the product changed (lib/ai/videoProduct verifyKeyframe).
      start = await generateCheckedKeyframe({ userId: job.userId, refs: l.products, prompt: keyframePrompt(d, { which: 'start', refCount: l.products.length, hasStart: false }), aspectRatio: l.aspectRatio }, l.products);
      startRef = await saveSourceImage(job.userId, Buffer.from(start.data, 'base64'), extOf(start));
    }
    if (!start) throw Object.assign(new Error('no start frame'), { key: 'imageRequired' });
    let end = l.end;
    let endRef = job.endUrl;
    if (l.aiEnd) {
      end = await generateCheckedKeyframe({ userId: job.userId, refs: l.products, first: start, prompt: keyframePrompt(d, { which: 'end', refCount: l.products.length, hasStart: true }), aspectRatio: l.aspectRatio }, l.products);
      endRef = await saveSourceImage(job.userId, Buffer.from(end.data, 'base64'), extOf(end));
    }
    // Anchor frames shaped like the video (no black bars for Veo to animate; the photo's own scene continues into the
    // sides instead of blurred bars).
    const extend = (m: VideoMedia, aspect: string) => extendFrame(job.userId, m, aspect);
    const first = await fitToAspect(start, l.aspectRatio, d.format, { extend });
    // …and the end subject the same size and place as the start one (no zoom / "shrinking" at the end).
    const last = end ? await matchSubjectScale(job.userId, first, await fitToAspect(end, l.aspectRatio, d.format, { extend }), l.aspectRatio) : null;
    // The AI director reads these exact frames and the product photos and writes the prompt for THIS product
    // (lib/ai/videoPromptWriter); the rule-based prompt stands in when it cannot.
    let prompt = l.prompt;
    let negative = negativePrompt(d);
    // (Not on the safe retry after Google refused the wording: that one is the plainest rule-based prompt.)
    const written = d.safeRetry ? null : await writeVideoPrompt(job.userId, { first, last, products: l.products, direction: d, changes: l.changes, durationSec: l.durationSec })
      .catch((e) => { logger.warn('AI video prompt writer failed', { jobId: job.id, error: e?.message }); return null; });
    if (written) {
      prompt = written.prompt;
      negative = Array.from(new Set([...negative.split(', '), ...written.negative])).join(', ');
    }
    const started = await startVideo({
      mode: last ? 'interpolate' : 'image', prompt, negativePrompt: negative, image: first, lastFrame: last ?? undefined,
      aspectRatio: l.aspectRatio, durationSec: l.durationSec, resolution: l.resolution, quality: l.quality, variants: l.variants, seed: l.seed, audio: d.audio !== 'none',
    });
    await prisma.aiVideoJob.update({
      where: { id: job.id },
      data: {
        status: 'running', operation: started.operation, provider: started.provider, model: started.model, sourceUrl: startRef, endUrl: endRef, prompt,
        direction: { ...(d as object), promptBy: written ? 'ai' : 'rules', reading: written?.reading || undefined } as any,
      },
    });
  } catch (err: any) {
    logger.warn('AI video start failed', { jobId: job.id, error: err?.message });
    await failJob(job, err?.key ?? (l.aiStart || l.aiEnd ? 'keyframeFailed' : 'videoFailed'), String(err?.message || 'failed'));
  }
}

/**
 * A new take or a follow-up version (also started by the automatic fix after a failed quality check, `opts.free`).
 * Returns the HTTP status + body for the handler.
 */
async function launchTake(userId: string, body: any, locale: 'tr' | 'en', opts: { free?: boolean; autoFixOf?: string } = {}): Promise<{ status: number; json: any }> {
  let parent: Job | null = null;
  if (body.parentId) {
    parent = await prisma.aiVideoJob.findFirst({ where: { id: String(body.parentId), userId: userId } });
    if (!parent) return { status: 404, json: { code: 'notFound' } };
  }
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 400) : '';
  if (parent && !instruction && !body.direction) return { status: 400, json: { code: 'instructionRequired' } };

  const direction: Dir = { ...normalizeDirection(body.direction ?? parent?.direction ?? {}), locale };
  // The seller's own words (any language) → a checked English direction for THIS product and shot; what real footage
  // cannot show, or what would change the product, is left out and shown to the seller (lib/ai/videoNotes).
  // Automatic fixes are written by us in English already.
  if (!opts.free) {
    const parentDir = (parent?.direction ?? null) as Dir | null;
    const dropped: string[] = [];
    delete direction.notesEn;
    if (direction.notes) {
      if (parentDir?.notes === direction.notes && parentDir?.notesEn) direction.notesEn = parentDir.notesEn;
      else {
        const r = await interpretNotes(userId, {
          notes: direction.notes, profile: direction.profile, product: direction.product, shot: direction.shotText,
          free: direction.preset === 'custom' && !direction.shotText, person: direction.person, locale,
        });
        if (r) { direction.notesEn = r.en || undefined; dropped.push(...r.dropped); }
      }
    }
    if (instruction) {
      const r = await interpretNotes(userId, { notes: instruction, profile: direction.profile, product: direction.product, shot: direction.shotText, person: direction.person, locale });
      if (r) { direction.instructionEn = r.en || undefined; dropped.push(...r.dropped); }
    } else delete direction.instructionEn;
    direction.notesDropped = dropped.length ? dropped : undefined;
  }
  const lock = body.lock !== false && (parent ? (parent.direction as any)?.lock !== false : true);

  // Frames + product photos. A follow-up re-uses its parent's frames (real photos or the keyframes already built).
  let startRef: string | null;
  let endRef: string | null;
  let productRefs: string[];
  if (parent) {
    startRef = parent.sourceUrl;
    // The safer automatic fix drops the end frame (it forced the turn that went wrong).
    endRef = body.dropEnd === true ? null : parent.endUrl;
    productRefs = parent.referenceUrls;
  } else {
    startRef = direction.mode === 'scene' ? null : (typeof body.sources?.start === 'string' ? body.sources.start : null);
    endRef = direction.mode === 'scene' ? null : (typeof body.sources?.end === 'string' ? body.sources.end : null);
    const listed = Array.isArray(body.sources?.product) ? body.sources.product : Array.isArray(body.sources?.references) ? body.sources.references : [];
    productRefs = Array.from(new Set([startRef, endRef, ...listed.map(String)].filter((x): x is string => Boolean(x)))).slice(0, MAX_PRODUCT_REFS);
  }
  const products = await loadSources(userId, productRefs);
  const start = startRef ? await loadSource(userId, startRef) : null;
  const end = endRef ? await loadSource(userId, endRef) : null;
  const aiStart = !start;
  if (aiStart && !products.length) return { status: 400, json: { code: direction.mode === 'scene' ? 'productPhotosRequired' : 'imageRequired' } };
  // The end the first frame cannot show (the back after a turn, the next pose) is built from the photos.
  const aiEnd = !end && !parent && lock && (TURNING.has(direction.preset) || (direction.preset === 'custom' && direction.showsBack === true)) && products.length > 0;

  const changes = [...(await changesOf(userId, parent)), ...(instruction ? [direction.instructionEn || instruction] : [])];
  // Veo renders 16:9 / 9:16; the client sends the generation aspect (from the format and the photo orientation).
  const parentGen = (parent?.direction as Dir | null)?.genAspect ?? (parent?.aspectRatio === '16:9' ? '16:9' : parent ? '9:16' : null);
  const aspectRatio: '9:16' | '16:9' = (body.aspectRatio ?? parentGen) === '16:9' ? '16:9' : '9:16';
  direction.genAspect = aspectRatio;
  const { durationSec, resolution } = veoConstraints({ mode: 'image', durationSec: Number(body.durationSec ?? parent?.durationSec ?? 8), resolution: String(body.resolution ?? parent?.resolution ?? '720p') });
  const quality = (body.quality ?? parent?.quality) === 'best' ? 'best' : 'fast';
  const variants = Math.min(4, Math.max(1, Number(body.variants ?? 1) || 1));
  direction.variants = variants;
  (direction as any).lock = lock;
  const seedRaw = body.seed;
  const seed = seedRaw !== undefined && seedRaw !== null && seedRaw !== '' && Number.isFinite(Number(seedRaw)) ? Math.round(Number(seedRaw)) : (parent?.seed ?? null);
  const prompt = directVideo(direction, changes);

  const id = newJobId();
  // An automatic fix (after a failed quality check) is on us: never charged.
  const cost = opts.free ? 0 : videoCredits({ quality, resolution, durationSec, variants }) + (aiStart ? imageCredits() : 0) + (aiEnd ? imageCredits() : 0);
  if (opts.autoFixOf) direction.autoFixOf = opts.autoFixOf;
  try {
    await spendCredits(userId, cost, { feature: 'video', ref: id, note: `${quality} ${resolution} ${durationSec}s x${variants}` });
  } catch (err) {
    if (isNoCreditsError(err)) return { status: 402, json: err.body() };
    if (isAiBudgetError(err)) return { status: 503, json: err.body() };
    throw err;
  }

  const job = await prisma.aiVideoJob.create({
    data: {
      id, groupId: id, userId: userId, parentId: parent?.id ?? null, provider: 'pending', model: 'pending', status: 'preparing',
      mode: aiStart ? 'scene' : end || aiEnd ? 'interpolate' : 'image',
      prompt, instruction: instruction || null, direction: direction as any, sourceUrl: startRef, endUrl: endRef, referenceUrls: productRefs,
      aspectRatio: direction.format ?? aspectRatio, durationSec, resolution, quality, seed, credits: cost,
      listingRef: (parent?.listingRef ?? (typeof body.listingRef === 'string' ? body.listingRef.slice(0, 120) : null)) || null,
      title: (parent?.title ?? (typeof body.title === 'string' ? body.title.slice(0, 140) : null)) || null,
    },
  });
  const launch: Launch = { job, direction, prompt, aspectRatio, durationSec, resolution, quality, variants, seed, start, end, products, aiStart, aiEnd, changes };
  // Keyframes and the AI-written prompt take ~10–60 s: the client polls 'preparing' → 'running' → 'done'.
  void prepareAndStart(launch);
  return { status: 200, json: { job: viewJob(job), credits: cost } };
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
        const fresh = await Promise.all(recent.map((j) => (j.status === 'running' || j.status === 'preparing' ? refresh(j) : j)));
        return res.status(200).json({ jobs: fresh.map(viewJob) });
      }
      const jobs = await prisma.aiVideoJob.findMany({ where: { userId: user.id, id: { in: ids } }, orderBy: { createdAt: 'asc' } });
      const fresh = await Promise.all(jobs.map(refresh));
      // Variants created on completion belong to the asked groups: return them too.
      const groups = Array.from(new Set(fresh.map((j) => j.groupId).filter(Boolean))) as string[];
      const siblings = groups.length ? await prisma.aiVideoJob.findMany({ where: { userId: user.id, groupId: { in: groups }, id: { notIn: ids } } }) : [];
      // …and versions the studio started by itself (the automatic fix) from the asked jobs.
      const known = new Set([...ids, ...siblings.map((j) => j.id)]);
      const children = await prisma.aiVideoJob.findMany({ where: { userId: user.id, parentId: { in: [...known] }, createdAt: { gt: new Date(Date.now() - STALE_MS) } } });
      return res.status(200).json({ jobs: [...fresh, ...siblings, ...children.filter((j) => !known.has(j.id))].map(viewJob) });
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

    const running = await prisma.aiVideoJob.count({ where: { userId: user.id, status: { in: ['running', 'preparing'] }, createdAt: { gt: new Date(Date.now() - STALE_MS) } } });
    if (running >= RUNNING_PER_USER) return res.status(429).json({ code: 'videoBusy' });

    const body = req.body || {};
    const locale: 'tr' | 'en' = body.locale === 'en' ? 'en' : 'tr';

    // ── Extend: continue a finished video by 7 s ──
    if (body.extendOf) {
      const src = await prisma.aiVideoJob.findFirst({ where: { id: String(body.extendOf), userId: user.id, status: 'done' } });
      if (!src?.filePath) return res.status(404).json({ code: 'notFound' });
      const direction = normalizeDirection(src.direction ?? {});
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 400) : '';
      const changes = [...(await changesOf(user.id, src)), ...(instruction ? [instruction] : [])];
      // A processed video (crop / grain) is extended from Veo's untouched original; the result is processed again.
      const orig = originalOf(src.filePath);
      const input = (await fs.promises.stat(orig).then(() => true).catch(() => false)) ? orig : src.filePath;
      const video = { data: (await fs.promises.readFile(input)).toString('base64'), mimeType: 'video/mp4' };
      const genAspect = (src.direction as Dir | null)?.genAspect === '16:9' || src.aspectRatio === '16:9' ? '16:9' : '9:16';
      const quality = src.quality === 'best' ? 'best' : 'fast';
      const id = newJobId();
      const cost = extendCredits(quality);
      try {
        await spendCredits(user.id, cost, { feature: 'video', ref: id, note: 'extend' });
      } catch (err) {
        if (isNoCreditsError(err)) return res.status(402).json(err.body());
        if (isAiBudgetError(err)) return res.status(503).json(err.body());
        throw err;
      }
      let started;
      try {
        started = await startVideo({
          mode: 'extend', prompt: directVideo(direction, [...changes, 'Continue the same shot seamlessly from the last frame']), negativePrompt: negativePrompt(direction),
          video, aspectRatio: genAspect, durationSec: 7, resolution: '720p', quality, audio: direction.audio !== 'none',
        });
      } catch (err) {
        await refundCredits(user.id, id).catch(() => undefined);
        throw err;
      }
      const job = await prisma.aiVideoJob.create({
        data: {
          id, userId: user.id, parentId: src.id, groupId: id, provider: started.provider, model: started.model, status: 'running', mode: 'extend',
          prompt: src.prompt, instruction: instruction || null, direction: { ...(src.direction as any), ...direction, genAspect, variants: 1 } as any, sourceUrl: src.sourceUrl, endUrl: src.endUrl,
          referenceUrls: src.referenceUrls, aspectRatio: src.aspectRatio, durationSec: src.durationSec + 7, resolution: '720p',
          quality: src.quality, operation: started.operation, listingRef: src.listingRef, title: src.title, credits: cost,
        },
      });
      return res.status(200).json({ job: viewJob(job), credits: cost });
    }

    // ── New take or follow-up ──
    const r = await launchTake(user.id, body, locale);
    return res.status(r.status).json(r.json);
  } catch (err: any) {
    logger.error('AI video request failed', err, { userId: user.id });
    return res.status(502).json({ code: 'videoFailed' });
  }
}
