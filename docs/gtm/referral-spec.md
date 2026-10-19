# Referral & signup attribution: build spec

Date: 2026-10-19, Stage B rewritten the same day after Atilla's decisions. For: mybaby-sync-product-d7 (assigned by the orchestrator). Business terms: [turkey-gameplan.md](turkey-gameplan.md) §4.2; pricing: [pricing-v2.md](pricing-v2.md).
Deploy only through the mybaby-sync-product-50 queue.

**Stage A (§0–2, admin report part of §4) is deployed** (`b6ee9895`, 2026-10-19). Its migration already has the `PartnerCommission` / `PartnerPayout` tables, which stay empty until Stage B. **Stage B (§3–5) replaces the old 30%-for-12-months commission model** with a one-time bounty, a partner dashboard and Stripe Global Payouts. Fields such as `Partner.rate`, `tierRate` and `months` stay as unused defaults or are migrated away in the Stage B migration.

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

## 3. Stage B: bounty ledger

Business rules (Atilla, 2026-10-19):
- **Yearly package:** 25% of the customer's **first yearly payment**, net of KDV, after discounts. The rate is 30% if the partner already had ≥ 10 paying referred customers before this payment.
- **Aylık (monthly):** a fixed **₺1.500**, earned on the customer's **2nd** successful monthly payment.
- **Upgrade:** Aylık → yearly within 90 days of the first payment earns the yearly bounty **minus** any Aylık bounty already earned. Never negative.
- **Exclusions:** modules, AI credit packs and renewals earn nothing. Shopify-billed customers, comped accounts and protected review accounts earn nothing.
- **Hold:** 30 days after the payment that earned it. A refund within the hold voids the bounty.

**Payment-provider agnostic.** Payments arrive from Stripe (Aylık, modules, and possibly yearly) and, after pricing v2, from **iyzico or PayTR** (yearly with taksit; pricing-v2 §4 P2). Put the rules in `lib/partners/bounty.ts` with one entry point:

```ts
onPaymentSucceeded({ userId, provider: 'stripe'|'iyzico'|'paytr', objectId, paidAt, currency, grossMinor, taxMinor, planKey, interval: 'year'|'month', isFirstPaymentOfPlan })
onPaymentRefunded({ provider, objectId, refundedMinor, totalMinor })
```

Each provider's webhook calls these at the end of its handler, inside its own try/catch, so a bounty bug can never break billing.

**Ledger rows** (reuse `PartnerCommission`; add `provider String @default("stripe")` and `reason String?` in the Stage B migration):
- One row per earned bounty. `kind`: `bounty_year` | `bounty_month` | `bounty_upgrade` | `reversal`.
- `stripeObjectId` holds the provider object id (unique, so retries are idempotent).
- `netMinor`, `rate`, `commissionMinor` = the bounty amount. `status`: `pending` | `payable` | `paid` | `void`. `payableAt = paidAt + 30 d`.

**Net amount:**
- Stripe: `amount_paid − sum(total_tax_amounts)`.
- iyzico/PayTR: the KDV amount from our own order record.
- If no tax amount is known while prices are "+KDV": log a warning and use `round(gross / 1.20)`.

**Refunds:**
- Stripe: add `charge.refunded` to `relevantEvents`. iyzico/PayTR: their refund callbacks.
- Bounty still `pending`: a full refund → `void`. A partial refund → reduce proportionally.
- Bounty already `paid`: write a `reversal` row (negative), netted against the next payout. Never chase the partner for money.

**Daily cron:** `pages/api/cron/partner-bounties.ts`, existing CronLock pattern. Moves `pending` → `payable` when `payableAt <= now`.

## 4. Partner report, partner dashboard and payouts

### 4.1 Admin (role `admin`; Stage A report exists, extend it)

| Endpoint / page | Does |
|---|---|
| `GET/POST/PATCH /api/admin/partners` | As in Stage A. Promo codes are created on coupon `STRIPE_PARTNER_COUPON_ID`; the discount lives on the coupon (20% once on yearly / repeating 3 months on Aylık; the founder may need two coupons). Add `PARTNER_YEARLY_COUPON_ID` if so, and the matching iyzico/PayTR discount once P2 exists |
| `GET /api/admin/partners/report?month=YYYY-MM[&format=csv]` | Adds bounties pending / payable / paid per partner |
| `POST /api/admin/partners/payouts/run?month=YYYY-MM` | **Dry run by default.** Lists payable bounties per partner (sum > 0 after reversals). With `confirm=true` it creates `PartnerPayout` rows and sends them through Stripe Global Payouts (§4.3) |
| `pages/app/admin/partners.tsx` | Adds the payout run (dry run → confirm) and per-partner payout status |

### 4.2 Partner dashboard: `/app/ortaklik` (new)

- **Access:** a `User` linked to a `Partner` (add `Partner.userId String? @unique`; the admin links it when creating the partner, using the partner's own KolayXport login, normally the comped Growth account).
- **Shows:**
  - The link and code (copy buttons).
  - Totals: signups, activated, paying; bounties pending / payable / paid.
  - A referral list with **masked** customers: first letter of the first name + "***" + first letter of the surname, plan and interval, status (deneme / aktif / ödedi / iptal), bounty amount and status, date. **No e-mails, store names or full names.**
  - Payout history.
  - A "Banka bilgilerimi gir / güncelle" button → the Stripe-hosted recipient onboarding link (§4.3).
- **Never shown** to Shopify-connected accounts (neutral-billing check), and not in the nav for non-partners.
- **KVKK:** add one line to the privacy notice: referred users' masked name, plan and payment status are shown to the referring partner. The gtm-overhaul session owns the legal texts; the lawyer-review flag applies.
- i18n under `partners.dashboard.*` (TR + EN). Mobile layout = expandable cards (app pattern).

### 4.3 Payouts: Stripe Global Payouts from Tamsar, Inc.

- Tamsar, Inc.'s Stripe account (US) collects in TRY. Global Payouts sends to Turkish recipients in **TRY by wire**. Required data: individual = e-mail + name; company = e-mail, company name, address.
- **Onboarding:** create a Stripe recipient for the partner (`Partner.stripeRecipientId`, new field) and give the partner a Stripe-hosted link to enter bank details and tax form (W-8BEN / W-8BEN-E). **We never store IBANs.**
- **Payout run:** one outbound payment per partner per month for the payable sum, `PartnerPayout{ provider:'stripe_global', externalId, amountMinor, currency:'try', paidAt }` (add `provider` + `externalId`). On success, mark the included rows `paid`; on failure, keep them `payable` and show the error in admin.
- The founder enables Global Payouts once in the Stripe dashboard. Fees are as shown there; check them before the first run.
- **Fallback** if Global Payouts isn't enabled for the account: the run outputs a CSV for a manual transfer, and an admin marks rows paid with a reference.

### 4.4 Free Growth perk

Unchanged from Stage A: an admin sets the plan via the existing admin user PATCH; it never uses a founding spot and never earns or creates a bounty.

## 5. Acceptance tests

Stage A tests (already covered by `b6ee9895`): cookie capture, first touch, invalid codes, excluded routes, signup/claim, too-old claim, exclusions, unknown code, promo attribution, report without e-mails, comped account, Shopify account.

Stage B tests (Vitest, mocks as in existing tests):

| # | Case | Expected |
|---|---|---|
| B1 | Referred user pays the first Büyüme yearly payment: gross ₺65.988 incl. ₺10.998 KDV | `bounty_year`, net 5.499.000 minor, bounty 1.374.750 minor (25%), `payableAt +30 d` |
| B2 | Same event replayed | No duplicate row |
| B3 | Partner already has 10 paying referrals; the 11th pays yearly | Rate 0.30 |
| B4 | Aylık first payment | No bounty |
| B5 | Aylık second payment | `bounty_month` 150.000 minor |
| B6 | Aylık customer (bounty earned) switches to yearly 40 days after the first payment | `bounty_upgrade` = yearly bounty − 150.000 |
| B7 | Same switch 120 days after the first payment | No upgrade bounty |
| B8 | Yearly renewal one year later | No bounty |
| B9 | Module or AI credit pack purchase | No bounty |
| B10 | Full refund 10 days after the yearly payment | Bounty `void` |
| B11 | Refund after the bounty was paid | `reversal` row, netted in the next payout run; the run never sends a negative amount |
| B12 | iyzico/PayTR yearly payment (when P2 exists) | Same as B1 through the shared entry point, `provider` set |
| B13 | Bounty code throws inside a webhook | Billing still updates; webhook returns 200; error logged |
| B14 | Payout run without `confirm` | No DB writes, no Stripe call |
| B15 | Payout run with a partner with no recipient onboarding | Partner skipped, listed as "banka bilgisi eksik" |
| B16 | Partner dashboard for partner A | Shows only A's referrals, masked; no e-mails in the HTML/JSON |
| B17 | Non-partner opens `/app/ortaklik` | 404/redirect; not in the nav |
| B18 | Shopify-connected partner account | Dashboard hidden (neutral billing) |
| B19 | Referred Shopify-billed customer pays | No bounty |

Manual prod check after Stage B (dev session + Merisa):
1. Run a payout in dry-run mode.
2. Do one real ₺1 test payout to a test recipient if Stripe allows it; otherwise check the CSV fallback.
3. Open a test partner's dashboard on a phone.

## 6. Rollout

1. ~~Stage A~~ (deployed 2026-10-19).
2. Stage B: the bounty ledger + cron on Stripe events first, then the dashboard, then Global Payouts.
3. The founder creates the partner coupon(s) and sets `STRIPE_PARTNER_COUPON_ID` (and `PARTNER_YEARLY_COUPON_ID` if needed) via stdin, and enables Global Payouts.
4. The iyzico/PayTR hook goes in when pricing v2 P2 is built.
5. The gtm-overhaul session publishes `/ortaklik` (terms) only after Stage B is live, the founder has approved the terms (done) and the accountant has confirmed the payout paperwork (pricing-v2 §5).
