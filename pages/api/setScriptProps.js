import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const supabase = getSupabaseServerClient(req, res);
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error('[setScriptProps] Supabase auth error:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }

    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = authUser.id;
    const body = req.body;

    console.info(`[SetScriptProps API] Received request for userId: ${userId}. Body:`, JSON.stringify(body));

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // --- Split fields ---
    const integrationSettingsUpdateData = {};
    const userUpdateData = {};
    const shipperProfileUpdateData = {};

    // Integration settings fields (UserIntegrationSettings)
    if ('veeqoApiKey' in body) integrationSettingsUpdateData.veeqoApiKey = body.veeqoApiKey;
    if ('shippoToken' in body) integrationSettingsUpdateData.shippoToken = body.shippoToken;
    if ('fedexApiKey' in body) integrationSettingsUpdateData.fedexApiKey = body.fedexApiKey;
    if ('fedexApiSecret' in body) integrationSettingsUpdateData.fedexApiSecret = body.fedexApiSecret;
    if ('fedexAccountNumber' in body) integrationSettingsUpdateData.fedexAccountNumber = body.fedexAccountNumber;
    if ('fedexMeterNumber' in body) integrationSettingsUpdateData.fedexMeterNumber = body.fedexMeterNumber;
    if ('trendyolSupplierId' in body) integrationSettingsUpdateData.trendyolSupplierId = body.trendyolSupplierId;
    if ('trendyolApiKey' in body) integrationSettingsUpdateData.trendyolApiKey = body.trendyolApiKey;
    if ('trendyolApiSecret' in body) integrationSettingsUpdateData.trendyolApiSecret = body.trendyolApiSecret;
    if ('hepsiburadaMerchantId' in body) integrationSettingsUpdateData.hepsiburadaMerchantId = body.hepsiburadaMerchantId;
    if ('hepsiburadaApiKey' in body) integrationSettingsUpdateData.hepsiburadaApiKey = body.hepsiburadaApiKey;

    // Only actual user fields (name, email, etc.)
    if ('name' in body) userUpdateData.name = body.name;
    if ('email' in body) userUpdateData.email = body.email;
    // Add more user fields as needed

    // --- ShipperProfile fields ---
    if ('importerOfRecord' in body) shipperProfileUpdateData.importerOfRecord = body.importerOfRecord;
    if ('shipperName' in body) shipperProfileUpdateData.shipperName = body.shipperName;
    if ('shipperPersonName' in body) shipperProfileUpdateData.shipperPersonName = body.shipperPersonName;
    if ('shipperPhoneNumber' in body) shipperProfileUpdateData.shipperPhoneNumber = body.shipperPhoneNumber;
    if ('shipperStreet1' in body) shipperProfileUpdateData.shipperStreet1 = body.shipperStreet1;
    if ('shipperStreet2' in body) shipperProfileUpdateData.shipperStreet2 = body.shipperStreet2;
    if ('shipperCity' in body) shipperProfileUpdateData.shipperCity = body.shipperCity;
    if ('shipperStateCode' in body) shipperProfileUpdateData.shipperStateCode = body.shipperStateCode;
    if ('shipperPostalCode' in body) shipperProfileUpdateData.shipperPostalCode = body.shipperPostalCode;
    if ('shipperCountryCode' in body) shipperProfileUpdateData.shipperCountryCode = body.shipperCountryCode;
    if ('shipperTinNumber' in body) shipperProfileUpdateData.shipperTinNumber = body.shipperTinNumber;
    if ('fedexFolderId' in body) shipperProfileUpdateData.fedexFolderId = body.fedexFolderId;
    if ('defaultCurrencyCode' in body) shipperProfileUpdateData.defaultCurrencyCode = body.defaultCurrencyCode;
    if ('dutiesPaymentType' in body) shipperProfileUpdateData.dutiesPaymentType = body.dutiesPaymentType;

    console.info(`[SetScriptProps API] Parsed userUpdateData for userId ${userId}:`, JSON.stringify(userUpdateData));
    console.info(`[SetScriptProps API] Parsed integrationSettingsUpdateData for userId ${userId}:`, JSON.stringify(integrationSettingsUpdateData));
    console.info(`[SetScriptProps API] Parsed shipperProfileUpdateData for userId ${userId}:`, JSON.stringify(shipperProfileUpdateData));

    let updatedUser = null;
    let updatedIntegrationSettings = null;
    let updatedShipperProfile = null;

    await prisma.$transaction(async (tx) => {
      // Upsert User (only if user fields present)
      const userExists = await tx.user.findUnique({ where: { id: userId } });
      const shouldUpsertUser = Object.keys(userUpdateData).length > 0;
      if (!userExists && (userUpdateData.name || userUpdateData.email)) {
        // Create user with only allowed fields
        const userDataForCreate = {
          id: userId,
          email: authUser.email,
          ...(userUpdateData.name ? { name: userUpdateData.name } : {}),
        };
        updatedUser = await tx.user.create({
          data: userDataForCreate,
        });
      } else if (userExists && shouldUpsertUser) {
        updatedUser = await tx.user.update({
          where: { id: userId },
          data: userUpdateData,
        });
      }

      // Upsert Integration Settings
      if (Object.keys(integrationSettingsUpdateData).length > 0) {
        updatedIntegrationSettings = await tx.userIntegrationSettings.upsert({
          where: { userId },
          create: { userId, ...integrationSettingsUpdateData },
          update: integrationSettingsUpdateData,
        });
      }

      // Upsert ShipperProfile
      if (Object.keys(shipperProfileUpdateData).length > 0) {
        const userExistsForShipperProfile = updatedUser || userExists;
        if (userExistsForShipperProfile) {
          console.info(`[SetScriptProps API] Upserting ShipperProfile for userId ${userId} with:`, JSON.stringify(shipperProfileUpdateData));
          updatedShipperProfile = await tx.shipperProfile.upsert({
            where: { userId: userId },
            create: { userId: userId, ...shipperProfileUpdateData },
            update: shipperProfileUpdateData,
          });
          console.info(`[SetScriptProps API] Upserted ShipperProfile for userId ${userId}.`);
        } else {
          console.warn(`[SetScriptProps API] Cannot upsert ShipperProfile: user does not exist for userId ${userId}`);
        }
      }
    });

    if (!updatedUser && !updatedIntegrationSettings && !updatedShipperProfile) {
      return res.status(400).json({ error: 'No valid properties to update for User, UserIntegrationSettings, or ShipperProfile' });
    }

    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      user: updatedUser,
      integrationSettings: updatedIntegrationSettings,
      shipperProfile: updatedShipperProfile,
    });
  } catch (error) {
    console.error('[SetScriptProps API] Error:', error);
    if (error.code === 'P2002' && error.meta?.target?.includes('userId')) {
      return res.status(409).json({ error: 'Conflict: Shipper profile or integration settings already exist for this user.' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
} 