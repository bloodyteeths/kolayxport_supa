import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { syncAllOrders } from '@/lib/orderSync';
import { syncTrendyolRecentOrdersForUser } from '@/lib/sync/trendyol';
import { syncWixRecentOrdersForUser } from '@/lib/sync/wix';
import { syncShopifyRecentOrdersForUser } from '@/lib/sync/shopify';
import { isTrendyolEnabled, isWixEnabled, isShopifyEnabled } from '@/lib/config';
import { runCronGuard } from '@/lib/cron/idempotency';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Temporary disable cron via env flag to avoid Hobby plan limits
  if (process.env.DISABLE_CRON_SYNC === 'true') {
    return res.status(503).json({ error: 'Cron sync temporarily disabled' });
  }
  const methodAllowed = req.method === 'GET' || req.method === 'POST';
  if (!methodAllowed) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Constant-time CRON_SECRET check + 15-minute idempotency bucket.
  // GitHub Actions cron-jobs.yml fires every 15 minutes; Vercel cron also defines a daily
  // run; the lock prevents double-execution in any overlap window.
  const guard = await runCronGuard(req, res, { jobName: 'sync-orders', intervalMinutes: 15 });
  if (!guard.ok) return;

  try {
    const users = await prisma.user.findMany({ include: { integrationSettings: true } });
    const results: any[] = [];

    for (const user of users) {
      const settings = user.integrationSettings;
      if (!settings) continue;

      // Always attempt generic sync for other marketplaces (veeqo/shippo) using central logic
      // It internally skips missing credentials
      try {
        await syncAllOrders(user.id, { syncType: 'recent' });
      } catch (e: any) {
        results.push({ userId: user.id, source: 'generic', error: e?.message || String(e) });
      }

      // Trendyol is optional per user
      if (isTrendyolEnabled(user.id)) {
        try {
          await syncTrendyolRecentOrdersForUser(user.id);
        } catch (e: any) {
          results.push({ userId: user.id, source: 'trendyol', error: e?.message || String(e) });
        }
      }

      // Wix is optional per user
      if (isWixEnabled(user.id)) {
        try {
          await syncWixRecentOrdersForUser(user.id);
        } catch (e: any) {
          results.push({ userId: user.id, source: 'wix', error: e?.message || String(e) });
        }
      }

      // Shopify is optional per user
      if (isShopifyEnabled(user.id)) {
        try {
          await syncShopifyRecentOrdersForUser(user.id);
        } catch (e: any) {
          results.push({ userId: user.id, source: 'shopify', error: e?.message || String(e) });
        }
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}


