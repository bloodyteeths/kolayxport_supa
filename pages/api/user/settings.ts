import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

// Types for integration settings
interface IntegrationSettings {
  veeqoApiKey: string | null;
  shippoToken: string | null;
  fedexApiKey: string | null;
  fedexApiSecret: string | null;
  fedexAccountNumber: string | null;
}

// Types for shipper profile
interface ShipperProfile {
  shipperName: string | null;
  shipperPersonName: string | null;
  shipperPhoneNumber: string | null;
  shipperStreet1: string | null;
  shipperStreet2: string | null;
  shipperCity: string | null;
  shipperStateCode: string | null;
  shipperPostalCode: string | null;
  shipperCountryCode: string | null;
  shipperTinNumber: string | null;
  importerOfRecord: string | null;
  fedexFolderId: string | null;
  defaultCurrencyCode: string | null;
  dutiesPaymentType: string | null;
}

// Response type
interface UserSettingsResponse {
  integrationSettings: IntegrationSettings | null;
  shipperProfile: ShipperProfile | null;
}

// Request body type for PATCH
interface UpdateSettingsRequest {
  integrationSettings?: Partial<IntegrationSettings>;
  shipperProfile?: Partial<ShipperProfile>;
}

// Error response type
interface ErrorResponse {
  error: string;
  details?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserSettingsResponse | ErrorResponse>
) {
  try {
    // Get authenticated user
    const supabase = getSupabaseServerClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session?.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = session.user.id;

    if (req.method === 'GET') {
      // Fetch user settings from new tables
      const [integrationSettings, shipperProfile] = await Promise.all([
        prisma.userIntegrationSettings.findUnique({
          where: { userId },
          select: {
            veeqoApiKey: true,
            shippoToken: true,
            fedexApiKey: true,
            fedexApiSecret: true,
            fedexAccountNumber: true,
          },
        }),
        prisma.shipperProfile.findUnique({
          where: { userId },
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
            importerOfRecord: true,
            fedexFolderId: true,
            defaultCurrencyCode: true,
            dutiesPaymentType: true,
          },
        }),
      ]);

      return res.status(200).json({
        integrationSettings,
        shipperProfile,
      });
    }

    if (req.method === 'PATCH') {
      const { integrationSettings, shipperProfile } = req.body as UpdateSettingsRequest;

      // Validate request body
      if (!integrationSettings && !shipperProfile) {
        return res.status(400).json({
          error: 'Bad Request',
          details: 'At least one of integrationSettings or shipperProfile must be provided',
        });
      }

      // Update integration settings if provided
      let updatedIntegrationSettings = null;
      if (integrationSettings) {
        updatedIntegrationSettings = await prisma.userIntegrationSettings.upsert({
          where: { userId },
          create: {
            userId,
            ...integrationSettings,
          },
          update: integrationSettings,
          select: {
            veeqoApiKey: true,
            shippoToken: true,
            fedexApiKey: true,
            fedexApiSecret: true,
            fedexAccountNumber: true,
          },
        });
      }

      // Update shipper profile if provided
      let updatedShipperProfile = null;
      if (shipperProfile) {
        updatedShipperProfile = await prisma.shipperProfile.upsert({
          where: { userId },
          create: {
            userId,
            ...shipperProfile,
          },
          update: shipperProfile,
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
            importerOfRecord: true,
            fedexFolderId: true,
            defaultCurrencyCode: true,
            dutiesPaymentType: true,
          },
        });
      }

      return res.status(200).json({
        integrationSettings: updatedIntegrationSettings,
        shipperProfile: updatedShipperProfile,
      });
    }

    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  } catch (error) {
    console.error('[Settings API] Error:', error);

    // Handle Prisma column not found errors
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
      return res.status(500).json({
        error: 'Schema mismatch: outdated User columns referenced',
        details: error.message,
      });
    }

    // Handle validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.message,
      });
    }

    // Handle all other errors
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
} 