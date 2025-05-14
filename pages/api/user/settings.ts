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
    importerOfRecord?: any;
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

  try {
    // Ensure records exist
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
  } catch (e) {
    console.error('Initialization error:', e);
    return res.status(500).json({ error: 'Initialization failed' });
  }

  if (req.method === 'GET') {
    try {
      const integrationSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId } });
      const shipperProfile = await prisma.shipperProfile.findUnique({ where: { userId } });
      return res.status(200).json({ integrationSettings, shipperProfile });
    } catch (error: any) {
      console.error('[User Settings API] GET error:', error);
      if (error.code === 'P2022') {
        return res.status(500).json({ error: 'Schema mismatch: legacy User column still referenced' });
      }
      return res.status(500).json({ error: 'Failed to fetch settings', details: error.message });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { integrationSettings: intBody, shipperProfile: spBody } = req.body as UserSettingsResponse;
      const sanitize = (data: any) =>
        Object.fromEntries(
          Object.entries(data || {}).map(([k, v]) => [k, v === undefined ? null : v])
        );

      if (intBody) {
        await prisma.userIntegrationSettings.update({ where: { userId }, data: sanitize(intBody) });
      }
      if (spBody) {
        await prisma.shipperProfile.update({ where: { userId }, data: sanitize(spBody) });
      }

      const integrationSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId } });
      const shipperProfile = await prisma.shipperProfile.findUnique({ where: { userId } });
      return res.status(200).json({ integrationSettings, shipperProfile });
    } catch (error: any) {
      console.error('[User Settings API] PATCH error:', error);
      if (error.code === 'P2022') {
        return res.status(500).json({ error: 'Schema mismatch: legacy User column still referenced' });
      }
      const isValidation = ['P2002', 'P2003'].includes(error.code) || /validation failed/.test(error.message);
      return res.status(isValidation ? 400 : 500).json({ error: error.message, details: error.meta });
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
} 