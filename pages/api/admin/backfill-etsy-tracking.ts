import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { runCronGuard } from '@/lib/cron/idempotency';
import { EtsyClient, EtsyCredentials } from '@/lib/integrations/etsyClient';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';

// One-time / maintenance backfill: walk Etsy receipts further back than the
// 30-day rolling sync window and fill Order.trackingNumber from
// receipt.shipments (fill-if-empty — never overwrites local values). Must run
// inside the app: Etsy tokens are envelope-encrypted and only decryptable
// where the DEK was unwrapped at startup.
//
// Trigger from the VPS:
//   curl -X POST 'http://localhost:3000/api/admin/backfill-etsy-tracking?monthsBack=12' \
//     -H 'Authorization: Bearer $CRON_SECRET'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await runCronGuard(req, res, { jobName: 'backfill-etsy-tracking', intervalMinutes: 5 });
  if (!guard.ok) return;

  const monthsBack = Math.min(36, Math.max(1, Number(req.query.monthsBack) || 12));
  const minCreated = Math.floor((Date.now() - monthsBack * 30 * 86_400_000) / 1000);
  const PAGE_LIMIT = 100;
  const MAX_RECEIPTS_PER_SHOP = 10_000;

  const summary: any[] = [];
  try {
    const shops = await prisma.etsyShop.findMany({ where: { isActive: true } });

    for (const shop of shops) {
      if (!shop.accessToken || !shop.shopId) continue;

      const onTokenRefresh = async (newCreds: EtsyCredentials) => {
        await prisma.etsyShop.update({
          where: { id: shop.id },
          data: {
            accessToken: encryptIfNeeded(newCreds.accessToken) as string,
            refreshToken: encryptIfNeeded(newCreds.refreshToken) as string | undefined,
            tokenExpiresAt: newCreds.tokenExpiresAt || undefined,
          },
        });
      };
      const client = new EtsyClient(
        {
          accessToken: decryptIfNeeded(shop.accessToken) as string,
          refreshToken: (decryptIfNeeded(shop.refreshToken) as string | null) || undefined,
          shopId: shop.shopId,
          tokenExpiresAt: shop.tokenExpiresAt || undefined,
        },
        onTokenRefresh,
      );

      // receipt_id -> latest tracking code reported by Etsy
      const trackingByReceipt = new Map<string, string>();
      let offset = 0;
      let fetched = 0;
      while (fetched < MAX_RECEIPTS_PER_SHOP) {
        const result = await client.getReceipts({ limit: PAGE_LIMIT, offset, min_created: minCreated });
        const receipts = result.results || [];
        fetched += receipts.length;
        for (const receipt of receipts) {
          const ships = Array.isArray(receipt.shipments) ? receipt.shipments : [];
          const codes = ships.map((s: any) => s?.tracking_code).filter(Boolean);
          if (codes.length) trackingByReceipt.set(String(receipt.receipt_id), String(codes[codes.length - 1]));
        }
        if (receipts.length < PAGE_LIMIT) break;
        offset += PAGE_LIMIT;
      }

      // Fill-if-empty on this user's orders
      let updated = 0;
      const entries = [...trackingByReceipt.entries()];
      for (let i = 0; i < entries.length; i += 50) {
        const chunk = entries.slice(i, i + 50);
        const orders = await prisma.order.findMany({
          where: {
            userId: shop.userId,
            marketplaceKey: { in: chunk.map(([rid]) => rid) },
            OR: [{ trackingNumber: null }, { trackingNumber: '' }],
          },
          select: { id: true, marketplaceKey: true },
        });
        for (const o of orders) {
          const tracking = trackingByReceipt.get(o.marketplaceKey);
          if (!tracking) continue;
          await prisma.order.update({ where: { id: o.id }, data: { trackingNumber: tracking } });
          updated++;
        }
      }

      summary.push({ shop: shop.shopName || shop.shopId, receiptsScanned: fetched, withTracking: trackingByReceipt.size, ordersUpdated: updated });
      logger.info('[backfill-etsy-tracking] shop done', { shopId: shop.shopId, fetched, withTracking: trackingByReceipt.size, updated });
    }

    return res.status(200).json({ success: true, monthsBack, shops: summary });
  } catch (err: any) {
    logger.error('[backfill-etsy-tracking] failed', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: err?.message || 'backfill failed', partial: summary });
  }
}
