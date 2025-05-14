import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

// Response types
interface UserSettingsResponse {
  integrationSettings: {
    veeqoApiKey: string | null;
    shippoToken: string | null;
    fedexApiKey: string | null;
    fedexApiSecret: string | null;
    fedexAccountNumber: string | null;
  } | null;
  shipperProfile: {
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
  } | null;
}

interface ErrorResponse {
  error: string;
  details?: string;
  code?: string;
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
      console.error('[Settings API] Auth error:', authError);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = session.user.id;
    console.log('[Settings API] Processing request for user:', userId);

    if (req.method === 'GET') {
      try {
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

        console.log('[Settings API] Successfully fetched settings:', {
          hasIntegrationSettings: !!integrationSettings,
          hasShipperProfile: !!shipperProfile,
        });

        return res.status(200).json({
          integrationSettings,
          shipperProfile,
        });
      } catch (error) {
        console.error('[Settings API] Error fetching settings:', error);
        throw error; // Re-throw to be caught by outer try-catch
      }
    }

    if (req.method === 'PATCH') {
      const { integrationSettings, shipperProfile } = req.body;

      // Validate request body
      if (!integrationSettings && !shipperProfile) {
        return res.status(400).json({
          error: 'Bad Request',
          details: 'At least one of integrationSettings or shipperProfile must be provided',
        });
      }

      try {
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

        console.log('[Settings API] Successfully updated settings:', {
          hasIntegrationSettings: !!updatedIntegrationSettings,
          hasShipperProfile: !!updatedShipperProfile,
        });

        return res.status(200).json({
          integrationSettings: updatedIntegrationSettings,
          shipperProfile: updatedShipperProfile,
        });
      } catch (error) {
        console.error('[Settings API] Error updating settings:', error);
        throw error; // Re-throw to be caught by outer try-catch
      }
    }

    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  } catch (error) {
    console.error('[Settings API] Unhandled error:', error);

    // Handle Prisma column not found errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('[Settings API] Prisma error details:', {
        code: error.code,
        message: error.message,
        meta: error.meta,
      });

      if (error.code === 'P2022') {
        return res.status(500).json({
          error: 'Database Schema Error',
          details: 'The database schema is out of sync with the application. Please contact support.',
          code: error.code,
        });
      }

      return res.status(400).json({
        error: 'Database Error',
        details: error.message,
        code: error.code,
      });
    }

    // Handle validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      console.error('[Settings API] Validation error:', error.message);
      return res.status(400).json({
        error: 'Validation Error',
        details: error.message,
      });
    }

    // Handle all other errors
    console.error('[Settings API] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
} 