import crypto from 'crypto';

/**
 * Etsy webhooks use the Standard Webhooks (Svix) signing scheme:
 *   signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *   key            = base64-decode(secret without the "whsec_" prefix)
 *   signature      = base64(HMAC-SHA256(key, signed content))
 *   header         = "v1,<sig>" — possibly several, space-separated (secret rotation)
 * Timestamps more than 5 minutes from now are rejected (replay protection).
 */

export const ETSY_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type EtsyWebhookVerifyResult =
  | { ok: true; webhookId: string; timestamp: number }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale_timestamp' | 'bad_secret' | 'bad_signature' };

function header(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const v = headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function decodeWebhookSecret(secret: string): Buffer | null {
  const trimmed = secret.trim();
  const b64 = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed;
  try {
    const key = Buffer.from(b64, 'base64');
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function computeEtsyWebhookSignature(key: Buffer, webhookId: string, timestamp: string, rawBody: Buffer | string): string {
  return crypto
    .createHmac('sha256', key)
    .update(`${webhookId}.${timestamp}.`)
    .update(rawBody)
    .digest('base64');
}

export function verifyEtsyWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): EtsyWebhookVerifyResult {
  const webhookId = header(headers, 'webhook-id');
  const timestampRaw = header(headers, 'webhook-timestamp');
  const signatureHeader = header(headers, 'webhook-signature');
  if (!webhookId || !timestampRaw || !signatureHeader) return { ok: false, reason: 'missing_headers' };

  if (!/^\d+$/.test(timestampRaw)) return { ok: false, reason: 'bad_timestamp' };
  const timestamp = Number(timestampRaw);
  if (Math.abs(nowSeconds - timestamp) > ETSY_WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' };

  const key = decodeWebhookSecret(secret);
  if (!key) return { ok: false, reason: 'bad_secret' };

  const expected = Buffer.from(computeEtsyWebhookSignature(key, webhookId, timestampRaw, rawBody));
  for (const part of signatureHeader.split(' ')) {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    const presented = Buffer.from(sig);
    if (presented.length === expected.length && crypto.timingSafeEqual(presented, expected)) {
      return { ok: true, webhookId, timestamp };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}
