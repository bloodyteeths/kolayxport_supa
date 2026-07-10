#!/usr/bin/env bash
#
# Auto-unseal OpenBao after a VPS reboot, then restart the app so it can unwrap the
# credential DEK from the Transit engine.
#
# OpenBao starts SEALED after every restart. This script reads the unseal keys from a
# root-only file and submits them until the vault is unsealed. Run by the
# openbao-unseal.service systemd unit on boot (see AMAZON_SPAPI_HARDENING_RUNBOOK.md).
#
# SECURITY TRADEOFF: storing unseal keys on the same host means anyone with root can
# unseal OpenBao. On a single-VPS deployment root can already read process memory (and
# thus the in-memory DEK), so this does not lower the practical bar — but keep the keys
# file at 0600 root:root, and store a copy OFFLINE (password manager) as the real backup.
#
# Config via env (all optional):
#   BAO_ADDR   OpenBao API address           (default http://127.0.0.1:8200)
#   KEYS_FILE  file with one unseal key/line  (default /root/openbao-unseal.keys)
#   CONTAINER  docker container name          (default openbao)
#   APP_SVC    app systemd service to restart (default kolayxport; empty = skip)
set -euo pipefail

BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
KEYS_FILE="${KEYS_FILE:-/root/openbao-unseal.keys}"
CONTAINER="${CONTAINER:-openbao}"
APP_SVC="${APP_SVC:-kolayxport}"

sealed_status() {
  # Prints "true", "false", or "" if the API is unreachable.
  curl -fsS "$BAO_ADDR/v1/sys/seal-status" 2>/dev/null \
    | grep -o '"sealed":[a-z]*' | head -1 | cut -d: -f2
}

# 1. Wait for the OpenBao API to answer (container may still be starting).
for _ in $(seq 1 30); do
  [ -n "$(sealed_status)" ] && break
  sleep 2
done

# 2. Already unsealed? Nothing to do.
if [ "$(sealed_status)" = "false" ]; then
  echo "OpenBao already unsealed."
  exit 0
fi

if [ ! -r "$KEYS_FILE" ]; then
  echo "Unseal keys file not readable: $KEYS_FILE" >&2
  exit 1
fi

# 3. Submit each key until the vault reports unsealed.
while IFS= read -r key || [ -n "$key" ]; do
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  [ -z "$key" ] && continue
  docker exec -e BAO_ADDR="$BAO_ADDR" "$CONTAINER" bao operator unseal "$key" >/dev/null 2>&1 || true
  if [ "$(sealed_status)" = "false" ]; then
    echo "OpenBao unsealed."
    # 4. Restart the app so instrumentation re-runs and unwraps the DEK.
    if [ -n "$APP_SVC" ]; then
      systemctl restart "$APP_SVC" && echo "Restarted $APP_SVC."
    fi
    exit 0
  fi
done < "$KEYS_FILE"

echo "OpenBao still sealed after submitting all keys in $KEYS_FILE." >&2
exit 1
