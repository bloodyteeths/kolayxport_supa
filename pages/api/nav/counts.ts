/**
 * GET /api/nav/counts — sidebar counters (shell-nav §9.1).
 *
 * 200 → NavCountsResponse (lib/nav/useNavCounts.ts):
 *   { orders: { toShip, overdue }, drafts: { etsy, ebay }, generatedAt }
 *
 * Session cookie only (no extension Bearer / API key). Private, never cached.
 * Cost: 1 raw COUNT query (both order counts via FILTER) + 2 Prisma counts.
 * "To ship" / "Overdue" come from lib/orders/views.ts, the one definition the
 * Orders page and Overview also use (CRITIQUE C4).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { TO_SHIP_COUNTS_SQL } from '@/lib/orders/views';
import type { NavCountsResponse } from '@/lib/nav/useNavCounts';

/** Draft statuses that mean "staged here, not on the marketplace yet". */
export const UNSENT_DRAFT_STATUSES = ['draft', 'failed', 'conflict'] as const;

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
      prisma.etsyListingDraft.count({ where: { userId: user.id, status } }),
      prisma.ebayListingDraft.count({ where: { userId: user.id, status } }),
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
