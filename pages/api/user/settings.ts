import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const userId = authUser.id;

  if (req.method === 'GET') {
    try {
      const userWithSettings = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          integrationSettings: true,
          shipperProfile: true,
        },
      });
      if (!userWithSettings) {
        return res.status(404).json({ error: 'User not found.' });
      }
      res.status(200).json({
        integrationSettings: userWithSettings.integrationSettings,
        shipperProfile: userWithSettings.shipperProfile,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch settings.', details: error.message });
    }
  } else if (req.method === 'PATCH') {
    try {
      const { integrationSettings, shipperProfile } = req.body;

      // First ensure the User record exists
      await prisma.user.upsert({
        where: { id: userId },
        update: { 
          updatedAt: new Date(),
          email: authUser.email || undefined,
          name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || undefined
        },
        create: {
          id: userId,
          email: authUser.email || undefined,
          name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || undefined,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Upsert IntegrationSettings
      if (integrationSettings) {
        await prisma.userIntegrationSettings.upsert({
          where: { userId: userId },
          update: {
            veeqoApiKey: integrationSettings.veeqoApiKey,
            shippoToken: integrationSettings.shippoToken,
            fedexApiKey: integrationSettings.fedexApiKey,
            fedexApiSecret: integrationSettings.fedexApiSecret,
            fedexAccountNumber: integrationSettings.fedexAccountNumber,
            fedexMeterNumber: integrationSettings.fedexMeterNumber,
            hepsiburadaApiKey: integrationSettings.hepsiburadaApiKey,
            hepsiburadaMerchantId: integrationSettings.hepsiburadaMerchantId,
            trendyolApiKey: integrationSettings.trendyolApiKey,
            trendyolApiSecret: integrationSettings.trendyolApiSecret,
            trendyolSupplierId: integrationSettings.trendyolSupplierId,
            updatedAt: new Date(),
          },
          create: {
            userId: userId,
            veeqoApiKey: integrationSettings.veeqoApiKey,
            shippoToken: integrationSettings.shippoToken,
            fedexApiKey: integrationSettings.fedexApiKey,
            fedexApiSecret: integrationSettings.fedexApiSecret,
            fedexAccountNumber: integrationSettings.fedexAccountNumber,
            fedexMeterNumber: integrationSettings.fedexMeterNumber,
            hepsiburadaApiKey: integrationSettings.hepsiburadaApiKey,
            hepsiburadaMerchantId: integrationSettings.hepsiburadaMerchantId,
            trendyolApiKey: integrationSettings.trendyolApiKey,
            trendyolApiSecret: integrationSettings.trendyolApiSecret,
            trendyolSupplierId: integrationSettings.trendyolSupplierId,
          },
        });
      }
      // Upsert ShipperProfile
      if (shipperProfile) {
        await prisma.shipperProfile.upsert({
          where: { userId: userId },
          update: {
            shipperName: shipperProfile.shipperName,
            shipperPersonName: shipperProfile.shipperPersonName,
            shipperPhoneNumber: shipperProfile.shipperPhoneNumber,
            shipperStreet1: shipperProfile.shipperStreet1,
            shipperStreet2: shipperProfile.shipperStreet2,
            shipperCity: shipperProfile.shipperCity,
            shipperStateCode: shipperProfile.shipperStateCode,
            shipperPostalCode: shipperProfile.shipperPostalCode,
            shipperCountryCode: shipperProfile.shipperCountryCode,
            shipperTinNumber: shipperProfile.shipperTinNumber,
            shipperTinType: shipperProfile.shipperTinType,
            importerOfRecord: shipperProfile.importerOfRecord,
            fedexFolderId: shipperProfile.fedexFolderId,
            defaultCurrencyCode: shipperProfile.defaultCurrencyCode,
            dutiesPaymentType: shipperProfile.dutiesPaymentType,
            defaultShippingChargesPaymentType: shipperProfile.defaultShippingChargesPaymentType,
            defaultWeightKg: shipperProfile.defaultWeightKg ? parseFloat(shipperProfile.defaultWeightKg) : null,
            defaultServiceType: shipperProfile.defaultServiceType,
            defaultPackagingType: shipperProfile.defaultPackagingType,
            defaultPickupType: shipperProfile.defaultPickupType,
            defaultHarmonizedCode: shipperProfile.defaultHarmonizedCode,
            defaultCountryOfMfg: shipperProfile.defaultCountryOfMfg,
            defaultLabelStockType: shipperProfile.defaultLabelStockType,
            defaultTermsOfSale: shipperProfile.defaultTermsOfSale,
            updatedAt: new Date(),
          },
          create: {
            userId: userId,
            shipperName: shipperProfile.shipperName,
            shipperPersonName: shipperProfile.shipperPersonName,
            shipperPhoneNumber: shipperProfile.shipperPhoneNumber,
            shipperStreet1: shipperProfile.shipperStreet1,
            shipperStreet2: shipperProfile.shipperStreet2,
            shipperCity: shipperProfile.shipperCity,
            shipperStateCode: shipperProfile.shipperStateCode,
            shipperPostalCode: shipperProfile.shipperPostalCode,
            shipperCountryCode: shipperProfile.shipperCountryCode,
            shipperTinNumber: shipperProfile.shipperTinNumber,
            shipperTinType: shipperProfile.shipperTinType,
            importerOfRecord: shipperProfile.importerOfRecord,
            fedexFolderId: shipperProfile.fedexFolderId,
            defaultCurrencyCode: shipperProfile.defaultCurrencyCode,
            dutiesPaymentType: shipperProfile.dutiesPaymentType,
            defaultShippingChargesPaymentType: shipperProfile.defaultShippingChargesPaymentType,
            defaultWeightKg: shipperProfile.defaultWeightKg ? parseFloat(shipperProfile.defaultWeightKg) : null,
            defaultServiceType: shipperProfile.defaultServiceType,
            defaultPackagingType: shipperProfile.defaultPackagingType,
            defaultPickupType: shipperProfile.defaultPickupType,
            defaultHarmonizedCode: shipperProfile.defaultHarmonizedCode,
            defaultCountryOfMfg: shipperProfile.defaultCountryOfMfg,
            defaultLabelStockType: shipperProfile.defaultLabelStockType,
            defaultTermsOfSale: shipperProfile.defaultTermsOfSale,
          },
        });
      }
      return res.status(200).json({ message: 'Settings saved successfully.' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to save settings.', details: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 