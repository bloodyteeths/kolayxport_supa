import { createPagesServerClient } from '@supabase/ssr';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  const supabase = createPagesServerClient({ req, res });
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('Supabase getSession error in /api/user/settings:', sessionError);
    return res.status(500).json({ error: 'Authentication error' });
  }

  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
  }
  const userId = session.user.id;

  if (req.method === 'GET') {
    try {
      const userSettings = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          // Select all the fields that are configured on the settings page
          veeqoApiKey: true,
          shippoToken: true,
          fedexApiKey: true,
          fedexApiSecret: true,
          fedexAccountNumber: true,
          fedexMeterNumber: true,
          trendyolSupplierId: true,
          trendyolApiKey: true,
          trendyolApiSecret: true,
          hepsiburadaMerchantId: true,
          hepsiburadaApiKey: true,
          // Add any other fields that were previously fetched from gscript properties
          // For example, if IMPORTER_OF_RECORD and Shipper TIN were stored as distinct fields:
          // importerContactPersonName: true, 
          // importerContactCompanyName: true,
          // ...etc.
          // shipperTinNumber: true,
          
          // For now, let's assume the main API keys. 
          // The IMPORTER_OF_RECORD was a JSON string, 
          // that needs to be decided if it's stored as JSON or individual fields in Prisma.
          // Based on setScriptProps, they are individual fields.
        },
      });

      if (!userSettings) {
        // This case should ideally not happen if the user is authenticated,
        // as a user record should exist.
        return res.status(404).json({ error: 'User settings not found.' });
      }
      
      // Transform to the flat key-value structure the settings page expects
      // (e.g. VEEQO_API_KEY instead of veeqoApiKey) for compatibility,
      // or update the settings page to use camelCase.
      // For now, let's send camelCase and update settings page later if needed.
      return res.status(200).json(userSettings);

    } catch (err) {
      console.error('Error fetching user settings:', err);
      return res.status(500).json({ error: 'Internal Server Error fetching settings.', details: err.message });
    }
  } else if (req.method === 'POST') {
    // TODO: Consolidate POST logic from /api/setScriptProps.js here
    // For now, just indicate it's not implemented in this specific file yet for POST
    res.setHeader('Allow', ['GET']); // Only GET is implemented for now
    return res.status(405).json({ error: `Method ${req.method} not supported yet on this endpoint. Use /api/setScriptProps for saving.` });
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 