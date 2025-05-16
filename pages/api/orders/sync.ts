import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { fetchVeeqoOrders } from '../../../lib/veeqoService';
import { VEEQO_API_KEY as GLOBAL_VEEQO_API_KEY } from '../../../lib/config';

interface SyncResult {
  added: number;
  updated: number;
  total: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SyncResult | { error: string }>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const userId = user.id;

  // Ensure the user exists in the User table (create if not)
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: user.email ?? undefined,
      name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? undefined,
      // Add other required fields with defaults if needed
    },
    update: {},
  });

  try {
    // Fetch UserIntegrationSettings
    const userSettings = await prisma.userIntegrationSettings.findUnique({
      where: { userId },
    });

    // Resolve Veeqo API Key
    const veeqoApiKey = userSettings?.veeqoApiKey || GLOBAL_VEEQO_API_KEY;
    console.log('[VEEQO SYNC] API Key resolution:', {
      hasUserKey: !!userSettings?.veeqoApiKey,
      hasGlobalKey: !!GLOBAL_VEEQO_API_KEY,
      resolvedKey: veeqoApiKey ? 'present' : 'missing'
    });

    if (!veeqoApiKey) {
      console.error(`Veeqo API Key missing for user ${userId} and no global fallback.`);
      return res.status(400).json({ error: 'Veeqo integration is not configured. Please check your settings.' });
    }

    // 1. Fetch Veeqo orders
    const veeqoData = await fetchVeeqoOrders(userId, veeqoApiKey);

    let added = 0;
    let updated = 0;

    for (const { order, items } of veeqoData) {
      try {
        // 2. Check if order exists
        const existing = await prisma.order.findUnique({
          where: {
            userId_orderNumber: {
              userId,
              orderNumber: order.orderNumber ?? 'Unknown',
            },
          },
        });

        // 3. Delete old items if order exists
        if (existing) {
          await prisma.orderItem.deleteMany({ where: { orderId: existing.id } });
        }

        // 4. Debug log before upsert
        console.debug('[SYNC] Processing order:', {
          orderNumber: order.orderNumber,
          marketplaceKey: order.marketplaceKey,
          customerName: order.customerName,
          status: order.status,
          totalPrice: order.totalPrice,
          itemsCount: items.length
        });
        console.debug('Order DTO:', order);
        console.debug('Items DTO:', items);
        console.log('[VEEQO SYNC] Items being upserted:', JSON.stringify(items, null, 2));

        // 5. Upsert order with guarded non-nullable fields
        await prisma.order.upsert({
          where: {
            userId_orderNumber: {
              userId,
              orderNumber: order.orderNumber ?? 'Unknown',
            },
          },
          create: {
            userId,
            marketplace: order.marketplace ?? 'Unknown',
            marketplaceKey: order.marketplaceKey ?? 'Unknown',
            orderNumber: order.orderNumber ?? null,
            marketplaceCreatedAt: order.marketplaceCreatedAt ? new Date(order.marketplaceCreatedAt) : null,
            customerName: order.customerName ?? null,
            status: order.status ?? 'Unknown',
            shipByDate: order.shipByDate ? new Date(order.shipByDate) : null,
            currency: order.currency ?? null,
            totalPrice: order.totalPrice ?? null,
            notes: order.notes ?? null,
            items: {
              create: items.map(item => ({
                image: item.image,
                sku: item.sku,
                productName: item.productName,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                variantInfo: item.variantInfo,
                notes: item.notes,
                quantity: item.quantity,
                shipBy: item.shipBy ? new Date(item.shipBy) : null,
                marketplaceKey: item.marketplaceKey,
                orderNumber: item.orderNumber ?? null,
                uniqueLineKey: item.uniqueLineKey ?? null,
              })),
            },
          },
          update: {
            marketplace: order.marketplace ?? 'Unknown',
            marketplaceKey: order.marketplaceKey ?? 'Unknown',
            orderNumber: order.orderNumber ?? null,
            marketplaceCreatedAt: order.marketplaceCreatedAt ? new Date(order.marketplaceCreatedAt) : null,
            customerName: order.customerName ?? null,
            status: existing?.status ?? 'Unknown', // Preserve status
            shipByDate: order.shipByDate ? new Date(order.shipByDate) : null,
            currency: order.currency ?? null,
            totalPrice: order.totalPrice ?? null,
            notes: existing?.notes ?? null, // Preserve notes
            items: {
              deleteMany: {},
              create: items.map(item => {
                // Try to find a matching existing item by uniqueLineKey or sku
                const existingItem = existing?.items?.find(ei =>
                  (item.uniqueLineKey && ei.uniqueLineKey === item.uniqueLineKey) ||
                  (item.sku && ei.sku === item.sku)
                );
                return {
                  image: item.image,
                  sku: item.sku,
                  productName: item.productName,
                  unitPrice: item.unitPrice,
                  totalPrice: item.totalPrice,
                  variantInfo: item.variantInfo,
                  notes: existingItem ? existingItem.notes : item.notes, // Preserve notes for all items
                  quantity: item.quantity,
                  shipBy: item.shipBy ? new Date(item.shipBy) : null,
                  marketplaceKey: item.marketplaceKey,
                  orderNumber: item.orderNumber ?? null,
                  uniqueLineKey: item.uniqueLineKey ?? null,
                };
              }),
            },
          },
          include: { items: true },
        });
        if (existing) {
          updated++;
          console.info(`[SYNC] Updated order:`, {
            orderNumber: order.orderNumber,
            marketplaceKey: order.marketplaceKey,
            id: existing.id
          });
        } else {
          added++;
          console.info(`[SYNC] Added order:`, {
            orderNumber: order.orderNumber,
            marketplaceKey: order.marketplaceKey
          });
        }
      } catch (error: any) {
        console.error('[SYNC ERROR] upsert failed:', error.message, {
          orderNumber: order.orderNumber,
          marketplaceKey: order.marketplaceKey,
          order,
          items
        });
        continue;
      }
    }

    return res.status(200).json({ added, updated, total: veeqoData.length });
  } catch (error: any) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
} 