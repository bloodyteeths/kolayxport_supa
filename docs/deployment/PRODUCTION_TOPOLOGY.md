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

Automatic on push to `main`. Since Sprint 6 the deploy logic lives in `scripts/deploy/hetzner-deploy.sh`; `.github/workflows/deploy-hetzner.yml` is reduced to a thin SSH invocation that calls the script. This avoids the `appleboy/ssh-action` multi-line YAML pitfall that broke earlier inline `if/then/else/fi` branching.

Two modes supported by the script:

| Mode | When | What it does |
|---|---|---|
| `full` (push default) | code changes | `git pull --ff-only`, `npm install --legacy-peer-deps`, `npx prisma migrate deploy`, `npx prisma generate`, back up `.next` to `.next-backup`, **preserve `.next/cache/` for incremental webpack**, `rm -rf .next`, re-seed cache, `npx next build --webpack`, `sudo systemctl restart`, health check, cleanup backup. Refuses to mark success if `BUILD_ID` is missing from the new build. |
| `restart` (workflow_dispatch only) | restart against an already-built `.next` | `git pull --ff-only`, `npx prisma migrate deploy` (no-op if none), `sudo systemctl restart`, health check. **Refuses to run if `.next/BUILD_ID` is missing** — partial builds will not be activated. |

Cache preservation note: every deploy preserves `.next/cache/` between builds. A cold webpack build on the Hetzner cax21 (4 ARM cores, 8 GB RAM) takes ~7–10 minutes. An incremental rebuild with a warm cache for a small code change drops to ~1–2 minutes. The script moves `.next/cache/` to `/tmp/kx-next-cache` before `rm -rf .next` and restores it before `next build --webpack`.

Manual invocation:
```bash
ssh deploy@kolayxport.com
cd /home/deploy/kolayxport
bash scripts/deploy/hetzner-deploy.sh full     # default
bash scripts/deploy/hetzner-deploy.sh restart  # skip install + build (BUILD_ID must exist)
```

GitHub Actions invocation:
```bash
gh workflow run deploy-hetzner.yml                    # push-style, mode=full
gh workflow run deploy-hetzner.yml -f mode=restart    # restart-only when build is already current
```

- `prisma db push` and `prisma db push --accept-data-loss` are **forbidden in any production pipeline**. Neither the workflow nor the script ever calls `db push`. Only `npx prisma migrate deploy`.
- The script runs under `set -euo pipefail`. There is no `|| true` swallowing real failures. A failed `git pull` (e.g. dirty working tree blocking fast-forward), failed migration, failed build, or failed health-check exits non-zero and trips the workflow as a failed run.
- Build failures restore `.next-backup` and exit 3. Missing `BUILD_ID` after build restores backup and exits 4. Health-check failures restore backup, restart, and exit 6.

### Recovery when the workflow is killed mid-build

If a workflow gets killed during `next build` (timeout, runner death, user cancel), the `.next` on the server is partial and the running service is now serving against an in-progress directory. Symptoms:

- `/api/health` keeps returning 200 (handled by Next.js API routes, no static file lookup).
- HTML pages (`/`, `/login`, etc.) return **500** because the service tries to read `.next/server/pages/<page>.html` which doesn't exist yet.

Recovery in this order:

1. **Cancel the workflow run** (`gh run cancel <id>`).
2. **Kill the orphaned build** on the server: `ssh deploy@kolayxport.com 'pkill -9 -f "next build --webpack" || true'`.
3. Check for a nested `.next-backup/.next/` — the workflow's pre-build `cp -r .next .next-backup` will create that when run repeatedly:
   ```bash
   ssh deploy@kolayxport.com 'cat /home/deploy/kolayxport/.next-backup/.next/BUILD_ID 2>/dev/null'
   ```
4. If `BUILD_ID` is present in the nested backup, restore it:
   ```bash
   ssh deploy@kolayxport.com '
     cd /home/deploy/kolayxport
     mv .next .next-broken-$(date +%s)
     mv .next-backup/.next .next
   '
   ```
   The running service starts serving HTML pages again immediately — no restart needed (Next.js reads `.next` lazily per request).
5. Trigger a clean deploy: `gh workflow run deploy-hetzner.yml -f mode=full` (or push a tiny commit).

This procedure was used on 2026-05-31 during the Sprint 1–5 deploy that timed out at 20 min mid-build, leaving homepage 500.

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
  Then on Hetzner: `npx prisma migrate deploy` (already automatic via the deploy script).
- `db push` is fine in local development. It is fine for fast-iteration on feature branches against a throwaway DB. It is **never** fine against production data.

---

## Known performance gaps in the deploy pipeline

Sprint 6 fixes the cheapest one (cache preservation). The rest are tracked but **not** done in this sprint:

| Gap | Impact | Next-sprint fix |
|---|---|---|
| Cold webpack build on every deploy (FIXED Sprint 6) | First build ~7–10 min; subsequent ~1–2 min | Already shipped — `.next/cache/` preserved through `rm -rf .next`. |
| `rm -rf .next` makes pages 500 during build | Customers see "Internal Server Error" on the homepage for the ~2 minutes between `rm -rf` and successful `mv` of new build | Build into `.next-new`, then atomic `mv .next .next-old && mv .next-new .next && rm -rf .next-old`. The service reads `.next` lazily per request, so the swap is effectively zero-downtime. |
| `--webpack` flag is hardcoded | Webpack is ~2–3x slower than Turbopack on the same codebase | Verify the app builds cleanly under Turbopack (`npx next build`), then drop the `--webpack` flag. Mid-incident is the wrong time. |
| Build runs on the deploy host | The Hetzner cax21 is undersized; GitHub-hosted runners have 4 vCPU x86 cores and would build in ~2 min | Move the build step to GitHub Actions: build `.next/`, archive it as an artifact, `rsync` to Hetzner, run `restart` mode. Bigger refactor. |
| `appleboy/ssh-action` adds ~30–60s overhead | Negligible vs. the build cost above | Stays. |

The user-facing 500 during build (item 2) is the next thing to fix because it directly affects experience during every deploy.

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
