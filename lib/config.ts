// lib/config.ts
import prisma from './prisma';

/**
 * Configuration and integration credential management.
 *
 * For user-specific integrations (Veeqo, Shippo, FedEx, etc.), credentials are fetched strictly from the database (Credential, ShipperProfile).
 * There is NO fallback to process.env for user operations. If credentials are missing, an error is thrown or null is returned.
 * process.env is only used for system-wide, non-user-specific config.
 */

// System-wide config (for app-level integrations only)
export const SYSTEM_API_KEY = process.env.SYSTEM_API_KEY;

export async function getIntegrationCreds(userId: string) {
  if (!userId) throw new Error('Missing userId');

  // Fetch from Credential
  const integration = await prisma.credential.findUnique({ where: { userId } });
  if (!integration) throw new Error('No integration settings found');

  return {
    veeqoApiKey: integration.veeqoApiKey,
    shippoToken: integration.shippoToken,
    fedexApiKey: integration.fedexApiKey,
    fedexApiSecret: integration.fedexApiSecret,
    fedexAccountNumber: integration.fedexAccountNumber,
    fedexMeterNumber: integration.fedexMeterNumber,
  };
}


// Veeqo
export const VEEQO_API_KEY = process.env.VEEQO_API_KEY;
export const VEEQO_ORDERS_URL = process.env.VEEQO_ORDERS_URL;

// Shippo
export const SHIPPO_TOKEN = process.env.SHIPPO_TOKEN;

// FedEx & Global Shipper Details
export const FEDEX_API_KEY = process.env.FEDEX_API_KEY;
export const FEDEX_API_SECRET = process.env.FEDEX_API_SECRET;
export const FEDEX_ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER;
export const FEDEX_FOLDER_ID = process.env.FEDEX_FOLDER_ID;

export const SHIPPER_NAME = process.env.SHIPPER_NAME;
export const SHIPPER_PERSON_NAME = process.env.SHIPPER_PERSON_NAME;
export const SHIPPER_PHONE_NUMBER = process.env.SHIPPER_PHONE_NUMBER;
export const SHIPPER_STREET_1 = process.env.SHIPPER_STREET_1;
export const SHIPPER_CITY = process.env.SHIPPER_CITY;
export const SHIPPER_STATE_CODE = process.env.SHIPPER_STATE_CODE;
export const SHIPPER_POSTAL_CODE = process.env.SHIPPER_POSTAL_CODE;
export const SHIPPER_COUNTRY_CODE = process.env.SHIPPER_COUNTRY_CODE;
export const SHIPPER_TIN_NUMBER = process.env.SHIPPER_TIN_NUMBER;
export const SHIPPER_TIN_TYPE = process.env.SHIPPER_TIN_TYPE;
export const DEFAULT_CURRENCY_CODE = process.env.DEFAULT_CURRENCY_CODE;

// console.log("[Config Info] All required environment variables loaded successfully."); 