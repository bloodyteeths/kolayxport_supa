import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import * as draftService from '@/lib/etsy/draftService';

// Looked up by a non-constant key so bundlers do not statically resolve a
// missing export before BR-3 lands (webpack warns, Turbopack errors).
const BR3_EXPORT: string = ['listSyncedDrafts'].join('');
import { draftErrorResponse } from '@/lib/etsy/draftErrors';

// GET /api/etsy-drafts/history?shop_id&listing_id[&limit=3]   (listing-editor §7 "Recent sends", §7.1 G1)
// The last synced drafts of one listing, for the editor rail's "Last sent {date}".
// Read-only. Implementation is backend BR-3 `listSyncedDrafts(shopId, listingId, limit)`
// (import-only). BR-3 takes no userId, so shop ownership is asserted here first.
// Until BR-3 ships this route answers 200 { items: [], available: false } so the rail
// simply hides the line instead of erroring.

export interface SyncedDraftItem {
  id: string;
  /** ISO time the draft was sent to Etsy. */
  syncedAt: string;
  /** Field keys / sections that draft changed (for "Sent: title, price"). */
  changedKeys: string[];
}

export interface DraftHistoryResponse {
  items: SyncedDraftItem[];
  /** false while backend BR-3 is not deployed. */
  available: boolean;
}

type ListSyncedDrafts = (shopId: string, listingId: bigint, limit: number) => Promise<unknown[]>;

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

export function parseLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Pure shaping of BR-3 rows (exported for tests): drops rows without a valid syncedAt, newest first. */
export function shapeHistory(rows: unknown[], limit: number): SyncedDraftItem[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const row = (r ?? {}) as { id?: unknown; syncedAt?: unknown; changedKeys?: unknown };
      const syncedAt = iso(row.syncedAt);
      if (!syncedAt || row.id == null) return null;
      const changedKeys = Array.isArray(row.changedKeys) ? row.changedKeys.filter((k): k is string => typeof k === 'string') : [];
      return { id: String(row.id), syncedAt, changedKeys };
    })
    .filter((x): x is SyncedDraftItem => x !== null)
    .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
    .slice(0, limit);
}

function resolveImpl(): ListSyncedDrafts | null {
  const fn = Reflect.get(draftService, BR3_EXPORT) as unknown;
  return typeof fn === 'function' ? (fn as ListSyncedDrafts) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const shopId = String(req.query.shop_id || '');
  const rawListingId = String(req.query.listing_id || '');
  if (!shopId || !rawListingId) return res.status(400).json({ error: 'shop_id and listing_id are required' });
  if (!/^\d{1,20}$/.test(rawListingId)) {
    return res.status(400).json({ error: 'Invalid listing id', code: 'INVALID_LISTING_ID', key: 'draftSync.invalidListingId' });
  }
  const limit = parseLimit(req.query.limit);

  try {
    await draftService.assertShopOwnership(user.id, shopId);
    res.setHeader('Cache-Control', 'private, no-store');
    const listSyncedDrafts = resolveImpl();
    if (!listSyncedDrafts) {
      const empty: DraftHistoryResponse = { items: [], available: false };
      return res.status(200).json(empty);
    }
    const rows = await listSyncedDrafts(shopId, BigInt(rawListingId), limit);
    const body: DraftHistoryResponse = { items: shapeHistory(rows, limit), available: true };
    return res.status(200).json(body);
  } catch (err: unknown) {
    const { status, body } = draftErrorResponse(err, 'Could not load send history');
    return res.status(status).json(body);
  }
}
