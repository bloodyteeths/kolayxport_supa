import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { withPrismaRetry } from '../../../lib/prismaWithRetry';
import { encryptCredentials, decryptCredentials, maskCredentials, stripMaskedSecrets } from '@/lib/encryption';
import { getPlanLimits } from '@/lib/billing/planLimits';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    console.log('[/api/user/settings] Request started', { 
      method: req.method,
      hasCookies: !!req.headers.cookie,
      cookieLength: req.headers.cookie?.length 
    });
    
    const authUser = await getAuthUser(req, res);
    if (!authUser) {
      console.error('[/api/user/settings] Auth failed');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userId = authUser.id;

  if (req.method === 'GET') {
    try {
      const userWithSettings = await withPrismaRetry(() => 
        prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          billingInterval: true,
          billingProvider: true,
          trialExpiresAt: true,
          usageResetAt: true,
          orderSyncCount: true,
          labelCount: true,
          shippingSettings: true,
          integrationSettings: true,
          shipperProfile: true,
        },
        })
      );
      if (!userWithSettings) {
        return res.status(404).json({ error: 'User not found.' });
      }
      // Any account with an active Shopify store is treated as the free Shopify
      // tier (App Store rule 1.2.1: no off-platform billing surfaces for
      // Shopify-installed merchants), even if the store was connected from the
      // settings page before the User row was flagged.
      const activeShopifyShops = await withPrismaRetry(() =>
        prisma.shopifyShop.count({ where: { userId, isActive: true } })
      );
      const effectiveBillingProvider =
        userWithSettings.billingProvider === 'shopify_free' || activeShopifyShops > 0
          ? 'shopify_free'
          : userWithSettings.billingProvider;
      // This response reaches the browser on every page (AppLayout), so secrets
      // go out masked ('••••' + last 4) — never in plaintext. Identifiers the
      // form must show (supplier IDs, account numbers) are returned readable.
      const maskedCreds = userWithSettings.integrationSettings
        ? maskCredentials(decryptCredentials(userWithSettings.integrationSettings as Record<string, any>))
        : null;
      const isShopifyFree = effectiveBillingProvider === 'shopify_free';
      const effectivePlan = isShopifyFree ? 'shopify_free' : userWithSettings.subscriptionPlan;
      const effectiveStatus = isShopifyFree ? 'active' : userWithSettings.subscriptionStatus;
      // Limits the usage limiter actually applies (lib/billing/planLimits.ts, same
      // decision as lib/middleware/withUsageLimiter.ts). null = unlimited; 0 = blocked.
      // Computed from the RAW DB plan/status, not the display-level shopify_free
      // mask above: the middleware only short-circuits when the User row itself
      // says subscriptionPlan === 'shopify_free', so an account that is
      // shopify_free only because of an active ShopifyShop / billingProvider is
      // still limited (trial or noSubscription) and must not be reported as
      // unlimited. The UI hides the meter for shopify_free (rule 1.2.1) anyway.
      const planLimits = getPlanLimits(
        userWithSettings.subscriptionPlan,
        userWithSettings.subscriptionStatus,
        userWithSettings.trialExpiresAt,
      );
      res.status(200).json({
        integrationSettings: maskedCreds,
        shipperProfile: userWithSettings.shipperProfile,
        shippingSettings: userWithSettings.shippingSettings || {},
        subscription: {
          subscriptionPlan: effectivePlan,
          subscriptionStatus: effectiveStatus,
          billingInterval: userWithSettings.billingInterval,
          billingProvider: effectiveBillingProvider,
          trialExpiresAt: userWithSettings.trialExpiresAt,
          usageResetAt: userWithSettings.usageResetAt,
          orderSyncCount: userWithSettings.orderSyncCount,
          labelCount: userWithSettings.labelCount,
          limits: planLimits.limits,
          period: planLimits.period,
        },
      });
    } catch (error: any) {
      console.error('[/api/user/settings] Database error:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      res.status(500).json({ error: 'Failed to fetch settings.', details: error.message });
    }
  } else if (req.method === 'PATCH') {
    try {
      const { shipperProfile, shippingSettings } = req.body;
      // The GET returns secrets masked; a mask sent back means "unchanged".
      const integrationSettings = req.body.integrationSettings
        ? stripMaskedSecrets(req.body.integrationSettings as Record<string, any>)
        : req.body.integrationSettings;

      // First ensure the User record exists
      await prisma.user.upsert({
        where: { id: userId },
        update: { 
          updatedAt: new Date(),
          email: authUser.email || undefined,
          name: authUser.name || authUser.email?.split('@')[0] || undefined,
          shippingSettings: shippingSettings || undefined
        },
        create: {
          id: userId,
          email: authUser.email || undefined,
          name: authUser.name || authUser.email?.split('@')[0] || undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
          shippingSettings: shippingSettings || {}
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
          // Encrypt sensitive credential fields before storing
          const encrypted = encryptCredentials(integrationSettings);

          // Cast data objects to any to avoid Prisma type mismatches in certain build environments
          await prisma.credential.upsert({
            where: { userId: authUser.id },
            create: ({
              userId: authUser.id,
              veeqoApiKey: encrypted.veeqoApiKey,
              shippoToken: encrypted.shippoToken,
              trendyolApiKey: encrypted.trendyolApiKey,
              trendyolApiSecret: encrypted.trendyolApiSecret,
              trendyolSupplierId: integrationSettings.trendyolSupplierId,
              fedexApiKey: encrypted.fedexApiKey,
              fedexApiSecret: encrypted.fedexApiSecret,
              fedexAccountNumber: integrationSettings.fedexAccountNumber,
              upsApiKey: encrypted.upsApiKey,
              upsApiSecret: encrypted.upsApiSecret,
              upsAccountNumber: integrationSettings.upsAccountNumber,
              mngCustomerNumber: encrypted.mngCustomerNumber,
              mngPassword: encrypted.mngPassword,
              mngAppId: integrationSettings.mngAppId,
              mngAppSecret: encrypted.mngAppSecret,
              mngApiEnvironment: integrationSettings.mngApiEnvironment,
              parasutClientId: encrypted.parasutClientId,
              parasutClientSecret: encrypted.parasutClientSecret,
              parasutUsername: encrypted.parasutUsername,
              parasutPassword: encrypted.parasutPassword,
              parasutCompanyId: integrationSettings.parasutCompanyId,
            } as any),
            update: ({
              veeqoApiKey: encrypted.veeqoApiKey,
              shippoToken: encrypted.shippoToken,
              trendyolApiKey: encrypted.trendyolApiKey,
              trendyolApiSecret: encrypted.trendyolApiSecret,
              trendyolSupplierId: integrationSettings.trendyolSupplierId,
              fedexApiKey: encrypted.fedexApiKey,
              fedexApiSecret: encrypted.fedexApiSecret,
              fedexAccountNumber: integrationSettings.fedexAccountNumber,
              upsApiKey: encrypted.upsApiKey,
              upsApiSecret: encrypted.upsApiSecret,
              upsAccountNumber: integrationSettings.upsAccountNumber,
              mngCustomerNumber: encrypted.mngCustomerNumber,
              mngPassword: encrypted.mngPassword,
              mngAppId: integrationSettings.mngAppId,
              mngAppSecret: encrypted.mngAppSecret,
              mngApiEnvironment: integrationSettings.mngApiEnvironment,
              parasutClientId: encrypted.parasutClientId,
              parasutClientSecret: encrypted.parasutClientSecret,
              parasutUsername: encrypted.parasutUsername,
              parasutPassword: encrypted.parasutPassword,
              parasutCompanyId: integrationSettings.parasutCompanyId,
            } as any),
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