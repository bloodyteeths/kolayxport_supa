import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { getUpsLabelFromCache } from '@/lib/ups/cache';
import prisma from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderId } = req.query;
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).send('Invalid request');
  }

  // Verify the order belongs to the authenticated user
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: { id: true },
  });
  if (!order) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const base64 = getUpsLabelFromCache(orderId);
  if (!base64) {
    return res.status(404).send('Label not found or expired');
  }

  const buffer = Buffer.from(base64, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="ups-label.pdf"');
  res.status(200).send(buffer);
} 