/**
 * Stable error codes stored in `lastSyncError` of EtsyListingDraft / EbayListingDraft
 * (CatalogDraft already stores `listings.*` keys). ISOMORPHIC: no server imports.
 *
 * The stored value is a full next-intl key (root namespace), e.g. `etsy.draftSync.rateLimited`.
 * The raw English error stays on the matching sync attempt row (`EtsyDraftSyncAttempt.error` /
 * `EbayDraftSyncAttempt.error`); ICU params, when the key has any, go to that attempt's
 * `result.errorParams`. Mapping table: docs/integration/draft-sync-error-codes.md.
 *
 * Older rows still hold English text; readers must accept both (see `isStoredErrorKey`).
 */

export type StoredDraftError = { key: string; params?: Record<string, string | number> };

/** Same shape lib/listings/query.ts accepts as an i18n key. */
const STORED_KEY_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

export function isStoredErrorKey(v: unknown): v is string {
  return typeof v === 'string' && STORED_KEY_RE.test(v.trim());
}

export const ETSY_DRAFT_ERROR = {
  interrupted: 'etsy.draftSync.interrupted',
  conflict: 'etsy.draftSync.conflict',
  reauthRequired: 'etsy.draftSync.reauthRequired',
  rateLimited: 'etsy.draftSync.rateLimited',
  whoMadeRequired: 'etsy.draftSync.whoMadeRequired',
  shopSectionNotFound: 'etsy.validation.shopSectionNotFound',
  shippingProfileInvalid: 'etsy.draftSync.shippingProfileInvalid',
  notFoundOnEtsy: 'etsy.draftSync.notFoundOnEtsy',
  rejected: 'etsy.draftSync.rejected',
  unavailable: 'etsy.draftSync.etsyUnavailable',
  failed: 'etsy.draftSync.failed',
} as const;

export const EBAY_DRAFT_ERROR = {
  interrupted: 'ebay.draftSync.interrupted',
  conflict: 'ebay.draftSync.conflict',
  itemMissing: 'ebay.draftSync.itemMissing',
  reauthRequired: 'ebay.draftSync.reauthRequired',
  rateLimited: 'ebay.draftSync.rateLimited',
  notFound: 'ebay.draftSync.notFound',
  rejected: 'ebay.draftSync.rejected',
  unavailable: 'ebay.draftSync.unavailable',
  failed: 'ebay.draftSync.failed',
} as const;

function messageOf(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String((err as any)?.message || '');
}

type Family = { reauthRequired: string; rateLimited: string; notFound: string; rejected: string; unavailable: string; failed: string };

function classifyGeneric(err: unknown, f: Family): string {
  const name = String((err as any)?.name || '');
  const msg = messageOf(err).toLowerCase();
  if (name === 'EtsyRateLimitedError' || name === 'EtsyDeferError') return f.rateLimited;
  if (/invalid access token|not a bearer token|invalid_grant|reconnect|token expired|\b401\b|unauthori[sz]ed|\b403\b|forbidden/.test(msg)) return f.reauthRequired;
  if (/\b429\b|rate limit|too many requests/.test(msg)) return f.rateLimited;
  if (/\b404\b|not found|no longer exists/.test(msg)) return f.notFound;
  if (/\b5\d\d\b|timed? ?out|econnreset|econnrefused|etimedout|fetch failed|socket hang up|service unavailable/.test(msg)) return f.unavailable;
  if (/\b400\b|\b409\b|\b422\b|invalid|must|required|not allowed|exceed/.test(msg)) return f.rejected;
  return f.failed;
}

/**
 * Etsy's own error wording → the specific key that names the problem (and has a fix in lib/listings/failureFix).
 * Order matters: "Shop section not found" must never read as a missing listing. null = no specific match.
 * Used for new failures (classifyEtsyDraftSyncError) and for old rows that stored the English text. Pure.
 */
export function etsySpecificKey(text: string): string | null {
  const m = text.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/shop section not found|shop_section/, 'etsy.validation.shopSectionNotFound'],
    [/could not find a listing|listing.*(does not exist|not found)|listing_id.*not found/, 'etsy.draftSync.listingDeleted'],
    [/price must be consistent|price.*linked products|price_on_property/, 'etsy.validation.inventoryPriceInconsistent'],
    [/quantity must be consistent|quantity.*linked products|quantity_on_property/, 'etsy.draftSync.linkedQuantity'],
    [/sku must be consistent|sku.*linked products|sku_on_property/, 'etsy.draftSync.linkedSku'],
    [/property_values|property_id|scale_id|invalid property|variation/, 'etsy.validation.inventoryInconsistentProperties'],
    [/who_made|when_made|is_supply/, 'etsy.draftSync.whoMadeRequired'],
    [/shipping_profile|shipping profile/, 'etsy.draftSync.shippingProfileInvalid'],
    [/return_policy|return policy/, 'etsy.draftSync.returnPolicyInvalid'],
    [/readiness_state|processing_min|processing_max|processing time/, 'etsy.draftSync.readinessStateRequired'],
    [/taxonomy/, 'etsy.validation.taxonomyRequired'],
    [/title.*(too long|140|characters)|(too long|140).*title/, 'etsy.draftSync.titleRejected'],
    [/title/, 'etsy.draftSync.titleRejected'],
    [/too many tags|tags.*13|13.*tags/, 'etsy.draftSync.tagsRejected'],
    [/tag.*(too long|20 characters)/, 'etsy.draftSync.tagsRejected'],
    [/\btags?\b/, 'etsy.draftSync.tagsRejected'],
    [/material/, 'etsy.draftSync.materialsRejected'],
    [/personaliz/, 'etsy.draftSync.personalizationRejected'],
    [/(at least one|must have an?|requires an?) (image|photo)|no images/, 'etsy.draftSync.imageRequired'],
    [/item_weight|item_length|item_width|item_height|dimension/, 'etsy.draftSync.dimensionsRejected'],
    [/billing|payment account|credit card|unpaid|fees? (are )?due/, 'etsy.draftSync.billingRequired'],
    [/cannot be (renewed|activated|published)|listing (is )?(not active|expired|sold.?out)|invalid state|state transition/, 'etsy.draftSync.stateNotAllowed'],
    [/description/, 'etsy.draftSync.descriptionRejected'],
    [/\bprice\b.*(must|invalid|greater|positive)|minimum price|0\.20/, 'etsy.validation.pricePositive'],
    [/\bquantity\b.*(must|invalid|999|greater)/, 'etsy.draftSync.quantityRejected'],
  ];
  for (const [re, key] of rules) if (re.test(m)) return key;
  return null;
}

/** eBay's own error wording (Inventory + Trading API) → the specific key. null = no specific match. Pure. */
export function ebaySpecificKey(text: string): string | null {
  const m = text.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/ended listing|listing (has )?ended|not allowed to revise ended/, 'ebay.draftSync.listingEnded'],
    [/selling limit|exceeded.*limit|limit.*exceeded/, 'ebay.draftSync.sellingLimit'],
    [/duplicate listing|identical items|same item/, 'ebay.draftSync.duplicateListing'],
    [/item specific|aspect|25002/, 'ebay.draftSync.missingAspects'],
    [/location|25604|merchantlocation/, 'ebay.draftSync.locationRequired'],
    [/fulfillment policy|payment policy|return policy|business polic|shipping service|25007|25008|25009/, 'ebay.draftSync.policyInvalid'],
    [/category|25019|leaf/, 'ebay.draftSync.categoryInvalid'],
    [/condition|25021/, 'ebay.draftSync.conditionInvalid'],
    [/picture|image|photo|25005/, 'ebay.draftSync.imageInvalid'],
    [/title/, 'ebay.draftSync.titleInvalid'],
    [/sku/, 'ebay.draftSync.skuExists'],
    [/price|25003/, 'ebay.draftSync.priceInvalid'],
    [/quantity|25004/, 'ebay.draftSync.quantityInvalid'],
  ];
  for (const [re, key] of rules) if (re.test(m)) return key;
  return null;
}

/** Etsy draft sync failure → stored key (+ params for the attempt row). */
export function classifyEtsyDraftSyncError(err: unknown): StoredDraftError {
  const e = err as any;
  if (e && e.name === 'EtsyDraftError' && typeof e.key === 'string' && e.key) {
    return { key: `etsy.${e.key}`, ...(e.params ? { params: e.params } : {}) };
  }
  const msg = messageOf(err);
  // 401/403/429/5xx first (their bodies can mention any field), then Etsy's wording for the exact field.
  const generic = classifyGeneric(err, {
    reauthRequired: ETSY_DRAFT_ERROR.reauthRequired, rateLimited: ETSY_DRAFT_ERROR.rateLimited, notFound: ETSY_DRAFT_ERROR.notFoundOnEtsy,
    rejected: ETSY_DRAFT_ERROR.rejected, unavailable: ETSY_DRAFT_ERROR.unavailable, failed: ETSY_DRAFT_ERROR.failed,
  });
  if (generic === ETSY_DRAFT_ERROR.reauthRequired || generic === ETSY_DRAFT_ERROR.rateLimited || generic === ETSY_DRAFT_ERROR.unavailable) return { key: generic };
  const specific = etsySpecificKey(msg);
  if (specific) return { key: specific };
  return {
    key: classifyGeneric(err, {
      reauthRequired: ETSY_DRAFT_ERROR.reauthRequired,
      rateLimited: ETSY_DRAFT_ERROR.rateLimited,
      notFound: ETSY_DRAFT_ERROR.notFoundOnEtsy,
      rejected: ETSY_DRAFT_ERROR.rejected,
      unavailable: ETSY_DRAFT_ERROR.unavailable,
      failed: ETSY_DRAFT_ERROR.failed,
    }),
  };
}

/** eBay draft sync failure → stored key. */
export function classifyEbayDraftSyncError(err: unknown): StoredDraftError {
  const e = err as any;
  // Typed errors (EbayDraftError, legacy Trading refusals) already name the exact cause.
  if (e && e.name === 'EbayDraftError' && typeof e.key === 'string' && e.key) {
    return { key: e.key.startsWith('ebay.') ? e.key : `ebay.${e.key}`, ...(e.params ? { params: e.params } : {}) };
  }
  const generic = classifyGeneric(err, {
    reauthRequired: EBAY_DRAFT_ERROR.reauthRequired, rateLimited: EBAY_DRAFT_ERROR.rateLimited, notFound: EBAY_DRAFT_ERROR.notFound,
    rejected: EBAY_DRAFT_ERROR.rejected, unavailable: EBAY_DRAFT_ERROR.unavailable, failed: EBAY_DRAFT_ERROR.failed,
  });
  if (generic === EBAY_DRAFT_ERROR.reauthRequired || generic === EBAY_DRAFT_ERROR.rateLimited || generic === EBAY_DRAFT_ERROR.unavailable) return { key: generic };
  const specific = ebaySpecificKey(messageOf(err));
  if (specific) return { key: specific };
  return {
    key: classifyGeneric(err, {
      reauthRequired: EBAY_DRAFT_ERROR.reauthRequired,
      rateLimited: EBAY_DRAFT_ERROR.rateLimited,
      notFound: EBAY_DRAFT_ERROR.notFound,
      rejected: EBAY_DRAFT_ERROR.rejected,
      unavailable: EBAY_DRAFT_ERROR.unavailable,
      failed: EBAY_DRAFT_ERROR.failed,
    }),
  };
}

/** English fallbacks for the codes above (API back-compat when no attempt text exists). */
const FALLBACK_EN: Record<string, string> = {
  [ETSY_DRAFT_ERROR.interrupted]: 'Sync interrupted by a server restart — retry Sync to Etsy',
  [ETSY_DRAFT_ERROR.conflict]: 'Listing changed on Etsy after these edits were staged. Review it, then sync again with "apply anyway" to overwrite.',
  [EBAY_DRAFT_ERROR.interrupted]: 'Sync interrupted by a server restart — retry',
  [EBAY_DRAFT_ERROR.conflict]: 'A field changed on eBay since this draft was created',
  [EBAY_DRAFT_ERROR.itemMissing]: 'Inventory item no longer exists on eBay',
};

/** Keys that were already stored as keys before the code migration (readers handle them). */
const PRE_EXISTING_KEYS = new Set(['etsy.draftSync.remoteChanged', 'etsy.draftSync.deletedOnEtsy']);

type AttemptLike = { status?: string | null; error?: string | null };

/**
 * API back-compat for the draft GET routes: older UI shows `lastSyncError` as text and pattern-matches it.
 * Adds `lastSyncErrorKey` (the stored key or null) and, when the stored value is one of the new codes,
 * puts the human message from the latest failed/conflict attempt (or an English fallback) back into
 * `lastSyncError`. New readers use `lastSyncErrorKey`.
 */
export function withLegacyLastSyncError<T extends { lastSyncError?: string | null; status?: string; syncAttempts?: AttemptLike[] }>(
  draft: T,
): T & { lastSyncErrorKey: string | null } {
  const stored = draft?.lastSyncError ?? null;
  if (!isStoredErrorKey(stored)) return { ...draft, lastSyncErrorKey: null };
  const key = stored.trim();
  if (PRE_EXISTING_KEYS.has(key)) return { ...draft, lastSyncErrorKey: key };
  const attempt = (draft.syncAttempts || []).find((a) => (a?.status === 'failed' || a?.status === 'conflict') && a?.error);
  const text = attempt?.error || FALLBACK_EN[key] || key;
  return { ...draft, lastSyncError: text, lastSyncErrorKey: key };
}
