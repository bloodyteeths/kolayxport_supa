import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string' || !orderId) {
    return res.status(400).json({ error: 'Order ID is required in the path.' });
  }

  const { labelOverrides } = req.body;
  if (!labelOverrides || typeof labelOverrides !== 'object') {
    return res.status(400).json({ error: 'labelOverrides must be provided as an object.' });
  }

  try {
    const order = await prisma.order.update({
      where: { id: orderId, userId: user.id },
      data: { labelOverrides },
    });
    return res.status(200).json({ success: true, order });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
} 