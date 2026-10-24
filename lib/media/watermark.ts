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
  const trimmed = await sharp(Buffer.from(svg)).png().trim({ threshold: 1 }).toBuffer();
  // Exactly `width` wide (capped by maxHeight): the mark's footprint must not depend on the font installed, and the
  // browser preview (components/domain/media/WatermarkPreview.tsx) scales its text the same way.
  const out = await sharp(trimmed).resize({ width, height: Math.max(1, Math.round(maxHeight)), fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  return { png: out.data, w: out.info.width, h: out.info.height };
}

/** Watermarks one image. Throws on unreadable input. */
export async function applyWatermark(image: Buffer, spec: WatermarkSpec, logo?: Buffer | null): Promise<{ data: Buffer; mimeType: string; box: [number, number, number, number] }> {
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

  // Where the mark sits (fractions of the image): the restore guard compares that region.
  const xs = layers.map((l) => [l.left as number, (l.left as number) + mark.w]);
  const ys = layers.map((l) => [l.top as number, (l.top as number) + mark.h]);
  const box: [number, number, number, number] = layers.length
    ? [Math.min(...xs.map((v) => v[0])) / W, Math.min(...ys.map((v) => v[0])) / H, Math.min(W, Math.max(...xs.map((v) => v[1]))) / W, Math.min(H, Math.max(...ys.map((v) => v[1]))) / H]
    : [0, 0, 1, 1];
  const out = sharp(oriented.data).composite(layers);
  const fmt = meta.format;
  if (fmt === 'png') return { data: await out.png().toBuffer(), mimeType: 'image/png', box };
  if (fmt === 'webp') return { data: await out.webp({ quality: 92 }).toBuffer(), mimeType: 'image/webp', box };
  return { data: await out.jpeg({ quality: 92, mozjpeg: true }).toBuffer(), mimeType: 'image/jpeg', box };
}

// ── Restore guard: signature of the photo we placed ─────────────────────────────────────────────────────────────
// A whole-photo 16×16 grey thumbnail AND a 16×16 thumbnail of the region our mark covers (found by diffing the
// output against the source). A candidate is "the photo we placed" only when both are close: the same picture
// (survives the marketplace's re-compression and resizing) still carrying our mark. A different photo, or the same
// photo without our mark, does not match, so restore never overwrites a photo we did not put there.
const SIG = 16;
export const SIG_MAX_MAD = { whole: 10, mark: 14 } as const;

const SIG_MARK = 32;

async function grey(image: Buffer, box?: [number, number, number, number], size = SIG): Promise<Buffer> {
  let img = sharp(image).rotate();
  if (box) {
    const m = await sharp(image).rotate().metadata();
    const W = m.width ?? 1, H = m.height ?? 1;
    const left = Math.floor(box[0] * W), top = Math.floor(box[1] * H);
    img = img.extract({ left, top, width: Math.max(1, Math.min(W - left, Math.ceil((box[2] - box[0]) * W))), height: Math.max(1, Math.min(H - top, Math.ceil((box[3] - box[1]) * H))) });
  }
  return img.greyscale().resize(size, size, { fit: 'fill' }).raw().toBuffer();
}

/** Region (0–1 fractions) where output differs from source, padded; whole image when nothing differs. */
async function markBox(source: Buffer, output: Buffer): Promise<[number, number, number, number]> {
  const w = 256;
  const a = await sharp(source).rotate().greyscale().resize(w, w, { fit: 'fill' }).raw().toBuffer();
  const b = await sharp(output).rotate().greyscale().resize(w, w, { fit: 'fill' }).raw().toBuffer();
  let x0 = w, y0 = w, x1 = -1, y1 = -1;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    if (Math.abs(a[y * w + x] - b[y * w + x]) > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) return [0, 0, 1, 1];
  const pad = 4;
  return [Math.max(0, x0 - pad) / w, Math.max(0, y0 - pad) / w, Math.min(w, x1 + 1 + pad) / w, Math.min(w, y1 + 1 + pad) / w];
}

/** Signature of the watermarked photo we place (stored as WatermarkOriginal.markHash). */
export async function markSignature(source: Buffer, output: Buffer, placedBox?: [number, number, number, number]): Promise<string> {
  const box = placedBox ?? (await markBox(source, output));
  const [whole, mark, unmarked] = await Promise.all([grey(output), grey(output, box, SIG_MARK), grey(source, box, SIG_MARK)]);
  return JSON.stringify({ v: 3, box: box.map((n) => Number(n.toFixed(4))), g: whole.toString('base64'), m: mark.toString('base64'), o: unmarked.toString('base64') });
}

const mad = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

/** Is `candidate` the photo we placed? Malformed / missing signature → false (never restore blind). */
export async function matchesSignature(signature: string | null | undefined, candidate: Buffer): Promise<{ ok: boolean; whole: number; mark: number }> {
  try {
    const sig = JSON.parse(signature ?? '') as { v?: number; box?: number[]; g?: string; m?: string; o?: string };
    if (sig.v !== 3 || !Array.isArray(sig.box) || sig.box.length !== 4 || !sig.g || !sig.m || !sig.o) return { ok: false, whole: 255, mark: 255 };
    const box = sig.box as [number, number, number, number];
    const [whole, mark] = await Promise.all([grey(candidate), grey(candidate, box, SIG_MARK)]);
    const w = mad(whole, Buffer.from(sig.g, 'base64'));
    const m = mad(mark, Buffer.from(sig.m, 'base64'));
    const o = mad(mark, Buffer.from(sig.o, 'base64'));
    // Same picture, and (when our mark visibly changed its region) that region is clearly the marked one, not the
    // unmarked original. A mark too faint to measure only needs the same picture: restoring then cannot overwrite
    // anything but a visually identical photo.
    const markVisible = mad(Buffer.from(sig.m, 'base64'), Buffer.from(sig.o, 'base64')) >= 8;
    const markOk = !markVisible || (m <= SIG_MAX_MAD.mark && m < o * 0.75);
    return { ok: w <= SIG_MAX_MAD.whole && markOk, whole: w, mark: m };
  } catch {
    return { ok: false, whole: 255, mark: 255 };
  }
}
