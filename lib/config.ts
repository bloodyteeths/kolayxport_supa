// lib/config.ts

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

const requiredEnvVarsDefinition: Record<string, { value: string | undefined, notes?: string }> = {
  VEEQO_API_KEY: { value: VEEQO_API_KEY, notes: "Veeqo API Key" },
  VEEQO_ORDERS_URL: { value: VEEQO_ORDERS_URL, notes: "Veeqo Orders URL" },
  SHIPPO_TOKEN: { value: SHIPPO_TOKEN, notes: "Shippo API Token" },
  FEDEX_API_KEY: { value: FEDEX_API_KEY, notes: "FedEx API Key" },
  FEDEX_API_SECRET: { value: FEDEX_API_SECRET, notes: "FedEx API Secret" },
  FEDEX_ACCOUNT_NUMBER: { value: FEDEX_ACCOUNT_NUMBER, notes: "FedEx Account Number" },
  FEDEX_FOLDER_ID: { value: FEDEX_FOLDER_ID, notes: "FedEx Folder ID (e.g., for Supabase storage)" },
  SHIPPER_NAME: { value: SHIPPER_NAME, notes: "Shipper Name" },
  SHIPPER_PERSON_NAME: { value: SHIPPER_PERSON_NAME, notes: "Shipper Contact Person" },
  SHIPPER_PHONE_NUMBER: { value: SHIPPER_PHONE_NUMBER, notes: "Shipper Phone Number" },
  SHIPPER_STREET_1: { value: SHIPPER_STREET_1, notes: "Shipper Address Line 1" },
  SHIPPER_CITY: { value: SHIPPER_CITY, notes: "Shipper City" },
  SHIPPER_STATE_CODE: { value: SHIPPER_STATE_CODE, notes: "Shipper State Code" },
  SHIPPER_POSTAL_CODE: { value: SHIPPER_POSTAL_CODE, notes: "Shipper Postal Code" },
  SHIPPER_COUNTRY_CODE: { value: SHIPPER_COUNTRY_CODE, notes: "Shipper Country Code (ISO)" },
  SHIPPER_TIN_NUMBER: { value: SHIPPER_TIN_NUMBER, notes: "Shipper Tax ID Number" },
  SHIPPER_TIN_TYPE: { value: SHIPPER_TIN_TYPE, notes: "Shipper Tax ID Type (e.g., FEDERAL_TAX_ID)" },
  DEFAULT_CURRENCY_CODE: { value: DEFAULT_CURRENCY_CODE, notes: "Default Currency Code (e.g., USD, TRY)" },
};

const missingVars = Object.entries(requiredEnvVarsDefinition)
  .filter(([key, config]) => !config.value)
  .map(([key, config]) => `${key} (${config.notes || 'General Setting'})`);

if (missingVars.length > 0) {
  const errorMessage = `[Config Validation Error] Missing required environment variables at startup: ${missingVars.join(', ')}. Please check your .env file and server configuration.`;
  console.error(errorMessage); // Log to server console
  throw new Error(errorMessage); // Prevent application startup
}

// console.log("[Config Info] All required environment variables loaded successfully."); 