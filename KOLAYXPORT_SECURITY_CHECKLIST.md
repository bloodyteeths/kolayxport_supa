# KOLAYXPORT_SECURITY_CHECKLIST

Legend: `[x]` shipped, `[~]` partially shipped, `[ ]` not yet, `[!]` blocker, `[n/a]` intentional skip.

---

## Auth & identity

- [x] NextAuth credentials + Google. bcryptjs cost 12. JWT sessions. Header-only internal API key. Constant-time compare.
- [ ] Email verification flow. Plan: `docs/security/PASSWORD_RESET_AND_EMAIL_VERIFICATION.md`.
- [ ] Password reset flow. Plan: same doc.
- [ ] 2FA for admin role. Plan: `ADMIN_2FA_PLAN.md`.
- [x] OAuth state CSRF binding verified for Etsy/eBay/Amazon (state contains userId + CSRF token); Shopify (HMAC + state); Wix (claim flow).

## API surface — multi-tenant isolation

- [x] `requireOwned` helper available.
- [x] Every dynamic `[id]` route audited; all enforce `userId` filter — see `API_OWNERSHIP_AUDIT.md`.
- [ ] Cross-tenant negative-test sweep. Pattern documented; estimated 1 sprint.
- [~] `pages/api/shipments/[shipmentId]/delete.ts` returns 403 vs the rest's 404 — cosmetic fix queued.

## Chrome extension

- [x] Origin pinned in `pages/api/auth/extension.ts` + `pages/api/ext/telemetry.ts`.
- [x] Manifest `externally_connectable` whitelists kolayxport.com only; `ids:[]`.
- [x] Extension endpoints never return marketplace tokens.
- [ ] DOM workflow fail-safes (selector / order id / tracking number mismatch). Documented in `KOLAYXPORT_EXTENSION_SECURITY.md`.
- [ ] Tracking job status enum (`pending | running | success | failed | needs_manual_review`). Same doc.

## Webhooks

- [x] Stripe signature verified; customer-match assertion before mutate.
- [x] Stripe + Wix events recorded in `WebhookEvent(provider, eventType, status)` for the admin cockpit.
- [x] Wix RS256 signature verified via `lib/integrations/wix/verifyWebhook.ts`. Falls back to claim-only when `WIX_WEBHOOK_PUBLIC_KEY` unset.
- [ ] `WIX_WEBHOOK_PUBLIC_KEY` set in Hetzner `.env` — until set, Wix runs in claim-only fallback.
- [ ] Shopify webhook HMAC audit on every event route. Routes under `pages/api/shopify/webhooks/*` exist (e.g. `subscription-update.ts`); full audit pending.

## Cron

- [x] `CRON_SECRET` constant-time compare; `runCronGuard` idempotency; failure-loud GitHub Actions.
- [x] `auto-sync-orders.yml` schedule disabled; script archived under `scripts/archive/`.
- [ ] `prisma migrate deploy` of `20260531120000_add_cron_lock` AND `20260531150000_admin_monitoring` on Hetzner.

## Stored credentials

- [x] `lib/crypto/credentials.ts` accepts all three on-disk shapes (plaintext, legacy, `enc:v1:`). `encryptIfNeeded` produces `enc:v1:` only.
- [x] All 5 marketplace OAuth callbacks (Etsy/eBay/Shopify/Wix/Amazon) encrypt on write.
- [x] All 5 marketplace clients decrypt on read + encrypt-on-refresh.
- [x] Carrier credential readers (FedEx via `lib/config.ts`, UPS, MNG) decrypt on read.
- [x] Paraşüt credentials decrypt on read.
- [x] Trendyol credentials decrypt on read in all 4 active routes (metadata / operations / products + central `lib/config.ts`).
- [x] Dual-format tests in `test/lib/crypto/credentials.test.ts`.
- [ ] `CREDENTIAL_ENCRYPTION_KEY` set on Hetzner `.env`.
- [ ] `scripts/backfill-encrypt-credentials.ts --dry-run` executed in production; plaintext counts recorded.
- [ ] `scripts/backfill-encrypt-credentials.ts --apply` executed.
- [n/a] SMTP creds at-rest encryption — SMTP lives entirely in env vars.

## Logging / observability (internal-only)

- [x] Redacting logger covers all paths.
- [x] Admin monitoring cockpit at `/admin/monitoring` driven by 12 admin APIs.
- [x] `AdminAuditLog` populated for `/api/admin/users/[userId]` PATCH.
- [x] Daily admin summary route off-by-default.
- [n/a] **No Sentry.** Package removed from `package.json` after grep confirmed 0 imports.

## Deployment / topology

- [x] Hetzner = production apex. Vercel project is linked but not serving production.
- [x] GitHub Actions = production cron.
- [x] `vercel.json` no longer runs `prisma db push --accept-data-loss`.
- [x] `.github/workflows/deploy-hetzner.yml` runs `npx prisma migrate deploy` between install and build.
- [x] No `prisma db push` reference in any active workflow or script (greppable confirmation in `KOLAYXPORT_HARDENING_SUMMARY.md`).
- [x] `docs/deployment/PRODUCTION_TOPOLOGY.md` covers the migration ritual.
- [x] `docs/admin/ADMIN_MONITORING_RUNBOOK.md` covers cockpit ops.
- [x] `docs/security/CREDENTIAL_ENCRYPTION_RUNBOOK.md` covers the dry-run/apply story.

## Tests

- [x] `vitest.config.ts` + `test/vitest.setup.ts`.
- [x] `npm run security:smoke` runs `tsc --noEmit` + the security-focused vitest files.
- Last run (Sprint 5 close): **12/12 test files passed, 94/94 tests passed**.

## Build / repo hygiene

- [x] Removed `@sentry/nextjs`, `@auth0/nextjs-auth0`, `iyzipay` from `package.json` (all confirmed unused).
- [x] `scripts/auto-sync-all-users.js` archived to `scripts/archive/`.
- [ ] Move repo-root junk per original audit §P6 (screenshots, zips, NabavkiData pitch deck, etc.). Future sprint.
- [ ] `@supabase/ssr`, `@supabase/supabase-js`: keep for now (CI build injects SUPABASE_URL/ANON_KEY — verify runtime usage before removing).
- [ ] Convert remaining `console.log/error` in `lib/integrations/*` and `pages/api/integrations/*` to the redacting logger.

---

## Pre-deploy ritual

1. **Migrations** (mandatory before the new code is restarted, but the deploy workflow now does this automatically):
   ```bash
   ssh deploy@kolayxport.com
   cd /home/deploy/kolayxport
   git pull
   npx prisma migrate deploy
   npx prisma migrate status        # expect "Database schema is up to date"
   sudo systemctl restart kolayxport
   curl -fsS https://kolayxport.com/api/health
   ```
2. **Env vars** on Hetzner `/home/deploy/kolayxport/.env`:
   - `CREDENTIAL_ENCRYPTION_KEY=<openssl rand -hex 32>` (do not lose).
   - `OFFICIAL_EXTENSION_ID=<chrome web store id>`.
   - `WIX_WEBHOOK_PUBLIC_KEY=<PEM from Wix Dev Center>`.
   - `ADMIN_ALERT_EMAIL=<optional>` (for daily summary).
3. **Cron sanity**:
   ```bash
   gh workflow run cron-jobs.yml
   gh run watch
   gh workflow run cron-daily.yml
   gh run watch
   ```
4. **CronLock / WebhookEvent / SyncLog visibility**:
   ```bash
   psql "$DATABASE_URL" -c 'SELECT "jobName","bucket","createdAt" FROM "CronLock" ORDER BY "createdAt" DESC LIMIT 10;'
   psql "$DATABASE_URL" -c 'SELECT provider,"eventType",status,"createdAt" FROM "WebhookEvent" ORDER BY "createdAt" DESC LIMIT 10;'
   psql "$DATABASE_URL" -c 'SELECT category, COUNT(*) FROM "SyncLog" WHERE timestamp > NOW() - INTERVAL '"'"'24 hours'"'"' GROUP BY category;'
   ```
5. **Credential backfill dry-run** (safe to run any time after key + migrations are set):
   ```bash
   npx tsx scripts/backfill-encrypt-credentials.ts --dry-run
   ```
6. **`/admin/monitoring`** sanity check — needs-attention queue, system card, cron card, audit log.
7. **Stripe webhook still wired**:
   ```bash
   stripe webhook_endpoints list --live \
     | python3 -c "import json,sys; print([e['url'] for e in json.load(sys.stdin)['data'] if 'kolayxport.com' in e['url']])"
   ```
