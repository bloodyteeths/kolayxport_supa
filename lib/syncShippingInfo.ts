import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Syncs shipping info for all users from external sources (Veeqo, Shippo, etc.)
 * and upserts normalized addresses into the new OrderShipping table.
 * This file is fully isolated and does NOT touch any senkron logic or tables.
 */
export async function syncShippingInfo() {
  // 1. Load integration settings & shipper defaults
  const users = await prisma.user.findMany({
    include: {
      integrationSettings: true,
      shipperProfile: true
    }
  });

  for (const user of users) {
    // 2. Fetch latest orders from each marketplace (Veeqo, Shippo, ...)
    // TODO: Replace with real API calls to Veeqo/Shippo
    const ordersJson = await fetchLatestOrders(user.integrationSettings);
    for (const o of ordersJson) {
      // 3. Find corresponding Order row
      const order = await prisma.order.findUnique({
        where: {
          userId_marketplace_marketplaceKey: {
            userId: user.id,
            marketplace: o.source,
            marketplaceKey: o.id
          }
        }
      });
      if (!order) continue;

      // 4. Map JSON → OrderShipping fields (clean phone, split name, fallback defaults)
      const cleanPhone = (s: string) => (s || '').replace(/\D/g, '') || user.shipperProfile?.shipperPhoneNumber || '';
      const [firstName, ...rest] = (o.deliver_to?.name || '').split(' ');
      const shippingData = {
        orderId: order.id,
        firstName: firstName || o.deliver_to?.first_name || '',
        lastName: rest.join(' ') || o.deliver_to?.last_name || '',
        company: o.deliver_to?.company || '',
        street1: o.deliver_to?.address1 || '',
        street2: o.deliver_to?.address2 || '',
        city: o.deliver_to?.city || '',
        state: o.deliver_to?.state || '',
        postalCode: o.deliver_to?.zip || '',
        countryCode: o.deliver_to?.country || '',
        phone: cleanPhone(o.deliver_to?.phone),
      };

      // 5. Upsert into OrderShipping
      await prisma.orderShipping.upsert({
        where: { orderId: order.id },
        create: shippingData,
        update: shippingData
      });
    }
  }
}

// Placeholder: Replace with real implementation for your marketplaces
async function fetchLatestOrders(integrationSettings: any): Promise<any[]> {
  // Example: return await veeqoApi.fetchOrders(integrationSettings.veeqoApiKey)
  return [];
}

// If running standalone (not as an Edge Function)
if (require.main === module) {
  syncShippingInfo().then(() => {
    console.log('Shipping info sync complete.');
    process.exit(0);
  }).catch((err) => {
    console.error('Error syncing shipping info:', err);
    process.exit(1);
  });
}
