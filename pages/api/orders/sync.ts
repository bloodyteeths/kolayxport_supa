import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { fetchVeeqoOrders } from '../../../lib/veeqoService';
import { fetchShippoOrders } from '../../../lib/shippoService';
import { VEEQO_API_KEY as GLOBAL_VEEQO_API_KEY, SHIPPO_TOKEN as GLOBAL_SHIPPO_TOKEN } from '../../../lib/config';

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

  try {
    // Fetch UserIntegrationSettings
    const settings = await prisma.userIntegrationSettings.findUnique({
      where: { userId },
    });

    // Resolve Veeqo API Key
    const veeqoApiKey = settings?.veeqoApiKey || GLOBAL_VEEQO_API_KEY;
    if (!veeqoApiKey) {
      // Log this error for server-side observability
      console.error(`Veeqo API Key missing for user ${userId} and no global fallback.`);
      // Return a user-friendly error, avoid exposing too many details.
      return res.status(400).json({ error: 'Veeqo integration is not configured. Please check your settings.' });
    }

    // Resolve Shippo Token
    const shippoToken = settings?.shippoToken || GLOBAL_SHIPPO_TOKEN;
    if (!shippoToken) {
      console.error(`Shippo Token missing for user ${userId} and no global fallback.`);
      return res.status(400).json({ error: 'Shippo integration is not configured. Please check your settings.' });
    }

    const [veeqoData, shippoData] = await Promise.all([
      fetchVeeqoOrders(userId, veeqoApiKey),
      fetchShippoOrders(userId, shippoToken),
    ]);
    const all = [...veeqoData, ...shippoData];
    let added = 0;
    let updated = 0;

    for (const { order, items } of all) {
      // determine if order already exists for counting
      const existing = await prisma.order.findUnique({
        where: {
          userId_marketplace_marketplaceKey: {
            userId,
            marketplace: order.marketplace,
            marketplaceKey: order.marketplaceKey,
          },
        },
      });
      const now = new Date();
      // prepare audit fields
      const dataToCreate = { ...order, rawData: order, rawFetchedAt: now, userId, syncedAt: now, syncStatus: 'ok' };
      const dataToUpdate = { ...order, rawData: order, rawFetchedAt: now, syncedAt: now, syncStatus: 'ok' };
      // never overwrite user edits
      delete (dataToUpdate as any).packingStatus;
      delete (dataToUpdate as any).productionNotes;
      delete (dataToUpdate as any).packingEditedAt;
      delete (dataToUpdate as any).productionEditedAt;
      // upsert order with audit tracking
      const dbOrder = await prisma.order.upsert({
        where: {
          userId_marketplace_marketplaceKey: {
            userId,
            marketplace: order.marketplace,
            marketplaceKey: order.marketplaceKey,
          },
        },
        create: dataToCreate,
        update: dataToUpdate,
      });
      // track counts
      if (existing) {
        updated++;
      } else {
        added++;
      }
      // upsert items without audit tracking
      for (const item of items) {
        await prisma.orderItem.upsert({
          where: {
            remoteLineId_orderId: {
              remoteLineId: item.remoteLineId,
              orderId: dbOrder.id,
            },
          },
          create: { ...item, orderId: dbOrder.id },
          update: { ...item },
        });
      }
    }

    return res.status(200).json({ added, updated, total: all.length });
  } catch (error: any) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
} 