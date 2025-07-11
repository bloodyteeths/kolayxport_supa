import type { NextApiRequest, NextApiResponse } from 'next';
import { getUpsLabelFromCache } from '@/lib/ups/cache';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { orderId } = req.query;
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).send('Invalid request');
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