// lib/listings/failureFix.ts — every send failure gets a way out. ISOMORPHIC (list cell, editor banner, tests).
//
// Founder 2026-10-17: "for every kind of failure — also the ones we haven't experienced yet — there must be the exact
// reason and a solution. We will be multi-tenant SaaS." So:
//  1. Known error keys map to a specific fix (open the exact field, review differences, reconnect, send again,
//     discard changes for a listing that no longer exists).
//  2. Unknown / future keys are classified by the words in the key (`…Title…` → title, `…image…` → photos, …).
//  3. Anything still unmatched opens the listing, and the UI shows the marketplace's own message (`detail`) so the
//     reason is never hidden. test/listings/failure-fix.test.ts checks every error key in messages/*.json.

import type { SectionId } from '@/lib/listingEditor/types';

export type FailureFix =
  /** Changed on the marketplace after the edit: pick Mine / theirs (Review differences). */
  | { kind: 'review' }
  /** Temporary (interrupted, rate limit, marketplace down): just send again. */
  | { kind: 'resend'; later?: boolean }
  /** The store connection expired. */
  | { kind: 'reconnect' }
  /** The listing is gone on the marketplace: the staged change can only be discarded. */
  | { kind: 'discard' }
  /** Only editable on the marketplace itself (eBay legacy listings). */
  | { kind: 'onMarketplace' }
  /** Fix a value in the editor: `target` is a field key or section id (editor deep link `#target`), null = top. */
  | { kind: 'open'; target: string | null; section: SectionId | null };

const open = (target: string | null, section: SectionId | null): FailureFix => ({ kind: 'open', target, section });

/** Explicit fixes for the keys the app stores today (see docs/integration/draft-sync-error-codes.md). */
const EXPLICIT: Record<string, FailureFix> = {
  // Conflicts
  'etsy.draftSync.conflict': { kind: 'review' },
  'etsy.draftSync.remoteChanged': { kind: 'review' },
  'ebay.draftSync.conflict': { kind: 'review' },
  'listings.sendError.conflict': { kind: 'review' },
  'listings.draftError.conflict': { kind: 'review' },
  // Gone on the marketplace
  'etsy.draftSync.deletedOnEtsy': { kind: 'discard' },
  'ebay.draftSync.itemMissing': { kind: 'discard' },
  'ebay.draftSync.missingOnEbay': { kind: 'discard' },
  'ebay.draftSync.notFound': { kind: 'discard' },
  'listings.sendError.notFound': { kind: 'discard' },
  'listings.draftError.productNotFound': { kind: 'discard' },
  'listings.draftError.remoteMissing': { kind: 'discard' },
  'listings.draftError.archived': { kind: 'discard' },
  // Connection
  'etsy.draftSync.reauthRequired': { kind: 'reconnect' },
  'etsy.draftSync.shopNotFound': { kind: 'reconnect' },
  'ebay.draftSync.reauthRequired': { kind: 'reconnect' },
  'listings.sendError.reconnect': { kind: 'reconnect' },
  'listings.draftError.notConnected': { kind: 'reconnect' },
  'listings.draftError.storeNotFound': { kind: 'reconnect' },
  // Temporary
  'etsy.draftSync.interrupted': { kind: 'resend' },
  'ebay.draftSync.interrupted': { kind: 'resend' },
  'listings.sendError.interrupted': { kind: 'resend' },
  'etsy.draftSync.rateLimited': { kind: 'resend', later: true },
  'ebay.draftSync.rateLimited': { kind: 'resend', later: true },
  'listings.sendError.rateLimited': { kind: 'resend', later: true },
  'listings.draftError.rateLimited': { kind: 'resend', later: true },
  'etsy.draftSync.etsyUnavailable': { kind: 'resend', later: true },
  'ebay.draftSync.unavailable': { kind: 'resend', later: true },
  'listings.draftError.unavailable': { kind: 'resend', later: true },
  'listings.draftError.batchTimeout': { kind: 'resend', later: true },
  'listings.draftError.batchFailed': { kind: 'resend' },
  'etsy.draftSync.draftSyncing': { kind: 'resend', later: true },
  'ebay.draftSync.draftSyncing': { kind: 'resend', later: true },
  // eBay legacy
  'ebay.draftSync.legacyNotEditable': { kind: 'onMarketplace' },
  'ebay.draftSync.legacyListing': { kind: 'onMarketplace' },
  'etsy.draftSync.listingDeleted': { kind: 'discard' },
  'etsy.draftSync.billingRequired': { kind: 'onMarketplace' },
  'ebay.draftSync.sellingLimit': { kind: 'onMarketplace' },
  'ebay.draftSync.listingEnded': { kind: 'onMarketplace' },
  'etsy.draftSync.stateNotAllowed': open(null, null),
  'etsy.draftSync.notFoundOnEtsy': open(null, null),
  'etsy.draftSync.linkedQuantity': open('variations', 'variations'),
  'etsy.draftSync.linkedSku': open('variations', 'variations'),
  'etsy.validation.inventoryPriceInconsistent': open('variations', 'variations'),
  'etsy.draftSync.returnPolicyInvalid': open('return_policy_id', 'shipping'),
  'etsy.draftSync.dimensionsRejected': open('item_weight', 'shipping'),
  'etsy.draftSync.imageRequired': open('photos', 'photos'),
  'ebay.draftSync.duplicateListing': open('title', 'title'),
  'ebay.draftSync.policyInvalid': open('shipping', 'shipping'),
  'ebay.draftSync.categoryInvalid': open('categoryId', 'details'),
  'ebay.draftSync.conditionInvalid': open('condition', 'details'),
  // Specific fields
  'etsy.validation.shopSectionNotFound': open('shop_section_id', 'details'),
  'etsy.draftSync.whoMadeRequired': open('who_made', 'details'),
  'etsy.draftSync.shippingProfileInvalid': open('shipping_profile_id', 'shipping'),
  'etsy.draftSync.readinessStateRequired': open('readiness_state_id', 'shipping'),
  'etsy.draftSync.processingNotMapped': open('readiness_state_id', 'shipping'),
  'etsy.draftSync.inventoryPatchRequired': open('variations', 'variations'),
  'etsy.draftSync.stockOverrideFailed': open('variations', 'variations'),
  'etsy.draftSync.propertyUpdateFailed': open('properties', 'details'),
  'etsy.draftSync.propertyDeleteFailed': open('properties', 'details'),
  'etsy.draftSync.mediaFileMissing': open('photos', 'photos'),
  'etsy.draftSync.mediaUrlRejected': open('photos', 'photos'),
  'etsy.draftSync.invalidMedia': open('photos', 'photos'),
  'etsy.draftSync.copyImagesFailed': open('photos', 'photos'),
  'ebay.draftSync.missingAspects': open('specifics', 'specifics'),
  'ebay.draftSync.missingAspectsShort': open('specifics', 'specifics'),
  'ebay.draftSync.locationRequired': open('shipping', 'shipping'),
  'ebay.draftSync.skuExists': open('sku', 'price'),
  'ebay.draftSync.skuExistsShort': open('sku', 'price'),
  'listings.draftError.noLocation': { kind: 'onMarketplace' },
  'listings.draftError.multiLocation': { kind: 'onMarketplace' },
  'listings.draftError.stockManaged': open('quantity', 'price'),
  'listings.draftError.inStockTracked': open('quantity', 'price'),
  'listings.draftError.listBelowSale': open('price', 'price'),
  'listings.draftError.invalidDiscount': open('price', 'price'),
  'listings.draftError.wixDiscounted': open('price', 'price'),
  'listings.draftError.invalidVat': open('price', 'price'),
  'listings.draftError.invalidCollections': open('details', 'details'),
  'listings.draftError.invalidAttributes': open('attributes', 'attributes'),
};

/** Word → section, checked in order against the last part of an unknown key (`inventoryPriceInconsistent`). */
const WORD_RULES: Array<[RegExp, FailureFix]> = [
  [/conflict|remotechanged|changedremote/, { kind: 'review' }],
  [/reauth|reconnect|notconnected|token|unauthori|forbidden/, { kind: 'reconnect' }],
  [/interrupt|ratelimit|toomany|unavailable|timeout|busy|syncing|retry/, { kind: 'resend', later: true }],
  [/deleted|notfound|missingon|gone|removed|archived/, { kind: 'discard' }],
  [/section/, open('shop_section_id', 'details')],
  [/title/, open('title', 'title')],
  [/description|textfield|texttoolong/, open('description', 'title')],
  [/tag|keyword/, open('tags', 'tags')],
  [/material/, open('materials', 'tags')],
  [/inventory|variant|variation|combination|offering|property/, open('variations', 'variations')],
  [/price|discount|vat|money|currency/, open('price', 'price')],
  [/quantity|stock/, open('quantity', 'price')],
  [/sku|barcode/, open('sku', 'price')],
  [/image|photo|media|video/, open('photos', 'photos')],
  [/shipping|processing|readiness|weight|dimension|location|return/, open('shipping', 'shipping')],
  [/personali[sz]/, open('personalization', 'personalization')],
  [/aspect|specific/, open('specifics', 'specifics')],
  [/attribute/, open('attributes', 'attributes')],
  [/taxonomy|category|whomade|whenmade|supply|vintage|maker|condition/, open('details', 'details')],
];

/** The fix for a send failure key; never null (unknown → open the listing). Pure. */
export function failureFixFor(errorKey: string | null | undefined, status?: string | null): FailureFix {
  if (status === 'conflict') return { kind: 'review' };
  const key = (errorKey || '').trim();
  if (EXPLICIT[key]) return EXPLICIT[key];
  const last = (key.split('.').pop() || '').toLowerCase();
  for (const [re, fix] of WORD_RULES) if (re.test(last)) return fix;
  return open(null, null);
}

/** The i18n key of the fix button (`listings.fix.*`). Pure. */
export function failureFixLabelKey(fix: FailureFix): string {
  switch (fix.kind) {
    case 'review': return 'listings.fix.review';
    case 'resend': return fix.later ? 'listings.fix.resendLater' : 'listings.fix.resend';
    case 'reconnect': return 'listings.fix.reconnect';
    case 'discard': return 'listings.fix.discard';
    case 'onMarketplace': return 'listings.fix.onMarketplace';
    case 'open': return fix.section ? `listings.fix.open.${fix.section}` : 'listings.fix.open.listing';
  }
}

/** Keys whose text is a general bucket: the marketplace's own message is shown under them. */
const GENERIC_RE = /\.(rejected|failed|generic|remoteFailed|invalidInput|internal|partial|batchFailedReason|invalidFields|invalidCreate)$/;
export function isGenericFailureKey(errorKey: string | null | undefined): boolean {
  return !errorKey || GENERIC_RE.test(errorKey);
}

/**
 * Marketplace error text → one readable line: drops our "Etsy API error: 400 - " prefix, reads `error` /
 * `message` / `[0].message` from a JSON body, collapses whitespace, cuts at 200 characters. Pure.
 */
export function marketplaceDetail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^(etsy|ebay|trendyol|wix|shopify|amazon)?\s*api error:?\s*\d{3}\s*[-:]\s*/i, '');
  if (/^[[{]/.test(s)) {
    try {
      const j = JSON.parse(s);
      const pick = (o: any): string | null => (o && (o.error_description || o.error || o.message || o.longMessage || o.errorMessage)) || null;
      const first = Array.isArray(j) ? j[0] : Array.isArray(j?.errors) ? j.errors[0] : j;
      const msg = pick(first) ?? pick(j);
      if (typeof msg === 'string') s = msg;
    } catch { /* keep the text */ }
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || /^[a-z]+(\.[A-Za-z0-9_]+)+$/.test(s)) return null; // empty, or one of our own i18n keys
  return s.length > 200 ? `${s.slice(0, 199).trimEnd()}…` : s;
}
