import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { applyWatermark } from '@/lib/media/watermark';
import { markOrigin, normalizeWatermarkSpec } from '@/lib/media/watermarkSpec';

const photo = (fmt: 'jpeg' | 'png' = 'jpeg') =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a6ea5' } })[fmt]().toBuffer();
const pixel = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const changedIn = async (a: Buffer, b: Buffer, x0: number, y0: number, x1: number, y1: number) => {
  const A = await sharp(a).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).raw().toBuffer();
  let n = 0;
  for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x += 4) {
    const i = (y * A.info.width + x) * A.info.channels;
    if (Math.abs(A.data[i] - B[i]) + Math.abs(A.data[i + 1] - B[i + 1]) + Math.abs(A.data[i + 2] - B[i + 2]) > 30) n += 1;
  }
  return n;
};

describe('watermark spec', () => {
  it('clamps and validates', () => {
    expect(normalizeWatermarkSpec({ kind: 'text', text: '  @belle  ', position: 'br', sizePct: 500, opacityPct: -3, marginPct: 4 }))
      .toEqual({ kind: 'text', text: '@belle', color: '#ffffff', position: 'br', sizePct: 60, opacityPct: 10, marginPct: 4 });
    expect(normalizeWatermarkSpec({ kind: 'text', text: '   ' })).toBeNull();
    expect(normalizeWatermarkSpec({ kind: 'logo', logoId: '../etc/passwd' })).toBeNull();
    expect(normalizeWatermarkSpec({ kind: 'logo', logoId: 'a'.repeat(32), position: 'nope' })?.position).toBe('br');
  });
  it('places marks on the nine points inside the image', () => {
    expect(markOrigin('tl', 800, 600, 100, 50, 10)).toEqual({ left: 10, top: 10 });
    expect(markOrigin('br', 800, 600, 100, 50, 10)).toEqual({ left: 690, top: 540 });
    expect(markOrigin('c', 800, 600, 100, 50, 10)).toEqual({ left: 350, top: 275 });
    expect(markOrigin('tr', 80, 60, 100, 50, 10)).toEqual({ left: 0, top: 10 });
  });
});

describe('applyWatermark', () => {
  it('text at bottom-right changes only that corner, keeps size and format', async () => {
    const src = await photo();
    const spec = normalizeWatermarkSpec({ kind: 'text', text: 'BelleCouture', position: 'br', sizePct: 30, opacityPct: 90, marginPct: 4 })!;
    const out = await applyWatermark(src, spec);
    expect(out.mimeType).toBe('image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([800, 600]);
    expect(await changedIn(src, out.data, 500, 450, 800, 600)).toBeGreaterThan(20);
    expect(await changedIn(src, out.data, 0, 0, 300, 300)).toBe(0);
  }, 30_000);
  it('a logo at 50% opacity blends instead of covering', async () => {
    const src = await photo('png');
    const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const spec = normalizeWatermarkSpec({ kind: 'logo', logoId: 'b'.repeat(32), position: 'c', sizePct: 25, opacityPct: 50, marginPct: 0 })!;
    const out = await applyWatermark(src, spec, logo);
    expect(out.mimeType).toBe('image/png');
    const [r, g, b] = await pixel(out.data, 400, 300);
    expect(r).toBeGreaterThan(0x3a + 40); // lighter than the photo…
    expect(r).toBeLessThan(250); // …but not pure white
    expect(g).toBeGreaterThan(0x6e); expect(b).toBeGreaterThan(0xa5);
  }, 30_000);
  it('tiled marks spread across the photo', async () => {
    const src = await photo();
    const spec = normalizeWatermarkSpec({ kind: 'text', text: 'SAMPLE', position: 'tile', sizePct: 15, opacityPct: 70, marginPct: 2 })!;
    const out = await applyWatermark(src, spec);
    expect(await changedIn(src, out.data, 0, 0, 400, 300)).toBeGreaterThan(5);
    expect(await changedIn(src, out.data, 400, 300, 800, 600)).toBeGreaterThan(5);
  }, 30_000);
});
