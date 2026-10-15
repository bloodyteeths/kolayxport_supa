# Hetzner deploy scripts

`hetzner-deploy.sh` is the canonical deploy entrypoint executed on the Hetzner
production box. It is called by `.github/workflows/deploy-hetzner.yml` via
`appleboy/ssh-action`, but you can also run it directly from an SSH session.

## Usage

```bash
# From the GitHub workflow (push to main):
#   workflow runs scripts/deploy/hetzner-deploy.sh full

# From the GitHub workflow (workflow_dispatch with mode=restart):
#   workflow runs scripts/deploy/hetzner-deploy.sh restart

# From an SSH session:
ssh deploy@kolayxport.com
cd /home/deploy/kolayxport
bash scripts/deploy/hetzner-deploy.sh full     # default
bash scripts/deploy/hetzner-deploy.sh restart  # skip install + build
```

## Modes

- `full` (default) — fetch latest source, `npm install --legacy-peer-deps`,
  `npx prisma migrate deploy`, `npx prisma generate`, back up `.next` to
  `.next-backup`, `npx next build --webpack`, `sudo systemctl restart
  kolayxport.service`, health-check. Rollback to `.next-backup` if the
  health check fails after restart.
- `restart` — fetch latest source, `npx prisma migrate deploy` (no-op if
  none), `sudo systemctl restart kolayxport.service`, health-check. **Refuses
  to run if `.next/BUILD_ID` is missing** — restarting against a partial
  build would crash the service.

## Failure semantics

The script runs under `set -euo pipefail`. Every step fails loudly:

- `git pull --ff-only origin main` — if there are local changes blocking the
  fast-forward, the script aborts. (Earlier, a non-fast-forward was silently
  ignored and the workflow falsely reported success.)
- `npx prisma migrate deploy` — if a migration fails, the script aborts.
  **`prisma db push` is never invoked.** Only `migrate deploy` is allowed in
  production per the rule in `docs/deployment/PRODUCTION_TOPOLOGY.md`.
- `npx next build --webpack` — on failure, restore `.next-backup` and exit 3.
- After restart, the health check fetches `https://kolayxport.com/api/health`.
  If that fails, the script restores `.next-backup`, restarts again, and
  exits 6.

Exit codes:

- 0 — success
- 1 — APP_DIR missing
- 2 — unknown mode
- 3 — `next build` failed (backup restored)
- 4 — build "succeeded" but `BUILD_ID` missing (backup restored)
- 5 — `restart` mode requested but `.next/BUILD_ID` missing
- 6 — health check failed (backup restored if available)

## Cron: scheduled draft sends (`send-scheduled-drafts`, every 5 min)

Sends staged listing drafts whose `scheduledSendAt` is due (Etsy, eBay,
Trendyol, Wix, Shopify) and resolves pending Trendyol batches. It never forces
a conflict and never sends a draft with a queued delete. Code:
`lib/drafts/scheduledSend.ts`, route `pages/api/cron/send-scheduled-drafts.ts`.

Primary trigger: the in-process scheduler job `scheduledSendJob` once it is
registered in `lib/scheduler/jobs.ts` (backend request BR-8). HTTP fallback,
next to the other cron jobs in the `deploy` user's crontab on the VPS
(`CRON_SECRET` read from the app's `.env`, never typed on the command line):

```cron
*/5 * * * * cd /home/deploy/kolayxport && curl -fsS --max-time 290 -X POST -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' .env | cut -d= -f2- | tr -d '"')" https://kolayxport.com/api/cron/send-scheduled-drafts >/dev/null 2>&1
```

Duplicate triggers in the same 5-minute bucket are skipped by `CronLock`, and
each draft is claimed by clearing its `scheduledSendAt`, so the scheduler job
and the crontab line can both run. Until migration BR-1a (`scheduledSendAt`,
`CatalogDraft`) is deployed the run is a no-op (`supported: false` in the
response).
