import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';


// Initialize a dedicated pool for raw queries
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
import { getIntegrationCreds } from '../../../lib/config';
import { fetchVeeqoOrders, VeeqoOrder } from '@integrations/veeqo';
import { fetchShippoOrders, ShippoOrder } from '@integrations/shippo';

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
    const { veeqoApiKey, veeqoOrdersUrl, shippoToken } = creds;
    if (!veeqoApiKey || !veeqoOrdersUrl || !shippoToken) {
      res.status(400).json({ error: 'Missing Veeqo or Shippo credentials' });
      return;
    }

    /* Fetch orders */
    const [veeqoRaw, shippoRaw] = await Promise.all([
      fetchVeeqoOrders(veeqoApiKey, veeqoOrdersUrl),
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

    // Pre-fetch all shipments for this user via direct PG query
    const { rows: shipmentRows } = await pool.query(
      `SELECT s."orderId"
       FROM "Shipment" AS s
       INNER JOIN "Order" AS o ON s."orderId" = o."id"
       WHERE o."userId" = $1`,
      [userId]
    );
    const shippedIds = new Set(shipmentRows.map(r => r.orderid));

    // Pre-fetch all existing order numbers for this user via direct PG query
    const { rows: existingRows } = await pool.query(
      `SELECT "orderNumber" FROM "Order" WHERE "userId" = $1`,
      [userId]
    );
    const existingSet = new Set(existingRows.map(r => r.ordernumber));

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
        orderNumber: string | null;
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
          orderNumber: String(raw.number ?? raw.id),
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
          marketplaceKey: String(raw.order_number),
          orderNumber: String(raw.order_number),
          customerName: raw.to_address?.name ?? null,
          status: 'imported',
          currency: raw.currency ?? null,
          totalPrice: raw.total_price ?? raw.subtotal_price ?? null,
        };

        itemsDTO =
          raw.line_items?.map((li) => ({
            image: li.product_image ?? null,
            sku: li.sku ?? null,
            productName: li.title ?? null,
            unitPrice: li.price ?? null,
            totalPrice: li.price ? li.price * li.quantity : null,
            variantInfo: li.product_variant ?? null,
            notes: null,
            quantity: li.quantity,
            shipBy: null,
            marketplaceKey: li.object_id ?? null,
            orderNumber: String(raw.order_number),
            uniqueLineKey: li.object_id ?? null,
          })) ?? [];
      }

      // Determine if order exists by either unique constraint
      const existingOrderRes = await pool.query(
        `SELECT "id" FROM "Order"
         WHERE ("userId" = $1 AND "orderNumber" = $2)
            OR ("userId" = $1 AND "marketplace" = $3 AND "marketplaceKey" = $4)
         LIMIT 1`,
        [userId, orderDTO.orderNumber, orderDTO.marketplace, orderDTO.marketplaceKey]
      );
      let orderId: string;
      if (existingOrderRes.rows.length > 0) {
        orderId = existingOrderRes.rows[0].id;
        // Update the order
        await pool.query(
          `UPDATE "Order"
           SET "customerName" = $1, "currency" = $2, "totalPrice" = $3, "notes" = $4, "updatedAt" = NOW()
           WHERE "id" = $5`,
          [
            orderDTO.customerName,
            orderDTO.currency,
            orderDTO.totalPrice,
            JSON.stringify(norm.raw).slice(0, 1000),
            orderId
          ]
        );
      } else {
        orderId = uuidv4();
        await pool.query(
          `INSERT INTO "Order" ("id","userId","marketplace","marketplaceKey","orderNumber","customerName","status","currency","totalPrice","notes","updatedAt","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
          [
            orderId,
            userId,
            orderDTO.marketplace,
            orderDTO.marketplaceKey,
            orderDTO.orderNumber,
            orderDTO.customerName,
            orderDTO.status,
            orderDTO.currency,
            orderDTO.totalPrice,
            JSON.stringify(norm.raw).slice(0, 1000)
          ]
        );
      }


      // Delete existing items for this order:
      await pool.query(
        `DELETE FROM "OrderItem" WHERE "orderId" = $1`,
        [orderId]
      );

      // Insert new items:
      if (!orderId) continue;
      for (const item of itemsDTO) {
        // Defensive: ensure all required fields are not null/undefined
        const orderItemId = uuidv4();
        const image = item.image ?? null;
        const sku = item.sku ?? null;
        const productName = item.productName ?? null;
        const unitPrice = item.unitPrice ?? 0;
        const totalPrice = item.totalPrice ?? 0;
        const variantInfo = item.variantInfo ?? null;
        const notes = item.notes ?? null;
        const quantity = item.quantity ?? 1;
        const shipBy = item.shipBy ?? null;
        const marketplaceKey = item.marketplaceKey ?? null;
        const orderNumber = item.orderNumber ?? null;
        const uniqueLineKey = item.uniqueLineKey ?? null;

        await pool.query(
          `INSERT INTO "OrderItem" ("id","orderId","image","sku","productName","unitPrice","totalPrice","variantInfo","notes","quantity","shipBy","marketplaceKey","orderNumber","uniqueLineKey") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            orderItemId,
            orderId,
            image,
            sku,
            productName,
            unitPrice,
            totalPrice,
            variantInfo,
            notes,
            quantity,
            shipBy,
            marketplaceKey,
            orderNumber,
            uniqueLineKey,
          ]
        );
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
