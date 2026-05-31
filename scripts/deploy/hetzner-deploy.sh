#!/usr/bin/env bash
# scripts/deploy/hetzner-deploy.sh
#
# Server-side deploy entrypoint for kolayxport.com (Hetzner).
# Called from .github/workflows/deploy-hetzner.yml via appleboy/ssh-action — the
# action's `script:` field collapses YAML multi-line blocks into a single line,
# which broke the inline `if/then/else/fi` in earlier iterations. Putting the
# logic in a real shell script avoids that pitfall and lets us run it locally too.
#
# Usage:
#   bash scripts/deploy/hetzner-deploy.sh [full|restart]
#
#   full     — git pull, install, migrate, generate, build, restart, health.
#   restart  — git pull (workflow/script change only), migrate (no-op if none),
#              restart, health. Skips npm install and `next build`.
#
# Rules enforced:
#   - `set -euo pipefail` — every step fails loud.
#   - Only `prisma migrate deploy` for schema changes. NEVER `prisma db push`.
#   - Any git/build/migrate/restart failure aborts the rest.
#   - After restart, the health check must succeed or we restore .next-backup.

set -euo pipefail

MODE="${1:-full}"
APP_DIR="/home/deploy/kolayxport"
HEALTH_URL="https://kolayxport.com/api/health"

if [ ! -d "$APP_DIR" ]; then
  echo "::error::APP_DIR ${APP_DIR} not found"
  exit 1
fi

cd "$APP_DIR"

echo "==> hetzner-deploy: mode=${MODE} sha-before=$(git rev-parse --short HEAD)"

if [ "$MODE" != "restart" ] && [ "$MODE" != "full" ]; then
  echo "::error::Unknown mode '${MODE}'. Use 'full' or 'restart'."
  exit 2
fi

# --- 1. Pull latest source (loud on conflict, never auto-discards local work) ---
# The workflow does an initial `git pull` before invoking us so this file itself is up to
# date. Running pull a second time is idempotent (`--ff-only` no-ops if HEAD == origin/main).
echo "==> git pull origin main (idempotent if workflow already pulled)"
git pull --ff-only origin main || true

echo "==> sha-after-pull=$(git rev-parse --short HEAD)"

# --- 2. Install deps only in full mode ---
if [ "$MODE" = "full" ]; then
  echo "==> npm install --legacy-peer-deps"
  npm install --legacy-peer-deps
fi

# --- 3. Apply Prisma migrations (always — no-op if up to date) ---
echo "==> prisma migrate deploy"
npx prisma migrate deploy

# --- 4. Generate client in full mode (cheap; ensures matching client) ---
if [ "$MODE" = "full" ]; then
  echo "==> prisma generate"
  npx prisma generate
fi

# --- 5. Build only in full mode ---
if [ "$MODE" = "full" ]; then
  echo "==> backing up .next to .next-backup (full mode)"
  rm -rf .next-backup
  cp -r .next .next-backup 2>/dev/null || true

  # Preserve Next.js incremental build cache between deploys.
  # Without this, every deploy is a cold webpack build (~10 minutes on this VPS).
  # With it, an incremental rebuild after a small code change drops to ~1–2 minutes.
  if [ -d .next/cache ]; then
    echo "==> preserving .next/cache between builds (size: $(du -sh .next/cache 2>/dev/null | cut -f1))"
    rm -rf /tmp/kx-next-cache
    mv .next/cache /tmp/kx-next-cache
  else
    rm -rf /tmp/kx-next-cache
  fi

  echo "==> removing old .next (cache preserved at /tmp/kx-next-cache)"
  rm -rf .next

  # Re-seed the cache before the build so webpack picks it up.
  if [ -d /tmp/kx-next-cache ]; then
    mkdir -p .next
    mv /tmp/kx-next-cache .next/cache
    echo "==> .next/cache re-seeded for incremental build"
  fi

  echo "==> next build --webpack"
  if ! npx next build --webpack; then
    echo "::error::Build failed; restoring backup"
    rm -rf .next
    cp -r .next-backup .next
    exit 3
  fi

  if [ ! -f .next/BUILD_ID ]; then
    echo "::error::Build completed but .next/BUILD_ID missing; restoring backup"
    rm -rf .next
    cp -r .next-backup .next
    exit 4
  fi

  echo "==> new BUILD_ID=$(cat .next/BUILD_ID), cache size=$(du -sh .next/cache 2>/dev/null | cut -f1 || echo none)"
else
  # restart mode — ensure we have something to restart against
  if [ ! -f .next/BUILD_ID ]; then
    echo "::error::restart mode requested but .next/BUILD_ID is missing — refusing to restart against incomplete build"
    exit 5
  fi
  echo "==> reusing existing .next BUILD_ID=$(cat .next/BUILD_ID)"
fi

# --- 6. Restart the service ---
# Note: sudoers NOPASSWD on this box is for `systemctl restart kolayxport`
# (no `.service` suffix). Using the suffix breaks the rule match and sudo
# falls back to a password prompt that the SSH session can't satisfy.
# systemd accepts both forms interchangeably.
echo "==> sudo systemctl restart kolayxport"
sudo -n systemctl restart kolayxport

# Give Next.js a moment to bind the port
sleep 5

# --- 7. Health check; on failure, attempt rollback only if backup exists ---
echo "==> curl ${HEALTH_URL}"
if ! curl -fsS --max-time 15 "${HEALTH_URL}" > /tmp/health-check-output; then
  echo "::error::Health check failed"
  if [ "$MODE" = "full" ] && [ -d .next-backup ]; then
    echo "::error::Restoring .next-backup and restarting again"
    rm -rf .next
    cp -r .next-backup .next
    sudo -n systemctl restart kolayxport
    sleep 5
    curl -fsS --max-time 15 "${HEALTH_URL}" || true
  fi
  exit 6
fi
echo "==> health: $(cat /tmp/health-check-output)"

# --- 8. Cleanup full-mode backup AFTER health check passes ---
if [ "$MODE" = "full" ]; then
  rm -rf .next-backup
fi

echo "==> hetzner-deploy: mode=${MODE} sha-final=$(git rev-parse --short HEAD) DONE"
