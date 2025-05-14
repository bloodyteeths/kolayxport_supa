import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';

// Define the expected response structure (also used by frontend)
interface UserSettingsResponse {
  integrationSettings?: {
    veeqoApiKey?: string | null;
    shippoToken?: string | null;
    fedexApiKey?: string | null;
    fedexApiSecret?: string | null;
    fedexAccountNumber?: string | null;
  } | null;
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
  } | null;
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
      // ensure a settings row exists for every user
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

      // now fetch from the new tables only
      const integrationSettings = await prisma.userIntegrationSettings.findUnique({
        where: { userId },
      });
      const shipperProfile = await prisma.shipperProfile.findUnique({
        where: { userId },
      });

      res.status(200).json({
        integrationSettings: integrationSettings || null, 
        shipperProfile: shipperProfile || null,
      });
    } catch (error: any) {
      console.error('[API GET /user/settings] Error fetching settings:', error);
      res.status(500).json({ error: 'Failed to fetch settings', details: error.message });
    }
  } else if (req.method === 'PATCH') {
    try {
      const { integrationSettings: intSettingsData, shipperProfile: spData } = req.body as UserSettingsResponse;

      let finalIntSettingsData: any = null;
      if (intSettingsData) {
        finalIntSettingsData = { userId };
        for (const [key, value] of Object.entries(intSettingsData)) {
          finalIntSettingsData[key] = value === undefined ? null : value;
        }
      }

      let finalSpData: any = null;
      if (spData) {
        finalSpData = { userId };
        for (const [key, value] of Object.entries(spData)) {
          finalSpData[key] = value === undefined ? null : value;
        }
      }
      
      if (finalIntSettingsData) {
        await prisma.userIntegrationSettings.upsert({
          where: { userId },
          create: finalIntSettingsData,
          update: finalIntSettingsData,
        });
      }

      if (finalSpData) {
        await prisma.shipperProfile.upsert({
          where: { userId },
          create: finalSpData,
          update: finalSpData,
        });
      }
      
      const updatedIntegrationSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId } });
      const updatedShipperProfile = await prisma.shipperProfile.findUnique({ where: { userId } });

      res.status(200).json({ 
        integrationSettings: updatedIntegrationSettings || null,
        shipperProfile: updatedShipperProfile || null,
      });
    } catch (error: any) {
      console.error('[API PATCH /user/settings] Error updating settings:', error);
      if (error.code === 'P2002' || error.code === 'P2003' || (error.message && error.message.includes('validation failed'))) {
         return res.status(400).json({ error: 'Validation failed or constraint violation.', details: error.message });
      }
      res.status(500).json({ error: 'Failed to update settings', details: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PATCH']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 