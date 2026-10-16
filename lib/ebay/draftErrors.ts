// Typed errors raised by the eBay staged-draft engine (listing-editor §7.1 F2).
// Mirrors lib/etsy/draftErrors.ts: API routes map `status` to the HTTP status
// and forward `code` / `key` / `params` so the UI renders a translated message
// (next-intl key relative to the `ebay` namespace, e.g. `draftSync.conflict`)
// instead of a raw English server string. `error` stays in the body as the
// English fallback for logs and older clients.

import { EBAY_LEGACY_LISTING_CODE, EBAY_LEGACY_LISTING_KEY } from './legacy';

export class EbayDraftError extends Error {
  code: string;
  status: number;
  key?: string;
  params?: Record<string, string | number>;
  /** Extra JSON fields forwarded to the response body (e.g. `missingAspects`). */
  extra?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    opts: { status?: number; key?: string; params?: Record<string, string | number>; extra?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'EbayDraftError';
    this.code = code;
    this.status = opts.status ?? 400;
    this.key = opts.key;
    this.params = opts.params;
    this.extra = opts.extra;
  }
}

/**
 * The listing was created on eBay (Trading API, SKU `legacy-<itemId>`): the Inventory API cannot edit it, so nothing
 * is staged. `key` is the full next-intl key (root namespace); the editor adapter accepts both forms.
 */
export function ebayLegacyListingError(sku: string): EbayDraftError {
  return new EbayDraftError(EBAY_LEGACY_LISTING_CODE, `Listing ${sku} was created on eBay; edit it on eBay`, {
    status: 409,
    key: EBAY_LEGACY_LISTING_KEY,
  });
}

export function isEbayDraftError(err: unknown): err is EbayDraftError {
  return Boolean(err) && (err as { name?: unknown }).name === 'EbayDraftError' && typeof (err as { code?: unknown }).code === 'string';
}

/** Known eBay error messages → typed codes. Pure (exported for tests). */
export function classifyEbayError(err: unknown): EbayDraftError {
  if (isEbayDraftError(err)) return err;
  const message = String((err as { message?: unknown } | null)?.message || err || 'eBay request failed');

  const missingAspects: string[] = [];
  const aspectRegex = /The item specific (.+?) is missing/g;
  let match: RegExpExecArray | null;
  while ((match = aspectRegex.exec(message)) !== null) missingAspects.push(match[1].trim());
  if (missingAspects.length) {
    return new EbayDraftError('MISSING_ASPECTS', message, {
      status: 422,
      key: 'draftSync.missingAspects',
      params: { aspects: missingAspects.join(', ') },
      extra: { missingAspects },
    });
  }
  if (message.includes('Item.Country')) {
    return new EbayDraftError('LOCATION_REQUIRED', message, { status: 422, key: 'draftSync.locationRequired' });
  }
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { code?: unknown } | null)?.code;
  if (name === 'EbayNotConnectedError' || code === 'NO_EBAY_CONNECTION' || /^eBay API 401\b/.test(message) || /not connected|no ebay credential|credential not found|refresh token|invalid_grant|reconnect/i.test(message)) {
    return new EbayDraftError('REAUTH_REQUIRED', message, { status: 401, key: 'draftSync.reauthRequired' });
  }
  return new EbayDraftError('EBAY_REJECTED', message, { status: 502, key: 'draftSync.rejected' });
}

/** Shape an error for a JSON API response. Never leaks stack traces. */
export function ebayDraftErrorResponse(err: unknown, fallback: string): { status: number; body: Record<string, unknown> } {
  if (isEbayDraftError(err)) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        ...(err.key ? { key: err.key } : {}),
        ...(err.params ? { params: err.params } : {}),
        ...(err.extra || {}),
      },
    };
  }
  const message = (err as { message?: unknown } | null)?.message;
  return { status: 500, body: { error: typeof message === 'string' && message ? message : fallback } };
}
