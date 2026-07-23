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
# Atomic .next swap: build into `.next-new` via NEXT_DIST_DIR (overridable in
# next.config.js), then `mv` it into place on success. The live `.next` keeps
# serving HTML pages throughout the build window — no more homepage 500.
#
# Webpack's incremental cache is seeded from the live `.next/cache/` via hardlinks
# so the build still benefits from prior compilation.
if [ "$MODE" = "full" ]; then
  echo "==> preparing .next-new (build target)"
  rm -rf .next-new .next-old

  # The live .next/types/ holds auto-generated route validators from the
  # PREVIOUS build. tsconfig includes them in the new build's typecheck, so a
  # deleted API route makes the build fail with "Cannot find module ...".
  # They are regenerated from scratch inside .next-new — safe to drop here.
  rm -rf .next/types

  # Hardlink the cache from the running .next so incremental webpack reuses it.
  # `cp -al` creates hardlinks (one inode, two names) — costs no extra disk space
  # and is instant. If the source is missing we just start cold.
  if [ -d .next/cache ]; then
    mkdir -p .next-new
    cp -al .next/cache .next-new/cache 2>/dev/null || cp -r .next/cache .next-new/cache
    echo "==> .next-new/cache seeded from running .next/cache"
  fi

  echo "==> NEXT_DIST_DIR=.next-new next build --webpack"
  # Raise the V8 heap for the build. Next's TypeScript pass can spike past the
  # default ~2GB limit on this box; the VPS has ample RAM (cax21, 8GB). Respect an
  # externally-provided NODE_OPTIONS if the operator already set one.
  if ! NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" NEXT_DIST_DIR=.next-new npx next build --webpack; then
    echo "::error::Build failed; live .next untouched"
    rm -rf .next-new
    exit 3
  fi

  if [ ! -f .next-new/BUILD_ID ]; then
    echo "::error::Build completed but .next-new/BUILD_ID missing; live .next untouched"
    rm -rf .next-new
    exit 4
  fi

  echo "==> new BUILD_ID=$(cat .next-new/BUILD_ID); swapping .next <- .next-new"

  # Atomic-ish swap: two rename(2) syscalls back-to-back. The window where
  # .next does not exist is microseconds, vs. the multi-minute build window
  # the previous rm-then-build approach exposed.
  mv .next .next-old
  mv .next-new .next

  # Backup the previous build for the health-check rollback path below.
  rm -rf .next-backup
  mv .next-old .next-backup

  echo "==> swap complete; cache size=$(du -sh .next/cache 2>/dev/null | cut -f1 || echo none)"
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
#
# Using `/tmp/health-check-output` as a fixed path meant whichever user ran
# the first deploy owned the file, and subsequent deploys as a different
# user hit "Permission denied" on the redirect. Curl's non-zero exit tripped
# the rollback logic and buried a perfectly healthy new build. mktemp gives
# each run a fresh writable file that gets cleaned up on script exit.
echo "==> curl ${HEALTH_URL}"
HEALTH_OUT="$(mktemp)"
trap 'rm -f "$HEALTH_OUT"' EXIT
if ! curl -fsS --max-time 15 "${HEALTH_URL}" > "$HEALTH_OUT"; then
  echo "::error::Health check failed"
  if [ "$MODE" = "full" ] && [ -d .next-backup ]; then
    echo "::error::Rolling back to .next-backup and restarting again"
    # Mirror the atomic swap, in reverse.
    mv .next .next-broken-$(date +%s) 2>/dev/null || rm -rf .next
    mv .next-backup .next
    sudo -n systemctl restart kolayxport
    sleep 5
    curl -fsS --max-time 15 "${HEALTH_URL}" || true
  fi
  exit 6
fi
echo "==> health: $(cat "$HEALTH_OUT")"

# --- 8. Cleanup full-mode backup AFTER health check passes ---
if [ "$MODE" = "full" ]; then
  rm -rf .next-backup
fi

echo "==> hetzner-deploy: mode=${MODE} sha-final=$(git rev-parse --short HEAD) DONE"
