import crypto from 'crypto';
import type { NextApiRequest } from 'next';

/**
 * Constant-time check of the legacy `x-api-key` header against the internal
 * automation keys (CLAWD_API_KEY / KOLAYXPORT_INTERNAL_API_KEY).
 *
 * Only callers authenticated this way may act on behalf of an arbitrary user
 * (via an explicit user id param). Session/Bearer callers always act as
 * themselves.
 */
export function hasValidInternalApiKeyHeader(req: NextApiRequest): boolean {
  const raw = req.headers['x-api-key'];
  const presented = typeof raw === 'string' ? raw.trim() : '';
  if (!presented) return false;

  const candidates = [process.env.CLAWD_API_KEY, process.env.KOLAYXPORT_INTERNAL_API_KEY].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );

  const p = Buffer.from(presented);
  for (const candidate of candidates) {
    const c = Buffer.from(candidate);
    if (p.length === c.length && crypto.timingSafeEqual(p, c)) return true;
  }
  return false;
}

/**
 * Validate a chrome-extension:// Origin against the configured extension id.
 * Fails closed: if no id is configured, no extension origin is allowed.
 * Accepts OFFICIAL_EXTENSION_ID (used by /api/auth/extension) and, for
 * backwards compatibility, CHROME_EXTENSION_ID.
 */
export function isAllowedExtensionOrigin(origin: string | undefined): boolean {
  if (!origin || !origin.startsWith('chrome-extension://')) return false;
  const id = (process.env.OFFICIAL_EXTENSION_ID || process.env.CHROME_EXTENSION_ID || '').trim();
  if (!id) return false;
  const expected = `chrome-extension://${id}`;
  return origin === expected || origin === `${expected}/`;
}

/**
 * Apply CORS headers for extension-facing endpoints. Only kolayxport.com and the
 * configured official extension origin are reflected; anything else gets no
 * Access-Control-Allow-Origin header.
 */
export function applyExtensionCors(
  req: NextApiRequest,
  res: { setHeader: (name: string, value: string) => unknown },
  methods: string,
): void {
  const origin = req.headers.origin;
  if (origin === 'https://kolayxport.com' || origin === 'https://www.kolayxport.com') {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (isAllowedExtensionOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://kolayxport.com');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Extension-Version, X-Extension-Auth',
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
