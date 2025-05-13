import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  try {
    const supabase = getSupabaseServerClient(req, res);
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error('[User Settings API] Supabase auth error:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }

    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = authUser.id;
    console.info(`[User Settings API] Authenticated. Attempting to process request for userId: ${userId}, method: ${req.method}`);

    if (req.method === 'GET') {
      try {
        console.info(`[User Settings API] Inside GET try block. About to call Prisma for userId: ${userId}`);
        const userWithProfile = await prisma.user.findUnique({
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
            shipperProfile: true,
          },
        });

        console.info(`[User Settings API] Prisma call completed for userId: ${userId}. Found user: ${!!userWithProfile}`);

        if (!userWithProfile) {
          console.warn(`[User Settings API] User record not found in database for authenticated userId: ${userId}. Returning default empty settings.`);
          // Return a default empty structure if user or profile not found
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
            // Default empty ShipperProfile fields
            importerOfRecord: null,
            shipperName: null,
            shipperPersonName: null,
            shipperPhoneNumber: null,
            shipperStreet1: null,
            shipperStreet2: null,
            shipperCity: null,
            shipperStateCode: null,
            shipperPostalCode: null,
            shipperCountryCode: null,
            shipperTinNumber: null,
            fedexFolderId: null,
            defaultCurrencyCode: null,
            dutiesPaymentType: null,
          });
        }

        const settingsResponse = {
          veeqoApiKey: userWithProfile.veeqoApiKey,
          shippoToken: userWithProfile.shippoToken,
          fedexApiKey: userWithProfile.fedexApiKey,
          fedexApiSecret: userWithProfile.fedexApiSecret,
          fedexAccountNumber: userWithProfile.fedexAccountNumber,
          fedexMeterNumber: userWithProfile.fedexMeterNumber,
          trendyolSupplierId: userWithProfile.trendyolSupplierId,
          trendyolApiKey: userWithProfile.trendyolApiKey,
          trendyolApiSecret: userWithProfile.trendyolApiSecret,
          hepsiburadaMerchantId: userWithProfile.hepsiburadaMerchantId,
          hepsiburadaApiKey: userWithProfile.hepsiburadaApiKey,
          ...(userWithProfile.shipperProfile || {
            importerOfRecord: null,
            shipperName: null,
            shipperPersonName: null,
            shipperPhoneNumber: null,
            shipperStreet1: null,
            shipperStreet2: null,
            shipperCity: null,
            shipperStateCode: null,
            shipperPostalCode: null,
            shipperCountryCode: null,
            shipperTinNumber: null,
            fedexFolderId: null,
            defaultCurrencyCode: null,
            dutiesPaymentType: null,
          }),
        };

        return res.status(200).json(settingsResponse);
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
    // No explicit disconnect needed here for Prisma in serverless
  }
} 