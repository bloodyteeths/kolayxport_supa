import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
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
        select: {
          id: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          billingInterval: true,
          trialExpiresAt: true,
          usageResetAt: true,
          orderSyncCount: true,
          labelCount: true,
          integrationSettings: {
            select: {
              veeqoApiKey: true,
              shippoToken: true,
              trendyolApiKey: true,
              trendyolApiSecret: true,
              trendyolSupplierId: true,
              fedexApiKey: true,
              fedexApiSecret: true,
              fedexAccountNumber: true,
              upsApiKey: true,
              upsApiSecret: true,
              upsAccountNumber: true,
            }
          },
          shipperProfile: {
            select: {
              shipperName: true,
              shipperPersonName: true,
              shipperPhoneNumber: true,
              shipperStreet1: true,
              shipperStreet2: true,
              shipperCity: true,
              shipperStateCode: true,
              shipperPostalCode: true,
              shipperCountryCode: true,
              shipperTinNumber: true,
              shipperTinType: true,
              importerOfRecord: true,
              fedexFolderId: true,
              defaultCurrencyCode: true,
              dutiesPaymentType: true,
              defaultShippingChargesPaymentType: true,
            }
          },
        },
      });
      if (!userWithSettings) {
        return res.status(404).json({ error: 'User not found.' });
      }
      res.status(200).json({
        integrationSettings: userWithSettings.integrationSettings,
        shipperProfile: userWithSettings.shipperProfile,
        subscription: {
          subscriptionPlan: userWithSettings.subscriptionPlan,
          subscriptionStatus: userWithSettings.subscriptionStatus,
          billingInterval: userWithSettings.billingInterval,
          trialExpiresAt: userWithSettings.trialExpiresAt,
          usageResetAt: userWithSettings.usageResetAt,
          orderSyncCount: userWithSettings.orderSyncCount,
          labelCount: userWithSettings.labelCount,
        },
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

      // Update integration settings
      if (integrationSettings) {
        console.log('Saving integration settings:', {
          userId: authUser.id,
          hasTrendyolKey: !!integrationSettings.trendyolApiKey,
          hasTrendyolSecret: !!integrationSettings.trendyolApiSecret,
          hasTrendyolSupplierId: !!integrationSettings.trendyolSupplierId,
        });
        
        try {
          await prisma.credential.upsert({
            where: { userId: authUser.id },
            create: {
              userId: authUser.id,
              veeqoApiKey: integrationSettings.veeqoApiKey,
              shippoToken: integrationSettings.shippoToken,
              trendyolApiKey: integrationSettings.trendyolApiKey,
              trendyolApiSecret: integrationSettings.trendyolApiSecret,
              trendyolSupplierId: integrationSettings.trendyolSupplierId,
              fedexApiKey: integrationSettings.fedexApiKey,
              fedexApiSecret: integrationSettings.fedexApiSecret,
              fedexAccountNumber: integrationSettings.fedexAccountNumber,
              upsApiKey: integrationSettings.upsApiKey,
              upsApiSecret: integrationSettings.upsApiSecret,
              upsAccountNumber: integrationSettings.upsAccountNumber,
            },
            update: {
              veeqoApiKey: integrationSettings.veeqoApiKey,
              shippoToken: integrationSettings.shippoToken,
              trendyolApiKey: integrationSettings.trendyolApiKey,
              trendyolApiSecret: integrationSettings.trendyolApiSecret,
              trendyolSupplierId: integrationSettings.trendyolSupplierId,
              fedexApiKey: integrationSettings.fedexApiKey,
              fedexApiSecret: integrationSettings.fedexApiSecret,
              fedexAccountNumber: integrationSettings.fedexAccountNumber,
              upsApiKey: integrationSettings.upsApiKey,
              upsApiSecret: integrationSettings.upsApiSecret,
              upsAccountNumber: integrationSettings.upsAccountNumber,
            },
          });
          console.log('Integration settings saved successfully');
        } catch (error) {
          console.error('Error saving integration settings:', error);
          throw error;
        }
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
            defaultHarmonizedCode: shipperProfile.defaultHarmonizedCode,
            defaultCountryOfMfg: shipperProfile.defaultCountryOfMfg,
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
            defaultHarmonizedCode: shipperProfile.defaultHarmonizedCode,
            defaultCountryOfMfg: shipperProfile.defaultCountryOfMfg,
          },
        });
      }
      return res.status(200).json({ message: 'Settings saved successfully.' });
    } catch (error: any) {
      console.error('Settings save error:', error);
      res.status(500).json({ 
        error: 'Failed to save settings.', 
        details: error.message,
        stack: error.stack 
      });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  } catch (globalError: any) {
    console.error('Global error in user settings API:', globalError);
    
    // Handle specific Prisma connection errors
    if (globalError.code === 'P2024' || globalError.message?.includes('connection pool')) {
      return res.status(503).json({ 
        error: 'Database temporarily unavailable. Please try again in a moment.',
        code: 'DB_CONNECTION_ERROR'
      });
    }
    
    if (globalError.code === 'P1001' || globalError.message?.includes('connection')) {
      return res.status(503).json({ 
        error: 'Database connection failed. Please try again.',
        code: 'DB_CONNECTION_FAILED' 
      });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error. Please try again.',
      code: 'INTERNAL_ERROR'
    });
  }
}