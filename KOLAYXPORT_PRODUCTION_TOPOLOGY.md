# KOLAYXPORT_PRODUCTION_TOPOLOGY

Status: **VERIFIED for the four pillars that drive money — frontend host, API host, Stripe webhook, Etsy OAuth callback. Cron source-of-truth verified on the GitHub Actions side.**

Last verified: 2026-05-31.

Decision rule: Vercel-related files (`vercel.json`, `.vercel/`) **stay** for now. They are no longer dangerous because the destructive `prisma db push --accept-data-loss` was removed from `vercel.json` on this date. The Vercel project (`prj_3TzY6KfFQS5cAFAhBbENTFMtrv1N`, `new-kolayxport`) is linked but does not serve the apex production domain.

---

## 1. Frontend deployment — VERIFIED: Hetzner

Evidence (2026-05-31):
- `curl -sI https://kolayxport.com/api/health` → `Server: nginx/1.24.0 (Ubuntu)`, **no `x-vercel-id` header**, response carries the exact security headers defined in `next.config.js` (X-Frame-Options, CSP with `https://*.etsy.com` / `*.ebay.com` / `*.trendyol.com`, HSTS, Permissions-Policy).
- `dig +short kolayxport.com A` → `46.224.169.225` (the Hetzner VPS).
- HTTPS connection: remote IP `46.224.169.225`.
- `.github/workflows/deploy-hetzner.yml` SSH-deploys to `46.224.169.225` and runs the post-deploy `curl https://kolayxport.com/api/health` health check.

Conclusion: production frontend is served by the Hetzner systemd unit `kolayxport.service` behind nginx.

---

## 2. API deployment — VERIFIED: Hetzner

Same evidence as §1: API routes are colocated under `pages/api/*` in the same Next.js app; the host that serves the frontend serves the API. Confirmed via `curl -sI https://kolayxport.com/api/stripe/webhook` → `HTTP/1.1 405 Method Not Allowed`, `Allow: POST`, same nginx server header.

---

## 3. Database location — UNCHANGED, ASSUMED HETZNER

Per `CLAUDE.md`: production Postgres is local on the VPS (`DATABASE_URL` pointing to `localhost`-style host). Not re-probed because reading the Hetzner `.env` requires SSH per row.

Supabase: still installed (`@supabase/ssr`, `@supabase/supabase-js` (devDep)) and CI injects `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` at build. Runtime usage of Supabase is **NEEDS_CONFIRMATION** — see §10 grep.

---

## 4. Domain → infrastructure mapping — VERIFIED for the apex

- `kolayxport.com` → Hetzner `46.224.169.225` (verified).
- `www.kolayxport.com`, `app.kolayxport.com`, `api.kolayxport.com`: **NEEDS_CONFIRMATION** — not probed.
- Vercel project (`new-kolayxport`) may serve a preview-only domain like `new-kolayxport.vercel.app`. Whatever it serves is **not** the customer-facing apex domain.

---

## 5. Cron jobs — VERIFIED: GitHub Actions is canonical

Four surfaces existed at the start of this sprint. Status now:

### A. Vercel cron (`vercel.json`)
Daily entries for `/api/cron/sync-orders` (6 UTC), `/api/cron/reset-usage` (0 UTC), `/api/cron/track-ranks` (8 UTC). **Not the production cron.** It only fires against the Vercel deployment, which is not the apex host. Left in place because (a) server-side idempotency now no-ops duplicate triggers and (b) the topology rule says don't delete Vercel files this sprint.

### B. GitHub Actions `cron-jobs.yml` — VERIFIED PRODUCTION CRON
Every 15 minutes, calls `${KOLAYXPORT_BASE_URL}/api/cron/sync-orders` with `Authorization: Bearer ${CRON_SECRET}`.
- Repository secret `KOLAYXPORT_BASE_URL` was missing; set to `https://kolayxport.com` on 2026-05-31.
- Manual `workflow_dispatch` post-fix completed successfully.
- The workflow now fails loudly if either secret is missing (preflight check, `set -euo pipefail`, `curl --fail`, no `|| true`).

### C. GitHub Actions `cron-daily.yml` — VERIFIED PRODUCTION CRON
Daily at 00:00 UTC. Hits `/api/cron/reset-usage` then `/api/cron/track-ranks`.
- Same secret + preflight model as `cron-jobs.yml`.

### D. GitHub Actions `auto-sync-orders.yml` — BROKEN, SCHEDULE DISABLED
- `scripts/auto-sync-all-users.js` references `prisma.userIntegrationSettings` (removed model; current is `Credential`) and the legacy `lib/integrations/veeqo.ts` / `lib/integrations/shippo.ts`.
- Every recent scheduled run returned `failure`. It is unsafe to re-enable until the script is rewritten.
- On 2026-05-31 the schedule was removed; `workflow_dispatch` only.

### Idempotency
All three cron handlers now use `lib/cron/idempotency.ts`:
- `sync-orders`: 15-minute bucket (matches `cron-jobs.yml` cadence).
- `reset-usage`: daily bucket.
- `track-ranks`: daily bucket.
The `CronLock(jobName, bucket)` unique constraint enforces single-execution per bucket regardless of how many triggers fire. Duplicate triggers receive `200 { skipped: true, reason: 'duplicate' }`.

---

## 6. Env vars — partial verification

Verified via `gh secret list`, `gh secret list --env Production`, `gh secret list --env Preview`, `gh variable list`:

| Secret | Where it lives | Status |
|---|---|---|
| `CRON_SECRET` | repo-level | present |
| `KOLAYXPORT_SSH_KEY` | repo-level | present |
| `KOLAYXPORT_VPS_IP` | repo-level | present |
| `NEXTAUTH_SECRET` | repo-level | present |
| `NEXT_PUBLIC_SUPABASE_URL` | repo-level | present (build-time only) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | repo-level | present (build-time only) |
| `SUPABASE_ACCESS_TOKEN` | repo-level | present (CLI / scripts) |
| `KOLAYXPORT_BASE_URL` | repo-level | **set on 2026-05-31** to `https://kolayxport.com` |

GitHub environments `Production` and `Preview` exist but have **no** environment-level secrets or variables defined.

Hetzner `.env` (`/home/deploy/kolayxport/.env`) — accessed via `ssh deploy@kolayxport.com`. Confirmed keys present (no values printed):
- `ETSY_REDIRECT_URI="https://kolayxport.com/api/integrations/etsy/callback"` — **VERIFIED match with §7**.
- `STRIPE_WEBHOOK_SECRET` — present (value not read).
- `NEXTAUTH_URL` — present (value not read).

Variables to add when the corresponding sprint tasks land:
- `CREDENTIAL_ENCRYPTION_KEY` (Hetzner `.env`) — needed before `scripts/backfill-encrypt-credentials.ts --apply` runs.
- `OFFICIAL_EXTENSION_ID` (Hetzner `.env`) — needed for P1-1 extension origin pin.

---

## 7. Source-of-truth table (post-verification)

| Concern | Source of truth | Confidence | Notes |
|---|---|---|---|
| Frontend at `https://kolayxport.com` | Hetzner systemd `kolayxport.service` behind nginx | VERIFIED | nginx server header + no x-vercel-id + DNS A → 46.224.169.225 |
| API at `https://kolayxport.com/api/*` | Same as frontend → Hetzner | VERIFIED | Same probe |
| Database | Hetzner local Postgres | HIGH (per CLAUDE.md) | Re-confirm by reading `DATABASE_URL` host in Hetzner `.env` next time. |
| File uploads (`uploads/etsy-drafts/`, `uploads/ebay-images/`) | Hetzner local filesystem | HIGH | Hardened `serve-image.ts` ships in this sprint; Vercel is never in the upload path because Vercel does not serve the apex. |
| Chrome extension auth endpoints (`/api/auth/extension`, `/api/ext/*`) | Hetzner | HIGH | Served by the apex host. |
| Stripe webhook `/api/stripe/webhook` | Hetzner | VERIFIED | `stripe webhook_endpoints list --live` returned endpoint `we_1RmLgwHkVI5icjTlDx7AyqAs` with URL `https://kolayxport.com/api/stripe/webhook`, `livemode: true`, `status: enabled`. |
| Etsy OAuth callback `/api/integrations/etsy/callback` | Hetzner | VERIFIED | Production `.env` confirms `ETSY_REDIRECT_URI` matches. |
| eBay / Shopify / Wix / Amazon OAuth callbacks | Hetzner | NEEDS_CONFIRMATION | Same pattern is highly likely; verify when each is rotated. |
| Cron (canonical) | GitHub Actions (`cron-jobs.yml` + `cron-daily.yml`) | VERIFIED | Idempotency guard now protects against accidental Vercel-side double-fires. |
| Hetzner systemd unit | `kolayxport.service` on `46.224.169.225` | HIGH | Deploy workflow restarts it on every push to `main`. |

---

## 8. Still unknown — verification list (smaller now)

1. Live mapping for `www.kolayxport.com`, `app.kolayxport.com`, `api.kolayxport.com`, Vercel preview hosts.
2. Whether the Vercel project has an active Production deployment serving any user-facing traffic at all.
3. eBay / Shopify / Wix / Amazon OAuth callback host registrations (each developer dashboard).
4. Whether `@supabase/ssr` / `@supabase/supabase-js` are still imported by any runtime path (need a grep — see §10 commands).

---

## 9. Risk register update

- **Vercel build no longer wipes the schema.** The `prisma db push --accept-data-loss` was removed from `vercel.json` on 2026-05-31. Production schema changes must go through `npx prisma migrate deploy` against the Hetzner Postgres.
- **Cron is no longer silently failing.** `cron-jobs.yml` and `cron-daily.yml` now `set -euo pipefail`, preflight-check the two required secrets, and `curl --fail` so non-2xx responses or missing config produce a red ✗ on the Actions page.
- **Cron is no longer double-fireable.** Idempotency lock via `CronLock(jobName, bucket)`.
- **Cron is no longer brute-forceable via timing.** `verifyCronAuth` uses `crypto.timingSafeEqual`.
- **`auto-sync-orders.yml` is no longer attempting to run** every 15 minutes against the broken `prisma.userIntegrationSettings` model.

---

## 10. Outstanding verification commands (run when convenient)

```bash
# Confirm no runtime imports of Supabase outside tests/scripts.
grep -rn "from '@supabase/\|from \"@supabase/" \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  pages/ lib/ components/ 2>/dev/null | grep -v node_modules

# Confirm OAuth callback URLs in each marketplace dashboard (manual):
#   - eBay:      developer.ebay.com -> Applications -> RuName / redirect URL
#   - Shopify:   partners.shopify.com -> App -> URLs -> Allowed redirection URLs
#   - Wix:       dev.wix.com -> app dashboard -> OAuth -> Redirect URI
#   - Amazon:    Seller Central -> Develop apps -> OAuth Login URI

# Confirm no Hetzner-side cron is racing GH Actions cron.
ssh root@46.224.169.225 'systemctl list-timers --all | grep -i kolayxport'
ssh root@46.224.169.225 'crontab -l -u deploy 2>/dev/null; crontab -l -u root 2>/dev/null'

# Sanity-check the active GH Actions cron-jobs.yml the next time it runs.
gh run list --workflow=cron-jobs.yml --limit 5
gh run view <run-id> --log | grep -E "(KOLAYXPORT_BASE_URL|curl|HTTP/|::error)"
```

---

## 11. Open decisions deferred to a future sprint

- Whether to disable Vercel cron in `vercel.json` (low priority now that idempotency protects the DB).
- Whether to unlink the Vercel project entirely (`.vercel/project.json`) — wait until we're sure no internal user is hitting a Vercel preview URL.
- Whether to remove `@supabase/*` deps (depends on §10 grep result).
- Whether `auto-sync-orders.yml` should be deleted or fixed-and-re-enabled. Fix is a small rewrite of `scripts/auto-sync-all-users.js` against the current `Credential` model; can be folded into the next sprint.
