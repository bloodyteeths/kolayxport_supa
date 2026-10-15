import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getAuthUser } from '@/lib/auth';

/** Private per-order note (never pushed to a marketplace). Keep in sync with components/labels/OrderNoteField.tsx. */
const ORDER_NOTE_MAX_LENGTH = 1000;

/**
 * POST { not?: string | null, durum?: string | null }
 *
 * Partial update: only the fields present in the body are written, so saving
 * a note never clears customStatus (and vice versa).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { orderId } = req.query;

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const hasNote = Object.prototype.hasOwnProperty.call(body, 'not');
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'durum');
  if (!hasNote && !hasStatus) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const data: { internalNote?: string | null; customStatus?: string | null } = {};
  if (hasNote) {
    const raw = body.not;
    if (raw != null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'Note must be a string' });
    }
    const note = typeof raw === 'string' ? raw.trim() : '';
    if (note.length > ORDER_NOTE_MAX_LENGTH) {
      return res.status(400).json({ error: `Note must be at most ${ORDER_NOTE_MAX_LENGTH} characters` });
    }
    data.internalNote = note || null;
  }
  if (hasStatus) {
    const raw = body.durum;
    if (raw != null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'Status must be a string' });
    }
    data.customStatus = (typeof raw === 'string' && raw.trim()) || null;
  }

  try {
    // Verify order exists and belongs to user
    const order = await prisma.order.findUnique({
      where: { id: orderId, userId: user.id },
      select: { id: true },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const saved = await prisma.senkronOrderData.upsert({
      where: { orderId },
      update: { ...data, updatedAt: new Date() },
      create: {
        orderId,
        userId: user.id,
        internalNote: data.internalNote ?? null,
        customStatus: data.customStatus ?? null,
      },
      select: { internalNote: true, customStatus: true },
    });

    return res.status(200).json({ success: true, internalNote: saved.internalNote, customStatus: saved.customStatus });
  } catch (error: any) {
    console.error('Error updating note and status:', error);
    return res.status(500).json({ error: 'Failed to update order note' });
  }
}
