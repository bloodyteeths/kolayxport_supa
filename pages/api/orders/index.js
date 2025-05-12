import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError) {
    console.error('Supabase getUser error in orders/index:', authError);
    return res.status(401).json({ error: 'Not authenticated', details: authError.message });
  }

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const userId = user.id;

  try {
    const userOrders = await prisma.order.findMany({
      where: {
        userId: userId,
      },
      include: {
        items: true, // Include related order items
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // The client-side OrdersTable.jsx was updated to expect structured data.
    // No need for the complex transformation here anymore if the client handles it.
    // Returning the raw structured data is generally better.
    // If transformedOrders is still needed for some legacy reason, 
    // that transformation logic should be reviewed and simplified.
    // For now, returning the structured data directly.

    return res.status(200).json({ success: true, data: userOrders }); // Return structured data

  } catch (error) {
    console.error('Error fetching orders from DB for user:', userId, error);
    if (error.code) { // Prisma errors
        console.error(`Prisma error in orders/index: ${error.code} - ${error.message}`);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch orders from database.', details: error.message });
  }
} 