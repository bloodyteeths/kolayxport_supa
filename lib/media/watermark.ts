// lib/media/watermark.ts — applies a WatermarkSpec to one image with sharp. SERVER ONLY.
// Text is rendered as an SVG overlay (fontconfig fonts on the VPS: DejaVu / Liberation); a logo is resized to the
// mark width and its alpha scaled by the opacity. The output keeps the input format (JPEG q92 / PNG / WebP) and size.
import sharp from 'sharp';
import { markOrigin, type WatermarkSpec } from '@/lib/media/watermarkSpec';

export const WATERMARK_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_TILES = 240;

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

/** The mark as a PNG with transparency, `width` px wide. */
async function renderMark(spec: WatermarkSpec, width: number, maxHeight: number, logo?: Buffer | null): Promise<{ png: Buffer; w: number; h: number }> {
  const alpha = spec.opacityPct / 100;
  if (spec.kind === 'logo') {
    if (!logo) throw new Error('logo_missing');
    const resized = await sharp(logo).ensureAlpha().resize({ width, height: maxHeight, fit: 'inside', withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
    // Scale the logo's own alpha by the opacity (dest-in with a 1×1 white pixel of that alpha, tiled).
    const png = await sharp(resized.data)
      .composite([{ input: Buffer.from([255, 255, 255, Math.round(255 * alpha)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
      .png()
      .toBuffer();
    return { png, w: resized.info.width, h: resized.info.height };
  }
  const text = spec.text ?? '';
  // Rough width per character at font-size 1 (sans, mixed case); the SVG is then trimmed to the real text box.
  const fontSize = Math.max(8, Math.min(maxHeight * 0.8, width / Math.max(1, text.length * 0.56)));
  const h = Math.ceil(fontSize * 1.35);
  const stroke = Math.max(1, fontSize * 0.04);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width * 1.3)}" height="${h}">
<text x="50%" y="${Math.round(fontSize * 1.02)}" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize.toFixed(1)}"
 fill="${spec.color ?? '#ffffff'}" fill-opacity="${alpha}" stroke="#000000" stroke-opacity="${(alpha * 0.35).toFixed(2)}" stroke-width="${stroke.toFixed(1)}" paint-order="stroke">${escapeXml(text)}</text></svg>`;
  const out = await sharp(Buffer.from(svg)).png().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  return { png: out.data, w: out.info.width, h: out.info.height };
}

/** Watermarks one image. Throws on unreadable input. */
export async function applyWatermark(image: Buffer, spec: WatermarkSpec, logo?: Buffer | null): Promise<{ data: Buffer; mimeType: string }> {
  if (image.length > WATERMARK_MAX_INPUT_BYTES) throw new Error('image_too_large');
  const base = sharp(image, { limitInputPixels: 60_000_000 }).rotate(); // apply EXIF orientation first
  const meta = await base.metadata();
  const oriented = await base.toBuffer({ resolveWithObject: true });
  const W = oriented.info.width;
  const H = oriented.info.height;
  if (!W || !H) throw new Error('image_unreadable');
  const markW = Math.max(8, Math.round((W * spec.sizePct) / 100));
  let mark = await renderMark(spec, Math.min(markW, W), Math.round(H * (spec.position === 'tile' ? 0.35 : 0.6)), logo);
  if (mark.w > W || mark.h > H) {
    // sharp refuses an overlay larger than the base image: shrink the mark to fit.
    const r = await sharp(mark.png).resize({ width: W, height: H, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    mark = { png: r.data, w: r.info.width, h: r.info.height };
  }
  const margin = Math.round((Math.min(W, H) * spec.marginPct) / 100);

  const layers: sharp.OverlayOptions[] = [];
  if (spec.position === 'tile') {
    const gapX = Math.max(mark.w * 0.6, 24);
    const gapY = Math.max(mark.h * 1.6, 24);
    let row = 0;
    for (let y = margin; y < H && layers.length < MAX_TILES; y += mark.h + gapY, row += 1) {
      const shift = row % 2 ? (mark.w + gapX) / 2 : 0;
      for (let x = margin - shift; x < W && layers.length < MAX_TILES; x += mark.w + gapX) {
        if (x + mark.w <= 0 || y + mark.h > H || x < 0 || x + mark.w > W) continue;
        layers.push({ input: mark.png, left: Math.round(x), top: Math.round(y) });
      }
    }
  } else {
    layers.push({ input: mark.png, ...markOrigin(spec.position, W, H, mark.w, mark.h, margin) });
  }

  const out = sharp(oriented.data).composite(layers);
  const fmt = meta.format;
  if (fmt === 'png') return { data: await out.png().toBuffer(), mimeType: 'image/png' };
  if (fmt === 'webp') return { data: await out.webp({ quality: 92 }).toBuffer(), mimeType: 'image/webp' };
  return { data: await out.jpeg({ quality: 92, mozjpeg: true }).toBuffer(), mimeType: 'image/jpeg' };
}
