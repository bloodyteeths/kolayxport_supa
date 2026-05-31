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

---

## Sprint 6 — Header-only API keys + Shopify HMAC + deploy reliability (2026-05-31, late)

### S6-1. Header-only internal API key sweep
- Removed `|| req.query.apiKey` from 19 routes that did their own ad-hoc `process.env.CLAWD_API_KEY === apiKey` check (Sprint 1 hardened `lib/auth.ts:getAuthUserOrApiKey` but never swept these). Each now reads only `req.headers['x-api-key']`.
- Files touched: `pages/api/stats.ts`, `pages/api/clawd/{amazon-research,arbitrage,ebay,ebay-ai,ebay-research,etsy,trendyol,upload-image}.ts`, `pages/api/finance/{dashboard,product-costs,settlements}.ts`, `pages/api/analytics/{index,marketplace}.ts`, `pages/api/trends/{amazon,etsy}.ts`, `pages/api/integrations/etsy/shops.ts`, `pages/api/trendyol/research.ts`.
- Functional behaviour unchanged for legitimate callers (extension + internal scripts already pass the header). Browser callers that accidentally put the key in a URL no longer succeed (the keys never belonged there).

### S6-2. Shopify webhook hardening + cockpit instrumentation
- New `lib/integrations/shopify/verifyWebhook.ts` exports:
  - `verifyShopifyHmac(rawBody, headerHmac)` — pre-checks length, then `crypto.timingSafeEqual` (the bare `timingSafeEqual` throws on mismatched lengths and that throw could leak the same length-vs-content distinction to an attacker by response shape).
  - `readRawBody(req)` — shared async iterator → utf-8 raw body. Both handlers now share this.
- `pages/api/shopify/webhooks/{compliance,subscription-update}.ts` rewritten on top of those helpers. Signature failures now emit `security.shopify.signature_failed` events visible at `/admin/monitoring → Security`. Each event is recorded into `WebhookEvent(provider='shopify', eventType, status, errorMessage)` for the cockpit Billing card. Compliance events redact buyer ids to the last 4 characters.
- Tests: `test/api/shopify.webhook.test.ts` (5 cases — valid HMAC, tampered body, length mismatch (no throw), missing secret, missing header).
- `npm run security:smoke` updated to include the new file. Total at Sprint 6 close: **13 files, 99 tests** passing.

### S6-3. Credential encryption fail-soft
- `lib/crypto/credentials.ts:encryptIfNeeded` now falls back to plaintext when `CREDENTIAL_ENCRYPTION_KEY` is unset, instead of throwing. Without this, the new OAuth callbacks would throw on every marketplace connect/refresh in a fresh environment where the key hasn't been provisioned yet.
- Verified: `CREDENTIAL_ENCRYPTION_KEY` IS set on the Hetzner production box, so the fail-soft is purely defensive for the case where it is ever removed.

### S6-4. Deploy reliability rewrite
The deploy workflow has been the most fragile piece this week. Sprint 6 took the following actions, each backed by a verified incident:

| Action | Why | Reference |
|---|---|---|
| `script_stop: true` removed (was silently ignored by appleboy/ssh-action) | The first Sprint 1–5 deploy reported success but `git pull` had silently failed because `yarn.lock` was dirty on the box — the workflow continued past the failed pull and the runtime never updated. | Run `26716805400`. |
| `command_timeout` bumped from default 10 m → 20 m → 30 m | Each previous bound killed the build mid-flight, leaving `.next` partial and the homepage 500. | Runs `26717036529` (10 m kill), `26718052475` (20 m kill). |
| Multi-line inline `if/then/else/fi` REMOVED | `appleboy/ssh-action` collapses the YAML `script:` block into a single line on the remote shell, mashing `then`/`else`/`fi` together into an unparsable command. The result: `SKIP_BUILD=true` didn't actually skip the build. | Verified via `ps -ef \| grep next-build` showing the build still running despite skip flag. |
| Logic moved into `scripts/deploy/hetzner-deploy.sh` | Real shell script avoids the multi-line YAML pitfall, runs under `set -euo pipefail`, can be invoked manually from SSH. README in `scripts/deploy/README.md`. |
| Restart-only mode added | A complete `.next/BUILD_ID` on disk can be activated without rebuilding — useful when the previous workflow run died at the restart step. | Refuses to run if `BUILD_ID` is missing. |
| `.next/cache/` preserved between builds | Webpack uses `.next/cache` for incremental compilation. Wiping it on every deploy turned every push into a cold build (~7–10 minutes on the cax21). Preserving it should drop incremental rebuilds to ~1–2 minutes. | Cold build measured at 7–10 min across three deploys. |

### S6-5. Mid-incident manual recovery procedure
Documented in `docs/deployment/PRODUCTION_TOPOLOGY.md` under "Recovery when the workflow is killed mid-build". The procedure used today:

1. `gh run cancel <id>`.
2. `ssh deploy@kolayxport.com 'pkill -9 -f "next build --webpack" || true'`.
3. Check for a nested `.next-backup/.next/BUILD_ID` (created when the workflow's `cp -r .next .next-backup` runs twice). If present, `mv .next .next-broken-<ts>; mv .next-backup/.next .next`. The service starts serving HTML pages immediately on the next request — no restart needed because Next.js reads `.next` lazily.
4. Trigger a clean deploy.

This was used to recover the homepage from 500 → 200 during the third deploy attempt today.

### S6-6. Known performance gaps (NOT done this sprint)
| Gap | Severity | Plan |
|---|---|---|
| `rm -rf .next` causes homepage 500 during ~2-minute build window | High — customer-visible 500s on every deploy | Atomic swap: build into `.next-new` (Next.js `distDir` or symlink trick), then `mv` after `BUILD_ID` is written. |
| Build runs on the deploy host | Medium — 7–10 min cold builds | Off-VPS build: GitHub Actions builds, `rsync` `.next/` to Hetzner, deploy script does only the restart. |
| `--webpack` flag hardcoded | Medium — Turbopack is 2–3× faster | Verify Turbopack compatibility, then drop the flag. |
| `appleboy/ssh-action` overhead | Low — ~30–60s per workflow | Stays. |

---

## Test suite result at Sprint 6 close

```
$ npm run security:smoke
Test Files  13 passed (13)
Tests       99 passed (99)
```

`tsc --noEmit` clean. New tests in this sprint: `test/api/shopify.webhook.test.ts` (5 cases).
