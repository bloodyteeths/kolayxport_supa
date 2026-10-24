// lib/media/watermarkOriginals.ts — full-resolution originals of watermarked photos. SERVER ONLY.
// File: uploads/watermarks/<userId>/originals/<sha256-32>.<ext> (content-addressed, stored once). Row:
// WatermarkOriginal (listing + slot it came from). Re-watermarking a slot starts from its stored original, never from
// the already-watermarked photo; "Filigranı kaldır" stages the stored original back into the slot.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { WATERMARK_UPLOAD_ROOT } from '@/lib/media/watermarkLogos';
import type { WatermarkSpec } from '@/lib/media/watermarkSpec';
import type { Prisma } from '@prisma/client';

export const WATERMARK_MARKETPLACES = ['etsy', 'ebay', 'shopify', 'wix', 'trendyol'] as const;
export type WatermarkMarketplace = (typeof WATERMARK_MARKETPLACES)[number];
export type WatermarkOrigin = { marketplace: WatermarkMarketplace; listingId: string; rank: number };

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const dir = (userId: string) => path.join(WATERMARK_UPLOAD_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''), 'originals');

/** Validates a client-sent origin; null when absent or malformed. Pure. */
export function normalizeOrigin(raw: unknown): WatermarkOrigin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const marketplace = (WATERMARK_MARKETPLACES as readonly string[]).includes(String(r.marketplace)) ? (r.marketplace as WatermarkMarketplace) : null;
  const listingId = typeof r.listingId === 'string' || typeof r.listingId === 'number' ? String(r.listingId).slice(0, 64) : '';
  const rank = typeof r.rank === 'number' && Number.isInteger(r.rank) && r.rank >= 1 && r.rank <= 50 ? r.rank : null;
  return marketplace && /^[\w-]+$/.test(listingId) && rank ? { marketplace, listingId, rank } : null;
}

/** The stored original of this slot (latest), if the slot was watermarked before. */
export async function findOriginal(userId: string, origin: WatermarkOrigin) {
  return prisma.watermarkOriginal.findFirst({
    where: { userId, marketplace: origin.marketplace, listingId: origin.listingId, rank: origin.rank },
    orderBy: { createdAt: 'desc' },
  });
}

export async function readOriginalFile(userId: string, fileKey: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(fileKey)) return null;
  return fs.promises.readFile(path.join(dir(userId), fileKey)).catch(() => null);
}

/** Stores the original (once per content) and records the slot it belongs to. */
export async function archiveOriginal(userId: string, origin: WatermarkOrigin, bytes: Buffer, mimeType: string, spec: WatermarkSpec, markHash: string) {
  const ext = EXT[mimeType] ?? 'jpg';
  const fileKey = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
  await fs.promises.mkdir(dir(userId), { recursive: true });
  const abs = path.join(dir(userId), fileKey);
  if (!(await fs.promises.stat(abs).catch(() => null))) await fs.promises.writeFile(abs, bytes);
  return prisma.watermarkOriginal.create({
    data: { userId, ...origin, fileKey, contentType: EXT[mimeType] ? mimeType : 'image/jpeg', spec: spec as unknown as Prisma.InputJsonValue, markHash },
  });
}

/** Re-applied to a slot: the stored original stays; the mark we placed now is this one. */
export async function updateMark(id: string, spec: WatermarkSpec, markHash: string) {
  return prisma.watermarkOriginal.update({ where: { id }, data: { spec: spec as unknown as Prisma.InputJsonValue, markHash } });
}
