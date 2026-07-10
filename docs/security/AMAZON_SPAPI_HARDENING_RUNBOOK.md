# Amazon SP-API — Security Hardening Runbook

Operational steps to make the posture described in the Amazon Solution Provider
Profile answers **actually true**. Run these before replying to the Amazon case.

Case ID: 20551740191. Deadline: 5 calendar days from the request.

Covers the four flagged controls:
- Network Protection 1.1 (add anti-virus / anti-malware for endpoints)
- Encryption at Rest 2.4 (adopt a KMS with full key lifecycle + prod/non-prod separation)
- Logging & Monitoring 2.6 (confirm PII handling in logs)
- Credential Management 1.4 (password length/complexity/identity restriction)

The application-code parts (password policy, log PII redaction, KMS integration)
are already committed. This runbook is the **infrastructure + GCP** side.

---

## 1. Network Protection 1.1 — host firewall, brute-force, anti-malware

Run on the Hetzner VPS (`46.224.169.225`) as root.

### 1a. Firewall (deny-by-default, allow only SSH/HTTP/HTTPS)
```bash
apt-get update
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (nginx -> Next.js)
ufw allow 443/tcp    # HTTPS
ufw --force enable
ufw status verbose
```
Postgres (5432) is intentionally **not** opened — it listens on localhost only and
is reached by the app over the loopback interface. Confirm:
```bash
ss -tlnp | grep 5432   # should show 127.0.0.1:5432, not 0.0.0.0:5432
```

### 1b. SSH brute-force protection (fail2ban)
```bash
apt-get install -y fail2ban
systemctl enable --now fail2ban
fail2ban-client status sshd
```

### 1c. Anti-virus / anti-malware (this is the specific gap Amazon flagged)
```bash
apt-get install -y clamav clamav-daemon
systemctl stop clamav-freshclam
freshclam                       # pull latest signatures
systemctl enable --now clamav-freshclam   # keeps signatures fresh
systemctl enable --now clamav-daemon

# Daily scan of the app + upload dirs, quarantine hits, log results:
cat >/etc/cron.daily/clamscan-kolayxport <<'EOF'
#!/bin/bash
LOG=/var/log/clamav/daily-scan.log
mkdir -p /var/lib/clamav/quarantine
clamscan -r --infected --move=/var/lib/clamav/quarantine \
  /home/deploy/kolayxport/uploads \
  /home/deploy/kolayxport \
  >> "$LOG" 2>&1
EOF
chmod +x /etc/cron.daily/clamscan-kolayxport
```

### 1d. Automatic security patches (endpoint hygiene)
```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # choose "Yes"
```

### 1e. SSH key-only auth (no passwords)
In `/etc/ssh/sshd_config` ensure:
```
PasswordAuthentication no
PermitRootLogin prohibit-password
```
then `systemctl restart ssh`.

### 1f. Developer endpoint (your laptop)
- Enable FileVault full-disk encryption (macOS): `System Settings → Privacy & Security → FileVault → On`.
- Keep the built-in macOS malware protection (XProtect/Gatekeeper) enabled, or install an endpoint AV.
- This is a real control Amazon expects you to *state* — enable it so the answer is truthful.

---

## 2. Encryption at Rest 2.4 — OpenBao (Vault) Transit envelope encryption

The app encrypts every marketplace credential/token with **AES-256-GCM**. The 32-byte
data-encryption key (DEK) is wrapped by a **Transit key that lives inside OpenBao**
(the Apache-licensed fork of HashiCorp Vault) and never leaves it. Transit owns the full
key lifecycle Amazon requires: generation, secure storage, versioned rotation, and
revocation. No cloud billing — it runs on the Hetzner VPS you already pay for.

Architecture note: the app unwraps the DEK **once at boot** and caches it in memory
(see `instrumentation-node.ts` → `initEncryptionKey`). So OpenBao only needs to be
reachable at app start/restart, not on every request — a running app keeps working even
if OpenBao is briefly down.

### 2a. Run OpenBao on the VPS (Docker, persistent file storage)
```bash
mkdir -p /opt/openbao/{data,config}
cat >/opt/openbao/config/config.hcl <<'EOF'
storage "file" { path = "/openbao/data" }
listener "tcp" {
  address     = "127.0.0.1:8200"   # localhost only — never exposed publicly
  tls_disable = true               # safe: only reachable over loopback on this host
}
ui = false
disable_mlock = true
EOF

docker run -d --name openbao --restart unless-stopped \
  --cap-add=IPC_LOCK -p 127.0.0.1:8200:8200 \
  -v /opt/openbao/data:/openbao/data \
  -v /opt/openbao/config:/openbao/config \
  openbao/openbao:latest server -config=/openbao/config/config.hcl
```

### 2b. Initialise & unseal (record the keys somewhere safe — a password manager)
```bash
export BAO_ADDR=http://127.0.0.1:8200
docker exec -e BAO_ADDR=$BAO_ADDR openbao bao operator init -key-shares=3 -key-threshold=2
# -> prints 3 Unseal Keys + an Initial Root Token. STORE THESE SECURELY (offline).

# Unseal (run twice with two different unseal keys):
docker exec -e BAO_ADDR=$BAO_ADDR openbao bao operator unseal <UNSEAL_KEY_1>
docker exec -e BAO_ADDR=$BAO_ADDR openbao bao operator unseal <UNSEAL_KEY_2>
```
After a VPS reboot OpenBao starts **sealed**; re-run the two unseal commands, then
restart the app so it can unwrap the DEK. (Optional: a root-only boot script can
automate unseal — documented tradeoff; ask before enabling.)

### 2c. Enable Transit, create the rotating key, and an AppRole for the app
```bash
export BAO_TOKEN=<Initial-Root-Token>
run(){ docker exec -e BAO_ADDR=$BAO_ADDR -e BAO_TOKEN=$BAO_TOKEN openbao bao "$@"; }

run secrets enable transit
run write -f transit/keys/credential-kek        # the KEK that wraps the DEK
run write transit/keys/credential-kek/config \
    auto_rotate_period=2160h                     # rotate every 90 days

# Least-privilege policy: the app may only encrypt/decrypt with this key.
printf 'path "transit/encrypt/credential-kek" { capabilities = ["update"] }\npath "transit/decrypt/credential-kek" { capabilities = ["update"] }\n' \
  | run policy write kolayxport-app -

run auth enable approle
run write auth/approle/role/kolayxport-app \
    token_policies=kolayxport-app token_ttl=20m token_max_ttl=1h secret_id_ttl=0
run read -field=role_id  auth/approle/role/kolayxport-app/role-id     # -> VAULT_ROLE_ID
run write -field=secret_id -f auth/approle/role/kolayxport-app/secret-id  # -> VAULT_SECRET_ID
```

### 2d. Wrap the CURRENT encryption key as the DEK (migration-safe — no data re-encryption)
On the VPS, in the app dir, using the existing `CREDENTIAL_ENCRYPTION_KEY` from `.env`:
```bash
cd /home/deploy/kolayxport
VAULT_ADDR=http://127.0.0.1:8200 \
VAULT_TOKEN=<Initial-Root-Token> \
VAULT_TRANSIT_KEY=credential-kek \
CREDENTIAL_ENCRYPTION_KEY="<existing-hex-key-from-.env>" \
npx tsx scripts/kms/wrap-dek.ts
```
It prints `CREDENTIAL_DEK_CIPHERTEXT=vault:v1:...`.

### 2e. Point the app at OpenBao
Edit `/home/deploy/kolayxport/.env`:
```
VAULT_ADDR=http://127.0.0.1:8200
VAULT_TRANSIT_KEY=credential-kek
VAULT_ROLE_ID=<role_id from 2c>
VAULT_SECRET_ID=<secret_id from 2c>
CREDENTIAL_DEK_CIPHERTEXT=vault:v1:<printed value>
```
Then **remove** `CREDENTIAL_ENCRYPTION_KEY` so OpenBao is the single source of truth,
and restart:
```bash
systemctl restart kolayxport     # NOTE: no ".service" suffix (sudoers rule)
journalctl -u kolayxport.service --since "2 minutes ago" --no-pager | grep -i "DEK unwrapped\|encryption"
```
You should see `Credential DEK unwrapped from Vault Transit.` Verify a marketplace still
connects/reads (existing ciphertext decrypts because we wrapped the *same* DEK).

Use a long-lived `VAULT_TOKEN` only for the one-off wrap in 2d; the running app should
use the AppRole (`VAULT_ROLE_ID`/`VAULT_SECRET_ID`), which mints short-lived tokens.

### 2f. Key rotation & environment separation (for the Amazon answer)
- The Transit key auto-rotates every 90 days (`auto_rotate_period=2160h`). Transit keeps
  earlier key versions, so the wrapped-DEK ciphertext keeps decrypting after rotation.
- To rotate the DEK itself (deeper rotation): generate a new DEK, re-encrypt all
  credential rows, re-wrap — see `CREDENTIAL_ENCRYPTION_RUNBOOK.md`.
- **Prod vs non-prod separation:** production uses this OpenBao instance + the
  `credential-kek` Transit key. Non-production/dev uses a **separate** Transit key (e.g.
  `credential-kek-dev`) or a separate OpenBao instance, and never has access to the prod
  key — so a non-prod compromise cannot decrypt production data. (Local dev may also just
  use the `CREDENTIAL_ENCRYPTION_KEY` env fallback with a throwaway key.)

### 2g. Disk-level encryption (defence in depth)
Application-layer AES-256-GCM already protects every Amazon token/credential regardless
of disk state. If you also want volume encryption, note Hetzner Cloud does not offer
transparent disk encryption; enabling LUKS requires a rebuild — track as a follow-up,
not a blocker for this response.

---

## 3. Logging & Monitoring 2.6 — PII confirmation

Already implemented in code (`lib/logger.ts`):
- Secret keys (`token`, `password`, `authorization`, …) → `[REDACTED]`.
- Buyer/customer PII keys (`email`, `phone`, `*name`, `address`, `postal`, `iban`, …)
  → `[PII_REDACTED]`.
- Any e-mail-looking substring in free text → `[EMAIL_REDACTED]`.
- Raw marketplace order payloads are never logged; only method/endpoint/status.

No action required on the box beyond confirming log retention. Optional but recommended:
wire the already-installed `@sentry/nextjs` for alerting (currently health checks run
every 15 min via GitHub Actions + the in-app admin monitoring cockpit).

---

## 4. Credential Management 1.4 — password policy

Already implemented in code (`lib/auth/passwordPolicy.ts`, enforced in signup +
password-reset):
- Minimum length **10**.
- Must combine lower-case, upper-case, and a digit.
- Must not contain the account e-mail local-part or name (identity restriction).
- Rejects a common-password blocklist.
- Hashed with **bcrypt cost 12**; reset revokes existing sessions.

No box changes required. Internal/admin access already uses SSH keys (see §1e) and
header-only, constant-time-compared internal API keys.

---

## Final checklist before replying to Amazon
- [ ] §1 firewall + fail2ban + ClamAV + unattended-upgrades running on the VPS
- [ ] §1e SSH password auth disabled; §1f laptop FileVault on
- [ ] §2 OpenBao running + unsealed, Transit key + AppRole created, DEK wrapped, app restarted on Vault
- [ ] Marketplace connect/read verified after the Vault switch (existing ciphertext still decrypts)
- [ ] Website pricing page reachable + clear (see AMAZON_SPAPI_PROFILE_ANSWERS.md §Website)
- [ ] Paste updated answers into the Solution Provider Profile, then reply to the case
