// lib/ai/videoSources.ts — the Video Studio's product photos (SERVER ONLY): listing photos (https) and the seller's
// own uploads / frames taken from their dress videos / AI keyframes (`upload:<hex>`, stored per user on the VPS).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { isUnsafeUrl } from './safeUrl';
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
