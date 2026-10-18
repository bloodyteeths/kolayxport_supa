// GET /api/listings — the one list API for all five marketplaces (listings-grid §9.1, M5 G1).
// Reads only the DB caches and the draft tables; never calls a marketplace (pull stays on the existing
// `sync_listings` / `?action=sync` endpoints). Query + response: lib/listings/types.ts.
import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { listListings, ListingsQueryError, type ListingsAdapter } from '@/lib/listings/query';
import { parseListingsQuery, type ListingMarketplace, type ListingsErrorBody, type ListingsErrorCode, type ListingsQuery, type ListingsResponse } from '@/lib/listings/types';
import { etsyAdapter } from '@/lib/listings/adapters/etsy';
import { ebayAdapter } from '@/lib/listings/adapters/ebay';
import { trendyolAdapter } from '@/lib/listings/adapters/trendyol';
import { wixAdapter } from '@/lib/listings/adapters/wix';
import { shopifyAdapter } from '@/lib/listings/adapters/shopify';
import { hepsiburadaAdapter } from '@/lib/listings/adapters/hepsiburada';

export const LISTINGS_ADAPTERS: Record<ListingMarketplace, ListingsAdapter> = {
  etsy: etsyAdapter,
  ebay: ebayAdapter,
  trendyol: trendyolAdapter,
  wix: wixAdapter,
  shopify: shopifyAdapter,
  hepsiburada: hepsiburadaAdapter,
};

/** `?ids=` on the list endpoint: at most one page. */
export const MAX_LIST_IDS = 250;

/** `ids=a,b,c` → unique trimmed ids (null when absent). */
export function parseIds(raw: string | string[] | undefined, max: number): string[] | null {
  if (raw === undefined) return null;
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set(parts)).slice(0, max);
}

export function sendListingsError(res: NextApiResponse, status: number, error: ListingsErrorCode, message?: string, errorId?: string): void {
  const body: ListingsErrorBody = { error, ...(message ? { message } : {}), ...(errorId ? { errorId } : {}) };
  res.status(status).json(body);
}

/** Shared auth + parse for the three listings endpoints. Returns null after it has answered. */
export async function prepareListingsRequest(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ userId: string; query: ListingsQuery; adapter: ListingsAdapter } | null> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendListingsError(res, 405, 'bad_request', 'GET only');
    return null;
  }
  const user = await getAuthUser(req, res);
  if (!user) {
    sendListingsError(res, 401, 'unauthorized');
    return null;
  }
  const parsed = parseListingsQuery(req.query);
  if (!parsed.ok) {
    sendListingsError(res, 400, 'bad_request', parsed.message);
    return null;
  }
  return { userId: user.id, query: parsed.query, adapter: LISTINGS_ADAPTERS[parsed.query.marketplace] };
}

/** Maps a thrown error to the documented error body (server errors carry an `errorId` that is logged). */
export function handleListingsError(res: NextApiResponse, err: unknown, where: string, userId?: string): void {
  if (err instanceof ListingsQueryError) {
    sendListingsError(res, err.status, err.code);
    return;
  }
  const errorId = randomUUID();
  void logger.error(`${where} failed`, err instanceof Error ? err : new Error(String(err)), { errorId, userId });
  sendListingsError(res, 500, 'server_error', undefined, errorId);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ListingsResponse | ListingsErrorBody>) {
  const ready = await prepareListingsRequest(req, res);
  if (!ready) return;
  const { userId, query, adapter } = ready;
  try {
    const ids = parseIds(req.query.ids, MAX_LIST_IDS);
    const body = await listListings(prisma, adapter, userId, query, ids ? { ids } : {});
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json(body);
  } catch (err) {
    handleListingsError(res, err, 'GET /api/listings', userId);
  }
}
