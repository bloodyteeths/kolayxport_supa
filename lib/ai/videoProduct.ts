// lib/ai/videoProduct.ts — keeping the product identical in AI videos (SERVER ONLY).
//
// Founder 2026-10-17: "when it's generating it's altering dress details … users should feed dress videos & photos,
// multiple of them, so each frame stays consistent" and "describing a dress is very difficult". So the lock is made of
// IMAGES, never words:
//  1. Anchor frames. The video starts on a real photo (and, with a second photo, ends on one): Veo only fills the
//     seconds between two real pictures of the dress.
//  2. Keyframes from every photo. For a new scene / pose, Nano Banana Pro builds the first (and last) frame from ALL
//     the seller's photos and video frames (up to 10), then Veo animates between them.
//  3. Visual check. After generation, frames of the video are compared with the photos by Gemini (image against image),
//     scored for product match and realism, with what differs and how to fix it.
import { GoogleGenAI } from '@google/genai';
import { aiJson, isRetryableAiError, logUsage } from './gemini';
import { modelChain } from './models';
import { frameAt, shrink, videoDuration } from './videoSources';
import type { VideoMedia } from './video';
import type { VideoDirection } from './videoDirector';
import { lockSentence, personSentence, sceneSentence } from './videoDirector';

export const MAX_PRODUCT_REFS = 10;

/** What the end frame shows, per shot type (the same shot a few seconds later). */
const END_POSE: Partial<Record<VideoDirection['preset'], string>> = {
  twirl: 'The person has turned around and now faces away from the camera, so the back of the outfit is fully visible.',
  turntable: 'The product has turned so its back is fully visible.',
  frontBack: 'The back of the outfit now faces the camera.',
  walk: 'The person has walked a few steps closer to the camera and stopped, smiling.',
  pose: 'The person stands in a different, relaxed natural pose a few seconds later.',
  lifestyle: 'A few seconds later in the same moment: a different natural pose.',
};

export function endPoseFor(preset: VideoDirection['preset']): string {
  return END_POSE[preset] ?? 'A few seconds later in the same shot: a slightly different natural pose.';
}

/** Keyframe prompt (exported for tests). `refCount` product photos follow the optional first frame. */
export function keyframePrompt(d: VideoDirection, opts: { which: 'start' | 'end'; refCount: number; hasStart: boolean }): string {
  const productImgs = opts.hasStart ? `Images 2–${opts.refCount + 1}` : `Images 1–${opts.refCount}`;
  const parts = [
    opts.which === 'end' && opts.hasStart
      ? `Image 1 is the first frame of a video. Create the LAST frame of the same continuous shot a few seconds later: the same ${d.person ? 'person, ' : ''}place, light and camera. ${endPoseFor(d.preset)}`
      : `Create the first frame of a real product video: ${d.person ? 'the same person from the photos wearing exactly this outfit, standing naturally, the whole outfit in frame' : 'the product fully in frame'}.`,
    `${productImgs} are real photos of the product${d.product ? ` (${d.product})` : ''} from different angles.`,
    lockSentence(d.person),
    d.person ? personSentence(d) : '',
    opts.which === 'start' || !opts.hasStart ? sceneSentence(d) : '',
    'A real photograph, a frame from an unedited video: true-to-life colours, natural light and shadows, real skin and fabric texture. No text, logos or watermarks.',
  ];
  return parts.filter(Boolean).join(' ');
}

/** One keyframe from the product photos (Nano Banana Pro, 2K, the generation aspect). */
export async function generateKeyframe(input: { userId: string; refs: VideoMedia[]; first?: VideoMedia | null; prompt: string; aspectRatio: '9:16' | '16:9' }): Promise<VideoMedia> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey });
  const imgs = [...(input.first ? [input.first] : []), ...input.refs.slice(0, MAX_PRODUCT_REFS)];
  const parts: any[] = imgs.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } }));
  parts.push({ text: input.prompt });
  let lastErr: unknown = null;
  for (const model of modelChain('image')) {
    const started = Date.now();
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: input.aspectRatio, imageSize: '2K' } } as any,
      });
      const img = r.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
      void logUsage({ userId: input.userId, feature: 'video.keyframe', model, ok: Boolean(img), usage: r.usageMetadata, ms: Date.now() - started, refine: false, images: img ? 1 : 0 });
      if (!img?.data) throw Object.assign(new Error('no keyframe image'), { noImage: true });
      return { data: img.data, mimeType: img.mimeType || 'image/png' };
    } catch (err: any) {
      lastErr = err;
      if (err?.noImage) throw err;
      void logUsage({ userId: input.userId, feature: 'video.keyframe', model, ok: false, ms: Date.now() - started, refine: false, error: err?.message });
      if (!isRetryableAiError(err)) throw err;
    }
  }
  throw lastErr ?? new Error('No image model available');
}

export type VideoQa = {
  status: 'running' | 'done' | 'failed';
  /** 0–10: the same product in every frame. */
  match?: number;
  /** 0–10: believable as a real filmed video. */
  realism?: number;
  /** What differs from the photos / looks artificial: `text` in the seller's language, `fix` an English instruction. */
  diffs?: { text: string; fix: string }[];
  issues?: { text: string; fix: string }[];
};

const clampScore = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : undefined;
};

function notes(v: unknown, max: number): { text: string; fix: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({ text: String(x?.text ?? '').trim().slice(0, 160), fix: String(x?.fix ?? '').trim().slice(0, 200) }))
    .filter((x) => x.text && x.fix)
    .slice(0, max);
}

/** Normalises the model's QA answer (wrong types, out-of-range scores, garbled lists). Pure, exported for tests. */
export function normalizeQa(raw: unknown): VideoQa {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const match = clampScore(o.productMatch ?? o.match);
  const realism = clampScore(o.realism);
  if (match === undefined && realism === undefined) return { status: 'failed' };
  return { status: 'done', match, realism, diffs: notes(o.diffs, 4), issues: notes(o.issues, 3) };
}

/** Compares frames of the finished video with the product photos. */
export async function checkVideo(input: { userId: string; file: string; refs: VideoMedia[]; locale: 'tr' | 'en' }): Promise<VideoQa> {
  const duration = await videoDuration(input.file);
  if (!duration) return { status: 'failed' };
  const frames: VideoMedia[] = [];
  for (const f of [0.12, 0.38, 0.62, 0.9]) {
    const buf = await frameAt(input.file, duration * f, 1024).catch(() => null);
    if (buf?.length) frames.push({ data: buf.toString('base64'), mimeType: 'image/jpeg' });
  }
  const photos = await Promise.all(input.refs.slice(0, 5).map((r) => shrink(r, 1024)));
  if (!frames.length || !photos.length) return { status: 'failed' };
  const lang = input.locale === 'tr' ? 'Turkish' : 'English';
  const parts: any[] = [
    { text: `PRODUCT PHOTOS (real): ${photos.length} images.` },
    ...photos.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })),
    { text: `VIDEO FRAMES (AI video, in time order): ${frames.length} images.` },
    ...frames.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })),
    {
      text: [
        'You check AI product videos for an online shop before a buyer sees them. Compare the product in every VIDEO FRAME with the PRODUCT PHOTOS, image against image, like a careful buyer.',
        'productMatch 0–10: 10 = the exact same product in every frame (cut, colours, pattern, lace, embroidery, flowers/appliqués — their number, size and position —, sleeves, neckline, length, accessories). Any changed, added or missing detail lowers it a lot.',
        'realism 0–10: 10 = nobody could tell it is not a real filmed video (faces, eyes, hands, skin, hair, fabric movement and physics, lighting, no morphing or warping).',
        `diffs: up to 4 concrete differences from the photos (most visible first). issues: up to 3 things that look artificial. Each item: "text" = short, specific, in ${lang}, for the seller; "fix" = one short English instruction for the video model to fix it.`,
        'Only list real problems; empty lists when there are none. Return JSON: {"productMatch": number, "realism": number, "diffs": [{"text","fix"}], "issues": [{"text","fix"}]}',
      ].join('\n'),
    },
  ];
  const raw = await aiJson({ tier: 'deep', feature: 'video.qa', userId: input.userId, temperature: 0.2 }, parts);
  return normalizeQa(raw);
}
