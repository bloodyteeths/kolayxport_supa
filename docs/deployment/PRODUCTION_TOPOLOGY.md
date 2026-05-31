# Production topology — ops cheat sheet

Companion: see `KOLAYXPORT_PRODUCTION_TOPOLOGY.md` at the repo root for evidence and verification commands. This file is the ops-facing summary for on-call use.

---

## Who serves what (as of 2026-05-31, VERIFIED)

| Layer | Host | Notes |
|---|---|---|
| `https://kolayxport.com` (frontend + API) | Hetzner VPS `46.224.169.225`, nginx → Next.js | systemd unit `kolayxport.service`. Path on box: `/home/deploy/kolayxport`. |
| Postgres | Hetzner local Postgres on the same VPS | `DATABASE_URL` in `/home/deploy/kolayxport/.env`. |
| File uploads | Hetzner local disk under `/home/deploy/kolayxport/uploads/...` | `EBAY_IMAGE_UPLOAD_DIR`, `ETSY_DRAFT_UPLOAD_DIR` env vars override. |
| Stripe webhook | `https://kolayxport.com/api/stripe/webhook` | Live endpoint id `we_1RmLgwHkVI5icjTlDx7AyqAs`. |
| Etsy OAuth callback | `https://kolayxport.com/api/integrations/etsy/callback` | Hard-coded in `process.env.ETSY_REDIRECT_URI`. |
| Wix webhook | `https://kolayxport.com/api/integrations/wix/webhook` | RS256 verified via `WIX_WEBHOOK_PUBLIC_KEY` after Sprint 3. |
| Chrome extension auth | `https://kolayxport.com/api/auth/extension` | Pinned to `OFFICIAL_EXTENSION_ID` for `chrome-extension://` origins. |
| Cron (production) | GitHub Actions: `cron-jobs.yml` (every 15 min) + `cron-daily.yml` (daily 00:00 UTC) | Both fire `curl` against the Hetzner host. Idempotency lock on the API side. |
| Vercel project `new-kolayxport` | Linked but not serving the production apex | Vercel cron is defined in `vercel.json` but no-ops in practice. |
| Sentry | not wired yet | `@sentry/nextjs` installed; no `sentry.*.config.ts` files. |

---

## Deploy paths

### Production deploy (Hetzner — canonical)

Automatic on push to `main`:
- `.github/workflows/deploy-hetzner.yml` SSHes as `deploy@46.224.169.225`, runs:
  ```bash
  cd /home/deploy/kolayxport
  git pull origin main
  npm install --legacy-peer-deps
  npx prisma migrate deploy        # NEW since Sprint 5 — applies all pending migrations
  npx prisma generate
  cp -r .next .next-backup 2>/dev/null || true
  rm -rf .next
  npx next build --webpack || { echo "Build failed, restoring backup"; cp -r .next-backup .next; exit 1; }
  sudo systemctl restart kolayxport
  sleep 5
  curl -fsS https://kolayxport.com/api/health \
    || { echo "Health check failed, restoring backup"; rm -rf .next; cp -r .next-backup .next; sudo systemctl restart kolayxport; exit 1; }
  rm -rf .next-backup
  ```
- The deploy script **now applies migrations automatically** as the first step after `npm install`. `migrate deploy` is the only Prisma migration command allowed in production (Prisma documents it as the production/staging command for applying pending migrations from `prisma/migrations/*`). It exits non-zero on failure, which trips `script_stop: true` and prevents the rest of the pipeline from running.
- `prisma db push` and `prisma db push --accept-data-loss` are **forbidden in any production pipeline**.

#### Steps when shipping a Prisma migration

This is the canonical sequence. Use `npx prisma migrate deploy` — not `prisma db push` and never `prisma db push --accept-data-loss`. Prisma documents `migrate deploy` as the only migration command for production and staging.

```bash
ssh deploy@kolayxport.com
cd /home/deploy/kolayxport
git pull
npx prisma migrate deploy         # applies any pending migration folders, e.g. 20260531120000_add_cron_lock
npx prisma migrate status         # expect "Database schema is up to date" — if not, do not restart
npx prisma generate
npx next build --webpack
sudo systemctl restart kolayxport
curl -fsS https://kolayxport.com/api/health
```

#### Verifying the `CronLock` table after deploy

The Sprint 2 / Sprint 3 hardening added `prisma/migrations/20260531120000_add_cron_lock/migration.sql`. The migration only creates the new `CronLock` table and three indexes; it does **not** drop or alter any existing table. After `prisma migrate deploy` you can confirm rows accumulating safely without exposing any secret:

```bash
# Reads only jobName/bucket/createdAt — no tokens, no user data.
psql "$DATABASE_URL" -c \
  'SELECT "jobName", "bucket", "createdAt" FROM "CronLock" ORDER BY "createdAt" DESC LIMIT 10;'
```

Expected after a few cron runs:

```
   jobName    |     bucket       |          createdAt
--------------+------------------+----------------------------
 sync-orders  | 2026-05-31T12:00 | 2026-05-31 12:00:14.123+00
 reset-usage  | 2026-05-31       | 2026-05-31 00:00:08.456+00
 track-ranks  | 2026-05-31       | 2026-05-31 00:00:09.789+00
```

If duplicate triggers fire in the same bucket the handler returns `200 { skipped: true, reason: 'duplicate', bucket }` and no second row appears.

#### Rollback

```bash
ssh deploy@kolayxport.com
cd /home/deploy/kolayxport
git fetch
git reset --hard <previous-sha>
npx prisma generate
rm -rf .next
npx next build --webpack
sudo systemctl restart kolayxport
curl -fsS https://kolayxport.com/api/health
```

If the schema changed in the bad release, the rollback may require a forward-only counter-migration. **Do not run `prisma migrate reset` against production.** `migrate reset` drops every table.

### Vercel deploy

- Not the production path.
- Vercel project linked because `.vercel/project.json` is committed; auto-deploys if its Git integration is enabled.
- After 2026-05-31 the Vercel build no longer mutates the schema.
- Treat any Vercel deployment as preview/inspection only until topology is reviewed again.

---

## Cron — what runs, when, where

| Job | Schedule | Trigger | Endpoint | Idempotency bucket |
|---|---|---|---|---|
| Order sync | every 15 min | `.github/workflows/cron-jobs.yml` | `https://kolayxport.com/api/cron/sync-orders` | 15-minute |
| Order sync (Vercel, no-op) | daily 06:00 UTC | `vercel.json` cron | same path, against the Vercel deployment | covered by the 15-min lock if it ever lands on the same DB |
| Reset usage / expire trials | daily 00:00 UTC | `.github/workflows/cron-daily.yml` | `https://kolayxport.com/api/cron/reset-usage` | daily |
| Track ranks | daily 00:00 UTC (second step) | `.github/workflows/cron-daily.yml` | `https://kolayxport.com/api/cron/track-ranks` | daily |
| `auto-sync-orders.yml` | DISABLED | — | — | — |

All cron handlers go through `lib/cron/idempotency.ts:runCronGuard`. Duplicate calls in the same bucket receive `200 { skipped: true, reason: 'duplicate' }`.

Required secrets on GitHub Actions:
- `KOLAYXPORT_BASE_URL` = `https://kolayxport.com` (verified set 2026-05-31)
- `CRON_SECRET` = matches `/home/deploy/kolayxport/.env` `CRON_SECRET`

Manual verification after secret rotation:
```bash
gh workflow run cron-jobs.yml
gh run watch
gh workflow run cron-daily.yml
gh run watch
```

The workflows now `set -euo pipefail`, preflight-check both secrets, and `curl --fail` — so any missing secret or non-2xx response surfaces as a red ✗ on the Actions page.

---

## Env var locations and required values

- Production runtime: `/home/deploy/kolayxport/.env` on the Hetzner VPS.
- CI build / cron triggers: GitHub Actions repo secrets.
- Vercel: `Project Settings → Environment Variables` (used if/when a Vercel preview is built).

Required keys (match these wherever the app actually runs):
- `DATABASE_URL`, `DIRECT_URL`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PRICE_STARTER_MONTH/YEAR`, `PRICE_GROWTH_MONTH/YEAR`
- `ETSY_API_KEY`, `ETSY_API_SECRET`, `ETSY_REDIRECT_URI`
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REDIRECT_URI`
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_REDIRECT_URI`
- `WIX_APP_ID`, `WIX_APP_SECRET`, `WIX_REDIRECT_URI`
- `WIX_WEBHOOK_PUBLIC_KEY` (PEM — from Wix Dev Center Webhooks tab; new this sprint)
- `AMAZON_*` per SP-API client
- `FEDEX_*`, `UPS_*`, `MNG_*`
- `CRON_SECRET`
- `KOLAYXPORT_INTERNAL_API_KEY` (preferred) and/or `CLAWD_API_KEY` (legacy; same value during migration)
- `CREDENTIAL_ENCRYPTION_KEY` (32 raw bytes; generate via `openssl rand -hex 32`)
- `OFFICIAL_EXTENSION_ID` (Chrome extension ID; required for `chrome-extension://` callers)
- `KOLAYXPORT_BASE_URL` (GitHub secret only, used by cron workflows)

---

## "Schema changes that need a migration" rule

- `prisma db push` is forbidden in production. It was removed from `vercel.json` because it carried `--accept-data-loss`.
- All schema changes go through:
  ```bash
  npx prisma migrate dev --name <descriptive>  # locally
  # commit the new prisma/migrations/<timestamp>_<name>/ folder
  ```
  Then on Hetzner: `npx prisma migrate deploy`.
- `db push` is fine in local development. It is fine for fast-iteration on feature branches against a throwaway DB. It is **never** fine against production data.

---

## Operational sanity checks

```bash
# 1) Production is alive
curl -fsS https://kolayxport.com/api/health

# 2) Confirm Hetzner is still serving it (no Vercel hijack)
curl -sI https://kolayxport.com/ | grep -i '^server:'                  # expect nginx
curl -sI https://kolayxport.com/api/health | grep -iE '^(x-vercel-|x-matched-path):'   # expect empty

# 3) systemd unit
ssh deploy@kolayxport.com 'systemctl is-active kolayxport.service'

# 4) Last build
ssh deploy@kolayxport.com 'cd /home/deploy/kolayxport && git log -1 --pretty=oneline'

# 5) Last cron run
gh run list --workflow=cron-jobs.yml --limit 1
gh run list --workflow=cron-daily.yml --limit 1

# 6) Confirm production schema is up to date
ssh deploy@kolayxport.com 'cd /home/deploy/kolayxport && npx prisma migrate status'

# 7) Confirm Stripe webhook is still wired
stripe webhook_endpoints list --live \
  | python3 -c "import json,sys; print([e['url'] for e in json.load(sys.stdin)['data'] if 'kolayxport.com' in e['url']])"

# 8) Confirm CronLock rows accumulating
psql "$DATABASE_URL" -c \
  'SELECT "jobName", "bucket", "createdAt" FROM "CronLock" ORDER BY "createdAt" DESC LIMIT 10;'
```
