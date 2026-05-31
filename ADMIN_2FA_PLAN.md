# ADMIN_2FA_PLAN

Plan-doc only. No implementation in this sprint. Sized for one focused sprint after Phase 5 cleanup lands.

---

## Goal

Require a TOTP-based second factor for any user with `role='admin'` before they can reach `/admin/*` or `/api/admin/*`. Google OAuth users get the same treatment — Google's own 2FA at the IdP is not enough because we audit the action at our own app layer.

## Non-goals

- 2FA for regular `role='user'` accounts (separate sprint).
- WebAuthn / FIDO2 keys (separate sprint).
- 2FA for the Chrome extension's NextAuth JWT path (the extension only ever sees user-tier scopes; admins do not use it).
- Backup-code rotation UI (provided once, displayed once; admin saves them).

---

## Data model

Single new table:

```prisma
model AdminTotp {
  userId         String   @id
  /// AES-GCM ciphertext of the base32 TOTP secret. Stored using lib/crypto/credentials.encryptIfNeeded.
  secretCiphered String
  /// Whether the user has verified the secret with a successful first code.
  verified       Boolean  @default(false)
  /// Hashed backup codes (bcrypt). 10 codes generated at enrollment; consumed one at a time.
  backupCodes    Json
  enrolledAt     DateTime @default(now())
  lastUsedAt     DateTime?

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Migration is additive — `prisma migrate dev --name add_admin_totp` then ship through `prisma migrate deploy`.

## Auth flow

1. Existing NextAuth credentials/Google flow → session cookie set.
2. New `withAdmin` middleware first checks `user.role === 'admin'`. Then:
   - Lookup `AdminTotp` for the user.
   - If `verified=false`, redirect to `/admin/2fa/enroll`.
   - If `verified=true`, lookup session-bound `admin_totp_ok` cookie:
     - Present + not expired → continue.
     - Absent or expired → redirect to `/admin/2fa/verify`.
3. `/admin/2fa/verify` posts a 6-digit code to `/api/admin/2fa/verify`. On success, server sets `admin_totp_ok` HttpOnly cookie (Same-Site=Strict, 12h TTL, signed via `NEXTAUTH_SECRET`).
4. Every admin action records its `admin_totp_ok` cookie freshness in `AdminAuditLog.metadata` for later forensics.

The cookie is short-lived (12h) and tied to the session — never store it client-side via JS.

## Routes to add

| Route | Purpose |
|---|---|
| `pages/api/admin/2fa/enroll-start.ts` | Generate a TOTP secret, encrypt it, store unverified. Return otpauth URL + QR data URL. |
| `pages/api/admin/2fa/enroll-verify.ts` | Verify the first code; flip `verified=true`; issue 10 backup codes (returned ONCE, displayed by UI; never stored plaintext). |
| `pages/api/admin/2fa/verify.ts` | Verify a step-2 code on existing-admin login; set `admin_totp_ok` cookie. |
| `pages/api/admin/2fa/disable.ts` | Disable own 2FA — requires current code AND password reauth. Records `AdminAuditLog` action `2fa.disabled`. |
| `pages/admin/2fa/enroll.tsx` | QR + backup-codes page. |
| `pages/admin/2fa/verify.tsx` | Step-2 code prompt. |

## TOTP library choice

- Add `otpauth` (~14kB) as a dep. It is minimal, ESM, no native bindings, and supports Google Authenticator / Authy / 1Password.
- Backup codes: `crypto.randomBytes(5)` → base32 → grouped `xxxxx-xxxxx`. Hashed with bcrypt cost 10 at write time.

## Middleware integration

`lib/middleware/withAdmin.ts` already checks `role === 'admin'`. Extend to a tuple check:

```ts
async (req, res, adminUser) => {
  const totp = await prisma.adminTotp.findUnique({ where: { userId: adminUser.id } });
  if (!totp || !totp.verified) {
    return res.redirect(307, '/admin/2fa/enroll');
  }
  const ok = await verifyAdminTotpCookie(req, adminUser.id);
  if (!ok) {
    return res.redirect(307, '/admin/2fa/verify');
  }
  return handler(req, res, adminUser);
}
```

A second flavour for API routes returns 401 instead of 307 (UI handles redirect).

## Rate limiting

- `/api/admin/2fa/verify` and `/api/admin/2fa/enroll-verify` use `lib/middleware/rateLimit.ts` with `(userId, 60s, 5)` — five attempts per minute per user.
- After 5 failures, lock the user out of 2FA verification for 15 minutes and log a `security` `SyncLog` row.

## Audit-log hooks

`recordAdminAction` is called from inside `withAdmin` after a successful TOTP verify with `action='admin.session_started'`. Subsequent admin writes already record their own audits. Net effect: every admin operation correlates to a TOTP verification within 12 hours.

## Backup-code rotation

If an admin loses their TOTP device:
1. They contact a second admin out-of-band (Slack/email).
2. The second admin opens `/admin/users/<id>` and clicks "Reset 2FA". Server records `action='2fa.reset_by_other_admin'`.
3. The reset admin's TOTP is wiped → next login forces re-enrollment.

A first-and-only admin without backup codes is locked out. Document in the runbook that the first admin MUST save backup codes.

## Test plan

- Unit: TOTP secret generation, code verify (drift ±1 step), backup-code consume-once.
- API: enroll flow, verify flow, locked-out behaviour, disable-requires-password.
- Integration: `withAdmin` redirects to /admin/2fa/enroll for unenrolled admins; redirects to /admin/2fa/verify for enrolled admins without fresh cookie; admin endpoints reject without `admin_totp_ok` cookie.

## Sprint cost

- Schema + migration: 0.5 day
- Backend routes + middleware: 1.5 days
- Frontend pages (enroll + verify): 1 day
- Tests + audit-log integration: 1 day
- Docs + ops runbook: 0.5 day

Total: ~4.5 dev-days. Recommended as the first item after Sprint 5 lands.

## Out-of-scope follow-ups

- Browser-credential (WebAuthn) as an alternative second factor.
- Per-action step-up auth (require fresh TOTP before destructive operations like "Delete user").
- Force-enroll after N days for users promoted to admin role.
