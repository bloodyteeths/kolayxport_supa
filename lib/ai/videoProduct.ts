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
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { aiJson, isRetryableAiError, logUsage } from './gemini';
import { modelChain } from './models';
import { frameAt, shrink, videoDuration } from './videoSources';
import type { VideoMedia } from './video';
import type { VideoDirection } from './videoDirector';
import { lockSentence, neutralPeople, personSentence, sceneSentence } from './videoDirector';
import { normalizeProfile, type ProductProfile } from './videoShots';

export const MAX_PRODUCT_REFS = 10;

/** What the end frame shows, per shot type (the same shot a few seconds later). */
const END_POSE: Partial<Record<VideoDirection['preset'], string>> = {
  twirl: 'The person has turned around and now faces away from the camera, so the back of the product is fully visible.',
  turntable: 'The product has turned so its back is fully visible.',
  frontBack: 'The back of the product now faces the camera.',
  walk: 'The person has walked a few steps closer to the camera and stopped, smiling.',
  pose: 'The person stands in a different, relaxed natural pose a few seconds later.',
  lifestyle: 'A few seconds later in the same moment: a different natural pose.',
  hero: 'The camera has moved in closer: a sharp hero view of the product.',
  orbit: 'The camera has moved a little around the product: the same shot from a slightly different angle.',
  reveal: 'The light has moved across: the whole product clearly and evenly lit.',
  withPerson: 'A few seconds later: the person still naturally using the product, in a slightly different pose.',
};

export function endPoseFor(d: Pick<VideoDirection, 'preset' | 'showsBack'>): string {
  if (d.preset === 'custom' && d.showsBack) return 'The back of the product is now fully visible.';
  return END_POSE[d.preset] ?? 'A few seconds later in the same shot: a slightly different natural view.';
}

/** Keyframe prompt (exported for tests). `refCount` product photos follow the optional first frame. */
export function keyframePrompt(d: VideoDirection, opts: { which: 'start' | 'end'; refCount: number; hasStart: boolean }): string {
  const productImgs = opts.hasStart ? `Images 2–${opts.refCount + 1}` : `Images 1–${opts.refCount}`;
  const parts = [
    opts.which === 'end' && opts.hasStart
      ? `Image 1 is the first frame of a video. Create the LAST frame of the same continuous shot a few seconds later: the same ${d.person ? 'person, ' : ''}place, light and camera distance. ${endPoseFor(d)}`
      : `Create the first frame of a real product video: ${d.addPerson ? 'a real, natural-looking adult naturally wearing, holding or using exactly this product in the setting; the product is the focus and fully recognisable' : d.person ? 'the same person from the photos wearing or holding exactly this product, natural and relaxed, the whole product in frame' : 'the product fully in frame'}.`,
    `${productImgs} are real photos of the product${d.product ? ` (${d.person ? neutralPeople(d.product) : d.product})` : ''} from different angles.`,
    lockSentence(d.person, d.productKind, d.addPerson === true),
    d.person ? personSentence(d) : '',
    opts.which === 'start' || !opts.hasStart ? sceneSentence(d) : '',
    d.format === '1:1' || d.format === '4:5'
      ? `The video is cropped to ${d.format === '1:1' ? 'a square' : '4:5'} from the centre: the whole product must fit inside that centre area, with background above and below it.`
      : '',
    'A real photograph, a frame from an unedited video: true-to-life colours, natural light and shadows, real textures. No added text, logos or watermarks.',
  ];
  return parts.filter(Boolean).join(' ');
}

/** One keyframe from the product photos (Nano Banana Pro, 2K, the generation aspect). */
export async function generateKeyframe(input: { userId: string; refs: VideoMedia[]; first?: VideoMedia | null; prompt: string; aspectRatio: string }): Promise<VideoMedia> {
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

/**
 * Continues a photo's real scene into the blurred sides of a padded frame (Nano Banana Pro outpaint) — for a video
 * whose shape differs from the photo. The caller lays the original photo back over the result (lib/ai/videoSources
 * fitBox), so only the new sides come from the AI. Null on any failure (the blurred sides stay).
 */
export async function extendFrame(userId: string, padded: VideoMedia, aspect: string): Promise<VideoMedia | null> {
  const supported = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  if (!supported.includes(aspect)) return null;
  try {
    return await generateKeyframe({
      userId, refs: [], first: padded, aspectRatio: aspect,
      prompt: 'This photo sits in the centre of the frame; the blurred areas around it are only placeholders. Replace the blurred areas '
        + 'with a sharp, natural continuation of the same real scene: the same room, wall, floor, furniture, light and perspective, as '
        + 'if the original photo had been taken wider. Keep the centre photo exactly as it is (do not move, resize or change anything '
        + 'in it). No new people or products, no text, no borders, no frames, no visible seams.',
    });
  } catch {
    return null;
  }
}

export type VideoQa = {
  status: 'running' | 'done' | 'failed';
  /** 0–10: the same product in every frame. */
  match?: number;
  /** 0–10: believable as a real filmed video. */
  realism?: number;
  /** What differs from the photos / looks artificial: `text` in the seller's language, `fix` an English instruction. */
  diffs?: QaNote[];
  issues?: QaNote[];
  /** The longest stretch (seconds) with no visible problem — the video can be trimmed to it. */
  clean?: { from: number; to: number };
  /** Set when the video was trimmed to its clean stretch automatically (`of` = the untrimmed length). */
  trimmed?: { from: number; to: number; of: number };
};

/** `text` in the seller's language; `fix` an English direction for the next take; `at` the second it shows. */
export type QaNote = { text: string; fix: string; at?: number };

const clampScore = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : undefined;
};

function notes(v: unknown, max: number, duration?: number): QaNote[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => {
      const at = Number(x?.at);
      const ok = Number.isFinite(at) && at >= 0 && (duration === undefined || at <= duration + 0.5);
      return { text: String(x?.text ?? '').trim().slice(0, 160), fix: String(x?.fix ?? '').trim().slice(0, 200), ...(ok ? { at: Math.round(at * 10) / 10 } : {}) };
    })
    .filter((x) => x.text && x.fix)
    .slice(0, max);
}

/** A usable clean stretch inside the video (seconds), or undefined. Pure. */
function cleanWindow(v: unknown, duration?: number): VideoQa['clean'] {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const from = Number(o.from);
  const to = Number(o.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return undefined;
  const end = duration === undefined ? to : Math.min(to, duration);
  if (end - from < 1) return undefined;
  return { from: Math.round(from * 10) / 10, to: Math.round(end * 10) / 10 };
}

/** Normalises the model's QA answer (wrong types, out-of-range scores, garbled lists). Pure, exported for tests. */
export function normalizeQa(raw: unknown, duration?: number): VideoQa {
  // Gemini sometimes wraps the object in an array.
  const one = Array.isArray(raw) ? raw.find((x) => x && typeof x === 'object' && !Array.isArray(x)) : raw;
  const o = (one && typeof one === 'object' && !Array.isArray(one) ? one : {}) as Record<string, unknown>;
  const match = clampScore(o.productMatch ?? o.match);
  const realism = clampScore(o.realism);
  if (match === undefined && realism === undefined) return { status: 'failed' };
  const clean = cleanWindow(o.clean, duration);
  return { status: 'done', match, realism, diffs: notes(o.diffs, 4, duration), issues: notes(o.issues, 4, duration), ...(clean ? { clean } : {}) };
}

/**
 * Checks a finished video against the product photos, like a careful buyer: the video itself (motion, flicker, hands,
 * faces) and 8 timed frames (fine product details), with the second each problem shows and the longest clean stretch.
 * `person` / `profile` tell it what to look at hardest (hands, teeth, eyes; printed text; petals …).
 */
export async function checkVideo(input: { userId: string; file: string; refs: VideoMedia[]; locale: 'tr' | 'en'; person?: boolean; profile?: ProductProfile }): Promise<VideoQa> {
  const duration = await videoDuration(input.file);
  if (!duration) return { status: 'failed' };
  const frames: { t: number; m: VideoMedia }[] = [];
  for (let i = 0; i < 8; i++) {
    const t = Math.round(((i + 0.5) / 8) * duration * 10) / 10;
    const buf = await frameAt(input.file, t, 1024).catch(() => null);
    if (buf?.length) frames.push({ t, m: { data: buf.toString('base64'), mimeType: 'image/jpeg' } });
  }
  const photos = await Promise.all(input.refs.slice(0, 5).map((r) => shrink(r, 1024)));
  if (!frames.length || !photos.length) return { status: 'failed' };
  const video = await fs.promises.readFile(input.file).catch(() => null);
  const withVideo = Boolean(video && video.length <= 15 * 1024 * 1024);
  const lang = input.locale === 'tr' ? 'Turkish' : 'English';
  const p = input.profile;
  const look = [
    input.person ? 'hands and fingers (count, shape, fused or bending fingers), teeth and mouths, eyes and blinking, faces turning to profile, skin texture (plastic or waxy), hair' : '',
    p?.text ? 'printed text, titles and labels (scrambled or changing letters)' : '',
    p?.physics === 'organic' ? 'petals, leaves and stems (count, shape, appearing or vanishing)' : '',
    p?.physics === 'fabric' ? 'the fabric\'s pattern and embellishments sliding or redrawing, fabric moving without weight' : '',
    p?.physics === 'rigid' ? 'the object bending, melting or changing shape' : '',
    p?.shiny ? 'reflections that do not follow the light' : '',
    p?.details?.length ? `these details of the product: ${p.details.join('; ')}` : '',
  ].filter(Boolean).join('; ');
  const parts: any[] = [
    { text: `PRODUCT PHOTOS (real): ${photos.length} images.` },
    ...photos.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })),
    ...(withVideo ? [{ text: `THE VIDEO (${duration.toFixed(1)} s, AI-generated):` }, { inlineData: { mimeType: 'video/mp4', data: video!.toString('base64') } }] : []),
    { text: `VIDEO FRAMES (sharp stills, in time order): ${frames.length} images.` },
    ...frames.flatMap((f) => [{ text: `t=${f.t}s` }, { inlineData: { mimeType: f.m.mimeType, data: f.m.data } }]),
    {
      text: [
        'You check AI product videos for an online shop before a buyer sees them. Compare the product in the video and every frame with the PRODUCT PHOTOS, image against image, like a careful buyer; watch the motion too.',
        'The photos show the product from different angles, poses and crops (front, back, side, close-up): never count a different pose, angle, crop, camera distance or framing as a difference. Judge only the product\'s own design. Motion blur in a frame of a moving shot is normal.',
        'productMatch 0–10: 10 = the same design in every frame (shape, cut, colours, pattern, prints and text, parts, ornaments — roughly the same number, size and placement —, materials). 8–9: only tiny differences a buyer would not notice. 6–7: a difference a buyer could notice. 4–5: clearly changed details. 0–3: a different product.',
        'realism 0–10, judged as a shopper watching on a phone: 10 = nobody could tell it is not a real filmed video. Lower it for distorted faces, eyes, teeth or hands, plastic skin, melting or morphing, flicker, impossible physics, slow-motion drift, on-screen interfaces, black bars, blurred borders.',
        look ? `Look hardest at: ${look}.` : '',
        `diffs: up to 4 concrete differences from the photos (most visible first). issues: up to 4 things that look artificial. Each item: "text" = short, specific, in ${lang}, for the seller; "at" = the second (number) where it shows most; "fix" = one short English direction for the NEXT take that prevents it, phrased as what should happen on camera (e.g. "The hands rest still at the sides", "The camera stays farther back so the bow is never redrawn", "The book stays closed with its cover toward the camera") — never just "fix X".`,
        'clean: the longest stretch {"from","to"} in seconds where no frame shows any of the problems you listed (the whole video if there are none).',
        'Only list real problems; empty lists when there are none. Return JSON: {"productMatch": number, "realism": number, "diffs": [{"text","fix","at"}], "issues": [{"text","fix","at"}], "clean": {"from","to"}}',
      ].filter(Boolean).join('\n'),
    },
  ];
  const raw = await aiJson({ tier: 'deep', feature: 'video.qa', userId: input.userId, temperature: 0.2 }, parts);
  return normalizeQa(raw, duration);
}

type Box = [number, number, number, number]; // ymin, xmin, ymax, xmax (0–1000)

const validBox = (b: unknown): b is Box =>
  Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && v >= 0 && v <= 1000) && b[2] > b[0] && b[3] > b[1];

/**
 * Where the crop window for the end frame goes so its subject matches the start frame's (same height, same place).
 * Inputs and output in pixels of a W×H frame. Pure, exported for tests. null = nothing to do / cannot.
 */
export function matchWindow(start: Box, end: Box, W: number, H: number): { left: number; top: number; width: number; height: number } | null {
  const sh = ((start[2] - start[0]) / 1000) * H;
  const eh = ((end[2] - end[0]) / 1000) * H;
  if (sh <= 0 || eh <= 0) return null;
  const s = sh / eh; // > 1: the end subject is smaller → zoom in on it
  if (s < 1.06 || s > 2.2) return null; // already alike, or too far apart to fix by cropping
  const width = Math.round(W / s);
  const height = Math.round(H / s);
  // Same subject centre (x) and same feet line (y = box bottom) as in the start frame.
  const ecx = (((end[1] + end[3]) / 2) / 1000) * W;
  const scx = (((start[1] + start[3]) / 2) / 1000) * W;
  const eb = (end[2] / 1000) * H;
  const sb = (start[2] / 1000) * H;
  let left = Math.round(ecx - scx / s);
  let top = Math.round(eb - sb / s);
  left = Math.max(0, Math.min(W - width, left));
  top = Math.max(0, Math.min(H - height, top));
  return { left, top, width, height };
}

/**
 * Real start + end photos are often taken from different distances (the back photo farther away): Veo then zooms
 * and the model "shrinks" at the end (seen on production 2026-10-17). The subject is found in both frames (Gemini
 * boxes) and the end frame is cropped so the subject has the same size and place as in the start frame.
 * Both frames must already be the video's shape (fitToAspect).
 */
export async function matchSubjectScale(userId: string, start: VideoMedia, end: VideoMedia, aspect: '9:16' | '16:9'): Promise<VideoMedia> {
  try {
    const [W, H] = aspect === '9:16' ? [1080, 1920] : [1920, 1080];
    const small = await Promise.all([shrink(start, 768), shrink(end, 768)]);
    const raw = await aiJson<any>({ tier: 'fast', feature: 'video.frameMatch', userId, temperature: 0 }, [
      { inlineData: { mimeType: small[0].mimeType, data: small[0].data } },
      { inlineData: { mimeType: small[1].mimeType, data: small[1].data } },
      { text: 'Image 1 and image 2 are two frames of the same product video. For each, give the bounding box of the main subject — the whole person with the whole outfit from the top of the head to the bottom of the hem or feet (or the whole product if there is no person) — as [ymin, xmin, ymax, xmax] normalised to 0–1000. Return JSON: {"start": [..4 numbers], "end": [..4 numbers]}' },
    ]);
    const o = Array.isArray(raw) ? raw[0] : raw;
    if (!validBox(o?.start) || !validBox(o?.end)) return end;
    const win = matchWindow(o.start, o.end, W, H);
    if (!win) return end;
    const sharpMod = (await import('sharp')).default;
    const out = await sharpMod(Buffer.from(end.data, 'base64')).resize(W, H, { fit: 'fill' }).extract(win).resize(W, H).jpeg({ quality: 92 }).toBuffer();
    return { data: out.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return end;
  }
}

export type PhotoView = 'front' | 'back' | 'side' | 'detail' | 'flat' | 'other';
export type ShotIdea = { label: string; hint: string; action: string; showsBack: boolean };
export type SceneIdea = { label: string; prompt: string };
export type PhotoAnalysis = {
  photos: { view: PhotoView; fullBody: boolean; person: boolean; quality: number }[];
  start: number | null;
  end: number | null;
  /** What the product is, for the shot list and the lock wording. */
  product: { kind: 'worn' | 'object'; category: string; profile: ProductProfile };
  /** Shots and settings that suit THIS product (any marketplace, any category). */
  shots: ShotIdea[];
  scenes: SceneIdea[];
};

const VIEWS: readonly PhotoView[] = ['front', 'back', 'side', 'detail', 'flat', 'other'];
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Cleans the model's photo analysis (indices 1-based in the prompt → 0-based). Pure, exported for tests. */
export function normalizePhotoAnalysis(raw: unknown, count: number): PhotoAnalysis {
  const o = (Array.isArray(raw) ? raw.find((x) => x && typeof x === 'object' && !Array.isArray(x)) : raw) as Record<string, any> | undefined;
  const list = Array.isArray(o?.photos) ? o!.photos : [];
  const photos = Array.from({ length: count }, (_, i) => {
    const p = list[i] ?? {};
    const view = VIEWS.includes(p.view) ? p.view : 'other';
    const q = Math.round(Number(p.quality));
    return { view: view as PhotoView, fullBody: p.fullBody === true, person: p.person === true, quality: Number.isFinite(q) ? Math.max(0, Math.min(10, q)) : 5 };
  });
  const idx = (v: unknown) => {
    const n = Math.round(Number(v)) - 1;
    return Number.isInteger(n) && n >= 0 && n < count ? n : null;
  };
  let start = idx(o?.start);
  let end = idx(o?.end);
  // Fall back to the rules when the model's pick is missing or unusable (a close-up never anchors a video).
  const score = (i: number) => (photos[i].fullBody ? 20 : 0) + photos[i].quality;
  const best = (views: PhotoView[], not: number | null) =>
    photos.map((p, i) => i).filter((i) => i !== not && views.includes(photos[i].view) && photos[i].view !== 'detail').sort((a, b) => score(b) - score(a))[0] ?? null;
  if (start === null || photos[start].view === 'detail') start = best(['front'], null) ?? best(['side', 'other', 'flat'], null);
  if (end !== null && (end === start || photos[end].view === 'detail')) end = null;
  if (end === null) end = best(['back'], start);
  const kind = o?.product?.kind === 'worn' ? 'worn' : 'object';
  const shots: ShotIdea[] = (Array.isArray(o?.shots) ? o!.shots : [])
    .map((x: any) => ({ label: txt(x?.label, 40), hint: txt(x?.hint, 80), action: txt(x?.action, 300), showsBack: x?.showsBack === true }))
    .filter((x: ShotIdea) => x.label && x.action)
    .slice(0, 5);
  const scenes: SceneIdea[] = (Array.isArray(o?.scenes) ? o!.scenes : [])
    .map((x: any) => ({ label: txt(x?.label, 30), prompt: txt(x?.prompt, 300) }))
    .filter((x: SceneIdea) => x.label && x.prompt)
    .slice(0, 4);
  const profile = normalizeProfile(o?.profile ?? {}, kind);
  return { photos, start, end, product: { kind: profile.use === 'worn' ? 'worn' : kind, category: txt(o?.product?.category, 60), profile }, shots, scenes };
}

/**
 * Looks at every product photo once: its view, whether the whole product is in it, the best start / end frame, what
 * the product is, and the shots and settings a good e-commerce videographer would film for it. Any category.
 */
export async function analyzePhotos(userId: string, refs: VideoMedia[], ctx: { title?: string; locale?: 'tr' | 'en' } = {}): Promise<PhotoAnalysis> {
  const small = await Promise.all(refs.slice(0, 12).map((m) => shrink(m, 512)));
  const lang = ctx.locale === 'en' ? 'English' : 'Turkish';
  const raw = await aiJson<any>({ tier: 'fast', feature: 'video.photos', userId, temperature: 0.2 }, [
    ...small.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })),
    {
      text: [
        `Images 1–${small.length} are photos of one product sold online${ctx.title ? ` ("${txt(ctx.title, 160)}")` : ''}. We will make a short product video from them.`,
        'For each image (in order) return: view = "front" | "back" | "side" | "detail" (a close-up where the whole product is not visible) | "flat" (laid flat or on a hanger) | "other"; fullBody = true when the whole product — and the whole person wearing or holding it, if any — is in the photo; person = true when a person wears or holds it; quality 0–10 (sharp, well lit, usable as a video frame).',
        'Pick start = the number of the best photo to open the video (the whole product, front, sharp) and end = the number of the best back view of the same product, person and setting (null if there is none).',
        'product: kind = "worn" for clothing, shoes, jewellery or accessories worn by a person, otherwise "object"; category = 2–4 English words.',
        'profile (how a video of THIS product must behave; any product — a dress, a book, a bouquet, a phone case, a candle, a ring, a sofa): '
          + 'name = 2–6 English words naming the product as the photos show it (no brand guesses); use = "worn" (worn on the body), "held" (normally held in the hands: a book, a bouquet, a phone case, a mug) or "placed" (stands or lies somewhere: decor, furniture, a candle); '
          + 'physics = "rigid" | "fabric" (clothing, textiles) | "organic" (flowers, plants, food) | "soft" (plush, cushions) | "liquid" (a visible liquid); '
          + 'text = true when the product shows printed words a buyer reads (a book cover, a label, a print); shiny = true for glass, metal, gems or gloss; size = "tiny" (a ring, earrings) | "small" | "medium" | "large" (furniture); flat = true when it naturally lies flat (a book, a card, folded clothing, jewellery); '
          + 'details = 3–6 short English phrases of what makes this product recognisable, only what the photos show (colours, parts, ornaments, prints, materials); printed = the exact words printed on the product itself, read from the photos letter for letter (a title, a brand on a label), [] if none; '
          + 'actions = for "lifestyle", "withPerson", "detail" and "reveal": one English sentence each of how that shot goes for this product — lifestyle: the product in its natural real place (a bouquet in a vase on a dining table, a book on a café table); withPerson: a person naturally wearing, holding or using it, calmly, hands still or holding it steadily, lips closed, never a face close-up; detail: a slow macro glide over its most characteristic detail that a photo shows; reveal: soft light gliding across its material. Nothing ever turns pages, opens packaging or changes the product.',
        `shots: 5 video shots that suit THIS product and these photos — what a good e-commerce videographer would film for it. AI video invents every side the photos do not show, so: never turn or rotate an object unless the photos show its back and sides; prefer the CAMERA moving around a still product (a slow push-in, a gentle arc of at most 30 degrees, a rising or lowering move), light gliding across it, a macro glide over a key detail, the product in use or in its natural place; for a worn product, the person posing calmly (a gentle weight shift or a slow turn of at most a quarter, hands still, lips closed, no gestures), never a close-up of a face or hands. Physically simple, real-time, the product always recognisable and rigid; keep the whole product in frame (a close-up only of a part a detail photo shows). Order them safest first. Each: label (≤ 4 words, ${lang}), hint (≤ 8 words, ${lang}), action (one English sentence of what happens on camera), showsBack (true only if the shot ends showing the back, which must be in the photos).`,
        `scenes: 4 real settings where this product would naturally be filmed. Each: label (≤ 3 words, ${lang}), prompt (one English sentence describing the place and light).`,
        'Return JSON: {"photos": [{"view","fullBody","person","quality"}], "start": number, "end": number | null, "product": {"kind","category"}, "profile": {"name","use","physics","text","shiny","size","flat","details":[],"printed":[],"actions":{"lifestyle","withPerson","detail","reveal"}}, "shots": [{"label","hint","action","showsBack"}], "scenes": [{"label","prompt"}]}',
      ].join('\n'),
    },
  ]);
  return normalizePhotoAnalysis(raw, small.length);
}
