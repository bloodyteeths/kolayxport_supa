// Shopify GDPR redaction for synced orders (compliance webhooks). Server-only.
//
// Orders synced since the mapper started tagging them carry `rawData.shop_domain`. Older rows have no shop
// tag, so they are only attributed to a shop when the account has no other Shopify store.
import prisma from '@/lib/prisma';

/** shop/redact: delete every synced order of `shopDomain` (items, shipments etc. cascade). Returns the count. */
export async function deleteShopOrders(shopDomain: string): Promise<number> {
  const shops = await prisma.shopifyShop.findMany({ where: { shopDomain }, select: { userId: true } });
  let deleted = 0;
  for (const { userId } of shops) {
    const others = await prisma.shopifyShop.count({ where: { userId, shopDomain: { not: shopDomain } } });
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order"
      WHERE "userId" = ${userId} AND marketplace = 'shopify'
        AND ("rawData"->>'shop_domain' = ${shopDomain} OR (${others === 0} AND "rawData"->>'shop_domain' IS NULL))`;
    if (rows.length) {
      deleted += (await prisma.order.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })).count;
    }
  }
  return deleted;
}

/** customers/redact: strip the customer's personal data from the listed orders of `shopDomain`. Returns the count. */
export async function redactCustomerOrders(shopDomain: string, shopifyOrderIds: Array<string | number>): Promise<number> {
  const keys = shopifyOrderIds.map((id) => String(id).replace(/^gid:\/\/shopify\/Order\//, '')).filter(Boolean);
  if (!keys.length) return 0;
  const shops = await prisma.shopifyShop.findMany({ where: { shopDomain }, select: { userId: true } });
  let redacted = 0;
  for (const { userId } of shops) {
    const orders = await prisma.order.findMany({
      where: { userId, marketplace: 'shopify', marketplaceKey: { in: keys } },
      select: { id: true },
    });
    const ids = orders.map((o) => o.id);
    if (!ids.length) continue;
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE "Order" SET "customerName" = 'Redacted', "shippingAddress" = NULL, "customerNote" = NULL, "giftMessage" = NULL,
          "rawData" = "rawData" - 'customer' - 'email' - 'phone' - 'note' - 'billing_address' - 'shipping_address'
        WHERE id = ANY(${ids})`,
      prisma.orderItem.updateMany({ where: { orderId: { in: ids } }, data: { recipientEmail: null } }),
      prisma.orderShipping.deleteMany({ where: { orderId: { in: ids } } }),
    ]);
    redacted += ids.length;
  }
  return redacted;
}
