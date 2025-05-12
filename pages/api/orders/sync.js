import { getSupabaseServerClient } from '../../../lib/supabase'; // Correct import
import prisma from '@/lib/prisma';
import { fetchVeeqoOrders_adapted } from '@/lib/marketplace_adapters/veeqo_adapter';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res); // Use the new helper
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError) {
    console.error('Supabase getUser error in orders/sync:', authError);
    return res.status(401).json({ error: 'Authentication error', details: authError.message });
  }

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = user.id;

  const { marketplace } = req.body;

  if (!marketplace) {
    return res.status(400).json({ error: 'Missing marketplace parameter' });
  }

  try {
    const userConfig = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        veeqoApiKey: true, 
        trendyolSupplierId: true,
        trendyolApiKey: true,
        trendyolApiSecret: true
        // Add other marketplace API keys here as needed
      }
    });

    if (!userConfig) {
      // This case should ideally not happen if the user is authenticated 
      // unless the user record was somehow deleted post-auth.
      console.error(`User config not found for authenticated user ${userId} in orders/sync.`);
      return res.status(404).json({ error: 'User configuration not found' });
    }

    let syncResult = { marketplace, newOrders: 0, updatedOrders: 0, errors: [] };

    if (marketplace.toLowerCase() === 'veeqo') {
      if (!userConfig.veeqoApiKey) {
        return res.status(400).json({ error: 'Veeqo API key not configured for this user.' });
      }
      const veeqoSyncData = await fetchVeeqoOrders_adapted(userId, userConfig.veeqoApiKey, prisma);
      syncResult.newOrders += veeqoSyncData.newOrders;
      syncResult.updatedOrders += veeqoSyncData.updatedOrders;
      if(veeqoSyncData.error) syncResult.errors.push({ veeqo: veeqoSyncData.error });

    } else if (marketplace.toLowerCase() === 'trendyol') {
      if (!userConfig.trendyolApiKey || !userConfig.trendyolApiSecret || !userConfig.trendyolSupplierId) {
        return res.status(400).json({ error: 'Trendyol API keys or Supplier ID not configured for this user.' });
      }
      // TODO: Implement Trendyol sync
      // const trendyolSyncData = await fetchTrendyolOrders_adapted(userId, userConfig.trendyolSupplierId, userConfig.trendyolApiKey, userConfig.trendyolApiSecret, prisma);
      // syncResult.newOrders += trendyolSyncData.newOrders;
      // syncResult.updatedOrders += trendyolSyncData.updatedOrders;
      // if(trendyolSyncData.error) syncResult.errors.push({ trendyol: trendyolSyncData.error });
      console.warn(`Trendyol sync initiated for user ${userId} - NOT IMPLEMENTED`);
      return res.status(501).json({ message: 'Trendyol sync not yet implemented.' });
    } else {
      return res.status(400).json({ error: `Unsupported marketplace: ${marketplace}` });
    }

    if (syncResult.errors.length > 0) {
        console.error(`Sync errors for user ${userId}, marketplace ${marketplace}:`, syncResult.errors);
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
    if (error.code) { // Prisma errors
        console.error(`Prisma error in orders/sync: ${error.code} - ${error.message}`);
    }
    return res.status(500).json({ error: 'Internal server error during sync.', details: error.message });
  }
} 