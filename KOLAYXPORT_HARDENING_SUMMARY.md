# KOLAYXPORT_HARDENING_SUMMARY

Cumulative log of the production hardening work to date. Every entry references the actual change in the repo.

---

## Sprint 1 — P0 security fixes (2026-05-31)

S1-1 Deleted `pages/api/setScriptProps.js`. S1-2 Redacting logger (`lib/logger.ts`). S1-3 Auth + ownership on `pages/api/clawd/serve-image.ts`. S1-4 `lib/middleware/requireOwned.ts` helper. S1-5 `lib/crypto/credentials.ts` (AES-256-GCM `enc:v1:` envelope) + `scripts/backfill-encrypt-credentials.ts`. S1-6 Header-only, timing-safe internal API key in `lib/auth.ts:getAuthUserOrApiKey`.

## Sprint 2 — Topology + cron (2026-05-31)

Hetzner verified for apex + Stripe webhook + Etsy callback. Vercel build no longer wipes schema. GitHub Actions cron made loud-failing. `auto-sync-orders.yml` schedule removed. `CronLock` model + `runCronGuard` idempotency. Migration `20260531120000_add_cron_lock`.

## Sprint 3 — Extension + Stripe + Wix (2026-05-31)

S3-1 Extension origin pinning (`OFFICIAL_EXTENSION_ID`). S3-2 Manifest `externally_connectable`. S3-3 Telemetry endpoint hardened. S3-4 Stripe webhook customer-match defense. S3-5 `lib/integrations/wix/verifyWebhook.ts` RS256 verification. S3-6 Test plumbing (`vitest.config.ts`, vitest local install).

## Sprint 4 — Admin SaaS monitoring cockpit (2026-05-31)

S4-1 Migration `20260531150000_admin_monitoring`: `SyncLog.category`, `WebhookEvent` extended, new `AdminAuditLog`. S4-2 Logger `event(category,…)` + `lib/admin/events.ts`. S4-3 `lib/admin/audit.ts`. S4-4 `lib/admin/monitoring.ts` aggregators. S4-5 12 admin monitoring API routes. S4-6 `pages/admin/monitoring.tsx` cockpit. S4-7 Instrumented call sites. S4-8 Off-by-default daily summary. S4-9 No Sentry — package marked removable.

---

## Sprint 5 — Credential encryption adoption + reliability + cleanup (2026-05-31 evening)

### S5-1. Dual-format credential decryption
- `lib/crypto/credentials.ts` `decryptIfNeeded` now accepts three on-disk shapes: `enc:v1:` envelope, legacy `lib/encryption.ts` raw `base64(iv|tag|ct)`, and plaintext. All three return the plaintext token.
- `encryptIfNeeded` is idempotent for both encrypted formats — it will never re-encrypt a legacy row, so existing `/api/user/settings`-written rows remain readable and stable.
- 5 new tests in `test/lib/crypto/credentials.test.ts` cover dual-format read, legacy non-re-encryption, plaintext (NextAuth JWT shape) passthrough, fresh-plain → `enc:v1:` conversion, and double-encrypt idempotency.

### S5-2. Marketplace OAuth callbacks now encrypt on write
- `pages/api/integrations/etsy/callback.ts` — encrypts both `EtsyShop.accessToken/refreshToken` and `Credential.etsyAccessToken/etsyRefreshToken` writes.
- `pages/api/integrations/ebay/callback.ts` — encrypts both `Credential.ebayAccessToken/ebayRefreshToken` writes.
- `pages/api/integrations/shopify/callback.ts` — encrypts `ShopifyShop.accessToken/refreshToken` + `Credential.shopifyAccessToken`. Webhook registration still uses raw token (one-shot, never read back).
- `pages/api/integrations/amazon/callback.ts` — encrypts `Credential.amazonAccessToken/amazonRefreshToken`.
- `pages/api/integrations/wix/webhook.ts` — encrypts `WixSite.accessToken` and (via `saveWixConnection`) `Credential.wixAccessToken`.
- `pages/api/integrations/wix/callback.ts` — encrypts pending-claim token before upserting to `Credential`.

### S5-3. Marketplace client read paths now decrypt
- `lib/integrations/etsyOrderSync.ts` — decrypts `EtsyShop.accessToken/refreshToken` before constructing `EtsyClient`; encrypts new tokens before writing them back via `onTokenRefresh`.
- `lib/etsy/draftService.ts:getEtsyAccessToken` — decrypts both Credential and EtsyShop paths; encrypts refreshed tokens.
- `lib/integrations/ebayClient.ts:getUserAccessToken` — decrypts refresh token before sending to eBay; encrypts new tokens before write.
- `lib/integrations/shopifyClient.ts:getValidAccessToken` — decrypts both refresh and access tokens; encrypts new ones.
- `lib/integrations/wixClient.ts` constructor — decrypts incoming `accessToken`; `refreshAccessToken` hands encrypted token to `onTokenRefresh` callback.
- `lib/integrations/amazonClient.ts:getValidToken` — decrypts access + refresh; encrypts the refreshed access token in the `onTokenRefreshed` callback.

### S5-4. Carrier + Paraşüt + Trendyol read paths
- `lib/config.ts:getIntegrationCreds` — central credential loader now decrypts veeqo / shippo / fedex / trendyol secrets before returning. Covers FedEx (since `lib/fedex/fedex.service.ts` receives creds via this path).
- `lib/ups/ups.credentials.ts` — decrypts `upsApiKey`/`upsApiSecret`.
- `lib/mng/mng.credentials.ts` — decrypts `mngPassword`.
- `lib/services/invoiceService.ts` — decrypts `parasutClientSecret` and `parasutPassword`.
- `pages/api/trendyol/{metadata,operations,products}.ts` — decrypts `trendyolApiKey`/`trendyolApiSecret` before handing to `createTrendyolClient`.

### S5-5. Hetzner deploy workflow now runs `prisma migrate deploy`
- `.github/workflows/deploy-hetzner.yml` runs `npx prisma migrate deploy` between `npm install` and `prisma generate`. Inline comment forbids `prisma db push` and `prisma db push --accept-data-loss`.

### S5-6. Legacy script archived
- `scripts/auto-sync-all-users.js` → `scripts/archive/auto-sync-all-users.js.disabled`. References in `.github/workflows/auto-sync-orders.yml` updated to point at the archived path (the workflow itself has been schedule-disabled since Sprint 2).

### S5-7. Repo hygiene — dependencies pruned
- Removed from `package.json`:
  - `@sentry/nextjs` — confirmed 0 imports under `pages/lib/components`. Decision recorded Sprint 4: no Sentry.
  - `@auth0/nextjs-auth0` — confirmed 0 imports.
  - `iyzipay` — confirmed 0 imports.
- `@google/genai` (1 import) and `@google/generative-ai` (5 imports) both kept; both are actively used.
- `@supabase/ssr`, `@supabase/supabase-js` deferred — CI workflow injects `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` at build, so runtime usage must be re-verified before removal.

### S5-8. New deliverable docs
- `CREDENTIAL_ENCRYPTION_INVENTORY.md` — every secret column, read/write site, patch status.
- `docs/security/CREDENTIAL_ENCRYPTION_RUNBOOK.md` — dry-run/apply safety, when to run them, key rotation guidance.
- `API_OWNERSHIP_AUDIT.md` — classification of every dynamic API route + ownership status + follow-ups.
- `ADMIN_2FA_PLAN.md` — sprint-sized plan for TOTP 2FA on admin role.
- `docs/security/PASSWORD_RESET_AND_EMAIL_VERIFICATION.md` — sprint-sized plan for email verify + password reset.

### S5-9. Test result

```
$ npm run security:smoke
Test Files  12 passed (12)
Tests       94 passed (94)
```

- 89 (Sprint 4 close) + 5 new credential dual-format tests = 94. `tsc --noEmit` runs clean on all touched files.

### S5-10. NOT done this sprint (intentionally deferred)

- Extension DOM-workflow fail-safes (Phase 2 of the request). Plan in `KOLAYXPORT_EXTENSION_SECURITY.md`; will land alongside the next extension build.
- Email verification + password reset implementation. Plan in `docs/security/PASSWORD_RESET_AND_EMAIL_VERIFICATION.md`.
- Admin TOTP 2FA implementation. Plan in `ADMIN_2FA_PLAN.md`.
- Cross-tenant negative tests across every dynamic route. Pattern documented in `API_OWNERSHIP_AUDIT.md`; estimated 1 sprint.
- Replacement of remaining `console.log/error` in `lib/integrations/*` and `pages/api/integrations/*` with the redacting logger.
- Backfill `--apply` execution in production (key + dry-run must come first).
