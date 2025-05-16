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
    },
    update: {},
  });

  try {
    // Fetch UserIntegrationSettings
    const userSettings = await prisma.userIntegrationSettings.findUnique({
      where: { userId },
    });
    const veeqoApiKey = userSettings?.veeqoApiKey || GLOBAL_VEEQO_API_KEY;
    if (!veeqoApiKey) {
      return res.status(400).json({ error: 'Veeqo integration is not configured. Please check your settings.' });
    }

    // Fetch ALL orders (full sync)
    const veeqoData = await fetchVeeqoOrders(userId, veeqoApiKey);
    let added = 0;
    let updated = 0;
    for (const { order, items } of veeqoData) {
      try {
        const existing = await prisma.order.findUnique({
          where: {
            userId_orderNumber: {
              userId,
              orderNumber: order.orderNumber ?? 'Unknown',
            },
          },
        });
        if (existing) {
          await prisma.orderItem.deleteMany({ where: { orderId: existing.id } });
        }
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
            status: existing?.status ?? 'Unknown',
            shipByDate: order.shipByDate ? new Date(order.shipByDate) : null,
            currency: order.currency ?? null,
            totalPrice: order.totalPrice ?? null,
            notes: existing?.notes ?? null,
            items: {
              deleteMany: {},
              create: items.map(item => {
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
                  notes: existingItem ? existingItem.notes : item.notes,
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
        if (existing) updated++; else added++;
      } catch (error: any) {
        continue;
      }
    }
    return res.status(200).json({ added, updated, total: veeqoData.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
