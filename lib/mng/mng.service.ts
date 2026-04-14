// ---------------------------------------------------------------------------
// MNG Kargo (DHL eCommerce Turkey) — Service Layer
// ---------------------------------------------------------------------------

import { logger } from '../logger';
import { MNG_ENDPOINTS } from './mng.config';
import type {
  MngCredentials,
  MngAuthRequest,
  MngAuthResponse,
  MngOrderRequest,
  MngOrderResponse,
  MngInvoiceResponse,
  MngTrackingResponse,
  MngShipmentResult,
} from './mng.types';

// ─── Token Cache ─────────────────────────────────────────────────────────────

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

function getBaseUrl(env: MngCredentials['environment']): string {
  return MNG_ENDPOINTS[env].base;
}

function getTokenUrl(env: MngCredentials['environment']): string {
  return MNG_ENDPOINTS[env].token;
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Get a JWT token from MNG Identity API.
 * Tokens are cached per customerNumber and refreshed before expiry.
 */
export async function getMngToken(credentials: MngCredentials): Promise<string> {
  const cacheKey = `${credentials.customerNumber}_${credentials.environment}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const body: MngAuthRequest = {
    customerNumber: credentials.customerNumber,
    password: credentials.password,
    identityType: 1,
  };

  const tokenUrl = getTokenUrl(credentials.environment);
  logger.info(`[MNG] Requesting JWT token from ${tokenUrl}`);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error(`[MNG] Token request failed (${res.status}): ${text}`);
    throw new Error(`MNG auth failed (${res.status}): ${text}`);
  }

  const data: MngAuthResponse = await res.json();

  if (!data.token) {
    throw new Error('MNG auth returned no token');
  }

  // Cache for ~4 hours (typical JWT lifetime), minus buffer
  const expiresAt = data.expireDate
    ? new Date(data.expireDate).getTime() - TOKEN_BUFFER_MS
    : Date.now() + (4 * 60 * 60 * 1000) - TOKEN_BUFFER_MS;

  tokenCache.set(cacheKey, { token: data.token, expiresAt });
  logger.info('[MNG] JWT token obtained and cached');

  return data.token;
}

// ─── Authenticated Request Helper ────────────────────────────────────────────

async function mngRequest<T = any>(
  credentials: MngCredentials,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getMngToken(credentials);
  const baseUrl = getBaseUrl(credentials.environment);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const text = await res.text();
    logger.error(`[MNG] API ${res.status} ${path}: ${text}`);
    throw new Error(`MNG API ${res.status}: ${text}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }

  // For binary responses (labels/PDFs)
  return res.text() as unknown as T;
}

// ─── Order Creation (Plus Command API) ───────────────────────────────────────

/**
 * Create a shipment order via the Plus Command API.
 * Returns order reference, barcode, and bill of landing ID.
 */
export async function createMngOrder(
  credentials: MngCredentials,
  order: MngOrderRequest
): Promise<MngOrderResponse> {
  logger.info(`[MNG] Creating order: ref=${order.referenceId}`);

  const data = await mngRequest<MngOrderResponse>(
    credentials,
    '/standardcommand/order',
    {
      method: 'POST',
      body: JSON.stringify({
        order: {
          referenceId: order.referenceId,
          barcode: order.barcode || '',
          billOfLandingId: order.billOfLandingId || '',
          isCOD: order.isCOD,
          codAmount: order.codAmount || 0,
          shipmentServiceType: order.shipmentServiceType,
          packagingType: order.packagingType,
          content: order.content,
          smsPreference1: order.smsPreference1,
          smsPreference2: order.smsPreference2,
          smsPreference3: order.smsPreference3,
          paymentType: order.paymentType,
          deliveryType: order.deliveryType,
          description: order.description || '',
          marketPlaceShortCode: order.marketPlaceShortCode || '',
          marketPlaceSaleCode: order.marketPlaceSaleCode || '',
          pudoId: order.pudoId || '',
          recipient: order.recipient,
          parcels: order.parcels,
        },
      }),
    }
  );

  logger.info(`[MNG] Order created: barcode=${data.barcode}, ref=${data.referenceId}`);
  return data;
}

// ─── Invoice / Barcode (Barcode Command API) ────────────────────────────────

/**
 * Convert an order to a shipment via invoicing.
 * This is step 2 — after creating the order, invoice it to get the label/barcode.
 */
export async function invoiceMngOrder(
  credentials: MngCredentials,
  params: { referenceId?: string; billOfLandingId?: string; barcode?: string }
): Promise<MngInvoiceResponse> {
  logger.info(`[MNG] Invoicing order: ref=${params.referenceId || params.barcode}`);

  const data = await mngRequest<MngInvoiceResponse>(
    credentials,
    '/barcodecommand/invoice',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );

  logger.info(`[MNG] Invoice result: barcode=${data.barcode}, success=${data.isSuccess}`);
  return data;
}

/**
 * Get label/barcode PDF for a shipment.
 */
export async function getMngLabel(
  credentials: MngCredentials,
  barcode: string
): Promise<string> {
  logger.info(`[MNG] Fetching label for barcode=${barcode}`);

  const data = await mngRequest<any>(
    credentials,
    `/barcodecommand/label?barcode=${encodeURIComponent(barcode)}`,
    { method: 'GET' }
  );

  // Returns base64-encoded label or URL
  return data.labelBase64 || data.labelUrl || data;
}

// ─── Tracking (Standard Query API) ──────────────────────────────────────────

/**
 * Track a shipment by barcode or bill of landing ID.
 */
export async function trackMngShipment(
  credentials: MngCredentials,
  params: { barcode?: string; billOfLandingId?: string }
): Promise<MngTrackingResponse> {
  const queryKey = params.barcode ? 'barcode' : 'billOfLandingId';
  const queryVal = params.barcode || params.billOfLandingId || '';

  logger.info(`[MNG] Tracking shipment: ${queryKey}=${queryVal}`);

  const data = await mngRequest<MngTrackingResponse>(
    credentials,
    `/standardquery/shipmentinfo?${queryKey}=${encodeURIComponent(queryVal)}`,
    { method: 'GET' }
  );

  return data;
}

// ─── Cancellation ───────────────────────────────────────────────────────────

/**
 * Cancel a shipment by barcode.
 */
export async function cancelMngShipment(
  credentials: MngCredentials,
  barcode: string
): Promise<{ isSuccess: boolean; message?: string }> {
  logger.info(`[MNG] Cancelling shipment: barcode=${barcode}`);

  const data = await mngRequest<any>(
    credentials,
    '/barcodecommand/cancel',
    {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    }
  );

  return { isSuccess: data.isSuccess ?? true, message: data.message };
}

// ─── Full Shipment Flow ─────────────────────────────────────────────────────

/**
 * Complete shipment flow:
 * 1. Create order (Plus Command)
 * 2. Invoice order (Barcode Command) to get label
 * Returns unified MngShipmentResult.
 */
export async function createMngShipment(
  credentials: MngCredentials,
  order: MngOrderRequest
): Promise<MngShipmentResult> {
  // Step 1: Create the order
  const orderResult = await createMngOrder(credentials, order);

  if (!orderResult.isSuccess && orderResult.resultCode !== '0') {
    throw new Error(`MNG order creation failed: ${orderResult.message || 'Unknown error'}`);
  }

  const barcode = orderResult.barcode || '';
  const billOfLandingId = orderResult.billOfLandingId || '';

  // Step 2: Invoice to get label
  let labelBase64: string | undefined;
  let labelUrl: string | undefined;

  try {
    const invoiceResult = await invoiceMngOrder(credentials, {
      referenceId: order.referenceId,
      barcode,
      billOfLandingId,
    });

    labelBase64 = invoiceResult.labelBase64;
    labelUrl = invoiceResult.labelUrl;
  } catch (err: any) {
    logger.warn(`[MNG] Invoice/label step failed (order still created): ${err.message}`);
    // Order was created, label can be fetched later
  }

  // If no label from invoice, try fetching directly
  if (!labelBase64 && !labelUrl && barcode) {
    try {
      const labelData = await getMngLabel(credentials, barcode);
      if (typeof labelData === 'string' && labelData.length > 100) {
        labelBase64 = labelData;
      } else {
        labelUrl = labelData;
      }
    } catch (err: any) {
      logger.warn(`[MNG] Direct label fetch failed: ${err.message}`);
    }
  }

  return {
    trackingNumber: barcode || billOfLandingId,
    barcode,
    billOfLandingId,
    labelBase64,
    labelUrl,
  };
}

// ─── Test Connection ────────────────────────────────────────────────────────

/**
 * Test MNG API credentials by attempting to get a token.
 */
export async function testMngConnection(credentials: MngCredentials): Promise<boolean> {
  try {
    await getMngToken(credentials);
    return true;
  } catch {
    return false;
  }
}
