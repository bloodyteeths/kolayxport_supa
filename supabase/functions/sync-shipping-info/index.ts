// Trigger redeploy2: minor change // Supabase Edge Function: sync-shipping-info
// @ts-ignore: Deno/Edge runtime import
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Handler for scheduled sync of shipping info.
 * This Edge Function is fully isolated from existing senkron logic.
 */
serve(async (req) => {
  try {
    // 1. Load integration settings & shipper profiles
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
        // Find order by userId, marketplace, and marketplaceKey
        const order = await prisma.order.findFirst({
          where: {
            userId: user.id,
            marketplace: o.source,
            marketplaceKey: o.id
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
        // Upsert into OrderShipping (create if not exists, update if exists)
        await prisma.orderShipping.upsert({
          where: { orderId: order.id },
          create: shippingData,
          update: shippingData
        });
      }
    }
    return new Response(JSON.stringify({ status: 'ok', message: 'Shipping info sync complete.' }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: (err as Error).message }), { status: 500 });
  }
});

// Placeholder: Replace with real implementation for your marketplaces
async function fetchLatestOrders(integrationSettings: any): Promise<any[]> {
  // Example: return await veeqoApi.fetchOrders(integrationSettings.veeqoApiKey)
  return [];
}

