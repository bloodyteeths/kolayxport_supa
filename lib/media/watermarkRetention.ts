// lib/media/watermarkRetention.ts — retention of watermark originals (Orchestrator decision 24 Oct). SERVER ONLY.
//   - An original is kept 180 days after the last watermark on its slot (WatermarkOriginal.updatedAt).
//   - At most 1 GB of originals per account: over that, the oldest slots go first.
//   - Files no row points at are removed.
// Plus the disk guard: above 90 % use, new watermark jobs pause (sending to the marketplace is never affected).
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { WATERMARK_UPLOAD_ROOT } from '@/lib/media/watermarkLogos';

export const ORIGINAL_RETENTION_DAYS = 180;
export const ORIGINALS_CAP_BYTES = 1024 * 1024 * 1024;
export const DISK_PAUSE_RATIO = 0.9;

const DAY = 86_400_000;
const userDir = (userId: string) => path.join(WATERMARK_UPLOAD_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''), 'originals');

/** When an original stored now / last watermarked at `at` will be purged. Pure. */
export const originalKeptUntil = (at: Date) => new Date(at.getTime() + ORIGINAL_RETENTION_DAYS * DAY);

/** Disk use of the volume holding the uploads (0–1), or null when it cannot be read. */
export async function uploadDiskUse(): Promise<number | null> {
  try {
    await fs.promises.mkdir(WATERMARK_UPLOAD_ROOT, { recursive: true });
    const s = await fs.promises.statfs(WATERMARK_UPLOAD_ROOT);
    return s.blocks > 0 ? 1 - s.bavail / s.blocks : null;
  } catch {
    return null;
  }
}

/** Bytes of originals this account stores (files its rows point at, each counted once). */
export async function originalsUsage(userId: string): Promise<number> {
  const rows = await prisma.watermarkOriginal.findMany({ where: { userId }, select: { fileKey: true } });
  let total = 0;
  for (const key of new Set(rows.map((r) => r.fileKey))) {
    const st = await fs.promises.stat(path.join(userDir(userId), key)).catch(() => null);
    total += st?.size ?? 0;
  }
  return total;
}

export type PurgeUserReport = { userId: string; expiredRows: number; overCapRows: number; files: number; bytes: number };

/**
 * Plans the purge, and applies it unless `dryRun`. Reports per account (counts and bytes; never file names).
 * Order: rows past the 180-day window, then the oldest rows over the 1 GB cap, then files no remaining row points at.
 */
export async function purgeWatermarkOriginals(opts: { now?: Date; dryRun?: boolean } = {}): Promise<{ dryRun: boolean; users: PurgeUserReport[]; totals: Omit<PurgeUserReport, 'userId'> }> {
  const now = opts.now ?? new Date();
  const dryRun = Boolean(opts.dryRun);
  const cutoff = new Date(now.getTime() - ORIGINAL_RETENTION_DAYS * DAY);
  const users = await prisma.watermarkOriginal.findMany({ distinct: ['userId'], select: { userId: true } });
  const dirs = await fs.promises.readdir(WATERMARK_UPLOAD_ROOT).catch(() => [] as string[]);
  const reports: PurgeUserReport[] = [];
  for (const userId of new Set([...users.map((u) => u.userId), ...dirs])) {
    const rows = await prisma.watermarkOriginal.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, select: { id: true, fileKey: true, updatedAt: true } });
    const expired = rows.filter((r) => r.updatedAt < cutoff);
    const live = rows.filter((r) => r.updatedAt >= cutoff);
    // Newest first: keep slots while the account's distinct files fit under the cap.
    const size = async (key: string) => (await fs.promises.stat(path.join(userDir(userId), key)).catch(() => null))?.size ?? 0;
    const kept = new Map<string, boolean>();
    let total = 0;
    const overCap: string[] = [];
    for (const r of live) {
      if (!kept.has(r.fileKey)) {
        const sz = await size(r.fileKey);
        const fits = total + sz <= ORIGINALS_CAP_BYTES;
        kept.set(r.fileKey, fits);
        if (fits) total += sz;
      }
      if (!kept.get(r.fileKey)) overCap.push(r.id);
    }
    const keepKeys = new Set(live.filter((r) => !overCap.includes(r.id)).map((r) => r.fileKey));
    const onDisk = await fs.promises.readdir(userDir(userId)).catch(() => [] as string[]);
    const orphan = onDisk.filter((f) => !keepKeys.has(f));
    let bytes = 0;
    for (const f of orphan) bytes += await size(f);
    if (!dryRun) {
      const ids = [...expired.map((r) => r.id), ...overCap];
      if (ids.length) await prisma.watermarkOriginal.deleteMany({ where: { id: { in: ids } } });
      for (const f of orphan) await fs.promises.rm(path.join(userDir(userId), f), { force: true });
    }
    if (expired.length || overCap.length || orphan.length) reports.push({ userId, expiredRows: expired.length, overCapRows: overCap.length, files: orphan.length, bytes });
  }
  const totals = reports.reduce((t, r) => ({ expiredRows: t.expiredRows + r.expiredRows, overCapRows: t.overCapRows + r.overCapRows, files: t.files + r.files, bytes: t.bytes + r.bytes }), { expiredRows: 0, overCapRows: 0, files: 0, bytes: 0 });
  return { dryRun, users: reports, totals };
}
