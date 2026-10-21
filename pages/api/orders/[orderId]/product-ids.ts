// GET /api/orders/:orderId/product-ids — EU customs product identifiers per order item (lib/shipping/productIds.ts):
// remembered from an earlier label, else the seller's eBay listing barcode / MPN, else SKU-based defaults.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { lookupProductIds } from '@/lib/shipping/productIds';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await getAuthUser(req, res);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const orderId = String(req.query.orderId || '');
  const order = await prisma.order.findFirst({ where: { id: orderId, userId: auth.id }, select: { id: true } });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = await prisma.orderItem.findMany({ where: { orderId }, select: { id: true, sku: true, listingRef: true } });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ items: await lookupProductIds(auth.id, items) });
}
