import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { fetchVeeqoOrders } from '../../../../lib/veeqoService';
import { fetchShippoOrders } from '../../../../lib/shippoService';
import { VEEQO_API_KEY as GLOBAL_VEEQO_API_KEY, SHIPPO_TOKEN as GLOBAL_SHIPPO_TOKEN } from '../../../../lib/config';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: true; syncedAt: string; syncStatus: string } | { error: string }>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const userId = user.id;

  try {
    // Fetch UserIntegrationSettings
    const settings = await prisma.userIntegrationSettings.findUnique({
      where: { userId },
    });

    // Resolve Veeqo API Key
    const veeqoApiKey = settings?.veeqoApiKey || GLOBAL_VEEQO_API_KEY;
    // Resolve Shippo Token
    const shippoToken = settings?.shippoToken || GLOBAL_SHIPPO_TOKEN;

    // Lookup existing order to get marketplace info
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { marketplace: true, marketplaceKey: true },
    });
    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const { marketplace, marketplaceKey } = existingOrder;

    // Fetch the single order data from the appropriate service
    let records: { order: any; items: any[] }[] = [];
    if (marketplace === 'Veeqo') {
      if (!veeqoApiKey) {
        return res.status(400).json({ error: 'Veeqo integration is not configured. Please check your settings.' });
      }
      records = await fetchVeeqoOrders(userId, veeqoApiKey);
    } else if (marketplace === 'Shippo') {
      if (!shippoToken) {
        return res.status(400).json({ error: 'Shippo integration is not configured. Please check your settings.' });
      }
      records = await fetchShippoOrders(userId, shippoToken);
    } else {
      return res.status(400).json({ error: `Unsupported marketplace: ${marketplace}` });
    }

    const record = records.find(r => String(r.order.marketplaceKey) === String(marketplaceKey));
    if (!record) {
      return res.status(404).json({ error: 'Order data not found in marketplace' });
    }
    const { order, items } = record;
    const now = new Date();

    // Prepare audit fields
    const dataToCreate = { ...order, marketplaceKey: String(order.marketplaceKey), userId, syncedAt: now, syncStatus: 'ok' };
    const dataToUpdate = { ...order, marketplaceKey: String(order.marketplaceKey), syncedAt: now, syncStatus: 'ok' };
    // Never overwrite user edits
    delete (dataToUpdate as any).packingStatus;
    delete (dataToUpdate as any).productionNotes;
    delete (dataToUpdate as any).packingEditedAt;
    delete (dataToUpdate as any).productionEditedAt;

    // Upsert order
    const dbOrder = await prisma.order.upsert({
      where: {
        userId_marketplace_marketplaceKey: { userId, marketplace, marketplaceKey: String(marketplaceKey) },
      },
      create: dataToCreate,
      update: dataToUpdate,
    });

    // Upsert items
    for (const item of items) {
      await prisma.orderItem.upsert({
        where: {
          remoteLineId_orderId: { remoteLineId: item.remoteLineId, orderId: dbOrder.id },
        },
        create: { ...item, orderId: dbOrder.id },
        update: { ...item },
      });
    }

    return res.status(200).json({
      success: true,
      syncedAt: now.toISOString(),
      syncStatus: 'ok',
    });
  } catch (error: any) {
    console.error('Resync error:', error);
    return res.status(500).json({ error: error.message });
  }
} 