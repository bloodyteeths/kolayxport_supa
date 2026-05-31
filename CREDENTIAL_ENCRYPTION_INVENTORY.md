# CREDENTIAL_ENCRYPTION_INVENTORY

Goal: every secret-bearing column readable from production code goes through `decryptIfNeeded` and every write goes through `encryptIfNeeded`. Sprint 5 closes this loop. Existing rows in any of three on-disk shapes — plaintext, legacy `lib/encryption.ts` raw `base64(iv|tag|ct)`, new `enc:v1:` envelope — continue to work without a migration.

Reference modules:
- `lib/crypto/credentials.ts` — new envelope (`enc:v1:<iv>:<tag>:<ct>`). `decryptIfNeeded` accepts all three shapes; `encryptIfNeeded` only produces the new shape and never re-encrypts an existing legacy or `enc:v1:` value.
- `lib/encryption.ts` — pre-existing legacy module. Still used by `pages/api/user/settings.ts`. Untouched in this sprint.
- `scripts/backfill-encrypt-credentials.ts` — dry-run/apply tool that walks `Credential` / `EtsyShop` / `WixSite` / `ShopifyShop` and migrates plaintext → `enc:v1:`.

Status legend: `[x]` patched in this sprint, `[~]` partially patched, `[ ]` not yet, `[L]` already covered by the legacy `lib/encryption.ts` wrapper through `/api/user/settings`.

---

## Credential model (`prisma/schema.prisma:258-308`)

| Field | Sensitive? | Read sites | Write sites | Read patched | Write patched | Notes |
|---|---|---|---|---|---|---|
| `veeqoApiKey` | yes | `lib/config.ts:getIntegrationCreds`, `lib/integrations/veeqo.ts` | `pages/api/user/settings.ts` (legacy enc) | [x] `lib/config.ts` | [L] | Veeqo is legacy; reads work for both formats via `getIntegrationCreds` |
| `shippoToken` | yes | `lib/config.ts:getIntegrationCreds`, `lib/integrations/shippo.ts` | `pages/api/user/settings.ts` | [x] `lib/config.ts` | [L] | Same |
| `fedexApiKey` | yes | `lib/config.ts`, `lib/fedex/fedex.service.ts` (via shipperConfig param) | `pages/api/user/settings.ts` | [x] via `lib/config.ts` | [L] | FedEx callers pull through `getIntegrationCreds`, now decrypts |
| `fedexApiSecret` | yes | Same | Same | [x] | [L] | Same |
| `fedexAccountNumber` | identifier, NOT secret | Same | Same | n/a | n/a | Account number is not encrypted (used in joins/lookups) |
| `fedexMeterNumber` | identifier | Same | Same | n/a | n/a | Same |
| `hepsiburadaApiKey` | yes | n/a (no active reader) | `pages/api/user/settings.ts` | [ ] no active reader | [L] | Field exists; no active integration code |
| `hepsiburadaMerchantId` | identifier | n/a | Same | n/a | n/a | |
| `trendyolApiKey` | yes | `lib/config.ts`, `pages/api/trendyol/{metadata,operations,products}.ts` | `pages/api/user/settings.ts` | [x] (all 4 sites) | [L] | Reads decrypt before handing to `createTrendyolClient` |
| `trendyolApiSecret` | yes | Same | Same | [x] | [L] | Same |
| `trendyolSupplierId` | identifier | Same | Same | n/a | n/a | |
| `upsApiKey` | yes | `lib/ups/ups.credentials.ts` | `pages/api/user/settings.ts` | [x] | [L] | Patched at the credential loader |
| `upsApiSecret` | yes | Same | Same | [x] | [L] | Same |
| `upsAccountNumber` | identifier | Same | Same | n/a | n/a | |
| `parasutClientId` | identifier-ish | `lib/services/invoiceService.ts` | `pages/api/user/settings.ts` | n/a | [L] | Not treated as secret in this sweep |
| `parasutClientSecret` | yes | `lib/services/invoiceService.ts` | `pages/api/user/settings.ts` | [x] | [L] | Patched at the credential loader |
| `parasutUsername` | identifier | `lib/services/invoiceService.ts` | `pages/api/user/settings.ts` | n/a | [L] | |
| `parasutPassword` | yes | `lib/services/invoiceService.ts` | `pages/api/user/settings.ts` | [x] | [L] | Patched at the credential loader |
| `parasutCompanyId` | identifier | Same | Same | n/a | n/a | |
| `etsyAccessToken` | yes | `lib/etsy/draftService.ts:getEtsyAccessToken` (Credential fallback), `pages/api/integrations/etsy/shops.ts` (admin status display only) | `pages/api/integrations/etsy/callback.ts` (OAuth), `lib/etsy/draftService.ts:refreshEtsyToken` | [x] draftService | [x] both OAuth callback + refresh | Fallback path patched |
| `etsyRefreshToken` | yes | Same | Same | [x] | [x] | Same |
| `etsyShopId` | identifier | Same | Same | n/a | n/a | |
| `ebayAccessToken` | yes | `lib/integrations/ebayClient.ts:getUserAccessToken` | `pages/api/integrations/ebay/callback.ts`, `ebayClient.ts` refresh | [x] | [x] | Single chokepoint |
| `ebayRefreshToken` | yes | Same | Same | [x] | [x] | Same |
| `wixAccessToken` | yes | `lib/integrations/wixClient.ts:createWixClient` factory | `pages/api/integrations/wix/{callback,webhook}.ts`, `wixClient.ts` refresh | [x] | [x] | Constructor decrypts; refresh callback receives encrypted value |
| `wixRefreshToken` | yes (column exists) | not consumed by current client | `pages/api/integrations/wix/{callback,webhook}.ts` | n/a | [~] | Wix uses client_credentials → no live refresh token; column is mostly dead |
| `wixSiteId` | identifier | n/a | n/a | n/a | n/a | |
| `wixInstanceId` | identifier | n/a | n/a | n/a | n/a | |
| `shopifyAccessToken` | yes | `lib/integrations/shopifyClient.ts:getValidAccessToken` | `pages/api/integrations/shopify/callback.ts`, `shopifyClient.ts` refresh | [x] | [x] | Single chokepoint |
| `shopifyShopDomain` | identifier | n/a | n/a | n/a | n/a | |
| `mngCustomerNumber` | identifier-but-sensitive | `lib/mng/mng.credentials.ts` | `pages/api/user/settings.ts` | n/a | [L] | Treated as opaque identifier (DHL eCommerce customer #) |
| `mngPassword` | yes | `lib/mng/mng.credentials.ts` | `pages/api/user/settings.ts` | [x] | [L] | Patched at the credential loader |
| `mngAppId` | identifier (env-shared) | n/a | n/a | n/a | n/a | Read from `process.env.MNG_APP_ID` |
| `mngAppSecret` | yes (env-shared) | n/a | n/a | n/a | n/a | Read from `process.env.MNG_APP_SECRET` |
| `mngApiEnvironment` | flag | `lib/mng/mng.credentials.ts` | `pages/api/user/settings.ts` | n/a | n/a | |
| `amazonAccessToken` | yes | `lib/integrations/amazonClient.ts:getValidToken` | `pages/api/integrations/amazon/callback.ts`, `amazonClient.ts` refresh callback | [x] | [x] | Single chokepoint |
| `amazonRefreshToken` | yes | Same | Same | [x] | [x] | Same |
| `amazonTokenExpiresAt` | flag | n/a | n/a | n/a | n/a | |
| `amazonSellerId` | identifier | n/a | n/a | n/a | n/a | |
| `amazonMarketplaceId` | identifier | n/a | n/a | n/a | n/a | |
| `amazonRegion` | flag | n/a | n/a | n/a | n/a | |

---

## EtsyShop model (`prisma/schema.prisma:496`)

| Field | Read sites | Write sites | Read patched | Write patched |
|---|---|---|---|---|
| `accessToken` | `lib/etsy/draftService.ts:getEtsyAccessToken`, `lib/integrations/etsyOrderSync.ts` | `pages/api/integrations/etsy/callback.ts`, `lib/etsy/draftService.ts:refreshEtsyToken`, `lib/integrations/etsyOrderSync.ts:onTokenRefresh` | [x] | [x] |
| `refreshToken` | Same | Same | [x] | [x] |

## WixSite model (`prisma/schema.prisma:1250`)

| Field | Read sites | Write sites | Read patched | Write patched |
|---|---|---|---|---|
| `accessToken` | `lib/integrations/wixClient.ts:createWixClient` | `pages/api/integrations/wix/webhook.ts`, `pages/api/integrations/wix/callback.ts`, `wixClient.ts` refresh callback | [x] | [x] |
| `refreshToken` | n/a (Wix client_credentials flow) | n/a | n/a | n/a |

## ShopifyShop model (`prisma/schema.prisma:1319`)

| Field | Read sites | Write sites | Read patched | Write patched |
|---|---|---|---|---|
| `accessToken` | `lib/integrations/shopifyClient.ts:getValidAccessToken` | `pages/api/integrations/shopify/callback.ts`, `shopifyClient.ts` refresh | [x] | [x] |
| `refreshToken` | Same | Same | [x] | [x] |

---

## SMTP / mailer credentials

SMTP credentials live entirely in environment variables (`ETGB_SMTP_USER`, `ETGB_SMTP_PASS`, `ETGB_SMTP_HOST`, …). Not in the database. They are loaded directly inside the per-call mailer (`lib/services/etgbMailerService.ts`, `lib/admin/dailySummary.ts`). The logger never receives them in `details`.

No encryption-at-rest changes required — they are not at rest in our database. (If you ever store user-specific SMTP creds in the future, add them to this inventory and to `scripts/backfill-encrypt-credentials.ts`.)

---

## Backfill safety verdict

- **`scripts/backfill-encrypt-credentials.ts --dry-run`** — **safe to run**. The script only counts plaintext / encrypted / null per column; no writes, no value printing. Run it after the migration is applied and `CREDENTIAL_ENCRYPTION_KEY` is set.
- **`scripts/backfill-encrypt-credentials.ts --apply`** — **not yet safe**. The script only wraps `Credential` / `EtsyShop` / `WixSite` / `ShopifyShop` token columns. Trendyol, FedEx, UPS, MNG, Paraşüt fields and the legacy `lib/encryption.ts` format are NOT yet migrated by it. Running `--apply` today would:
  1. Re-encrypt plaintext OAuth tokens (correct) — but those are written via the OAuth callbacks, which now write `enc:v1:` directly, so most production tokens flip to `enc:v1:` over time without any backfill.
  2. Leave legacy `base64(iv|tag|ct)` rows from `/api/user/settings` alone (they pass `looksLikeLegacy` so `encryptIfNeeded` no-ops). They continue to work via `decryptIfNeeded`'s legacy branch — long-term we can opt into legacy→enc:v1 migration via a small backfill flag.
- **Conclusion**: dry-run is fine today. Apply requires either (a) extending the backfill to include all secret columns and a `--migrate-legacy` flag, or (b) waiting until natural token-refresh activity has cycled all OAuth tokens through the new `enc:v1:` callbacks (~30 days for most marketplaces).

---

## Required env vars

- `CREDENTIAL_ENCRYPTION_KEY` (Hetzner `/home/deploy/kolayxport/.env`).
  - 64-char hex string. Generate with `openssl rand -hex 32`.
  - Both `lib/crypto/credentials.ts` and the existing `lib/encryption.ts` read the same env var. Keep it stable forever — losing it bricks every encrypted credential row.

---

## What is intentionally not in scope this sprint

- A second backfill pass that migrates legacy `lib/encryption.ts` rows into `enc:v1:`.
- Encryption of `*AccountNumber` / `*SellerId` / `*MarketplaceId` / `*ShopId` / `*SiteId` / `*Domain` columns. They are not secrets — they're tenant identifiers used in joins.
- SMTP credentials at-rest (they live in env vars).
- `lib/encryption.ts` decommission. It remains in place because `/api/user/settings.ts` and a small number of read paths still go through it. Removal will be a focused sprint that also rewrites those readers.
