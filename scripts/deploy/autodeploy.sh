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
SHA=$(git rev-parse --short HEAD)
if ! bash scripts/deploy/hetzner-deploy.sh "$MODE"; then
  echo "$(date -Is) deploy FAILED $SHA (live site untouched)"
  # Email once per failed version (Postmark creds read from the app .env at run time; no secrets in this file).
  STATE=/home/deploy/.autodeploy-failed-sha
  if [ "$(cat "$STATE" 2>/dev/null)" != "$SHA" ]; then
    echo "$SHA" > "$STATE"
    TOKEN=$(grep -E '^POSTMARK_SERVER_TOKEN=' "$APP/.env" | head -1 | cut -d= -f2- | tr -d '\042\047')
    FROM=$(grep -E '^POSTMARK_FROM_EMAIL=' "$APP/.env" | head -1 | cut -d= -f2- | tr -d '\042\047')
    BODY=$(printf 'Deploy of %s failed on the VPS; the live site still runs the previous version.\n\nLast log lines:\n%s\n' "$SHA" "$(tail -25 "$LOG")" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
    [ -n "$TOKEN" ] && [ -n "$FROM" ] && curl -sS -m 20 -o /dev/null -X POST 'https://api.postmarkapp.com/email' \
      -H 'Accept: application/json' -H 'Content-Type: application/json' -H "X-Postmark-Server-Token: $TOKEN" \
      -d "{\"From\":\"$FROM\",\"To\":\"atillatkulu@gmail.com\",\"Subject\":\"KolayXport deploy failed ($SHA)\",\"TextBody\":$BODY,\"MessageStream\":\"outbound\"}" || true
  fi
  exit 1
fi
echo "$(date -Is) deploy done $SHA"
