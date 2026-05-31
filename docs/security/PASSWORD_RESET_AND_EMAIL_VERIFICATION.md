# PASSWORD_RESET_AND_EMAIL_VERIFICATION (plan)

Plan-doc only. The credentials flow currently bypasses email verification and has no password reset; both are necessary before any wider launch. Sprint 6 candidate.

---

## Current state (audited Sprint 5)

- `pages/api/auth/[...nextauth].ts` is the NextAuth catch-all. Providers: Google OAuth + Credentials (bcryptjs cost 12). Session strategy: JWT.
- `pages/api/auth/signup.ts` writes a `User` row with a hashed password and provisions a 30-day trial. No email confirmation, no `emailVerified` enforcement.
- `User.emailVerified DateTime?` exists in `prisma/schema.prisma` but is never read in middleware.
- `User.password String?` is nullable to accommodate Google-only users.
- `VerificationToken` model exists (NextAuth adapter table) but is empty in our flow because no Email provider is wired.
- SMTP wiring exists for ETGB (`ETGB_SMTP_HOST/USER/PASS/FROM`) and is reused by `lib/admin/dailySummary.ts`. No transactional template engine.

So today: anyone can sign up with `attacker@victim.com`, never verify, and the account behaves identically to a verified one.

---

## Goals

1. **Email verification**: every credentials user must verify the address before they can take any tenant-write action (connect a marketplace, generate a label, submit tracking).
2. **Password reset**: a self-service reset that resists user-enumeration, replay, and brute force.
3. **No user enumeration**: every "did this email exist?" code path returns an identical response.
4. **Google OAuth users untouched**: Google users have `emailVerified` populated by the provider; they should not be required to do anything new.

---

## Data model

```prisma
// Reuse VerificationToken (NextAuth adapter table) — it already has identifier/token/expires.
// Add a `purpose` discriminator so the same table services email-verify and password-reset.

model VerificationToken {
  identifier String
  token      String   @unique
  /// 'email_verify' | 'password_reset'
  purpose    String   @default("email_verify")
  expires    DateTime
  consumedAt DateTime?

  @@unique([identifier, token])
  @@index([purpose, expires])
}
```

Migration: additive, safe.

For password-reset rate limiting, reuse `lib/middleware/rateLimit.ts` keyed by `email-or-ip` so legitimate users on the same office IP aren't all blocked together.

---

## Email verification flow

1. `pages/api/auth/signup.ts`:
   - Insert `User` with `emailVerified=null`.
   - Generate token = `crypto.randomBytes(32).toString('base64url')`, store hash + identifier + purpose + expires (24h).
   - Send email with `https://kolayxport.com/auth/verify?token=<token>`.
2. `pages/api/auth/verify-email.ts`:
   - Find token by hash; if expired or `consumedAt != null`, return generic "link invalid".
   - Set `User.emailVerified = now()`, set token `consumedAt`.
   - Redirect to `/login?verified=1`.
3. `pages/api/auth/resend-verification.ts`:
   - Always returns 200 with the same `{ ok: true }` regardless of whether the email exists or is already verified.
   - Internally: if a user with the email exists AND `emailVerified == null`, generate a fresh token (invalidate prior ones for the same identifier+purpose by setting `consumedAt`), send the email.
   - Rate-limit: 1 request per email per 60s, 5 per IP per 5m.
4. New middleware `requireVerifiedEmail`:
   - For credentials users (`user.password != null`) where `user.emailVerified == null`, return 403 from any tenant-write route OR redirect to `/auth/verify-pending` for page routes.
   - Google users (`user.password == null`) bypass unconditionally.

### Login policy decision (default = block hard)

Two viable policies:
- **(A) Block all login** until verified — strongest, simplest to reason about.
- **(B) Allow login but block tenant-write actions** — friendlier UX; users can browse settings, plan pricing page, etc.

Recommended: **(B)**, because most users will land on `/ayarlar` after signup and need to see what to do next. Implementation: `withVerifiedEmail` middleware wraps all writes; pages with action UI show a top banner explaining the limitation.

---

## Password reset flow

1. `pages/api/auth/request-reset.ts`:
   - Accept `{ email }`.
   - Always return `200 { ok: true, message: 'If an account exists, you will receive an email' }`. **Do not vary timing perceptibly** — use `crypto.randomBytes(0)` busy-wait or simply skip lookup short-circuit on misses (the DB lookup is fast enough that constant-time isn't strictly required, but keep the code-shape identical between hit/miss).
   - Internally: if a credentials user exists for the email, generate a token (purpose='password_reset', expires 1h), invalidate any prior unconsumed tokens for the same identifier+purpose, send email.
   - Rate-limit: 3/hour per email, 10/hour per IP.
2. `pages/api/auth/reset-password.ts`:
   - Accept `{ token, newPassword }`.
   - Verify token (hash lookup, not consumed, not expired).
   - Validate new password meets policy (≥8 chars, ≥1 letter, ≥1 number; reject equal to the user's last password via `bcrypt.compare`).
   - `bcrypt.hash(newPassword, 12)`, update `User.password`.
   - Mark token consumed.
   - Invalidate all NextAuth sessions for this user (delete `Session` rows). User must re-login.
   - Log a `security` SyncLog `password.reset_completed` (no values).
3. UI:
   - `/auth/forgot` — email input → request-reset.
   - `/auth/reset?token=...` — new-password form.

---

## Pages to add

| Path | Purpose |
|---|---|
| `pages/auth/verify-pending.tsx` | "We sent you an email" landing. |
| `pages/auth/verify.tsx` | Calls `/api/auth/verify-email?token=...`; shows success/failure. |
| `pages/auth/forgot.tsx` | Email input → POST `/api/auth/request-reset`. |
| `pages/auth/reset.tsx` | New-password form. Token in URL. |

All four use existing styling; no broad redesign.

## Emails

Reuse `nodemailer` with the existing `ETGB_SMTP_*` env vars (rename to `SMTP_*` in a later cleanup sprint — keep ETGB_ aliases for backward compatibility).

Plain-text templates only this sprint. Two:
- `verify-email`: 4-line message + link.
- `password-reset`: 4-line message + link + 1-hour expiry note.

No HTML templates. No third-party email service. No `From` rewrite.

If `SMTP_*` env vars are missing in production at the time a flow runs:
- For verify-email at signup → log a `security warn` and let signup succeed with `emailVerified=null` (user is stuck but can request resend later).
- For password-reset request → log and return the generic 200 (do not surface SMTP misconfiguration to users).

---

## Tests

- `test/api/auth/request-reset.test.ts` — same response shape and approximate timing for known + unknown email.
- `test/api/auth/reset-password.test.ts` — token expires, token cannot be reused, password is bcrypt-hashed on write.
- `test/api/auth/verify-email.test.ts` — happy path + expired token + already-consumed token.
- `test/api/auth/resend-verification.test.ts` — rate-limit, generic response.
- `test/lib/middleware/withVerifiedEmail.test.ts` — credentials user blocked, Google user passes through, verified user passes through.
- Plus a `security:smoke` snapshot to confirm none of the new routes leak the token or password in logs.

---

## What does NOT change

- NextAuth Google provider — Google users continue to bypass the new gate.
- Existing sessions — users mid-session don't get logged out by this sprint; they're flagged on next request.
- Extension auth flow — extension JWT is issued only for verified-or-Google sessions automatically because `getAuthUser` returns the same `{id,email,name}` shape.

---

## Sprint cost

- Schema + migration: 0.5 day
- API routes: 1.5 days
- Pages: 1 day
- Middleware + integration: 0.5 day
- Tests: 1 day
- Email copy + ops runbook: 0.5 day

Total: ~5 dev-days. Recommended right after ADMIN_2FA_PLAN.md.
