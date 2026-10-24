// lib/media/watermarkLogos.ts — sellers' watermark logos on the VPS filesystem. SERVER ONLY.
// uploads/watermarks/<userId>/<id>.png; the id is the content hash, so the same logo is stored once. Normalised to a
// PNG at most 1200 px wide on upload. Read back only for the owner.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

export const WATERMARK_LOGO_MAX_BYTES = 3 * 1024 * 1024;
export const WATERMARK_UPLOAD_ROOT = path.resolve(process.env.WATERMARK_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'watermarks'));
const root = () => WATERMARK_UPLOAD_ROOT;
const safeUser = (userId: string) => userId.replace(/[^a-zA-Z0-9_-]/g, '');

export async function saveWatermarkLogo(userId: string, bytes: Buffer): Promise<{ id: string; width: number; height: number }> {
  if (!bytes.length || bytes.length > WATERMARK_LOGO_MAX_BYTES) throw new Error('logo_size');
  const png = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().ensureAlpha().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
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
