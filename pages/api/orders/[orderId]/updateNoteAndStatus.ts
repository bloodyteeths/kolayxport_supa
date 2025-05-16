import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
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

  const { not, durum } = req.body;
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    // Update both the Order (for status) and the first OrderItem (for notes)
    const order = await prisma.order.update({
      where: { id: orderId as string, userId: user.id },
      data: {
        status: durum,
      },
    });

    // Update the first OrderItem's notes field
    const orderItem = await prisma.orderItem.findFirst({
      where: { orderId: orderId as string },
      orderBy: { id: 'asc' },
    });
    if (orderItem) {
      await prisma.orderItem.update({
        where: { id: orderItem.id },
        data: { notes: not },
      });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message, stack: error?.stack });
  }
}
