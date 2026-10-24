// lib/media/watermarkLogos.ts — sellers' watermark logos on the VPS filesystem. SERVER ONLY.
// uploads/watermarks/<userId>/<id>.png; the id is the content hash, so the same logo is stored once. Normalised to a
// PNG at most 1200 px wide on upload. Read back only for the owner.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

export const WATERMARK_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** PNG, JPEG or WebP by magic bytes (never SVG or anything sharp could otherwise decode). Pure. */
export function rasterImageType(b: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export const WATERMARK_UPLOAD_ROOT = path.resolve(process.env.WATERMARK_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'watermarks'));
const root = () => WATERMARK_UPLOAD_ROOT;
const safeUser = (userId: string) => userId.replace(/[^a-zA-Z0-9_-]/g, '');

export async function saveWatermarkLogo(userId: string, bytes: Buffer): Promise<{ id: string; width: number; height: number }> {
  if (!bytes.length || bytes.length > WATERMARK_LOGO_MAX_BYTES) throw new Error('logo_size');
  const type = rasterImageType(bytes);
  if (!type) throw new Error('logo_type');
  const png = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().ensureAlpha().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const id = crypto.createHash('sha256').update(png.data).digest('hex').slice(0, 32);
  const dir = path.join(root(), safeUser(userId));
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, `${id}.png`), png.data);
  return { id, width: png.info.width, height: png.info.height };
}

export async function readWatermarkLogo(userId: string, id: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{16,64}$/.test(id)) return null;
  return fs.promises.readFile(path.join(root(), safeUser(userId), `${id}.png`)).catch(() => null);
}
