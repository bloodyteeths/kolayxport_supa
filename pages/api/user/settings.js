import { createPagesServerClient } from '@supabase/ssr';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  const supabase = createPagesServerClient({ req, res });
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('[User Settings API] Supabase getSession error:', sessionError);
    return res.status(500).json({ error: 'Authentication error' });
  }

  if (!session?.user?.id) {
    console.warn('[User Settings API] Unauthorized: User not authenticated or session.user.id missing.');
    return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
  }
  const userId = session.user.id;
  console.log(`[User Settings API] Authenticated. Attempting to process request for userId: ${userId}, method: ${req.method}`);

  if (req.method === 'GET') {
    try {
      console.log(`[User Settings API] Inside GET try block. About to call Prisma for userId: ${userId}`);
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
      console.log(`[User Settings API] Prisma call completed for userId: ${userId}. Found settings: ${!!userSettings}`);

      if (!userSettings) {
        console.warn(`[User Settings API] User settings not found in database for authenticated userId: ${userId}`);
        return res.status(404).json({ error: 'User settings not found.' });
      }
      
      // Transform to the flat key-value structure the settings page expects
      // (e.g. VEEQO_API_KEY instead of veeqoApiKey) for compatibility,
      // or update the settings page to use camelCase.
      // For now, let's send camelCase and update settings page later if needed.
      console.log(`[User Settings API] Successfully fetched settings for userId: ${userId}. Returning data.`);
      return res.status(200).json(userSettings);

    } catch (err) {
      console.error('[User Settings API] Error in GET try block while fetching settings:', err);
      // Check if the error is a Prisma known error for better diagnostics
      if (err.code) { // Prisma errors often have a code
        console.error(`[User Settings API] Prisma error code: ${err.code}, meta: ${JSON.stringify(err.meta)}`);
      }
      return res.status(500).json({ error: 'Internal Server Error fetching settings.', details: err.message });
    }
  } else if (req.method === 'POST') {
    console.log(`[User Settings API] Received POST request for userId: ${userId}. This method is not fully implemented here yet.`);
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not supported yet on this endpoint. Use /api/setScriptProps for saving.` });
  } else {
    console.warn(`[User Settings API] Method ${req.method} not allowed for userId: ${userId}.`);
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 