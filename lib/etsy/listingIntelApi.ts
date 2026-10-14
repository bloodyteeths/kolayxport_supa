/**
 * Small shared helpers for the W3 listing-intel API routes (pages/api/etsy/*).
 */
import type { NextApiRequest } from 'next';
import prisma from '@/lib/prisma';

export function parseBigIntParam(v: unknown): bigint | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || !/^\d{1,20}$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

export function parseLimit(v: unknown, def = 30, max = 100): number {
  const n = Math.trunc(Number(Array.isArray(v) ? v[0] : v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

export function queryString(req: NextApiRequest, key: string): string {
  const v = req.query[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim() : '';
}

/** Active Etsy shop ids the user owns (optionally narrowed to one). */
export async function ownedShopIds(userId: string, shopId?: string): Promise<string[]> {
  const rows = await prisma.etsyShop.findMany({
    where: { userId, isActive: true, ...(shopId ? { shopId } : {}) },
    select: { shopId: true },
  });
  return rows.map((r) => r.shopId);
}

/** Opaque keyset cursor over (capturedAt desc, id desc). */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(raw: string): { at: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const at = new Date(iso);
    if (!id || Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export const VERSION_LIST_SELECT = {
  id: true,
  etsyShopId: true,
  etsyListingId: true,
  remoteUpdatedTs: true,
  capturedAt: true,
  source: true,
  attribution: true,
  draftId: true,
  batchKey: true,
  changedKeys: true,
  diff: true,
  state: true,
  isTombstone: true,
} as const;

export function serializeVersion(v: any) {
  const baseline = !v.isTombstone && Array.isArray(v.changedKeys) && v.changedKeys.length === 0;
  return {
    id: v.id,
    shopId: v.etsyShopId,
    listingId: String(v.etsyListingId),
    remoteUpdatedTs: v.remoteUpdatedTs,
    capturedAt: v.capturedAt instanceof Date ? v.capturedAt.toISOString() : v.capturedAt,
    source: v.source,
    attribution: v.attribution,
    draftId: v.draftId ?? null,
    batchKey: v.batchKey ?? null,
    changedKeys: v.changedKeys || [],
    diff: v.diff ?? {},
    state: v.state ?? null,
    isTombstone: !!v.isTombstone,
    baseline,
    restorable: !v.isTombstone,
  };
}
