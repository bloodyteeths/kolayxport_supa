# KolayXport Access Control & Identity Management Policy

Aligned with Amazon SP-API Data Protection Policy (Identity & Access Management,
Credential Management). Reviewed every 6 months. Last reviewed: 2026-07-16.

## Principles
Least privilege and need-to-know. Access to Amazon data is limited to named individuals
and per-service credentials; there are no shared logins.

## Human access
- **Production server (Hetzner VPS):** SSH **key-only** — password authentication is
  disabled and root password login is disabled (`PermitRootLogin prohibit-password`).
  fail2ban blocks brute-force attempts. Access is limited to the founder's individual key.
- **Cloud consoles** (GitHub, Google/GCP, Cloudflare, Postmark, Stripe): protected with
  **multi-factor authentication (MFA)**.
- **Application accounts:** authenticated via NextAuth (email/password or Google OAuth).
  Passwords are enforced server-side (12-char min, complexity, no identity info, bcrypt
  cost 12 — see passwordPolicy). Roles separate ordinary users from admin functions.

## Machine / service access
- Amazon LWA tokens, marketplace API keys, and other secrets live in environment
  variables only (gitignored, never committed), encrypted at rest with the DEK wrapped by
  the OpenBao/Vault Transit KMS.
- Internal service-to-service calls use header-only API keys compared in constant time;
  keys are never accepted in URLs or query strings.
- The application process runs as the non-root `deploy` user; the database (PostgreSQL)
  binds to localhost only.

## Provisioning & de-provisioning
- **Grant:** the founder adds an individual's SSH public key / creates their account and
  assigns the minimum role needed. Cloud console access is invitation-based with MFA
  required.
- **Revoke (offboarding / compromise):** remove the SSH key from `authorized_keys`,
  disable the account, rotate any shared secrets they could have seen, and — for a
  credential compromise — rotate the KMS key (see INCIDENT_RESPONSE_PLAN.md).

## Privileged access
Root/administrative access on the production host is limited to the founder via SSH key.
KMS decrypt permission is held by a least-privilege AppRole scoped to encrypt/decrypt on
the single credential key.

## Review
Access (SSH keys, cloud console members, app admin roles) is reviewed at each 6-month
policy review and whenever a person leaves or a role changes.
