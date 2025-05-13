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

    const userUpdateData = {};
    const shipperProfileUpdateData = {};

    // --- Direct User fields (API Keys) ---
    if ('veeqoApiKey' in body) userUpdateData.veeqoApiKey = body.veeqoApiKey;
    if ('shippoToken' in body) userUpdateData.shippoToken = body.shippoToken;
    if ('fedexApiKey' in body) userUpdateData.fedexApiKey = body.fedexApiKey;
    if ('fedexApiSecret' in body) userUpdateData.fedexApiSecret = body.fedexApiSecret;
    if ('fedexAccountNumber' in body) userUpdateData.fedexAccountNumber = body.fedexAccountNumber;
    if ('fedexMeterNumber' in body) userUpdateData.fedexMeterNumber = body.fedexMeterNumber;
    if ('trendyolSupplierId' in body) userUpdateData.trendyolSupplierId = body.trendyolSupplierId;
    if ('trendyolApiKey' in body) userUpdateData.trendyolApiKey = body.trendyolApiKey;
    if ('trendyolApiSecret' in body) userUpdateData.trendyolApiSecret = body.trendyolApiSecret;
    if ('hepsiburadaMerchantId' in body) userUpdateData.hepsiburadaMerchantId = body.hepsiburadaMerchantId;
    if ('hepsiburadaApiKey' in body) userUpdateData.hepsiburadaApiKey = body.hepsiburadaApiKey;

    // --- ShipperProfile fields ---
    // Note: Frontend should send these as camelCase matching ShipperProfile model
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
    console.info(`[SetScriptProps API] Parsed shipperProfileUpdateData for userId ${userId}:`, JSON.stringify(shipperProfileUpdateData));

    let updatedUser = null;
    let updatedShipperProfile = null;

    await prisma.$transaction(async (tx) => {
      const userDataForCreate = {
        id: userId, 
        email: authUser.email, 
        ...userUpdateData,
      };

      const shouldUpsertUser = Object.keys(userUpdateData).length > 0 || !await tx.user.findUnique({ where: { id: userId } });
      console.info(`[SetScriptProps API] For userId ${userId}: Should upsert user? ${shouldUpsertUser}`);

      if (shouldUpsertUser) {
        updatedUser = await tx.user.upsert({
          where: { id: userId },
          create: userDataForCreate,
          update: userUpdateData,
        });
        console.info(`[SetScriptProps API] User upsert result for userId ${userId}:`, updatedUser ? 'User updated/created' : 'User not updated/created (check data)');
      } else {
        console.info(`[SetScriptProps API] For userId ${userId}: Skipped user upsert (no new data and user exists).`);
      }

      const shouldUpsertShipperProfile = Object.keys(shipperProfileUpdateData).length > 0;
      console.info(`[SetScriptProps API] For userId ${userId}: Should upsert shipper profile? ${shouldUpsertShipperProfile}`);
      
      if (shouldUpsertShipperProfile) {
        const userExistsForShipperProfile = updatedUser || await tx.user.findUnique({ where: { id: userId } });
        console.info(`[SetScriptProps API] For userId ${userId}: User exists for shipper profile upsert? ${!!userExistsForShipperProfile}`);

        if (userExistsForShipperProfile) {
          updatedShipperProfile = await tx.shipperProfile.upsert({
            where: { userId: userId }, 
            create: {
              userId: userId, 
              ...shipperProfileUpdateData,
            },
            update: shipperProfileUpdateData,
          });
          console.info(`[SetScriptProps API] ShipperProfile upsert result for userId ${userId}:`, updatedShipperProfile ? 'ShipperProfile updated/created' : 'ShipperProfile not updated/created (check data)');
        } else {
          console.warn(`[SetScriptProps API] User with id ${userId} not found and not created, cannot upsert shipper profile.`);
        }
      } else {
        console.info(`[SetScriptProps API] For userId ${userId}: Skipped shipper profile upsert (no new data).`);
      }
    });

    console.info(`[SetScriptProps API] After transaction for userId ${userId} - updatedUser:`, updatedUser ? 'Exists' : 'null');
    console.info(`[SetScriptProps API] After transaction for userId ${userId} - updatedShipperProfile:`, updatedShipperProfile ? 'Exists' : 'null');

    if (!updatedUser && !updatedShipperProfile) {
        console.warn(`[SetScriptProps API] No valid properties were updated for User or ShipperProfile for userId ${userId}. Responding 400.`);
        return res.status(400).json({ error: 'No valid properties to update for User or ShipperProfile' });
    }

    return res.status(200).json({ 
      message: 'Settings updated successfully', 
      user: updatedUser, // Will be null if no user fields were updated
      shipperProfile: updatedShipperProfile // Will be null if no shipper fields were updated
    });

  } catch (error) {
    console.error('[SetScriptProps API] Error:', error);
    if (error.code === 'P2002' && error.meta?.target?.includes('userId')) {
        return res.status(409).json({ error: 'Conflict: Shipper profile already exists for this user.' });
    } // Added more specific error for unique constraint if upsert logic fails for some reason
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    // No explicit disconnect needed.
  }
} 