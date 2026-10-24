import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

vi.mock('@/lib/prisma', () => ({ default: {} }));

describe('watermark logo upload', () => {
  it('accepts PNG / JPEG / WebP by magic bytes only; SVG is refused even when labelled as PNG', async () => {
    const { rasterImageType, saveWatermarkLogo } = await import('@/lib/media/watermarkLogos');
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#fff' } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).webp().toBuffer();
    expect([rasterImageType(png), rasterImageType(jpg), rasterImageType(webp)]).toEqual(['png', 'jpeg', 'webp']);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><image href="file:///etc/passwd"/></svg>');
    expect(rasterImageType(svg)).toBeNull();
    await expect(saveWatermarkLogo('u1', svg)).rejects.toThrow('logo_type');
    await expect(saveWatermarkLogo('u1', Buffer.alloc(3 * 1024 * 1024, 1))).rejects.toThrow('logo_size');
  });
});

describe('ownImage public/ branch', () => {
  const link = path.join(process.cwd(), 'public', '__wm-test-link.jpg');
  afterAll(() => { try { fs.unlinkSync(link); } catch { /* none */ } });
  it('never reads outside public/: "..", encoded "..", non-images, symlinks', async () => {
    const { loadImageForUser } = await import('@/lib/images/ownImage');
    for (const u of ['/../../.env', '/%2e%2e/%2e%2e/.env', '/demo/../../.env.jpg', '/..%2f..%2f.env.jpg', '/.env']) {
      expect(await loadImageForUser('u1', u), u).toBeNull();
    }
    fs.symlinkSync(path.join(process.cwd(), 'package.json'), link);
    expect(await loadImageForUser('u1', '/__wm-test-link.jpg')).toBeNull();
  });
});

describe('Etsy templates DELETE cannot touch watermark presets', () => {
  it('looks the row up with marketplace etsy', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'pages/api/editor-templates/index.ts'), 'utf8');
    expect(src).toContain("findFirst({ where: { id, userId, marketplace: MARKETPLACE } })");
  });
});

describe('watermark origin (listing + slot)', () => {
  it('accepts only known marketplaces, safe ids and real slots', async () => {
    const { normalizeOrigin } = await import('@/lib/media/watermarkOriginals');
    expect(normalizeOrigin({ marketplace: 'etsy', listingId: '1790001234', rank: 2 })).toEqual({ marketplace: 'etsy', listingId: '1790001234', rank: 2 });
    expect(normalizeOrigin({ marketplace: 'amazon', listingId: '1', rank: 1 })).toBeNull();
    expect(normalizeOrigin({ marketplace: 'etsy', listingId: '../x', rank: 1 })).toBeNull();
    expect(normalizeOrigin({ marketplace: 'etsy', listingId: '1', rank: 0 })).toBeNull();
  });
});
