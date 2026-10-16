/**
 * GET /api/nav/counts — sidebar counters (shell-nav §9.1).
 *
 * 200 → NavCountsResponse (lib/nav/useNavCounts.ts):
 *   { orders: { toShip, overdue }, drafts: { etsy, ebay }, generatedAt }
 *
 * Session cookie only (no extension Bearer / API key). Private, never cached.
 * Cost: 1 raw COUNT query (both order counts via FILTER) + 2 light draft reads (open drafts whose every change
 * was undone hold nothing to send and are not counted, lib/drafts/emptyDraft).
 * "To ship" / "Overdue" come from lib/orders/views.ts, the one definition the
 * Orders page and Overview also use (CRITIQUE C4).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { TO_SHIP_COUNTS_SQL } from '@/lib/orders/views';
import type { NavCountsResponse } from '@/lib/nav/useNavCounts';
import { emptyCheckSelect, isUncountedDraft, type DraftModelKind } from '@/lib/drafts/emptyDraft';

/** Draft statuses that mean "staged here, not on the marketplace yet". */
export const UNSENT_DRAFT_STATUSES = ['draft', 'failed', 'conflict'] as const;

/**
 * Unsent drafts that hold something to send (an open draft whose every change was undone is not counted, nor an
 * eBay draft of a listing created on eBay, which can never be sent from here).
 */
async function countNonEmpty(model: DraftModelKind, delegate: any, userId: string, status: unknown): Promise<number> {
  const rows: any[] = await delegate.findMany({ where: { userId, status }, select: { status: true, ...emptyCheckSelect(model, { scheduledSendAt: true }) } });
  return rows.filter((r) => !isUncountedDraft(model, r)).length;
}

function toCount(v: unknown): number {
  const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const status = { in: [...UNSENT_DRAFT_STATUSES] };
    const [orderRows, etsy, ebay] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ toShip: unknown; overdue: unknown }>>(TO_SHIP_COUNTS_SQL, user.id),
      countNonEmpty('EtsyListingDraft', prisma.etsyListingDraft, user.id, status),
      countNonEmpty('EbayListingDraft', prisma.ebayListingDraft, user.id, status),
    ]);
    const row = orderRows?.[0];
    const body: NavCountsResponse = {
      orders: { toShip: toCount(row?.toShip), overdue: toCount(row?.overdue) },
      drafts: { etsy: toCount(etsy), ebay: toCount(ebay) },
      generatedAt: new Date().toISOString(),
    };
    return res.status(200).json(body);
  } catch (error: any) {
    // Counters are decorations: the client hides them on error (shell-nav §5).
    console.error('[/api/nav/counts] failed', { userId: user.id, message: error?.message });
    return res.status(500).json({ error: 'Failed to load counts' });
  }
}
