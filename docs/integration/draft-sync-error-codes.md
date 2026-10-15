# Draft sync error codes (`lastSyncError`)

`lastSyncError` on `EtsyListingDraft`, `EbayListingDraft` and `CatalogDraft` now stores a **full next-intl key**
(root namespace) for send failures and conflicts, never raw English. Source: `lib/drafts/syncErrors.ts`
(Etsy/eBay) and `lib/catalogDrafts/service.ts` (catalog).

- Raw English error: the latest `EtsyDraftSyncAttempt.error` / `EbayDraftSyncAttempt.error`.
- ICU params (only for keys that need them): that attempt's `result.errorParams`. If they are missing, render
  `listings.sendError.generic`.
- Rows written before this change still hold English text. Readers must accept both: use
  `isStoredErrorKey()` (`lib/drafts/syncErrors.ts`), or `sendErrorKey()` in `lib/listings/query.ts`, which passes
  keys through and maps old text to `listings.sendError.*`.
- `synced` drafts may still carry an English warning summary in `lastSyncError` (partial sync). That is not a failure
  and was not changed.

## API back-compat

`GET /api/etsy-drafts`, `GET/PATCH /api/etsy-drafts/[id]`, `GET/POST /api/ebay-drafts`, `GET/PATCH /api/ebay-drafts/[id]`
return each draft with:

- `lastSyncErrorKey`: the stored key, or `null` when the row holds legacy text or nothing. **New UI reads this.**
- `lastSyncError`: unchanged for legacy rows. For the new codes it holds the human message from the latest
  failed or conflict attempt (or an English fallback), so the legacy pages that show or pattern-match the text keep
  working. `etsy.draftSync.remoteChanged` and `etsy.draftSync.deletedOnEtsy` were already keys and pass through as-is.

## Etsy (`EtsyListingDraft`)

| Stored key | When | Params |
|---|---|---|
| `etsy.draftSync.interrupted` | stuck in `syncing` for more than 10 min (restart), recovered as `failed` | none |
| `etsy.draftSync.conflict` | the remote `updated_timestamp` moved and draft fields changed (status `conflict`) | none |
| `etsy.draftSync.remoteChanged` | webhook or reconcile saw a remote edit (status `conflict`, pre-existing) | none |
| `etsy.draftSync.deletedOnEtsy` | the listing was deleted on Etsy (status `conflict`, pre-existing) | none |
| `etsy.<EtsyDraftError.key>` | typed engine error, e.g. `etsy.draftSync.mediaFileMissing`, `etsy.draftSync.inventoryPatchRequired`, `etsy.draftSync.readinessStateRequired`, `etsy.draftSync.stockOverrideFailed`, `etsy.validation.shopSectionNotFound` | `etsy.draftSync.processingNotMapped` {min,max}, `etsy.draftSync.copyImagesFailed` {attempted}: in `result.errorParams` |
| `etsy.draftSync.reauthRequired` | 401/403, invalid or expired token | none |
| `etsy.draftSync.rateLimited` | 429, or the rate budget deferred the call | none |
| `etsy.draftSync.whoMadeRequired` | Etsy complained about who_made / when_made / is_supply | none |
| `etsy.validation.shopSectionNotFound` | "shop section not found" | none |
| `etsy.draftSync.shippingProfileInvalid` | shipping_profile error | none |
| `etsy.draftSync.notFoundOnEtsy` | 404 / not found | none |
| `etsy.draftSync.etsyUnavailable` | 5xx, timeout, network error | none |
| `etsy.draftSync.rejected` | 400/409/422 or validation wording | none |
| `etsy.draftSync.failed` | anything else | none |

## eBay (`EbayListingDraft`)

| Stored key | When | Params |
|---|---|---|
| `ebay.draftSync.conflict` | a remote inventory field changed since staging (status `conflict`) | `field` in `result.errorParams` (not needed by the string) |
| `ebay.draftSync.itemMissing` | the inventory item no longer exists (status `conflict`) | none |
| `ebay.draftSync.reauthRequired` | 401/403, token | none |
| `ebay.draftSync.rateLimited` | 429 | none |
| `ebay.draftSync.notFound` | 404 / not found | none |
| `ebay.draftSync.unavailable` | 5xx, timeout, network error | none |
| `ebay.draftSync.rejected` | 400/409/422 or validation wording | none |
| `ebay.draftSync.failed` | anything else | none |
| `ebay.draftSync.interrupted` | reserved (eBay recovers stale `syncing` inline and re-runs the send) | none |

## Catalog (`CatalogDraft`: Trendyol, Wix, Shopify)

Unchanged. It already stores `listings.draftError.*` / `listings.validate.*` keys (see `ERROR_META` in
`lib/catalogDrafts/service.ts`).

All keys above exist in `messages/en.json` and `messages/tr.json`.
