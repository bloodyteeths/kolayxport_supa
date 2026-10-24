import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';

vi.mock('@/lib/prisma', () => ({ default: { watermarkOriginal: { findFirst: async () => null } } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/logger', () => ({ logger: { event: vi.fn() } }));
vi.mock('@/lib/images/ownImage', () => ({ loadImageForUser: async () => null }));

describe('disk guard', () => {
  it('above 90% a new watermark is refused (disk_full); a preview is not blocked by it', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ blocks: 100, bavail: 5 } as any);
    const { default: handler } = await import('@/pages/api/media/watermark');
    const call = async (body: unknown) => {
      let code = 0; let json: any = null;
      const res: any = { status: (c: number) => { code = c; return res; }, json: (j: unknown) => { json = j; return res; }, setHeader: () => res, send: () => res, end: () => res };
      await handler({ method: 'POST', body } as any, res);
      return { code, json };
    };
    const spec = { kind: 'text', text: 'x', position: 'br', sizePct: 20, opacityPct: 50, marginPct: 2 };
    expect(await call({ imageUrl: '/a.jpg', spec })).toEqual({ code: 507, json: { error: 'Storage is full', code: 'disk_full' } });
    expect((await call({ imageUrl: '/a.jpg', spec, preview: true })).code).toBe(422); // went on to read the photo
  });
});
