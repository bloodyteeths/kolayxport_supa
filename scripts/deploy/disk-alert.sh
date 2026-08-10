#!/usr/bin/env bash
#
# Disk-space alert for the KolayXport Hetzner VPS.
# Emails via the Postmark HTTP API when the root filesystem crosses a threshold.
#
# - Reads POSTMARK_SERVER_TOKEN + POSTMARK_FROM_EMAIL from the app .env (no secrets in this file).
# - Sends at most one email per COOLDOWN_HOURS while over threshold (avoids hourly spam).
# - Recovery notice sent once when usage drops back below threshold.
#
# Installed as an hourly root cron. Logs to /var/log/disk-alert.log.

set -euo pipefail

THRESHOLD=85                 # percent used at which to alert
COOLDOWN_HOURS=12           # min hours between repeat alerts while still over
ALERT_TO="atillatkulu@gmail.com"
ENV_FILE="/home/deploy/kolayxport/.env"
STATE_FILE="/var/lib/disk-alert.state"   # stores epoch of last alert
MOUNT="/"

now=$(date +%s)
host=$(hostname)

# Read Postmark creds from the app env without exporting the whole file.
token=$(grep -E '^POSTMARK_SERVER_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\042\047')
from=$(grep -E '^POSTMARK_FROM_EMAIL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\042\047')

if [[ -z "${token:-}" || -z "${from:-}" ]]; then
  echo "$(date -Is) ERROR: Postmark creds missing in $ENV_FILE" >&2
  exit 1
fi

use=$(df --output=pcent "$MOUNT" | tail -1 | tr -dc '0-9')
avail=$(df -h --output=avail "$MOUNT" | tail -1 | tr -d ' ')
top=$(du -xh --max-depth=2 /home /var 2>/dev/null | sort -rh | head -8 | sed 's/\t/  /')

send_email() {
  local subject="$1" body="$2"
  curl -sS -m 20 -o /dev/null -w '%{http_code}' \
    -X POST 'https://api.postmarkapp.com/email' \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/json' \
    -H "X-Postmark-Server-Token: $token" \
    -d "$(cat <<JSON
{"From":"$from","To":"$ALERT_TO","Subject":"$subject","TextBody":$(printf '%s' "$body" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),"MessageStream":"outbound"}
JSON
)"
}

last_alert=0
[[ -f "$STATE_FILE" ]] && last_alert=$(cat "$STATE_FILE" 2>/dev/null || echo 0)

if (( use >= THRESHOLD )); then
  age=$(( now - last_alert ))
  if (( age >= COOLDOWN_HOURS * 3600 )); then
    body="Disk usage on $host is ${use}% (only ${avail} free) on ${MOUNT}.

Threshold: ${THRESHOLD}%.

Largest dirs under /home and /var:
${top}

Free space or production will 503 when the disk hits 100%.
This alert repeats at most every ${COOLDOWN_HOURS}h while over threshold."
    code=$(send_email "[KolayXport] Disk ${use}% full on ${host}" "$body" || echo "ERR")
    echo "$(date -Is) ALERT use=${use}% avail=${avail} postmark=${code}"
    if [[ "$code" == "200" ]]; then echo "$now" > "$STATE_FILE"; fi
  else
    echo "$(date -Is) over threshold (use=${use}%) but within cooldown, skipping"
  fi
else
  # Recovered: if we had previously alerted, send one all-clear and reset.
  if [[ -f "$STATE_FILE" ]]; then
    body="Disk usage on $host recovered to ${use}% (${avail} free) on ${MOUNT}. No further action needed."
    code=$(send_email "[KolayXport] Disk recovered (${use}%) on ${host}" "$body" || echo "ERR")
    echo "$(date -Is) RECOVERED use=${use}% postmark=${code}"
    rm -f "$STATE_FILE"
  else
    echo "$(date -Is) OK use=${use}% avail=${avail}"
  fi
fi
