import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { syncAllOrders } from '@/lib/orderSync';
import { syncTrendyolRecentOrdersForUser } from '@/lib/sync/trendyol';
import { syncWixRecentOrdersForUser } from '@/lib/sync/wix';
import { isTrendyolEnabled, isWixEnabled } from '@/lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Temporary disable cron via env flag to avoid Hobby plan limits
  if (process.env.DISABLE_CRON_SYNC === 'true') {
    return res.status(503).json({ error: 'Cron sync temporarily disabled' });
  }
  // Allow Vercel Cron (GET with x-vercel-cron header) and secured calls (POST with Bearer token)
  const isVercelCron = req.headers["x-vercel-cron"] !== undefined;
  const authHeader = req.headers.authorization;
  const methodAllowed = req.method === 'GET' || req.method === 'POST';
  if (!methodAllowed) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isVercelCron && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
    }

    return res.status(200).json({ ok: true, results });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}


