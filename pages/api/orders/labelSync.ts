import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { getIntegrationCreds } from '../../../lib/config';
import { fetchVeeqoOrders, VeeqoOrder } from '@integrations/veeqo';
import { fetchShippoOrders } from '@integrations/shippo';
import { ShippoOrder } from '../../../lib/types';

type Normalised = {
  externalId: string;
  marketplace: 'VEEQO' | 'SHIPPO';
  raw: unknown;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ imported: number } | { error: string }>,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const userId = user.id;

  try {
    /* Resolve creds */
    const creds = await getIntegrationCreds(userId);
    const { veeqoApiKey, shippoToken } = creds;
    if (!veeqoApiKey || !shippoToken) {
      res.status(400).json({ error: 'Missing Veeqo or Shippo credentials' });
      return;
    }

    /* Fetch orders */
    const [veeqoRaw, shippoRaw] = await Promise.all([
      fetchVeeqoOrders({ apiKey: veeqoApiKey }),
      fetchShippoOrders(shippoToken),
    ]);

    const merged: Normalised[] = [
      ...veeqoRaw.map(
        (o: VeeqoOrder): Normalised => ({
          externalId: String(o.id),
          marketplace: 'VEEQO',
          raw: o,
        }),
      ),
      ...shippoRaw.map(
        (o: ShippoOrder): Normalised => ({
          externalId: String(o.order_number),
          marketplace: 'SHIPPO',
          raw: o,
        }),
      ),
    ];

    // Pre-fetch all shipments for this user via Prisma
    const shipmentRows = await prisma.shipment.findMany({
      where: { order: { userId } },
      select: { orderId: true }
    });
    const shippedIds = new Set(shipmentRows.map(r => r.orderId));

    // Pre-fetch all existing order numbers for this user via Prisma
    const existingRows = await prisma.order.findMany({
      where: { userId },
      select: { orderNumber: true }
    });
    const existingSet = new Set(existingRows.map(r => r.orderNumber));

    // Filter out orders that already have a shipment
    const unsent = merged.filter(o => !shippedIds.has(o.externalId));
    const toImport = unsent as Normalised[];

    /* ---------- FULL UPSERT (orders + items) ---------- */
    let added = 0;
    let updated = 0;

    // 1. Build normalised DTOs for all orders to import
    type OrderDTO = {
      marketplace: string;
      marketplaceKey: string;
      orderNumber: string;
      customerName: string | null;
      status: string;
      currency?: string | null;
      totalPrice?: number | null;
    };
    type ItemDTO = {
      image?: string | null;
      sku?: string | null;
      productName?: string | null;
      unitPrice?: number | null;
      totalPrice?: number | null;
      variantInfo?: string | null;
      notes?: string | null;
      quantity: number;
      shipBy?: Date | null;
      marketplaceKey?: string | null;
      orderNumber?: string | null;
      uniqueLineKey?: string | null;
    };
    type PreparedOrder = { norm: Normalised; orderDTO: OrderDTO; itemsDTO: ItemDTO[] };

    const prepared: PreparedOrder[] = [];
    for (const norm of toImport) {
      let orderDTO: OrderDTO;
      let itemsDTO: ItemDTO[] = [];

      if (norm.marketplace === 'VEEQO') {
        const raw = norm.raw as VeeqoOrder;
        orderDTO = {
          marketplace: 'VEEQO',
          marketplaceKey: String(raw.id),
          orderNumber: String(raw.number ?? raw.id ?? ''),
          customerName: `${raw.deliver_to?.first_name ?? ''} ${raw.deliver_to?.last_name ?? ''}`.trim() || null,
          status: raw.status ?? 'imported',
          currency: raw.currency_code ?? null,
          totalPrice: raw.total_price ?? null,
        };

        itemsDTO =
          raw.line_items?.map((li) => ({
            image: li.product_image ?? null,
            sku: li.variation_sku ?? null,
            productName: li.product_title ?? null,
            unitPrice: li.price ?? null,
            totalPrice: li.price ? li.price * li.quantity : null,
            variantInfo: li.variation_title ?? null,
            notes: li.notes ?? null,
            quantity: li.quantity,
            shipBy: null,
            marketplaceKey: String(li.id),
            orderNumber: String(raw.number ?? raw.id),
            uniqueLineKey: String(li.id),
          })) ?? [];
      } else {
        // SHIPPO
        const raw = norm.raw as ShippoOrder;
        orderDTO = {
          marketplace: 'SHIPPO',
          marketplaceKey: String(raw.order_number ?? ''),
          orderNumber: String(raw.order_number ?? ''),
          customerName: raw.to_address?.name ?? null,
          status: 'imported',
          currency: raw.currency ?? null,
          totalPrice: raw.total_price ? parseFloat(raw.total_price) : null,
        };

        itemsDTO =
          raw.line_items?.map((li) => ({
            image: null,
            sku: li.sku ?? null,
            productName: li.title ?? null,
            unitPrice: parseFloat(li.total_price) / li.quantity,
            totalPrice: parseFloat(li.total_price),
            variantInfo: null,
            notes: null,
            quantity: li.quantity,
            shipBy: null,
            marketplaceKey: li.object_id ?? null,
            orderNumber: String(raw.order_number),
            uniqueLineKey: li.object_id ?? null,
          })) ?? [];
      }

      // Defensive: Ensure all unique fields are present and valid
      if (!userId || !orderDTO.marketplace || !orderDTO.marketplaceKey) {
        continue;
      }

      prepared.push({ norm, orderDTO, itemsDTO });
    }

    // 2. Batch-fetch all existing orders for this user that match the marketplaceKeys we care about
    const marketplaceKeys = prepared.map(p => p.orderDTO.marketplaceKey);
    const existingOrders = await prisma.order.findMany({
      where: {
        userId,
        marketplaceKey: { in: marketplaceKeys },
      },
      select: { id: true, marketplace: true, marketplaceKey: true },
    });
    const existingOrderMap = new Map(
      existingOrders.map(o => [`${o.marketplace}:${o.marketplaceKey}`, o])
    );

    // 3. Use a single transaction for all DB operations
    const result = await prisma.$transaction(async (tx) => {
      const orderIds: Array<{ key: string; orderId: string; isNew: boolean }> = [];

      // 3a. Process updates and creates for orders
      for (const { norm, orderDTO } of prepared) {
        const key = `${orderDTO.marketplace}:${orderDTO.marketplaceKey}`;
        const existing = existingOrderMap.get(key);

        if (existing) {
          await tx.order.update({
            where: { id: existing.id },
            data: {
              customerName: orderDTO.customerName,
              currency: orderDTO.currency,
              totalPrice: orderDTO.totalPrice,
              rawData: norm.raw as any,
              updatedAt: new Date(),
            },
          });
          orderIds.push({ key, orderId: existing.id, isNew: false });
        } else {
          const created = await tx.order.create({
            data: {
              userId,
              marketplace: orderDTO.marketplace,
              marketplaceKey: orderDTO.marketplaceKey,
              orderNumber: orderDTO.orderNumber,
              customerName: orderDTO.customerName,
              status: orderDTO.status,
              currency: orderDTO.currency,
              totalPrice: orderDTO.totalPrice,
              rawData: norm.raw as any,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          });
          orderIds.push({ key, orderId: created.id, isNew: true });
        }
      }

      // Build orderId lookup
      const orderIdMap = new Map(orderIds.map(o => [o.key, o]));

      // 3b. Batch delete all existing items for all affected orders
      const allOrderIds = orderIds.map(o => o.orderId);
      await tx.orderItem.deleteMany({
        where: { orderId: { in: allOrderIds } },
      });

      // 3c. Batch create all items using createMany
      const allItems: Array<{
        orderId: string;
        image?: string;
        sku?: string;
        productName?: string;
        unitPrice?: number;
        totalPrice?: number;
        variantInfo?: string;
        notes?: string;
        quantity: number;
        shipBy?: Date;
        marketplaceKey?: string;
        orderNumber?: string;
        uniqueLineKey?: string;
      }> = [];

      for (const { orderDTO, itemsDTO } of prepared) {
        const key = `${orderDTO.marketplace}:${orderDTO.marketplaceKey}`;
        const entry = orderIdMap.get(key);
        if (!entry) continue;

        for (const item of itemsDTO) {
          allItems.push({
            orderId: entry.orderId,
            image: item.image || undefined,
            sku: item.sku || undefined,
            productName: item.productName || undefined,
            unitPrice: (item.unitPrice ?? 0) as any,
            totalPrice: (item.totalPrice ?? 0) as any,
            variantInfo: item.variantInfo || undefined,
            notes: item.notes || undefined,
            quantity: item.quantity ?? 1,
            shipBy: item.shipBy || undefined,
            marketplaceKey: item.marketplaceKey || undefined,
            orderNumber: item.orderNumber || undefined,
            uniqueLineKey: item.uniqueLineKey || undefined,
          });
        }
      }

      if (allItems.length > 0) {
        await tx.orderItem.createMany({ data: allItems });
      }

      // 3d. Count added vs updated
      let batchAdded = 0;
      let batchUpdated = 0;
      for (const { orderDTO } of prepared) {
        if (existingSet.has(orderDTO.orderNumber ?? '')) batchUpdated++;
        else batchAdded++;
      }

      return { added: batchAdded, updated: batchUpdated };
    });

    added = result.added;
    updated = result.updated;

    res.status(200).json({ imported: added + updated });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[labelSync]', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
