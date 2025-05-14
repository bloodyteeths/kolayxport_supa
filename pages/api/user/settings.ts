import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';

// Response shapes
interface UserSettingsResponse {
  integrationSettings?: {
    veeqoApiKey?: string | null;
    shippoToken?: string | null;
    fedexApiKey?: string | null;
    fedexApiSecret?: string | null;
    fedexAccountNumber?: string | null;
    fedexMeterNumber?: string | null;
    trendyolSupplierId?: string | null;
    trendyolApiKey?: string | null;
    trendyolApiSecret?: string | null;
    hepsiburadaMerchantId?: string | null;
    hepsiburadaApiKey?: string | null;
  };
  shipperProfile?: {
    shipperName?: string | null;
    shipperPersonName?: string | null;
    shipperPhoneNumber?: string | null;
    shipperStreet1?: string | null;
    shipperStreet2?: string | null;
    shipperCity?: string | null;
    shipperStateCode?: string | null;
    shipperPostalCode?: string | null;
    shipperCountryCode?: string | null;
    shipperTinNumber?: string | null;
    shipperTinType?: string | null;
    importerOfRecord?: string | null;
    fedexFolderId?: string | null;
    defaultCurrencyCode?: string | null;
    dutiesPaymentType?: string | null;
  };
}

interface ErrorResponse {
  error: string;
  details?: any;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserSettingsResponse | ErrorResponse>
) {
  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const userId = user.id;

  if (req.method === 'GET') {
    try {
      // Ensure per-user records exist
      await prisma.userIntegrationSettings.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      await prisma.shipperProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      // Fetch user-specific settings
      const integrationSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId } });
      const shipperProfile = await prisma.shipperProfile.findUnique({ where: { userId } });

      return res.status(200).json({
        integrationSettings: integrationSettings || undefined,
        shipperProfile: shipperProfile || undefined,
      });
    } catch (error: any) {
      console.error('[User Settings API] Error in GET:', error);
      return res.status(500).json({ error: 'Internal server error while fetching settings' });
    }
  } else if (req.method === 'PATCH') {
    try {
      const { integrationSettings: intData, shipperProfile: spData } = req.body as UserSettingsResponse;

      // Sanitize and upsert integration settings
      if (intData) {
        const sanitized = Object.fromEntries(
          Object.entries(intData).map(([k, v]) => [k, v === undefined ? null : v])
        );
        await prisma.userIntegrationSettings.upsert({
          where: { userId },
          create: { userId, ...sanitized },
          update: sanitized,
        });
      }

      // Sanitize and upsert shipper profile
      if (spData) {
        const sanitized = Object.fromEntries(
          Object.entries(spData).map(([k, v]) => [k, v === undefined ? null : v])
        );
        await prisma.shipperProfile.upsert({
          where: { userId },
          create: { userId, ...sanitized },
          update: sanitized,
        });
      }

      // Return updated data
      const updatedIntegrationSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId } });
      const updatedShipperProfile = await prisma.shipperProfile.findUnique({ where: { userId } });
      return res.status(200).json({
        integrationSettings: updatedIntegrationSettings || undefined,
        shipperProfile: updatedShipperProfile || undefined,
      });
    } catch (error: any) {
      console.error('[User Settings API] Error in PATCH:', error);
      if (error.code === 'P2002' || error.code === 'P2003' || (error.message && error.message.includes('validation failed'))) {
        return res.status(400).json({ error: 'Validation failed or constraint violation.', details: error.message });
      }
      return res.status(500).json({ error: 'Internal server error while updating settings', details: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 