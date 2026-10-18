// lib/ai/videoSources.ts — the Video Studio's product photos (SERVER ONLY): listing photos (https) and the seller's
// own uploads / frames taken from their dress videos / AI keyframes (`upload:<hex>`, stored per user on the VPS).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { isUnsafeUrl } from './safeUrl';
import { loadImageForUser, ownPath } from '@/lib/images/ownImage';
import { VIDEO_SOURCE_ROOT, type VideoMedia } from './video';

const run = promisify(execFile);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function sourceDir(userId: string): string {
  return path.join(VIDEO_SOURCE_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''));
}

/** Stores an image for the user; returns its `upload:<id>` ref. */
export async function saveSourceImage(userId: string, buf: Buffer, ext: 'jpg' | 'png' | 'webp' = 'jpg'): Promise<string> {
  const id = crypto.randomBytes(12).toString('hex');
  const dir = sourceDir(userId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, `${id}.${ext}`), buf);
  return `upload:${id}`;
}

export function sourceUrlOf(ref: string): string {
  return ref.startsWith('upload:') ? `/api/ai/video/source?id=${ref.slice(7)}` : ref;
}

/** A source → image bytes. `upload:<id>` reads the seller's own file (path checked); URLs are https + public. */
export async function loadSource(userId: string, ref: string | null | undefined): Promise<VideoMedia | null> {
  if (!ref) return null;
  if (ref.startsWith('upload:')) {
    const id = ref.slice(7).replace(/[^a-f0-9]/g, '');
    if (!id) return null;
    const dir = sourceDir(userId);
    const file = (await fs.promises.readdir(dir).catch(() => [] as string[])).find((f) => f.startsWith(`${id}.`));
    if (!file) return null;
    const buf = await fs.promises.readFile(path.join(dir, file));
    const ext = path.extname(file).slice(1).toLowerCase();
    return { data: buf.toString('base64'), mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  }
  // Our own photo URLs (staged Etsy photos, uploads) are read from disk for this seller (lib/images/ownImage).
  if (ownPath(ref)) {
    const own = await loadImageForUser(userId, ref);
    return own && Buffer.byteLength(own.data, 'base64') <= MAX_IMAGE_BYTES ? own : null;
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

/** Loads many sources (missing ones dropped, order kept). */
export async function loadSources(userId: string, refs: string[]): Promise<VideoMedia[]> {
  return (await Promise.all(refs.map((r) => loadSource(userId, r)))).filter((x): x is VideoMedia => Boolean(x));
}

/** A smaller JPEG for vision calls (long side ≤ `max`). */
export async function shrink(m: VideoMedia, max = 1024): Promise<VideoMedia> {
  try {
    const out = await sharp(Buffer.from(m.data, 'base64')).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { data: out.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return m;
  }
}

/** Sharpness of an image: standard deviation of its Laplacian (higher = sharper). */
async function sharpness(buf: Buffer): Promise<number> {
  const img = sharp(buf).greyscale().resize(640, 640, { fit: 'inside' })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] });
  const stats = await img.stats();
  return stats.channels[0]?.stdev ?? 0;
}

export async function videoDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 30_000 });
  const d = Number(String(stdout).trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** One frame at `t` seconds as a JPEG buffer (long side ≤ 2048). */
export async function frameAt(file: string, t: number, maxSide = 2048): Promise<Buffer> {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
    '-vf', `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`,
    '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1',
  ], { timeout: 60_000, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  return stdout as unknown as Buffer;
}

/**
 * The seller's dress video → its sharpest frames, spread over the whole clip (each candidate window keeps its
 * sharpest frame). Saved as sources; returns their refs in time order.
 */
export async function framesFromVideo(userId: string, file: string, keep = 6): Promise<string[]> {
  const duration = await videoDuration(file);
  if (!duration) throw new Error('unreadable video');
  const windows = Math.max(1, Math.min(keep, Math.ceil(duration)));
  const perWindow = 3;
  const picks: Buffer[] = [];
  for (let w = 0; w < windows; w++) {
    const a = (duration * w) / windows;
    const b = (duration * (w + 1)) / windows;
    let best: { buf: Buffer; score: number } | null = null;
    for (let k = 0; k < perWindow; k++) {
      const t = Math.min(duration - 0.05, a + ((b - a) * (k + 0.5)) / perWindow);
      const buf = await frameAt(file, t).catch(() => null);
      if (!buf?.length) continue;
      const score = await sharpness(buf).catch(() => 0);
      if (!best || score > best.score) best = { buf, score };
    }
    if (best) picks.push(best.buf);
  }
  const refs: string[] = [];
  for (const buf of picks) refs.push(await saveSourceImage(userId, buf, 'jpg'));
  return refs;
}

/**
 * The colour of a photo's free edges when they are plain (studio white, a seamless backdrop): the edges that the
 * padding will continue — top + bottom strips for a wide photo in a tall frame, left + right for a tall one.
 * null when the edges are busy (a real room, outdoors).
 */
async function plainEdgeColour(buf: Buffer, padded: 'horizontal' | 'vertical'): Promise<{ r: number; g: number; b: number } | null> {
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return null;
  const band = Math.max(2, Math.round((padded === 'horizontal' ? h : w) * 0.03));
  const strips = padded === 'horizontal'
    ? [{ left: 0, top: 0, width: w, height: band }, { left: 0, top: h - band, width: w, height: band }]
    : [{ left: 0, top: 0, width: band, height: h }, { left: w - band, top: 0, width: band, height: h }];
  // stats() reads its own input: cut each strip out first.
  const stats = await Promise.all(strips.map(async (r) => sharp(await sharp(buf).extract(r).removeAlpha().png().toBuffer()).stats()));
  const channels = stats.flatMap((st) => st.channels.slice(0, 3));
  if (channels.some((c) => c.stdev > 10)) return null;
  const mean = (i: number) => Math.round(stats.reduce((sum, st) => sum + st.channels[i].mean, 0) / stats.length);
  const r = mean(0), g = mean(1), b = mean(2);
  // Both edges must be the same colour too.
  const far = stats.some((st) => Math.abs(st.channels[0].mean - r) > 12 || Math.abs(st.channels[1].mean - g) > 12 || Math.abs(st.channels[2].mean - b) > 12);
  return far ? null : { r, g, b };
}

/**
 * Fills the padded sides of a frame with a real continuation of the photo's scene (AI outpaint), given the padded frame
 * and its aspect. Returns null when it could not (the blurred padding is kept).
 */
export type FrameExtender = (padded: VideoMedia, aspect: string) => Promise<VideoMedia | null>;

/** Reduced w:h ratio string for the image model ('1:1', '4:5', '9:16', '16:9' …). Pure. */
export function aspectLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/** The photo with its edges facing the padding faded out over `feather` px (alpha), so it blends into an extension. */
async function feathered(fg: Buffer, sides: 'horizontal' | 'vertical', feather: number): Promise<Buffer> {
  const { data, info } = await sharp(fg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = sides === 'vertical' ? Math.min(x, w - 1 - x) : Math.min(y, h - 1 - y);
      const i = (y * w + x) * 3;
      const o = (y * w + x) * 4;
      out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2];
      out[o + 3] = d >= feather ? 255 : Math.round((255 * d) / feather);
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Fits a photo into a w×h box: a small shape difference is cropped (subject kept), a big one is padded — with the
 * photo's own plain background colour, else (with `extend`) a real continuation of its scene, else a blurred copy.
 * The photo itself is always laid back over an AI extension pixel for pixel, so the product cannot change.
 */
async function fitBox(buf: Buffer, bw: number, bh: number, extend?: FrameExtender): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const ratio = (meta.width ?? bw) / (meta.height ?? bh);
  const target = bw / bh;
  const loss = ratio > target ? 1 - target / ratio : 1 - ratio / target;
  if (loss <= 0.15) return sharp(buf).resize(bw, bh, { fit: 'cover', position: sharp.strategy.attention }).png().toBuffer();
  const fg = await sharp(buf).resize(bw, bh, { fit: 'inside' }).toBuffer();
  // A plain studio background (very common for product photos) is extended with its own colour — seamless.
  const sides = ratio > target ? 'horizontal' : 'vertical';
  const edge = await plainEdgeColour(buf, sides);
  if (edge) {
    const bg = await sharp({ create: { width: bw, height: bh, channels: 3, background: edge } }).png().toBuffer();
    return sharp(bg).composite([{ input: fg, gravity: 'center' }]).png().toBuffer();
  }
  // Anything else: blurred copy behind, then (when possible) the AI continues the real scene into those sides —
  // blurred side bars look fake (the quality check flagged "blurred vertical borders" on production).
  const blurBg = await sharp(buf).resize(bw, bh, { fit: 'cover' }).blur(40).modulate({ brightness: 1.03 }).toBuffer();
  const padded = await sharp(blurBg).composite([{ input: fg, gravity: 'center' }]).png().toBuffer();
  if (!extend) return padded;
  try {
    const ext = await extend({ data: padded.toString('base64'), mimeType: 'image/png' }, aspectLabel(bw, bh));
    if (!ext) return padded;
    const bg = await sharp(Buffer.from(ext.data, 'base64')).resize(bw, bh, { fit: 'fill' }).removeAlpha().png().toBuffer();
    const feather = Math.max(8, Math.round(Math.min(bw, bh) * 0.02));
    return sharp(bg).composite([{ input: await feathered(fg, sides, feather), gravity: 'center' }]).png().toBuffer();
  } catch {
    return padded;
  }
}

/**
 * An anchor frame shaped like the video (9:16 / 16:9). Veo pads a photo of another shape with black bars (and then
 * animates them — a camera-app screen appeared on production). A small difference is cropped (the subject kept by
 * sharp's attention strategy); when a crop would cut more than 15 % of the product, the photo sits whole on its own
 * plain background colour, or on an AI continuation of its scene (`opts.extend`), or a soft, blurred copy of itself.
 * With a square / 4:5 final `format` (a centre crop after generation) the photo is fitted into that centre box, so a
 * tall product is never cut by the crop (a statue lost its head and base on production).
 */
export async function fitToAspect(m: VideoMedia, aspect: '9:16' | '16:9', format?: string, opts: { extend?: FrameExtender } = {}): Promise<VideoMedia> {
  const [W, H] = aspect === '9:16' ? [1080, 1920] : [1920, 1080];
  const [bw, bh] = format === '1:1' ? [Math.min(W, H), Math.min(W, H)] : format === '4:5' ? (aspect === '9:16' ? [1080, 1350] : [864, 1080]) : [W, H];
  try {
    const buf = await sharp(Buffer.from(m.data, 'base64')).rotate().toBuffer();
    const box = await fitBox(buf, bw, bh, opts.extend);
    let out: Buffer;
    if (bw === W && bh === H) out = await sharp(box).jpeg({ quality: 92 }).toBuffer();
    else {
      // The part outside the crop box only feeds Veo (it is cropped away): continue the box's own edges.
      const edge = await plainEdgeColour(box, W > bw ? 'vertical' : 'horizontal');
      const bg = edge
        ? await sharp({ create: { width: W, height: H, channels: 3, background: edge } }).png().toBuffer()
        : await sharp(box).resize(W, H, { fit: 'cover' }).blur(40).modulate({ brightness: 1.03 }).toBuffer();
      out = await sharp(bg).composite([{ input: box, gravity: 'center' }]).jpeg({ quality: 92 }).toBuffer();
    }
    return { data: out.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return m;
  }
}
