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

## 2. Encryption at Rest 2.4 — GCP KMS envelope encryption

The app encrypts every marketplace credential/token with **AES-256-GCM**. The 32-byte
data-encryption key (DEK) is wrapped by a **KMS-managed key-encryption key (KEK)** that
never leaves Google Cloud KMS. This gives us the full key lifecycle Amazon requires:
generation, storage, rotation, and revocation are all owned by KMS.

### 2a. Create separate key rings for prod and non-prod (environment separation)
```bash
PROJECT=<your-gcp-project>          # same project as Gemini billing
LOCATION=europe-west3               # near Hetzner (Germany)

gcloud config set project "$PROJECT"

# Production key ring + rotating KEK (90-day rotation):
gcloud kms keyrings create kolayxport-prod --location="$LOCATION"
gcloud kms keys create credential-kek \
  --location="$LOCATION" --keyring=kolayxport-prod \
  --purpose=encryption --rotation-period=90d --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"

# Non-production key ring (separate key material, never shared with prod):
gcloud kms keyrings create kolayxport-nonprod --location="$LOCATION"
gcloud kms keys create credential-kek \
  --location="$LOCATION" --keyring=kolayxport-nonprod \
  --purpose=encryption --rotation-period=90d --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"
```

### 2b. Service account with least-privilege KMS access
```bash
gcloud iam service-accounts create kolayxport-kms --display-name="KolayXport KMS"
SA="kolayxport-kms@${PROJECT}.iam.gserviceaccount.com"

# Prod app can encrypt+decrypt with the prod key only:
gcloud kms keys add-iam-policy-binding credential-kek \
  --location="$LOCATION" --keyring=kolayxport-prod \
  --member="serviceAccount:${SA}" \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter

gcloud iam service-accounts keys create /root/kolayxport-kms.json --iam-account="$SA"
```
Copy `/root/kolayxport-kms.json` to the VPS (e.g. `/home/deploy/kolayxport/kms-sa.json`,
`chmod 600`, owned by `deploy`).

### 2c. Wrap the CURRENT encryption key as the DEK (migration-safe — no data re-encryption)
On the VPS, in the app directory, using the value of the existing `CREDENTIAL_ENCRYPTION_KEY`:
```bash
cd /home/deploy/kolayxport
GOOGLE_APPLICATION_CREDENTIALS=/home/deploy/kolayxport/kms-sa.json \
GCP_KMS_KEY_NAME="projects/${PROJECT}/locations/${LOCATION}/keyRings/kolayxport-prod/cryptoKeys/credential-kek" \
CREDENTIAL_ENCRYPTION_KEY="<existing-hex-key-from-.env>" \
npx tsx scripts/kms/wrap-dek.ts
```
It prints `GCP_KMS_KEY_NAME=` and `CREDENTIAL_DEK_CIPHERTEXT=`.

### 2d. Switch the app to KMS
Edit `/home/deploy/kolayxport/.env`:
```
GOOGLE_APPLICATION_CREDENTIALS=/home/deploy/kolayxport/kms-sa.json
GCP_KMS_KEY_NAME=projects/<p>/locations/europe-west3/keyRings/kolayxport-prod/cryptoKeys/credential-kek
CREDENTIAL_DEK_CIPHERTEXT=<printed value>
```
Then **remove** `CREDENTIAL_ENCRYPTION_KEY` so KMS is the single source of truth, and restart:
```bash
systemctl restart kolayxport     # NOTE: no ".service" suffix (sudoers rule)
journalctl -u kolayxport.service --since "2 minutes ago" --no-pager | grep -i "DEK unwrapped\|encryption"
```
You should see `Credential DEK unwrapped from GCP KMS.` Verify a marketplace still
connects/reads (existing ciphertext decrypts because we wrapped the *same* DEK).

### 2e. Key rotation notes (for the Amazon answer)
- The KEK rotates automatically every 90 days (`--rotation-period=90d`). KMS keeps old
  key versions, so the wrapped-DEK ciphertext keeps decrypting after rotation.
- To rotate the DEK itself (deeper rotation), generate a new DEK, re-encrypt all
  credential rows, and re-wrap — documented in `CREDENTIAL_ENCRYPTION_RUNBOOK.md`.
- Prod and non-prod use **different key rings** (§2a), so a non-prod compromise cannot
  decrypt production data.

### 2f. Disk-level encryption (defence in depth)
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
- [ ] §2 KMS key rings created (prod + non-prod), DEK wrapped, app restarted on KMS
- [ ] Marketplace connect/read verified after KMS switch
- [ ] Website pricing page reachable + clear (see AMAZON_SPAPI_PROFILE_ANSWERS.md §Website)
- [ ] Paste updated answers into the Solution Provider Profile, then reply to the case
