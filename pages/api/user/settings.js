import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  console.log('[DEBUG] Incoming cookies:', req.cookies);
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
        
        // First ensure user exists
        const user = await prisma.user.upsert({
          where: { id: userId },
          create: {
            id: userId,
            email: authUser.email,
          },
          update: {},
        });

        const userWithSettings = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            integrationSettings: true,
            shipperProfile: true,
          },
        });

        console.info(`[User Settings API] Prisma call completed for userId: ${userId}. Found user: ${!!userWithSettings}`);

        if (!userWithSettings) {
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
          ...(userWithSettings.integrationSettings || {
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
          }),
          ...(userWithSettings.shipperProfile || {
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
    } else if (req.method === 'POST') {
      try {
        const {
          // Integration settings
          veeqoApiKey,
          shippoToken,
          fedexApiKey,
          fedexApiSecret,
          fedexAccountNumber,
          fedexMeterNumber,
          trendyolSupplierId,
          trendyolApiKey,
          trendyolApiSecret,
          hepsiburadaMerchantId,
          hepsiburadaApiKey,
          // Shipper profile
          importerOfRecord,
          shipperName,
          shipperPersonName,
          shipperPhoneNumber,
          shipperStreet1,
          shipperStreet2,
          shipperCity,
          shipperStateCode,
          shipperPostalCode,
          shipperCountryCode,
          shipperTinNumber,
          fedexFolderId,
          defaultCurrencyCode,
          dutiesPaymentType,
        } = req.body;

        // Update integration settings
        const integrationSettings = await prisma.userIntegrationSettings.upsert({
          where: { userId },
          create: {
            userId,
            veeqoApiKey,
            shippoToken,
            fedexApiKey,
            fedexApiSecret,
            fedexAccountNumber,
            fedexMeterNumber,
            trendyolSupplierId,
            trendyolApiKey,
            trendyolApiSecret,
            hepsiburadaMerchantId,
            hepsiburadaApiKey,
          },
          update: {
            veeqoApiKey,
            shippoToken,
            fedexApiKey,
            fedexApiSecret,
            fedexAccountNumber,
            fedexMeterNumber,
            trendyolSupplierId,
            trendyolApiKey,
            trendyolApiSecret,
            hepsiburadaMerchantId,
            hepsiburadaApiKey,
          },
        });

        // Update shipper profile
        const shipperProfile = await prisma.shipperProfile.upsert({
          where: { userId },
          create: {
            userId,
            importerOfRecord,
            shipperName,
            shipperPersonName,
            shipperPhoneNumber,
            shipperStreet1,
            shipperStreet2,
            shipperCity,
            shipperStateCode,
            shipperPostalCode,
            shipperCountryCode,
            shipperTinNumber,
            fedexFolderId,
            defaultCurrencyCode,
            dutiesPaymentType,
          },
          update: {
            importerOfRecord,
            shipperName,
            shipperPersonName,
            shipperPhoneNumber,
            shipperStreet1,
            shipperStreet2,
            shipperCity,
            shipperStateCode,
            shipperPostalCode,
            shipperCountryCode,
            shipperTinNumber,
            fedexFolderId,
            defaultCurrencyCode,
            dutiesPaymentType,
          },
        });

        return res.status(200).json({
          ...integrationSettings,
          ...shipperProfile,
        });
      } catch (error) {
        console.error(`[User Settings API] Error in POST try block while updating settings:`, error);
        return res.status(500).json({ error: 'Internal server error while updating settings' });
      }
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('[User Settings API] Error in main try block:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
} 