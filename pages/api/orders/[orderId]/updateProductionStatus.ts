import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const { packingStatus, productionNotes } = req.body;
  // Remove validation for these fields since they no longer exist

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // No longer update these fields
    // const dataToUpdate: any = { packingStatus, productionNotes };
    // dataToUpdate.packingEditedAt = new Date();
    // dataToUpdate.productionEditedAt = new Date();
    // Instead, just return 400
    return res.status(400).json({ error: 'Packing/production status fields have been removed from the Order model.' });
  } catch (error: any) {
    console.error('Error updating production status:', error);
    return res.status(500).json({ error: 'Failed to update order', details: error.message });
  }
} 