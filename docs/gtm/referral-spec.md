# Referral & signup attribution: build spec

Date: 2026-10-19. For: the dev session the orchestrator assigns. Business terms: [turkey-gameplan.md](turkey-gameplan.md) §4.2 (approved by the orchestrator for Atilla on 2026-10-19).
Effort: S–M (2–3 dev days). Deploy only through the mybaby-sync-product-50 queue.

## 0. Hard constraints (MCP / directory-review freeze)

- **Do not touch:** `lib/auth.ts`, `pages/api/auth/[...nextauth].*`, NextAuth/Apple cookie settings, OAuth providers/consent screens, `lib/mcp/*`, `pages/api/mcp/*`, or reviewer accounts.
- Capture uses **our own first-party cookies**, set in `middleware.js` (a no-op today; its matcher already excludes `api/auth`).
- For OAuth (Google/Apple) users, attribution is written by a **post-login claim endpoint**, not by the NextAuth `events.createUser` hook.
- **Middleware scope (deploy-queue owner, 2026-10-19):** `middleware.js` runs on every route. Its matcher (or an early `return NextResponse.next()`) must exclude `/api/mcp/*`, `/oauth/*`, `/.well-known/*`, `/api/auth/*`, `/api/shopify/*` and `/api/integrations/shopify/*`. The Claude/ChatGPT MCP reviews and the Shopify review are live, and a cookie or redirect there could break them. Simplest option: only act on page paths (not `/api/*`) that carry `?ref=` or `utm_*`.
- **Shopify-connected accounts** (`shopify_free` or Shopify-billed) never see referral rewards, Stripe prices or upgrades (App Store rule 1.2.1). Gate any referral UI on the existing neutral-billing check (`useAiCostsVisible` / `balance.neutral`). Shopify-billed customers create no commission.
- **Protected accounts** (review@, play-review@, mcp-review@) are never modified, attributed or comped.
- `pages/api/auth/signup.ts` is our own credentials-signup route, not NextAuth config. The plan adds one additive write there (§2.2). If the queue owner treats the whole `pages/api/auth/` folder as frozen, drop that write: the claim endpoint (§2.3) still covers credentials users who log in on the same browser.

## 1. Data model (Prisma, one migration)

```prisma
model Partner {
  id                  String   @id @default(uuid())
  code                String   @unique            // uppercase A–Z, 0–9, '-', 3–20 chars, e.g. "ETSYILEGELIR"
  name                String
  type                String                      // fb_admin | tg_admin | x_voice | youtube | musavir | other
  email               String?                     // for statements; never shown to anyone else
  status              String   @default("active") // active | paused | terminated
  rate                Decimal  @default(0.30)
  tierRate            Decimal  @default(0.35)
  tierThreshold       Int      @default(10)       // distinct paying referred customers
  months              Int      @default(12)       // commission window from the customer's first payment
  stripePromotionCode String?  @unique            // Stripe promotion_code id (promo_...)
  promoCodeText       String?                     // the code customers type, usually == code
  notes               String?
  createdAt           DateTime @default(now())
  acquisitions        UserAcquisition[]
  commissions         PartnerCommission[]
}

model UserAcquisition {
  userId      String   @id
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  utmSource   String?
  utmMedium   String?
  utmCampaign String?
  utmContent  String?
  utmTerm     String?
  landing     String?          // first landing path
  refCode     String?          // raw ?ref= value as captured (uppercased, validated format)
  partnerId   String?          // set only when refCode / promo matches an active Partner
  partner     Partner? @relation(fields: [partnerId], references: [id])
  via         String           // signup | claim | promo
  firstSeenAt DateTime?        // when the cookie was first set
  capturedAt  DateTime @default(now())
  @@index([partnerId])
}

model PartnerCommission {
  id              String    @id @default(uuid())
  partnerId       String
  partner         Partner   @relation(fields: [partnerId], references: [id])
  userId          String
  stripeObjectId  String    @unique   // invoice id (in_...) or checkout session id (cs_...) for one-time credit packs; refunds: re_...
  kind            String              // invoice | credit_pack | refund
  paidAt          DateTime
  currency        String              // try | usd
  grossMinor      Int                 // amount paid, incl. KDV
  taxMinor        Int                 // KDV on the invoice (0 if none)
  netMinor        Int                 // gross − tax (negative for refunds)
  rate            Decimal
  commissionMinor Int                 // round(net × rate), negative for refunds
  status          String    @default("pending") // pending | payable | paid | void
  payableAt       DateTime            // paidAt + 30 days
  payoutId        String?
  createdAt       DateTime  @default(now())
  @@index([partnerId, status])
}

model PartnerPayout {
  id          String   @id @default(uuid())
  partnerId   String
  period      String            // "2026-12"
  amountMinor Int
  currency    String            // try
  fxNote      String?           // TCMB rate used if USD commissions were converted
  paidAt      DateTime?
  reference   String?           // EFT reference
  createdAt   DateTime @default(now())
}
```

Add `acquisition UserAcquisition?` on `User`. Nothing else on `User` changes.

## 2. Capture points

### 2.1 Middleware: first-party cookies (`middleware.js`)

On any matched **GET page request** (skip `/api/*`, `/app/*` assets and bots by user agent):
- If `?ref=` is present, matches `^[A-Za-z0-9-]{3,20}$`, and the `kx_ref` cookie is **absent**: set `kx_ref=<UPPERCASED>|<epochSeconds>`.
- If any of `utm_source|utm_medium|utm_campaign|utm_content|utm_term` is present and `kx_ft` is **absent**: set `kx_ft=<base64url JSON {utm…, landing: pathname, at}>`, max 600 bytes, values trimmed to 100 chars.
- Cookie attributes: `Path=/; Max-Age=7776000 (90 days); SameSite=Lax; Secure; HttpOnly`.
- First touch wins: **never overwrite** an existing cookie.
- No DB access and no redirect in middleware. Unknown codes are still stored; they're validated at write time.
- `?ref=` also gets mirrored into `utm_content=ref-<code>` for GA4 only if no `utm_*` is present. That happens client-side in `captureAttribution` (`lib/tracking/events.ts`); add `ref` to the stored keys.

### 2.2 Credentials signup (`pages/api/auth/signup.ts`, additive only)

After `prisma.user.create`, call `recordAcquisition(user.id, { cookies: req.cookies, body: req.body?.attribution, via: 'signup' })`:
- Source priority per field: cookie (`kx_ft`/`kx_ref`), then the body's `attribution` (localStorage, already sent by `components/AuthForm.jsx`).
- It must never fail the signup: wrap it in try/catch and log on error.
- This covers the case where the verification link is opened on another device.

### 2.3 Claim endpoint for OAuth and anything missed: `POST /api/user/acquisition/claim`

- Auth: the normal session (`getServerSession`), with no change to auth config.
- Called once by `pages/_app.tsx` when a session exists and `localStorage['kx-acq-claimed']` is unset. The body carries `readAttribution()`. Set the flag after any 2xx.
- Server logic:
  1. If a `UserAcquisition` row exists → 200 `{status:'exists'}` (idempotent).
  2. If `user.createdAt` is **older than 24 h** → 200 `{status:'too_old'}`. Existing users can't attach a partner later.
  3. Else `recordAcquisition(user.id, { cookies, body, via: 'claim' })` → 201.
- Clear `kx_ref`/`kx_ft` (Max-Age=0) in the response once written.

### 2.4 Promo code at checkout (Stripe webhook)

In `checkout.session.completed`, add a block that leaves the existing logic unchanged:
- Expand `total_details.breakdown.discounts.discount.promotion_code`.
- If the code matches an active `Partner.stripePromotionCode` **and** the user's `UserAcquisition.partnerId` is null: set `partnerId` (create the row with `via:'promo'` if missing).
- A link that came first keeps its partner (first touch wins).

### 2.5 `recordAcquisition` (new, `lib/partners/acquisition.ts`)

- Upsert-if-absent `UserAcquisition`.
- Resolve `refCode` → `Partner` where `status='active'`.
- **Exclusions (partnerId stays null, refCode kept for audit):**
  - user email == partner email (case-insensitive)
  - user role is admin
  - user email is in `REVIEW_ACCOUNT_EMAILS` (env, comma-separated; covers review@, play-review@, mcp-review@)

## 3. Commission ledger (Stripe webhook)

Add `charge.refunded` to `relevantEvents`. Existing case branches keep their behaviour; the new logic lives in `lib/partners/commissions.ts` and is called at the end of each relevant case inside its own try/catch, so a ledger bug can never break billing.

- **`invoice.payment_succeeded`** (every `billing_reason`, `amount_paid > 0`): find the user by customer → `UserAcquisition.partnerId`. If there is a partner:
  - **Window:** the customer's first `PartnerCommission.paidAt` (or this invoice, if it's the first) + `partner.months`. Invoices after the window are ignored.
  - **Rate:** `tierRate` if the partner already has ≥ `tierThreshold` distinct paying referred users *before* this invoice, else `rate`. This is not retroactive.
  - **Net:** `amount_paid − sum(total_tax_amounts)`. If the invoice has no tax line while prices are "+KDV", log a warning and use `round(amount_paid / 1.20)`.
  - **Write:** `stripeObjectId=invoice.id` (unique, so webhook retries are idempotent), `payableAt = paidAt + 30 d`.
- **AI credit packs** (`checkout.session.completed` with `mode='payment'`): same rules, `kind='credit_pack'`, `stripeObjectId = session.id`.
- **`charge.refunded`:** find the commission row for the charge's invoice/session.
  - Write a `kind='refund'` row with negative net/commission proportional to `amount_refunded / amount`, `status='payable'` and `payableAt = now`.
  - If the original row is still `pending`, mark it `void` instead and skip the negative row when the refund is full.
- **Daily cron** (`pages/api/cron/partner-commissions.ts`, existing CronLock pattern): `pending` → `payable` when `payableAt <= now`.

## 4. Partner report and admin

All endpoints require `role === 'admin'` (same check as `pages/api/admin/*`).

| Endpoint / script | Does |
|---|---|
| `GET/POST/PATCH /api/admin/partners` | List, create, pause or terminate partners. On create with `createPromo: true`, create a Stripe promotion code on coupon `STRIPE_PARTNER_COUPON_ID` (20% off, `duration: repeating`, `duration_in_months: 3`; the founder creates the coupon once) and store its id |
| `GET /api/admin/partners/report?month=YYYY-MM[&format=csv]` | Per partner: signups (UserAcquisition rows), **activated** (a marketplace connection created ≤ 7 days after signup; the dev picks the source tables: Credential, EtsyShop, eBay/Amazon/Trendyol/Shopify/Wix connection rows), trialing, paying (≥1 paid invoice), net revenue, commission pending / payable / paid. Also totals and an "unattributed" row by `utm_source` |
| `scripts/partners/monthly-statements.ts --month=YYYY-MM` | Writes one statement per partner (counts and amounts only) and a payout list: partners with payable ≥ ₺1.000 (USD converted at the TCMB rate the founder enters with `--usd-try`). **Dry run by default**, `--write` creates `PartnerPayout` rows |
| `POST /api/admin/partners/payouts/:id/paid` | Sets `paidAt` + EFT reference and marks the included commission rows `paid` |
| `pages/app/admin/partners.tsx` | Simple table over the report (desktop only is fine), i18n keys under `admin.partners.*` (TR + EN) |

**Privacy (KVKK):** partners never see who signed up. Statements show counts and money only; no names, e-mails or store names.

**Free Growth perk for partners:** the existing admin `PATCH /api/admin/users/[userId]` sets `subscriptionPlan`. Add `comp: true` handling there, or document the manual steps: `plan=growth`, `status=active`, no Stripe customer. A comped account must **not** use a founding spot and must not create commission. Owner: the admin (Atilla, or whoever he gives the admin role) does it on Merisa's request.

## 5. Acceptance tests

Vitest unit/API tests (mock Stripe and Prisma as the existing tests do), plus a manual check on prod after the deploy.

| # | Case | Expected |
|---|---|---|
| 1 | GET `/?ref=etsyilegelir` with no cookies | `kx_ref=ETSYILEGELIR\|…`, HttpOnly, Secure, Lax, 90 d |
| 2 | Same request with an existing `kx_ref=OTHER` | Cookie unchanged (first touch) |
| 3 | `?ref=<script>` or a 40-char value | No cookie set |
| 4 | Requests to `/api/auth/*`, `/api/mcp/*`, `/oauth/*`, `/.well-known/*`, `/api/shopify/*`, `/api/integrations/shopify/*`, `/_next/*`, even with `?ref=` | Middleware does nothing: no Set-Cookie, no redirect |
| 5 | Credentials signup with `kx_ref` for an active partner | `UserAcquisition{via:'signup', partnerId}`; the signup still returns 201 even if `recordAcquisition` throws |
| 6 | Google sign-in (new user), then `_app` claim | `UserAcquisition{via:'claim'}`; a second claim returns `exists`; cookies cleared |
| 7 | Claim by a user created 3 days ago | `too_old`, no row |
| 8 | Ref code == partner's own e-mail account / reviewer e-mail / admin | Row written with `refCode`, `partnerId = null` |
| 9 | Unknown or paused code | Row with `refCode`, `partnerId = null` |
| 10 | Checkout with partner promo code, user without partner | `partnerId` set, `via:'promo'`; user with a link partner keeps the original |
| 11 | `invoice.payment_succeeded` ₺1.798,80 incl. ₺299,80 KDV | Net 149.900 minor, commission 44.970 minor (30%), `payableAt = +30 d`; replaying the same event creates no duplicate |
| 12 | Invoice 13 months after the first paid invoice | No commission row |
| 13 | 11th paying customer of a partner with 10 paying | Rate 0.35 for the new invoices; old rows unchanged |
| 14 | Full refund within 30 days | Original row `void`, nothing payable |
| 15 | Partial refund after payout | Negative payable row, netted in the next statement |
| 16 | Credit pack purchase by a referred user | `kind:'credit_pack'` row |
| 17 | Commission code throws inside the webhook | Billing updates still happen; webhook returns 200; error logged |
| 18 | Report for a month | Counts match fixtures; CSV has no user e-mails |
| 19 | Statement script without `--write` | No DB writes |
| 20 | Comped partner account | No founding spot used, no commission rows |
| 21 | Shopify-connected account (shopify_free) with a ref cookie | No referral UI shown, no Stripe prices; no commission rows |

Manual prod check after the deploy (Merisa + dev session):
1. Open `https://kolayxport.com/?ref=TEST-PARTNER` in a private window and sign up with a test e-mail.
2. The report shows 1 signup for TEST-PARTNER.
3. Delete the test user and the TEST-PARTNER row afterwards.

## 6. Rollout

1. Migration + capture (§1–2) first. From that day every signup is attributed, even before any partner exists.
2. Ledger + report (§3–4) in the same or the next queue slot.
3. The founder creates the Stripe coupon `STRIPE_PARTNER_COUPON_ID` (20% off, repeating, 3 months) and sets the env value via stdin.
4. The gtm-overhaul session publishes `/ortaklik` only after 1–3 are live and the founder approved the terms (claims check).
