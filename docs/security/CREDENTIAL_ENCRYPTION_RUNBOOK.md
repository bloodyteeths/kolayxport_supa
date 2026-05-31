# Credential encryption runbook

Companion to `CREDENTIAL_ENCRYPTION_INVENTORY.md`. Operational steps for adopting / rotating the encryption envelope in production.

---

## On-disk formats — what each row may look like

| Shape | Source | Read path | Write path |
|---|---|---|---|
| **Plaintext** | Old OAuth callbacks (pre-Sprint 5) | `decryptIfNeeded` passes through unchanged | new code never writes this — `encryptIfNeeded` produces `enc:v1:` |
| **Legacy base64(iv\|tag\|ct)** | `pages/api/user/settings.ts` via `lib/encryption.ts` | `decryptIfNeeded` recognises via heuristic, decrypts | `encryptIfNeeded` no-ops on it to avoid double-encryption |
| **`enc:v1:<iv>:<tag>:<ct>`** | New OAuth callbacks + token refreshes after Sprint 5 | `decryptIfNeeded` strips envelope, decrypts | `encryptIfNeeded` produces this format |

Same key (`CREDENTIAL_ENCRYPTION_KEY`) decrypts both encrypted formats. There is no fork in the keyring.

---

## Generating the key

```bash
# Produce a 32-byte key as 64 hex characters.
openssl rand -hex 32
```

Add it to Hetzner `/home/deploy/kolayxport/.env`:

```
CREDENTIAL_ENCRYPTION_KEY=<64-char hex>
```

**Once set, do not lose it.** Encrypted credentials cannot be recovered without the original key. Store it in a password manager outside the deploy server. If you rotate the key in the future, you must dual-decrypt during the window and re-encrypt the entire credential surface — plan this as its own sprint.

---

## Dry-run (always safe)

```bash
ssh deploy@kolayxport.com
cd /home/deploy/kolayxport
# Ensure migrations have been applied:
npx prisma migrate status
# Print plaintext / encrypted / null counts per column. Never prints values.
npx tsx scripts/backfill-encrypt-credentials.ts --dry-run
```

Expected output for a freshly-migrated database where all OAuth flows have already cycled new rows through:

```
=== credential ===
rowsScanned: 42
rowsUpdated:  0
  etsyAccessToken     plaintext=    0  encrypted=   38  null=    4
  etsyRefreshToken    plaintext=    0  encrypted=   38  null=    4
  ...
```

If `plaintext > 0` after a deploy and enough time for natural token refresh to occur, those rows belong to users who never refreshed their token. They'll be migrated on next refresh OR you can run `--apply` (see below).

---

## Apply (not yet safe with the current script)

`scripts/backfill-encrypt-credentials.ts --apply` currently covers only the per-marketplace OAuth columns. Trendyol/FedEx/UPS/MNG/Paraşüt secrets are still written through the legacy `lib/encryption.ts` flow at `/api/user/settings`, and the backfill does NOT touch those columns yet — running `--apply` today would not break them (it skips fields not in its plan) but it also won't migrate them.

**Required before running `--apply`** (in this order):
1. `CREDENTIAL_ENCRYPTION_KEY` set on Hetzner.
2. Both migrations applied: `npx prisma migrate status` shows "up to date".
3. At least one successful deploy with this sprint's code (so new OAuth writes already go through `enc:v1:`).
4. A dry-run output reviewed — the report should look healthy.

**Recommended**:
- Wait ~30 days after deploy. The OAuth refresh cycle for Etsy (90d-ish), eBay (~2h on active accounts), Shopify (offline tokens — no expiry), Wix (~4h), Amazon (~1h) will naturally promote most rows to `enc:v1:`.
- Then run `--apply` once to flip the long-lived holdouts (Shopify rows that never refreshed; users who paused activity).

If you need to migrate immediately, run `--apply` and accept that legacy `lib/encryption.ts`-written rows stay legacy (still readable via `decryptIfNeeded`).

---

## When a credential read fails in production

Symptoms:
- Marketplace API call returns 401.
- Integration suddenly returns "no refresh token" errors.
- Logs show `decryptIfNeeded: bad envelope` (rare — we suppress most thrown decrypt errors).

Diagnosis:
1. Is `CREDENTIAL_ENCRYPTION_KEY` set on Hetzner? `ssh deploy@kolayxport.com 'env | grep ^CREDENTIAL_ENCRYPTION_KEY' | awk -F= '{print $1"=***"}'`
2. Did the key change? Compare the env var to the value you stored in your password manager at the time of the last rotation.
3. Does the affected row's column look like `enc:v1:` or a base64 blob? Run the lookup that does not print values:
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, CASE WHEN \"etsyAccessToken\" LIKE 'enc:v1:%' THEN 'enc:v1' WHEN length(\"etsyAccessToken\") > 28 THEN 'legacy_or_plain' ELSE 'plain' END AS shape FROM \"Credential\" WHERE id = '<id>';"
   ```
4. If the row has shape `enc:v1` and the key is correct, the row is corrupt — surface this to the user as a "please reconnect" UI message.

---

## Smoke after a deploy

`npm run security:smoke` includes `test/lib/crypto/credentials.test.ts` which covers:
- round-trip `enc:v1:`
- tampered ciphertext rejection
- malformed envelope rejection
- double-encrypt idempotency
- legacy `base64(iv|tag|ct)` accepted on read
- `encryptIfNeeded` does NOT re-encrypt legacy values
- plaintext (NextAuth-JWT shaped strings with dots) passes through unchanged
- `encryptIfNeeded` produces `enc:v1:` envelope on plaintext input

All 14 crypto-credential tests pass at the current commit.
