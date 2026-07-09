# Amazon SP-API — Solution Provider Profile Answers (Case 20551740191)

Copy-paste answers addressing each flagged point. Only submit an answer once the
matching control in `AMAZON_SPAPI_HARDENING_RUNBOOK.md` is actually in place — the
reviewer may verify. Replace `<...>` placeholders with real values before sending.

---

## Network Protection 1.1

> Describe the network protection controls used by your organization to restrict
> public access to databases, file servers, and desktop/developer endpoints.

**Answer:**

Our production application runs on a single hardened Linux VPS. Public network access
is restricted by a default-deny host firewall (UFW): only ports 22 (SSH), 80 (HTTP),
and 443 (HTTPS) accept inbound traffic; all other inbound traffic, including the
PostgreSQL database (5432), is denied. The database binds only to the loopback
interface (127.0.0.1) and is never exposed to the public internet; the application
reaches it over localhost. Staged file storage (upload directory) is on the same host
behind the firewall and is not publicly listable.

SSH is key-only (password authentication disabled, root password login disabled) and
protected against brute-force attempts by fail2ban. The operating system applies
automatic security updates via unattended-upgrades.

For endpoint protection, the production host runs anti-malware (ClamAV) with
automatically updated signatures (freshclam) and a scheduled daily scan of the
application and upload directories, quarantining any detected malware. Developer/
desktop endpoints used to access production have full-disk encryption enabled
(FileVault) and run active anti-malware protection. Administrative access to the
server is limited to named individuals using SSH keys; there are no shared accounts.

---

## Encryption at Rest 2.4

> Describe how your organization stores Amazon information at Rest including:
> (a) encryption methods, and (b) key management systems.

**Answer:**

(a) Encryption methods. All Amazon information at rest — including Amazon SP-API
access and refresh tokens and any Amazon-derived data — is encrypted at the
application layer using **AES-256-GCM** (authenticated encryption with a unique
random 96-bit IV and 128-bit authentication tag per record) before it is written to
our PostgreSQL database.

(b) Key management system. We use **Google Cloud KMS** as our key management system.
Encryption uses envelope encryption: a 32-byte data-encryption key (DEK) performs the
AES-256-GCM operations, and the DEK is wrapped (encrypted) by a key-encryption key
(KEK) that is generated in and never leaves Google Cloud KMS. KMS owns the complete
key lifecycle:
- **Generation & secure storage:** the KEK is generated inside KMS and stored in
  Google's FIPS 140-2 validated HSM-backed infrastructure; the plaintext KEK is never
  exported.
- **Rotation:** the KEK is on an automatic 90-day rotation schedule. Previous key
  versions are retained by KMS so existing ciphertext remains decryptable.
- **Revocation:** access can be revoked immediately by removing the IAM binding or
  disabling/destroying the key version.
- **Access control:** a dedicated least-privilege service account holds only the
  cryptoKeyEncrypterDecrypter role on the relevant key; the wrapped DEK is unwrapped
  once at application start-up and held only in process memory.

Key rotation. Yes — the KEK rotates automatically every 90 days via the KMS rotation
schedule. The DEK can additionally be rotated via a documented re-encryption
procedure.

Environment separation. Production and non-production use **separate KMS key rings**
with independent key material (`kolayxport-prod` vs `kolayxport-nonprod`). Non-
production systems have no access to production keys, so a non-production compromise
cannot decrypt production data.

---

## Logging and Monitoring 2.6

> Describe your organization's security logging and monitoring system, including
> monitoring mechanisms for suspicious activities, and incident investigation
> procedures.

**Answer:**

We maintain structured, categorized application logging (security, authentication,
integration, billing, and system events) persisted in a dedicated append log store,
with each entry carrying a level, category, operation, timestamp, and correlation
details. An internal administrative monitoring dashboard lets us filter and review
these events; automated health checks run every 15 minutes and alert on failures.

**PII in logs.** Personally Identifiable Information is **not** stored in our logs. The
logging layer applies automatic redaction before any entry is persisted: (1) secrets
and credentials (tokens, API keys, passwords, authorization headers) are replaced with
`[REDACTED]`; (2) buyer/customer PII fields (names, e-mail, phone, postal address, tax
/ national IDs, IBAN, card numbers) are replaced with `[PII_REDACTED]`; and (3) any
e-mail-address pattern appearing in free-text messages is scrubbed to
`[EMAIL_REDACTED]`. Raw marketplace order payloads are never logged — only the request
method, endpoint, and status are recorded.

**Suspicious-activity monitoring.** Authentication events (sign-in, sign-up, password
reset, token rejection, verification) are logged in a dedicated security category.
Rate limiting is enforced on authentication and sync endpoints; repeated failures and
anomalies are visible in the monitoring dashboard, and SSH-level brute force is blocked
by fail2ban.

**Incident investigation.** On a suspected incident we query the security/auth log
category by user, operation, and time window to reconstruct the sequence of events,
correlate with server and access logs, revoke affected credentials/sessions
(password reset revokes existing sessions; marketplace tokens can be rotated), and
remediate. Encryption keys can be rotated or revoked via KMS as described in §2.4.

---

## Credential Management 1.4

> How does your organization enforce password management practices for all the
> systems handling Amazon as it relates to required length, complexity and expiration
> period?

**Answer:**

Application user passwords are enforced server-side on every path that sets a password
(registration and password reset), so requirements cannot be bypassed by the client:
- **Length:** minimum 10 characters.
- **Complexity:** must contain lower-case letters, upper-case letters, and digits.
- **Identity restriction:** the password may not contain the user's e-mail local-part
  or name (no user-identity information in the password).
- **Common-password rejection:** a blocklist rejects the most commonly abused
  passwords.
- **Storage:** passwords are hashed with bcrypt (cost factor 12); we never store or log
  plaintext passwords.
- **Expiration / revocation:** password reset immediately invalidates existing
  sessions; credentials can be revoked on demand. (In line with current NIST SP
  800-63B guidance we rely on strong length/complexity and breach-resistant hashing
  rather than mandatory periodic rotation, which is known to weaken password quality.)

For the systems that handle Amazon data directly (production server and cloud
console): server access is SSH key-only with passwords disabled and root password
login disabled; the Google Cloud account uses a strong password plus multi-factor
authentication; internal service-to-service calls use header-only API keys compared in
constant time, never passwords in URLs. There are no shared administrative accounts.

---

## Website — pricing transparency

> Your website must display the app's pricing scheme clearly and transparently.

**Current state.** Pricing is published at `https://kolayxport.com/fiyatlandirma` with
concrete monthly and annual prices for the Starter (₺449/mo) and Growth (₺999/mo)
plans, a 30-day free trial, and a "Request a quote" (Teklif Al) contact form for the
Enterprise plan — which satisfies the quote-based requirement.

**Actions to remove any ambiguity before replying:**
1. Ensure the pricing page is reachable from the main navigation/footer of the URL you
   submitted to Amazon (the reviewer must be able to find it without a direct link).
2. Because Amazon reviewers read English, add an English-visible pricing statement or
   ensure the language switcher exposes English pricing at a stable URL (e.g. an `/en`
   pricing route), so prices are unambiguous to the reviewer.
3. Confirm there are no hidden service fees; if any exist, list them on the page.
4. Keep the Enterprise "Request a quote" form live and reachable.

Then reply to the case confirming the website and profile updates are complete.
