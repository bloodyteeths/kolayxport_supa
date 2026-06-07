// lib/config.ts
import prisma from './prisma';
import { decryptIfNeeded } from './crypto/credentials';

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

  // Every secret-bearing field is wrapped in `decryptIfNeeded` so callers always
  // see plaintext, regardless of whether the row was written by the legacy
  // `lib/encryption.ts` flow or the new `lib/crypto/credentials.ts` envelope.
  return {
    veeqoApiKey: decryptIfNeeded(integration.veeqoApiKey),
    shippoToken: decryptIfNeeded(integration.shippoToken),
    fedexApiKey: decryptIfNeeded(integration.fedexApiKey),
    fedexApiSecret: decryptIfNeeded(integration.fedexApiSecret),
    fedexAccountNumber: integration.fedexAccountNumber,
    fedexMeterNumber: integration.fedexMeterNumber,
    trendyolSupplierId: integration.trendyolSupplierId,
    trendyolApiKey: decryptIfNeeded(integration.trendyolApiKey),
    trendyolApiSecret: decryptIfNeeded(integration.trendyolApiSecret),
  };
}


// Veeqo
export const VEEQO_API_KEY = process.env.VEEQO_API_KEY;
export const VEEQO_ORDERS_URL = process.env.VEEQO_ORDERS_URL;

// Shippo
export const SHIPPO_TOKEN = process.env.SHIPPO_TOKEN;

// Trendyol Marketplace Integration
export const MARKETPLACE_TRENDYOL = process.env.MARKETPLACE_TRENDYOL === 'true';
export const TRENDYOL_SUPPLIER_ID = process.env.TRENDYOL_SUPPLIER_ID;
export const TRENDYOL_API_KEY = process.env.TRENDYOL_API_KEY;
export const TRENDYOL_API_SECRET = process.env.TRENDYOL_API_SECRET;
export const ALLOW_TRENDYOL_USERS = process.env.ALLOW_TRENDYOL_USERS?.split(',').map(id => id.trim()) || [];

// Helper function to check if Trendyol is enabled for a specific user
export function isTrendyolEnabled(userId?: string): boolean {
  if (!MARKETPLACE_TRENDYOL) return false;
  
  // If no user restrictions, allow all users
  if (ALLOW_TRENDYOL_USERS.length === 0) return true;
  
  // Check if user is in the allowed list
  return userId ? ALLOW_TRENDYOL_USERS.includes(userId) : false;
}

// Wix Marketplace Integration
export const MARKETPLACE_WIX = process.env.MARKETPLACE_WIX === 'true';
export const ALLOW_WIX_USERS = process.env.ALLOW_WIX_USERS?.split(',').map(id => id.trim()) || [];

export function isWixEnabled(userId?: string): boolean {
  if (!MARKETPLACE_WIX) return false;
  if (ALLOW_WIX_USERS.length === 0) return true;
  return userId ? ALLOW_WIX_USERS.includes(userId) : false;
}

// Shopify Marketplace Integration
// Defaults to enabled — Shopify is a public App Store integration, not a gated beta.
// Set MARKETPLACE_SHOPIFY=false in env to emergency-disable.
export const MARKETPLACE_SHOPIFY = process.env.MARKETPLACE_SHOPIFY !== 'false';
export const ALLOW_SHOPIFY_USERS = process.env.ALLOW_SHOPIFY_USERS?.split(',').map(id => id.trim()) || [];

export function isShopifyEnabled(userId?: string): boolean {
  if (!MARKETPLACE_SHOPIFY) return false;
  if (ALLOW_SHOPIFY_USERS.length === 0) return true;
  return userId ? ALLOW_SHOPIFY_USERS.includes(userId) : false;
}

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