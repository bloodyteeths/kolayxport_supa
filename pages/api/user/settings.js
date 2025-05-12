import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  try {
    const supabase = getSupabaseServerClient(req, res);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error('[User Settings API] Supabase auth error:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = user.id;
    console.info(`[User Settings API] Authenticated. Attempting to process request for userId: ${userId}, method: ${req.method}`);

    if (req.method === 'GET') {
      try {
        console.info(`[User Settings API] Inside GET try block. About to call Prisma for userId: ${userId}`);
        const userSettings = await prisma.user.findUnique({
          where: { id: userId },
          select: {
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
            IMPORTER_OF_RECORD: true,
            SHIPPER_TIN_NUMBER: true,
            SHIPPER_CITY: true,
            SHIPPER_COUNTRY_CODE: true,
            SHIPPER_NAME: true,
            SHIPPER_PERSON_NAME: true,
            SHIPPER_PHONE_NUMBER: true,
            SHIPPER_POSTAL_CODE: true,
            SHIPPER_STATE_CODE: true,
            SHIPPER_STREET1: true,
            SHIPPER_STREET2: true,
            SHIPPER_TIN_NUMBER: true,
            FEDEX_FOLDER_ID: true,
            DEFAULT_CURRENCY_CODE: true,
            DUTIES_PAYMENT_TYPE: true
          }
        });

        console.info(`[User Settings API] Prisma call completed for userId: ${userId}. Found settings: ${!!userSettings}`);

        if (!userSettings) {
          console.warn(`[User Settings API] User settings not found in database for authenticated userId: ${userId}`);
          // Return empty settings object instead of 404
          return res.status(200).json({
            veeqoApiKey: null,
            shippoToken: null,
            fedexApiKey: null,
            fedexApiSecret: null,
            fedexAccountNumber: null,
            fedexMeterNumber: null,
            trendyolSupplierId: null,
            trendyolApiKey: null,
            trendyolApiSecret: null,
            hepsiburadaMerchantId: null,
            hepsiburadaApiKey: null,
            IMPORTER_OF_RECORD: null,
            SHIPPER_TIN_NUMBER: null,
            SHIPPER_CITY: null,
            SHIPPER_COUNTRY_CODE: null,
            SHIPPER_NAME: null,
            SHIPPER_PERSON_NAME: null,
            SHIPPER_PHONE_NUMBER: null,
            SHIPPER_POSTAL_CODE: null,
            SHIPPER_STATE_CODE: null,
            SHIPPER_STREET1: null,
            SHIPPER_STREET2: null,
            FEDEX_FOLDER_ID: null,
            DEFAULT_CURRENCY_CODE: null,
            DUTIES_PAYMENT_TYPE: null
          });
        }

        return res.status(200).json(userSettings);
      } catch (error) {
        console.error(`[User Settings API] Error in GET try block while fetching settings:`, error);
        return res.status(500).json({ error: 'Internal server error while fetching settings' });
      }
    } else {
      res.setHeader('Allow', ['GET']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('[User Settings API] Error in main try block:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Do not force disconnect for every invocation in serverless; Prisma will handle.
  }
} 