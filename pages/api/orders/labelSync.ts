import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
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

  const userId = (req.body.userId ?? req.query.userId) as string | undefined;
  if (!userId) {
    res.status(400).json({ error: 'Missing userId' });
    return;
  }

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

    for (const norm of toImport) {
      let orderDTO: {
        marketplace: string;
        marketplaceKey: string;
        orderNumber: string;
        customerName: string | null;
        status: string;
        currency?: string | null;
        totalPrice?: number | null;
      };
      let itemsDTO: Array<{
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
      }> = [];

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

      // Find existing order by userId, marketplace, and marketplaceKey
      const existingOrder = await prisma.order.findFirst({
        where: {
          userId,
          marketplace: orderDTO.marketplace,
          marketplaceKey: orderDTO.marketplaceKey
        }
      });
      let orderId: string;
      if (existingOrder) {
        orderId = existingOrder.id;
        await prisma.order.update({
          where: { id: orderId },
          data: {
            customerName: orderDTO.customerName,
            currency: orderDTO.currency,
            totalPrice: orderDTO.totalPrice,
            rawData: norm.raw as any,
            updatedAt: new Date()
          }
        });
      } else {
        const created = await prisma.order.create({
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
            createdAt: new Date()
          }
        });
        orderId = created.id;
      }

      // Delete existing items for this order:
      await prisma.orderItem.deleteMany({ where: { orderId } });

      // Insert new items:
      for (const item of itemsDTO) {
        await prisma.orderItem.create({
          data: {
            orderId,
            image: item.image || undefined,
            sku: item.sku || undefined,
            productName: item.productName || undefined,
            unitPrice: item.unitPrice ?? 0,
            totalPrice: item.totalPrice ?? 0,
            variantInfo: item.variantInfo || undefined,
            notes: item.notes || undefined,
            quantity: item.quantity ?? 1,
            shipBy: item.shipBy || undefined,
            marketplaceKey: item.marketplaceKey || undefined,
            orderNumber: item.orderNumber || undefined,
            uniqueLineKey: item.uniqueLineKey || undefined
          }
        });
      }

      if (existingSet.has(orderDTO.orderNumber ?? '')) updated++;
      else added++;
    }

    res.status(200).json({ imported: added + updated });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[labelSync]', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
