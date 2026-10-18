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

describe('square / 4:5 videos keep the whole product inside the crop', () => {
  it('a tall product photo for a square video sits inside the centre square of the 9:16 frame', async () => {
    const out = await fitToAspect(await photo({ r: 250, g: 250, b: 250 }, 400, 1000), '9:16', '1:1');
    const buf = Buffer.from(out.data, 'base64');
    expect((await sharp(buf).metadata()).height).toBe(1920);
    // The dark subject (80% of the photo height) must end inside the centre square (rows 420–1500), not above it.
    const strip = await sharp(buf).extract({ left: 520, top: 0, width: 40, height: 1920 }).raw().toBuffer();
    const rows = Array.from({ length: 1920 }, (_, y) => strip[y * 40 * 3]);
    const dark = rows.map((v, y) => (v < 100 ? y : -1)).filter((y) => y >= 0);
    expect(dark[0]).toBeGreaterThanOrEqual(420);
    expect(dark[dark.length - 1]).toBeLessThanOrEqual(1500);
  });
});

describe('the video shape follows the photo', () => {
  it('a tall 3:4 photo for Etsy becomes 4:5, a near-square one stays square', async () => {
    const { formatForPhoto, VIDEO_TARGET_PROFILES } = await import('@/lib/ai/videoTargets');
    expect(formatForPhoto(VIDEO_TARGET_PROFILES.etsy, 3 / 4)).toBe('4:5');
    expect(formatForPhoto(VIDEO_TARGET_PROFILES.etsy, 0.95)).toBe('1:1');
    expect(formatForPhoto(VIDEO_TARGET_PROFILES.etsy, 16 / 9)).toBe('16:9');
    // Wix has no 4:5: a tall photo goes square (padding is then continued by the AI, not blurred).
    expect(formatForPhoto(VIDEO_TARGET_PROFILES.wix, 3 / 4)).toBe('1:1');
    expect(formatForPhoto(VIDEO_TARGET_PROFILES.wix, 4 / 3)).toBe('16:9');
    expect(formatForPhoto(VIDEO_TARGET_PROFILES.ebay, null)).toBe('16:9');
  });
});

describe('padded sides continue the real scene', () => {
  it('a busy-background photo is handed to the extender and laid back over its result unchanged', async () => {
    // A photo with a noisy (non-plain) background: no plain colour to extend.
    const w = 600, h = 800;
    const noise = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
    const buf = await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
    let called = '';
    const green = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: { r: 0, g: 200, b: 0 } } }).png().toBuffer();
    const out = await fitToAspect({ data: buf.toString('base64'), mimeType: 'image/jpeg' }, '9:16', '1:1', {
      extend: async (_m, aspect) => { called = aspect; return { data: green.toString('base64'), mimeType: 'image/png' }; },
    });
    expect(called).toBe('1:1');
    const o = Buffer.from(out.data, 'base64');
    // Left side of the square (rows 420–1500 of the 9:16 frame): the extension (green), not a blurred copy.
    const side = await sharp(await sharp(o).extract({ left: 10, top: 700, width: 80, height: 400 }).png().toBuffer()).stats();
    expect(side.channels[1].mean).toBeGreaterThan(150);
    expect(side.channels[0].mean).toBeLessThan(60);
    // Centre: the photo itself (noisy), not green.
    const mid = await sharp(await sharp(o).extract({ left: 500, top: 900, width: 80, height: 80 }).png().toBuffer()).stats();
    expect(mid.channels[0].stdev).toBeGreaterThan(20);
  });
});
