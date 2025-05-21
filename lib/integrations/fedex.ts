/**
 * FedEx REST v1 basic helper – OAuth & Shipment
 *
 * NOTE: This is a stub. Replace the TODO sections with real logic.
 */
import fetch from 'node-fetch';

export interface FedexCreds {
  apiKey: string;
  apiSecret: string;
  accountNumber: string;
}

export interface FedexPayload {
  // keep minimal for now – extend with real fields as you build out the flow
  labelResponseOptions: 'URL_ONLY' | 'LABEL';
  requestedShipment: unknown;
}

export interface FedexResult {
  success: boolean;
  pdfUrl?: string;
  trackingNumber?: string;
  alerts?: string[];
  errors?: string[];
  raw?: any;
}

/**
 * Obtain OAuth token. Memoise for simple reuse in stateless environments.
 */
export async function getFedexOAuthToken(creds: Pick<FedexCreds, 'apiKey' | 'apiSecret'>): Promise<string> {
  const payload = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.apiKey,
    client_secret: creds.apiSecret,
  }).toString();

  const res = await fetch('https://apis.fedex.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  if (!res.ok) {
    throw new Error(`FedEx OAuth error: HTTP ${res.status} – ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/**
 * Call FedEx Ship API.
 * Returns a uniform FedexResult object.
 */
export async function createShipment(
  creds: FedexCreds,
  payload: FedexPayload,
): Promise<FedexResult> {
  try {
    const token = await getFedexOAuthToken(creds);

    const res = await fetch('https://apis.fedex.com/ship/v1/shipments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, accountNumber: { value: creds.accountNumber } }),
    });

    const raw: any = await res.json();

    if (!res.ok) {
      return {
        success: false,
        errors: raw?.errors?.map((e: any) => e.message) ?? ['Unknown FedEx error'],
        raw,
      };
    }

    const tx = raw?.output?.transactionShipments?.[0];
    const pdfUrl =
      tx?.pieceResponses?.[0]?.packageDocuments?.find(
        (d: any) => /label/i.test(d.docType) || /label/i.test(d.contentType),
      )?.url ?? undefined;

    return {
      success: true,
      pdfUrl,
      trackingNumber: tx?.masterTrackingNumber,
      alerts: raw?.output?.alerts?.map((a: any) => a.message),
      raw,
    };
  } catch (err: any) {
    return { success: false, errors: [err.message ?? 'Unknown exception'], raw: err };
  }
}
