import crypto from 'crypto';

/**
 * Shopify webhook HMAC verification.
 *
 * Shopify signs every webhook with HMAC-SHA256 over the raw request body using the
 * app's shared secret. The signature is delivered as the `X-Shopify-Hmac-Sha256`
 * header, base64-encoded.
 *
 * `crypto.timingSafeEqual` throws when the two buffers have different lengths; we
 * pre-check and swallow the throw so attackers can't distinguish "length mismatch"
 * from "signature mismatch" via the response shape.
 */
export function verifyShopifyHmac(rawBody: string, headerHmac: string | undefined): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !headerHmac) return false;
  const generated = Buffer.from(
    crypto.createHmac('sha256', secret).update(rawBody).digest('base64'),
  );
  const received = Buffer.from(headerHmac);
  if (generated.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(generated, received);
  } catch {
    return false;
  }
}

/**
 * Read the request body as a single UTF-8 string. Callers MUST disable Next.js's
 * built-in body parser via `export const config = { api: { bodyParser: false } }`
 * for the HMAC to be computed against bytes Shopify actually signed.
 */
export async function readRawBody(
  req: { [Symbol.asyncIterator]: () => AsyncIterator<Buffer | string> },
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
