/**
 * Shared helpers for /api/stock/* (W2, T13). Server-only.
 * Every route is session-authenticated and user-scoped; ids from the client
 * are always re-checked against the user before use.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { computeLinkTarget } from './math';

export async function stockAuth(req: NextApiRequest, res: NextApiResponse, methods: string[]): Promise<string | null> {
  if (!methods.includes(String(req.method))) {
    res.setHeader('Allow', methods);
    res.status(405).json({ error: 'method_not_allowed' });
    return null;
  }
  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return user.id;
}

export function fail(res: NextApiResponse, status: number, code: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ error: code, ...extra });
}

export function serverError(res: NextApiResponse, route: string, err: unknown, userId?: string) {
  void Promise.resolve(
    logger.error(`stock api ${route} failed`, err instanceof Error ? err : new Error(String(err)), { userId }),
  ).catch(() => undefined);
  return res.status(500).json({ error: 'internal_error' });
}

export function qstr(v: unknown): string | undefined {
  if (Array.isArray(v)) return v[0] !== undefined ? String(v[0]) : undefined;
  return v === undefined || v === null ? undefined : String(v);
}

export function int(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function ownedItem(userId: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  return prisma.stockItem.findFirst({ where: { id, userId } });
}

export async function ownedLink(userId: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  return prisma.stockLink.findFirst({ where: { id, userId } });
}

/** JSON view of an item with links and current targets. */
export function serializeItem(item: any, extra: { openPushes?: number; lastError?: string | null } = {}) {
  return {
    id: item.id,
    sku: item.sku,
    displaySku: item.displaySku,
    title: item.title,
    imageUrl: item.imageUrl,
    onHand: item.onHand,
    safetyBuffer: item.safetyBuffer,
    tracking: item.tracking,
    status: item.status,
    seededAt: item.seededAt ? new Date(item.seededAt).toISOString() : null,
    updatedAt: new Date(item.updatedAt).toISOString(),
    openPushes: extra.openPushes ?? 0,
    lastError: extra.lastError ?? null,
    links: (item.links || []).map((l: any) => ({
      id: l.id,
      channel: l.channel,
      accountRef: l.accountRef,
      externalId: l.externalId,
      variantRef: l.variantRef,
      title: l.title,
      remoteSku: l.remoteSku,
      matchType: l.matchType,
      status: l.status,
      statusReason: l.statusReason,
      unitsPerSale: l.unitsPerSale,
      buffer: l.buffer,
      maxListedQty: l.maxListedQty,
      lastSeenRemoteQty: l.lastSeenRemoteQty,
      lastSeenAt: l.lastSeenAt ? new Date(l.lastSeenAt).toISOString() : null,
      lastPushedQty: l.lastPushedQty,
      lastPushedAt: l.lastPushedAt ? new Date(l.lastPushedAt).toISOString() : null,
      deactivatedByStock: l.deactivatedByStock,
      target: computeLinkTarget({ onHand: item.onHand, safetyBuffer: item.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty }),
    })),
  };
}
