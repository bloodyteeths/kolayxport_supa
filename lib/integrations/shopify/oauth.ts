import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Shopify OAuth helpers shared by /install, /connect and /callback.
 *
 * The `state` param is HMAC-signed with the app secret so it can't be forged
 * (e.g. a crafted `userId` that links an attacker's shop to someone else's
 * account), and its nonce is bound to the browser that started the flow via an
 * HttpOnly cookie — the standard Shopify OAuth CSRF protection.
 */

export const SHOPIFY_SCOPES = 'read_orders,read_products,write_products,read_inventory,write_inventory';

const NONCE_COOKIE = 'shopify_oauth_nonce';
const NONCE_MAX_AGE_SECONDS = 10 * 60;

export interface ShopifyOAuthState {
  nonce: string;
  shop: string;
  appStoreInstall?: boolean;
  userId?: string;
}

export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

/** Normalizes "mystore" / "mystore.myshopify.com" / "https://mystore.myshopify.com/" input; null if invalid. */
export function normalizeShopDomain(input: string): string | null {
  let shop = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!shop.endsWith('.myshopify.com')) shop = `${shop}.myshopify.com`;
  return isValidShopDomain(shop) ? shop : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Verifies the `hmac` Shopify adds to install/callback query strings. */
export function verifyShopifyQueryHmac(
  query: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const hmac = query.hmac;
  if (typeof hmac !== 'string') return false;

  const message = Object.entries(query)
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return safeEqual(expected, hmac);
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

/** Creates a signed state and sets the matching nonce cookie on the response. */
export function createOAuthState(
  res: NextApiResponse,
  payload: Omit<ShopifyOAuthState, 'nonce'>,
  secret: string,
): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = Buffer.from(JSON.stringify({ ...payload, nonce })).toString('base64url');
  const secure = (process.env.NEXTAUTH_URL || '').startsWith('https://');
  appendCookie(
    res,
    [
      `${NONCE_COOKIE}=${nonce}`,
      'Path=/api/integrations/shopify',
      'HttpOnly',
      `Max-Age=${NONCE_MAX_AGE_SECONDS}`,
      'SameSite=Lax',
      ...(secure ? ['Secure'] : []),
    ].join('; '),
  );
  return `${body}.${sign(body, secret)}`;
}

/** Returns the decoded state if its signature, nonce cookie and shop all match; otherwise null. */
export function verifyOAuthState(
  req: NextApiRequest,
  state: string,
  shop: string,
  secret: string,
): ShopifyOAuthState | null {
  const [body, sig] = state.split('.');
  if (!body || !sig || !safeEqual(sign(body, secret), sig)) return null;

  let decoded: ShopifyOAuthState;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  const cookieNonce = req.cookies?.[NONCE_COOKIE];
  if (!cookieNonce || typeof decoded.nonce !== 'string' || !safeEqual(cookieNonce, decoded.nonce)) return null;
  if (decoded.shop !== shop) return null;
  return decoded;
}

/** Adds a Set-Cookie without dropping cookies already set on the response (e.g. the session). */
export function appendCookie(res: NextApiResponse, cookie: string) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function clearOAuthNonceCookie(res: NextApiResponse) {
  appendCookie(res, `${NONCE_COOKIE}=; Path=/api/integrations/shopify; HttpOnly; Max-Age=0; SameSite=Lax`);
}
