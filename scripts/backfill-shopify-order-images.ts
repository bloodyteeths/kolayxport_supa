/**
 * Backfill product images on existing Shopify OrderItem rows.
 *
 * Reads each Shopify Order for a user (or all users), pulls product_id from
 * rawData, fetches the product's featured image, writes it to OrderItem.image.
 *
 * Usage:
 *   npx tsx scripts/backfill-shopify-order-images.ts [userId]
 *
 * Without args: runs across every user with Shopify shops.
 * With userId: only that user.
 */

import prisma from '../lib/prisma';
import { ShopifyClient, getValidAccessToken } from '../lib/integrations/shopifyClient';

async function backfillForShop(userId: string, shopId: string, shopDomain: string) {
  const accessToken = await getValidAccessToken(shopId);
  const client = new ShopifyClient({ accessToken, shopDomain });

  const orders = await prisma.order.findMany({
    where: { userId, marketplace: 'shopify' },
    include: { items: true },
  });
  console.log(`[${shopDomain}] ${orders.length} Shopify orders to scan`);

  const imageByProductId = new Map<string, string>();
  let updated = 0;

  for (const order of orders) {
    const raw = order.rawData as any;
    const lineItems = raw?.line_items || [];
    for (const li of lineItems) {
      if (!li?.product_id) continue;
      const productId = String(li.product_id);

      if (!imageByProductId.has(productId)) {
        try {
          const product = await client.getProduct(productId);
          const src = product?.image?.src || product?.images?.[0]?.src || '';
          imageByProductId.set(productId, src);
        } catch (err: any) {
          console.warn(`  product ${productId} fetch failed: ${err?.message}`);
          imageByProductId.set(productId, '');
        }
      }

      const src = imageByProductId.get(productId);
      if (!src) continue;

      const remoteLineId = String(li.id);
      const item = order.items.find((it) => it.remoteLineId === remoteLineId);
      if (!item) continue;
      if (item.image === src) continue;

      await prisma.orderItem.update({
        where: { id: item.id },
        data: { image: src },
      });
      updated++;
    }
  }
  console.log(`[${shopDomain}] updated ${updated} OrderItem rows`);
}

async function main() {
  const userArg = process.argv[2];

  const shops = await prisma.shopifyShop.findMany({
    where: userArg ? { userId: userArg, isActive: true } : { isActive: true },
  });
  console.log(`Found ${shops.length} active Shopify shops`);

  for (const shop of shops) {
    try {
      await backfillForShop(shop.userId, shop.id, shop.shopDomain);
    } catch (err: any) {
      console.error(`shop ${shop.shopDomain} failed:`, err?.message || err);
    }
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
