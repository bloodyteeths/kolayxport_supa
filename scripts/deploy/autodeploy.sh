#!/usr/bin/env bash
# Self-deploy on the VPS (no GitHub Actions minutes): cron runs this every 2 minutes as `deploy`.
# If origin/main moved, pull and run the normal atomic deploy (scripts/deploy/hetzner-deploy.sh).
# One run at a time (flock); the manual GitHub workflow calls this same script, so they never overlap.
set -euo pipefail
APP=/home/deploy/kolayxport
LOG=/home/deploy/autodeploy.log
MODE="${1:-full}"
exec 9>/tmp/kx-autodeploy.lock
flock -n 9 || exit 0
# Keep the log small.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5000000 ]; then tail -c 1000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
cd "$APP"
git fetch -q origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ] && [ "${FORCE:-0}" != "1" ]; then exit 0; fi
echo "$(date -Is) deploy start $(git rev-parse --short "$REMOTE") mode=$MODE"
git checkout -- yarn.lock next-env.d.ts 2>/dev/null || true
git pull -q --ff-only origin main
bash scripts/deploy/hetzner-deploy.sh "$MODE"
echo "$(date -Is) deploy done $(git rev-parse --short HEAD)"
