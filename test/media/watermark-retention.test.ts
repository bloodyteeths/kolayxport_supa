import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

type Row = { id: string; userId: string; fileKey: string; updatedAt: Date };
let rows: Row[] = [];
vi.mock('@/lib/prisma', () => ({
  default: {
    watermarkOriginal: {
      findMany: async ({ where, distinct, orderBy }: any = {}) => {
        let r = rows.filter((x) => !where?.userId || x.userId === where.userId);
        if (orderBy?.updatedAt === 'desc') r = [...r].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        if (distinct) r = r.filter((x, i, a) => a.findIndex((y) => y.userId === x.userId) === i);
        return r;
      },
      deleteMany: async ({ where }: any) => { const before = rows.length; rows = rows.filter((x) => !where.id.in.includes(x.id)); return { count: before - rows.length }; },
    },
  },
}));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ret-'));
process.env.WATERMARK_UPLOAD_DIR = root;
const NOW = new Date('2026-10-24T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const put = (user: string, key: string, bytes: number) => {
  fs.mkdirSync(path.join(root, user, 'originals'), { recursive: true });
  fs.writeFileSync(path.join(root, user, 'originals', key), Buffer.alloc(bytes, 1));
};

describe('watermark originals retention', () => {
  beforeEach(() => {
    rows = [];
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  });
  it('removes slots past 180 days and orphan files; dry run changes nothing but reports the same', async () => {
    const { purgeWatermarkOriginals } = await import('@/lib/media/watermarkRetention');
    put('u1', 'a'.repeat(32) + '.jpg', 1000); put('u1', 'b'.repeat(32) + '.jpg', 2000); put('u1', 'c'.repeat(32) + '.jpg', 500);
    rows = [
      { id: 'r1', userId: 'u1', fileKey: 'a'.repeat(32) + '.jpg', updatedAt: daysAgo(10) },
      { id: 'r2', userId: 'u1', fileKey: 'b'.repeat(32) + '.jpg', updatedAt: daysAgo(200) },
    ];
    const dry = await purgeWatermarkOriginals({ now: NOW, dryRun: true });
    expect(dry.users).toEqual([{ userId: 'u1', expiredRows: 1, overCapRows: 0, files: 2, bytes: 2500 }]);
    expect(rows).toHaveLength(2);
    expect(fs.readdirSync(path.join(root, 'u1', 'originals'))).toHaveLength(3);
    const real = await purgeWatermarkOriginals({ now: NOW });
    expect(real.totals).toEqual({ expiredRows: 1, overCapRows: 0, files: 2, bytes: 2500 });
    expect(rows.map((r) => r.id)).toEqual(['r1']);
    expect(fs.readdirSync(path.join(root, 'u1', 'originals'))).toEqual(['a'.repeat(32) + '.jpg']);
  });
  it('over the 1 GB cap the oldest slots go first', async () => {
    const mod = await import('@/lib/media/watermarkRetention');
    const spy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: any) => ({ size: String(p).includes('old') ? 600 * 1048576 : 500 * 1048576 }) as any);
    fs.mkdirSync(path.join(root, 'u2', 'originals'), { recursive: true });
    rows = [
      { id: 'new', userId: 'u2', fileKey: 'new.jpg', updatedAt: daysAgo(1) },
      { id: 'old', userId: 'u2', fileKey: 'old.jpg', updatedAt: daysAgo(20) },
    ];
    const r = await mod.purgeWatermarkOriginals({ now: NOW });
    spy.mockRestore();
    expect(r.users[0]).toMatchObject({ userId: 'u2', expiredRows: 0, overCapRows: 1 });
    expect(rows.map((x) => x.id)).toEqual(['new']);
  });
});
