import { createPagesServerClient } from '@supabase/ssr';
import prisma from '@/lib/prisma';
import { fetchVeeqoOrders_adapted } from '@/lib/marketplace_adapters/veeqo_adapter'; // We will create this adapter

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = createPagesServerClient({ req, res });
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = session.user.id;

  const { marketplace } = req.body;

  if (!marketplace) {
    return res.status(400).json({ error: 'Missing marketplace parameter' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        veeqoApiKey: true, 
        trendyolSupplierId: true, // For when we add Trendyol
        trendyolApiKey: true,    // For when we add Trendyol
        trendyolApiSecret: true  // For when we add Trendyol
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let syncResult = { marketplace, newOrders: 0, updatedOrders: 0, errors: [] };

    if (marketplace.toLowerCase() === 'veeqo') {
      if (!user.veeqoApiKey) {
        return res.status(400).json({ error: 'Veeqo API key not configured.' });
      }
      const veeqoSyncData = await fetchVeeqoOrders_adapted(userId, user.veeqoApiKey, prisma);
      syncResult.newOrders += veeqoSyncData.newOrders;
      syncResult.updatedOrders += veeqoSyncData.updatedOrders;
      if(veeqoSyncData.error) syncResult.errors.push({ veeqo: veeqoSyncData.error });

    } else if (marketplace.toLowerCase() === 'trendyol') {
      // TODO: Implement Trendyol sync
      // const trendyolSyncData = await fetchTrendyolOrders_adapted(userId, user.trendyolSupplierId, user.trendyolApiKey, user.trendyolApiSecret, prisma);
      // syncResult.newOrders += trendyolSyncData.newOrders;
      // syncResult.updatedOrders += trendyolSyncData.updatedOrders;
      // if(trendyolSyncData.error) syncResult.errors.push({ trendyol: trendyolSyncData.error });
      return res.status(501).json({ message: 'Trendyol sync not yet implemented.' });
    } else {
      return res.status(400).json({ error: `Unsupported marketplace: ${marketplace}` });
    }

    if (syncResult.errors.length > 0) {
        console.error(`Sync errors for user ${userId}, marketplace ${marketplace}:`, syncResult.errors);
        // Return partial success with error details
        return res.status(207).json({ 
            message: `Sync for ${marketplace} completed with some errors.`, 
            details: syncResult 
        });
    }

    return res.status(200).json({ 
        message: `Sync for ${marketplace} completed successfully.`, 
        details: syncResult 
    });

  } catch (error) {
    console.error(`Error in /api/orders/sync for user ${userId}, marketplace ${marketplace}:`, error);
    return res.status(500).json({ error: 'Internal server error during sync.', details: error.message });
  }
} 