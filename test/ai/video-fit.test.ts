import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fitToAspect } from '@/lib/ai/videoSources';

async function photo(bg: { r: number; g: number; b: number }, w: number, h: number) {
  const subject = await sharp({ create: { width: Math.round(w * 0.4), height: Math.round(h * 0.8), channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer();
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite([{ input: subject, gravity: 'center' }]).jpeg().toBuffer();
  return { data: buf.toString('base64'), mimeType: 'image/jpeg' };
}

describe('anchor frames shaped like the video', () => {
  it('a portrait studio photo in a landscape frame is extended with its own white, not a blurred copy', async () => {
    const out = await fitToAspect(await photo({ r: 250, g: 250, b: 250 }, 600, 900), '16:9');
    const img = sharp(Buffer.from(out.data, 'base64'));
    const meta = await img.metadata();
    expect([meta.width, meta.height]).toEqual([1920, 1080]);
    // stats() reads its own input: cut the strip out first.
    const strip = await sharp(Buffer.from(out.data, 'base64')).extract({ left: 0, top: 0, width: 200, height: 1080 }).png().toBuffer();
    const left = await sharp(strip).stats();
    expect(left.channels[0].mean).toBeGreaterThan(240);
    expect(left.channels[0].stdev).toBeLessThan(4);
  });
  it('a near match is cropped to the frame', async () => {
    const out = await fitToAspect(await photo({ r: 200, g: 120, b: 120 }, 1000, 1700), '9:16');
    const meta = await sharp(Buffer.from(out.data, 'base64')).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
  });
});
