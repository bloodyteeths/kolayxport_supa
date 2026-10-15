## Review of the tiers plan: what I checked and what I corrected

I checked the plan against `/Users/tamsar/Downloads/backup integration/kx-ux-phase0` at HEAD 92087ba, read-only. The two Stripe API-version claims were checked against the official Stripe changelog pages for 2025-03-31.basil. The plan has no brand or logo rules, so nothing on that side needed checking. Most line references are correct. The errors are below, most serious first.

### A. Factual errors and missed defects

1. **New defect D14: the expired-trial cron hits paying Stripe subscribers who are still in their Stripe trial.**
   - `pages/api/cron/reset-usage.ts:58-80` matches every user with `subscriptionStatus:'trialing' AND trialExpiresAt <= now`, then sets `canceled` and `subscriptionPlan:null`.
   - The webhook writes the Stripe `trial_end` into `trialExpiresAt` (`webhook.ts:207-209`). So a user on the checkout's 30-day Stripe trial matches the sweep the day the trial ends.
   - If the cron runs before Stripe's `customer.subscription.updated` arrives, `updated` restores `active` but never restores the plan (`:301-312`). The withUsageLimiter then answers `invalidPlan` (`withUsageLimiter.ts:111-119`) and the paying customer stays blocked.
   - The plan's new sweep filter (`stripeSubscriptionId IS NULL`) happens to fix this, but the plan never names it as a defect. It needs a backfill check, and the fix must ship before the sweep is redeployed.

2. **New defect D15: the invoice webhook branches are probably dead code.**
   - `lib/stripe.ts:8` pins `apiVersion: '2025-06-30.basil'` (SDK 18.5.0).
   - Per the Stripe changelog, basil removed `invoice.subscription`. It is now `invoice.parent.subscription_details.subscription`.
   - `webhook.ts:218` and `:257` read `invoice.subscription`. If the webhook endpoint's API version is basil or later, `payment_succeeded` and `payment_failed` never do anything.
   - basil also removed `subscription.current_period_end`; it is now `items.data[0].current_period_end`. The plan's `currentPeriodEnd` write has to read it from the item.
   - **Must verify:** the webhook endpoint's API version in the Stripe dashboard.

3. **D2 (annual limits once a year) is still true, but the evidence is partly wrong.**
   - The yearly reset that actually takes effect is the one written at checkout (`webhook.ts:194-199`) and by `reset-usage.ts:37-42`.
   - The `invoice.payment_succeeded` branch (`:236-241`) is probably never reached (see item 2).
   - The withUsageLimiter's own reset is a rolling 30 days (`withUsageLimiter.ts:60-83`), and it only fires when `usageResetAt` has passed.

4. **New defect D16 (largest): connecting any Shopify store gives unlimited use.**
   - `shopify/callback.ts:254-262` moves every non-Stripe user to `shopify_free`, whether the store came from an App Store install or from the settings page.
   - `user/settings.ts:56-59` treats any active `ShopifyShop` as Shopify-free.
   - So any trial or expired user can connect a free Shopify development store and get unlimited orders and labels for good. In the original plan, that also includes unlimited connected stores (`shopify_free.connectedStores: null`).
   - That makes every paid tier pointless. The plan says nothing about it.

5. **"Cap it with the scans/day limit already in the job runner" is false.**
   - No per-user scan limit exists.
   - `clawd/arbitrage.ts:88-95` only checks the shared eBay Browse quota.
   - The arbitrage matcher (`lib/arbitrage/matcher.ts`) calls Gemini without any metering.

6. **"`ai/trendyol.ts`: add auth check" is wrong.** It already has `getAuthUser` at `:13`. What it lacks is a rate limit and metering.

7. **The connect-limit redirect target is wrong.** `/ayarlar?tab=integrations` does not exist. The tab keys (`pages/ayarlar.tsx:25`) are `connections | billing | apiKeys | senderProfile | syncAdvanced`. Use `?tab=connections`.

8. **The plan says "D7: the limiter covers these routes". The wrapped routes are actually:** `labels/ups.ts`, `labels/mng.ts`, `orders/[orderId]/generate-label.ts`, `orders/sync.ts`, `integrations/etsy/orders.ts` and `integrations/etsy/addresses.ts`.
   - `analytics/index.ts` and `analytics/marketplace.ts` import the withUsageLimiter but never use it. Remove those imports when the shim lands.
   - D7 itself is confirmed: `shipments/index.ts` (FedEx) has no limiter.

9. **The Pro-gate line references for the finance APIs point inside the handlers.** The handlers start at `dashboard.ts:591`, `settlements.ts:2137` and `product-costs.ts:287`. Put the gate right after auth in each handler.

10. **The checkout user-create fallback is not a 4th place that sets a trial date.** `create-checkout-session.ts:110-121` sets `trial`/`trialing` but **no** `trialExpiresAt`. Under the current withUsageLimiter that user is blocked as `noSubscription`. Either way, replacing it with a 409 is still correct.

11. **D3 is confirmed.** The trial branch catches anyone who is Stripe-`trialing` because `trialExpiresAt` equals the Stripe `trial_end`.

12. **D1 is confirmed, and the fix needs one more piece.** `isPayingStripeCustomer` also leaves out `trialing` (`callback.ts:251-253`), so a subscriber still in their Stripe trial is switched to `shopify_free` too.

### B. Missing pieces

- **Order ingestion that bypasses sync.** Wix webhooks (`integrations/wix/webhook.ts`), Etsy webhooks (`pages/api/webhooks/etsy.ts` and `cron/process-etsy-webhooks.ts`) and the Shopify recent sync still bring orders in after the limit is reached. With counted orders this is soft enforcement. Either accept it explicitly and gate only the pull paths, or gate the ingestion paths too.
- **Arbitrage background jobs** (`resumeStaleJobsOnce`, `lib/arbitrage/jobRunner.ts`). A user who downgrades from Pro must not have stale jobs resumed. The gate also has to run when a job is created and when it resumes, not only on the API call.
- **The internal API-key path** (`getAuthUserOrApiKey` with `x-user-id`, used by `ebay-drafts/*`). Decide whether internal calls are metered. Recommendation: meter them as the target user, and do not exempt them the way `CLAWD_API_KEY` is exempted on arbitrage.
- **Consumers of `subscriptionStatus`/`subscriptionPlan` the plan did not list.** These must learn `expired` and `pro`: `pages/admin/index.tsx`, `pages/api/admin/dashboard.ts`, `pages/api/admin/users/[userId].ts`, `lib/admin/monitoring.ts` and `lib/hooks/useSettings.ts:10-11`.
- **Tax.** Decide whether TRY prices include KDV (20%) and whether USD prices include VAT or US sales tax. Turn on Stripe Tax or show prices as "+KDV". The pricing page copy depends on this decision.
- **`subscription.discounts` returns ids unless expanded.** The founding check needs `expand: ['discounts']`. In basil, read the coupon from `discount.coupon`; in clover and later it moves to `discount.source.coupon`.
- **The hardcoded English summary** (`fiyatlandirma.js:272-286`) exists on purpose for marketplace app reviewers. Generate it from `PLANS`, but keep it visible in every locale.

### C. Risky assumptions

- **Counting orders by `uiOrderDate`.** The `coalesce(uiOrderDate, createdAt)` raw SQL cannot use the `[userId, uiOrderDate]` index. Use `uiOrderDate >= start OR (uiOrderDate IS NULL AND createdAt >= start)` instead; both columns are indexed with `userId` (schema lines 185 and 188).
- **The Stripe trial carry-over (`trial_end`).** Checkout requires `trial_end` to be at least 2 days away. The plan's 48h guard is right; make it more than 48h plus a buffer.
- **Pro AI cost.** "500 images ≈ $35" assumes image prices that have not been verified. Treat the AI credit numbers as provisional and log real cost per credit for the first month (UsageLedger).

---

# CORRECTED PLAN

# KolayXport billing: current state and implementation plan (corrected)

Repo read: `/Users/tamsar/Downloads/backup integration/kx-ux-phase0` (HEAD 92087ba). No files were edited.

## 0. Current state and the defects that block launch

**Plan data is copied in 6 places and the copies disagree.**
- `lib/stripePrices.ts:1-13` (only starter and growth)
- `withUsageLimiter.ts:17-25` (plans) and `:96` (trial 50/10)
- `LimitReachedDialog.tsx:21-25`
- `SubscriptionDashboard.tsx:50-56`
- `TrialNotification.tsx:21`
- `fiyatlandirma.js:32-35` (₺449/₺999) and the English block at `:272-286`

**The 30-day trial is set in 3 places, plus checkout:**
- `pages/api/auth/signup.ts:47-50`
- `lib/auth.ts:51-60` (createUser event)
- `shopify/callback.ts:53-66` (shopify_free provisioning)
- Checkout adds a 30-day Stripe trial at `create-checkout-session.ts:217`.
- The checkout user-create fallback at `:110-121` sets `trial` without a `trialExpiresAt`.

**Defects**
- **D1. Nothing ever sets `billingProvider='stripe'`.** So `isPayingStripeCustomer` (`shopify/callback.ts:251-253`) is always false, and it also leaves out `trialing`. A paying Stripe user who connects Shopify is switched to `shopify_free` while Stripe keeps charging them.
- **D2. Annual subscribers get a yearly usage reset.**
  - Checkout writes `usageResetAt` one year ahead (`webhook.ts:194-199`).
  - `reset-usage.ts:37-42` does the same.
  - The withUsageLimiter's rolling 30-day reset only fires after `usageResetAt` has passed.
- **D3. Stripe-`trialing` subscribers get trial caps.** The trial branch (`withUsageLimiter.ts:95-103`) catches them, because the webhook stores `trial_end` in `trialExpiresAt` (`webhook.ts:207`).
- **D4. Portal plan changes never reach the DB.** `customer.subscription.updated` (`:289-317`) writes only the status. Subscription id, price, currency and discount are never stored.
- **D5. `past_due` is blocked immediately** (`withUsageLimiter.ts:106`). There is no grace period.
- **D6. The "order sync" limit counts API calls, not orders.**
  - `orders/sync.ts:196` adds 1 per call.
  - The Etsy `orders.ts:285` and `addresses.ts:246` routes are wrapped but never increment.
  - `cron/sync-orders.ts:26-66` (every 15 minutes, `cron-jobs.yml`) syncs every user with no entitlement check.
- **D7. FedEx labels are not counted.** `pages/api/shipments/index.ts` has no limiter.
- **D8. Shopify-free detection is inconsistent.**
  - The withUsageLimiter checks `subscriptionPlan==='shopify_free'` only (`:90`).
  - Settings (`user/settings.ts:56-59`) and checkout (`create-checkout-session.ts:21-32`) also count an active ShopifyShop.
  - Result: a trial user with a legacy Shopify connection gets trial caps, and checkout refuses them with a 403. They are stuck.
- **D9. The limit dialog ignores the API's `reason`.** `limitInterceptor.ts:119` re-derives it from `details`, and `LimitType` (`:19`) only knows `orderSync | label | unknown`.
- **D10. AI has no metering.**
  - In-memory 30 requests/min only in `ai/etsy.ts:15-34` and `ai/amazon.ts:383-387`.
  - No limit at all in `ai/trendyol.ts` (auth exists at `:13`) or `ai/generate-image.ts`.
  - Unmetered: `clawd/ebay-ai.ts` (dispatcher at `:730`), `clawd/etsy.ts:3472` (`analyze_keyword_ranking`), `trendyol/research.ts:129` (`ai_market_report`) and the arbitrage matcher `lib/arbitrage/matcher.ts`.
- **D11. The pricing page claims things that do not exist.**
  - "1/5/Unlimited Users" and "API Access" (`marketing.pricing` lines ~34/46/58/100/106 in `en.json`). There is no team or public API product; `ApiKeysPanel` is only marketplace credential entry.
  - "Save 15%" is wrong; 10× monthly is about 17% (2 months free).
  - "30-day trial" appears in meta, hero, subheading, the button and `fiyatlandirma.js:283`.
- **D12. Expired trials are set to `canceled` with plan `null`.** No grace, and they look the same as a real cancellation.
- **D13. Pro features have no gate anywhere.**
  - Arbitrage: `clawd/arbitrage.ts:26-60` and the background `jobRunner`. UI: `ebay-research.tsx:2943` (tab) and `:3104`.
  - Financials: handlers at `finance/dashboard.ts:591`, `settlements.ts:2137`, `product-costs.ts:287`. Also `pages/app/financials.tsx`, `cron/sync-financials.ts:28-40` and the nav at `AppLayout.js:166`.
  - Bulk Photo Studio: `BulkEditor.tsx:3476-3477`. It has no own API; it calls `/api/ai/etsy`, `/api/ai/generate-image` and the draft endpoints.
- **D14. The expired-trial sweep hits Stripe-trialing payers.** `reset-usage.ts:58-80` matches `trialing AND trialExpiresAt<=now`, which includes Stripe-trial subscribers whose trial ends today. It nulls their plan; `subscription.updated` restores `active` but not the plan, and the withUsageLimiter then returns `invalidPlan`.
- **D15. The invoice webhook branches are probably dead under basil.**
  - `lib/stripe.ts:8` uses `2025-06-30.basil`, which removed `invoice.subscription` (now `invoice.parent.subscription_details.subscription`) and `subscription.current_period_*` (now on `items.data[]`).
  - `webhook.ts:218` and `:257` read the removed field.
  - Check the webhook endpoint's API version in the Stripe dashboard.
- **D16. Connecting any Shopify store gives unlimited use.** `shopify/callback.ts:254-262` (any connect path, including from settings) together with `settings.ts:56-59` puts every non-Stripe user on `shopify_free`, with unlimited orders and labels. A free development store is enough to bypass every tier.

**Reuse:**
- `lib/integrations/connectionStatus.ts` (`getConnectionStatus`, `MARKETPLACE_PROVIDERS` `:38-48`)
- `Order` indexes `[userId, uiOrderDate]` and `[userId, createdAt]`
- `emitUsageNotifications` (`withUsageLimiter.ts:145-187`)
- The 402 interceptor and `LimitReachedDialog`
- `WebhookEvent` idempotency
- `runCronGuard`

## 1. Single source of truth: `lib/billing/plans.ts` (new)

```ts
export type PlanKey = 'trial'|'starter'|'growth'|'pro'|'enterprise'|'shopify_free';
export type PaidPlanKey = 'starter'|'growth'|'pro';
export type Currency = 'try'|'usd'; export type Interval = 'month'|'year';
export type Feature = 'arbitrage'|'financials'|'bulkPhotoStudio';
export type Meter = 'orders'|'labels'|'connectedStores'|'aiCredits';

export const TRIAL_DAYS = 14, GRACE_DAYS = 3, OVERAGE_BUFFER = 0.10;
export const FOUNDING = { couponEnv: 'STRIPE_FOUNDING_COUPON_ID', maxSpots: 20, percentOff: 40 };

export const PLANS: Record<PlanKey, {
  limits: Record<Meter, number|null>;            // null = unlimited
  features: Record<Feature, boolean>;
  price?: Record<Currency, Record<Interval, number>>; // display, major units
  stripeUpsell: boolean;                          // false => never show Stripe/pricing (rule 1.2.1)
}> = {
  trial:   { limits:{orders:150, labels:30,  connectedStores:3,  aiCredits:100},  features:ALL_ON,  stripeUpsell:true },
  starter: { limits:{orders:500, labels:250, connectedStores:2,  aiCredits:300},  features:ALL_OFF, stripeUpsell:true,
             price:{ try:{month:2499,year:24990}, usd:{month:59, year:590} } },
  growth:  { limits:{orders:2000,labels:1000,connectedStores:5,  aiCredits:1500}, features:ALL_OFF, stripeUpsell:true,
             price:{ try:{month:4999,year:49990}, usd:{month:99, year:990} } },
  pro:     { limits:{orders:6000,labels:3000,connectedStores:10, aiCredits:5000}, features:ALL_ON,  stripeUpsell:true,
             price:{ try:{month:7999,year:79990}, usd:{month:149,year:1490} } },
  enterprise:  { limits:{orders:null,labels:null,connectedStores:null,aiCredits:null}, features:ALL_ON, stripeUpsell:false },
  // FOUNDER DECISION (see D16): proposed caps, neutral wording, no Stripe upsell
  shopify_free:{ limits:{orders:null,labels:null,connectedStores:/*non-Shopify*/1, aiCredits:300}, features:ALL_OFF, stripeUpsell:false },
};
export const PRICE_ENV = { starter:{month:'PRICE_STARTER_MONTH',year:'PRICE_STARTER_YEAR'},
  growth:{month:'PRICE_GROWTH_MONTH',year:'PRICE_GROWTH_YEAR'}, pro:{month:'PRICE_PRO_MONTH',year:'PRICE_PRO_YEAR'} };
export const LEGACY_PRICE_ENV = ['PRICE_STARTER_MONTH_LEGACY','PRICE_STARTER_YEAR_LEGACY','PRICE_GROWTH_MONTH_LEGACY','PRICE_GROWTH_YEAR_LEGACY'];
export const AI_ACTION_COST = { default:1, report:3, bulkPerItem:1, image:10, arbitrageMatchPerScan:5 } as const;
export const PRO_ARBITRAGE_SCANS_PER_DAY = 10; // new; no per-user cap exists today
export function priceIdFor(plan, interval): string|undefined
export function planFromPriceId(id): {plan:PaidPlanKey, interval:Interval, legacy:boolean}|null
export function limitsFor(user): Record<Meter,number|null> // applies User.limitOverrides
```

**Why these numbers**

- **Orders: 500 / 2,000 / 6,000.**
  - Starter has to carry a real small shop: about 15 orders a day for $59.
  - Unit price falls from about $0.12 per order on Starter to about $0.025 on Pro.
- **Labels at half the order count.** Many orders ship through Etsy or Amazon labels, or are self-fulfilled.
- **Connected stores: 2 / 5 / 10.** This is the main upgrade lever.
  - Each Etsy shop, Wix site and Shopify shop counts as one store.
  - eBay, Amazon, Trendyol and Hepsiburada count as one each.
  - Veeqo and Shippo count as one each.
  - Carriers (fedex/ups/mng) and parasut do not count.
- **AI credits: 300 / 1,500 / 5,000.**
  - Text costs 1 credit (Gemini 2.5 Flash). An image costs 10.
  - Image cost per call is an estimate, so log real cost per credit for the first month and adjust.
- **Trial: Pro features on, low caps.** It sells Pro and keeps AI cost per trial low.
- **shopify_free.** Orders and labels stay unlimited, as today. Closing D16 is a **required founder decision**. Options:
  - (a) Cap non-Shopify connected stores and AI, and use neutral "not available on the Shopify plan" wording.
  - (b) Only apply shopify_free to App Store installs (`shopify/install.ts` → callback with `appStoreInstall`). A settings-page Shopify connect then counts as a normal store under the user's own plan, which is compliant because the merchant did not come in through Shopify.
  - (c) Long term, paid Shopify tiers through the Shopify Billing API.
  - **Recommend (b) now, plus (a)'s AI cap.** Any change to the limits must match the Shopify App Store listing text.

## 2. File-by-file changes

### 2a. Entitlement core (new files)

**`lib/billing/entitlements.ts` — `getEntitlement(userId)`**
- Returns `{plan, state, limits, features, usage, periodStart, periodEnd, graceEndsAt, stripeUpsell}`.
- `state` is one of `trial | grace | active | past_due_grace | expired | shopify_free | enterprise`.
- **Shopify-free check, in one place:** `billingProvider==='shopify_free' || subscriptionPlan==='shopify_free'`. Under option (b), an active ShopifyShop alone no longer means Shopify-free. Settings (`user/settings.ts:56-59`) and checkout (`:21-32`) must call this same function (fixes D8).
- **Stripe user:** `stripeSubscriptionId != null` → state comes from `subscriptionStatus`.
  - `trialing` or `active` → `active` on the plan's limits (fixes D3).
  - `past_due` → `past_due_grace` until `graceEndsAt`, then `expired`.
- **No Stripe subscription:**
  - `trialExpiresAt > now` → `trial`.
  - Within `trialExpiresAt + 3d` → `grace`, on trial limits.
  - After that → `expired`.
- `expired` blocks sync, labels, AI, connect and Pro features. Reading existing data stays allowed.

**Usage (always monthly, anchored on `usagePeriodStart`; fixes D2)**
- **Orders:** `count(Order WHERE userId AND (uiOrderDate >= start OR (uiOrderDate IS NULL AND createdAt >= start)))`.
- **Labels:** `User.labelCount`.
- **AI credits:** `User.aiCreditCount`.
- **Connected stores:** from `getConnectionStatus()`.
- Memoize per request. Cache orders and connectedStores in-process for 30s.

**`lib/billing/meter.ts`**
- `reserveAiCredits(userId, n)`: one atomic `UPDATE "User" SET "aiCreditCount"="aiCreditCount"+$n WHERE id=$1 AND ($limit IS NULL OR "aiCreditCount"+$n <= $limit) RETURNING ...`. Zero rows means 402.
- `refundAiCredits()` in a `finally` block when the AI call fails.
- `incrementLabel()` uses the same conditional increment.
- `rollPeriodIfDue(user)` replaces `withUsageLimiter.ts:60-83`. It advances `usagePeriodStart` by one month, resets `labelCount` and `aiCreditCount`, and calls `resolveByPrefix('usage:')`.
- Optional: write `UsageLedger` rows fire-and-forget.

**`lib/billing/guard.ts`**
- `withEntitlement(handler, {meter?, feature?, cost?})` returns 402 `{error:'Payment Required', limitType, reason, used, limit, plan, feature?, neutral?}`.
- It keeps the `error`/`limitType` keys that `isLimiterBody` (`limitInterceptor.ts:130-134`) relies on.
- New `limitType` values: `aiCredit | connectedStore | feature`. New `reason` values: `expired | grace | featureLocked`.
- Helpers `requireFeature()` and `checkMeter()` cover OAuth redirects and job runners.
- `emitUsageNotifications` moves here, keyed by meter.

### 2b. Existing files

**`lib/middleware/withUsageLimiter.ts`**
- Turn it into a shim: `'label'` → `{meter:'labels'}`, `'orderSync'` → `{meter:'orders'}`.
- Delete `plans` (`:17-25`) and the trial branch (`:94-103`).
- `res.incrementUsage` becomes a no-op for orders.
- Remove the unused imports in `analytics/index.ts:4` and `analytics/marketplace.ts:4`.

**Orders**
- Remove the increment at `orders/sync.ts:195-197`.
- A manual sync is blocked once usage reaches limit × 1.10.
- `cron/sync-orders.ts:26`: load entitlements and skip `expired` users and users over limit × 1.10, raising one `usageLimitReached` notification. Apply the same to the Trendyol, Wix and Shopify blocks (`:41-64`). shopify_free is never skipped.
- **Decision:** webhook ingestion (`integrations/wix/webhook.ts`, `webhooks/etsy.ts`, `cron/process-etsy-webhooks.ts`) is left ungated in v1, so orders that buyers already placed are never lost. Enforcement is soft: the pull paths stop, and the UI shows the overage.

**Labels**
- Keep the wrappers on `labels/ups.ts:233`, `labels/mng.ts:167` and `orders/[orderId]/generate-label.ts:650`.
- Wrap `shipments/index.ts` and increment after `createShipment` (`:48`) succeeds (D7).

**AI credits (reserve before the call, refund in `finally`)**

| File | Where | Cost |
|---|---|---|
| `ai/etsy.ts` | after the rate limit (`:932-938`), dispatcher at `:951+` | `bulk_optimize` = 1 per listing; `market_analysis`, `niche_report`, `shop_spy_report`, `listing_audit` = 3; other actions 1 |
| `ai/amazon.ts` | `:389-395` | reports 3, others 1 |
| `ai/trendyol.ts` | after auth `:13` (auth already exists); also add the 30/min rate limiter | 1 per action |
| `ai/generate-image.ts` | after the API-key check (`~:96`) | 10 per image |
| `clawd/ebay-ai.ts` | dispatcher `:730` | `bulk_optimize_titles` 1 per item, others 1 |
| `clawd/etsy.ts:3472` | `analyze_keyword_ranking` | 3 |
| `trendyol/research.ts:129` | `ai_market_report` | 3 |
| Arbitrage | Gemini matching through `lib/arbitrage/matcher.ts` | Pro only; enforce a **new** `PRO_ARBITRAGE_SCANS_PER_DAY` in `clawd/arbitrage.ts` scan start and in `jobRunner`. Alternative: charge `arbitrageMatchPerScan` credits. |

Calls made with the internal API key and `x-user-id` (`getAuthUserOrApiKey`) are metered against that user.

**Connected-store limit**
- Call `checkMeter(user.id,'connectedStores')` before the OAuth redirect in:
  - `integrations/etsy/connect.ts`
  - `ebay/connect.ts`
  - `amazon/connect.ts`
  - `wix/connect.ts`
  - `shopify/connect.ts` (unless the Shopify App Store install path is in use)
- On failure, redirect to `/ayarlar?tab=connections&limit=connectedStore`.
- Re-authorizing an account that is already connected is allowed.
- **Callbacks** (defense in depth): `etsy/callback.ts:216` and `wix/callback.ts:160`. If the account is new and over the limit, save it with `isActive:false` and redirect with `limit=connectedStore`.
- **Credential providers** (Trendyol, Hepsiburada, Veeqo, Shippo): `user/settings.ts` PATCH returns 402 when a new provider would exceed the limit.

**Pro gates (server)**
- `clawd/arbitrage.ts` after `:56`. Skip the gate for `userId==='api-user'`.
- `lib/arbitrage/jobRunner.ts` / `resumeStaleJobsOnce`: before resuming a job, check `requireFeature(job.userId,'arbitrage')`. If the user has lost Pro, mark the job canceled.
- Finance handlers: put the gate right after auth in `dashboard.ts` (`:591+`), `settlements.ts` (`:2137+`) and `product-costs.ts` (`:287+`).
- `cron/sync-financials.ts:28-40`: filter the target users by `features.financials`.
- **Bulk Photo Studio:** its AI calls are covered by credit metering. The non-AI part gets a client-only gate in v1. A dedicated `etsy-drafts/bulk-media` endpoint can be added later.

**Pro gates (client)**
- `lib/hooks/useEntitlement.ts`: SWR on `/api/billing/entitlement`.
- `components/billing/ProGate.tsx`: when `stripeUpsell` is true, show a lock card and a Pro chip. When the user is shopify_free or neutral, render nothing and hide the nav entry.
- Apply it at `ebay-research.tsx:2943` and `:3104`, `pages/app/financials.tsx`, `AppLayout.js:166`, the CommandPalette filter and `BulkEditor.tsx:3476`.

**Checkout — `pages/api/stripe/create-checkout-session.ts`**
- Request body is `{plan:'starter'|'growth'|'pro', interval, currency}` (`:34-42`), and the price comes from `priceIdFor`.
- Pass `currency` to the session, using a Price with `currency_options`.
- **Currency choice:** the UI selector wins, then `User.billingCurrency` (locked once set), then the locale (tr → try, en → usd).
- Remove `trial_period_days: 30` (`:217`). If the app trial has more than 49h left, set `subscription_data.trial_end = trialExpiresAt`. Otherwise charge immediately.
- **Founding coupon:** if `STRIPE_FOUNDING_COUPON_ID` is set and Stripe `coupons.retrieve` shows `times_redeemed < max_redemptions`, add `discounts:[{coupon}]` and do not set `allow_promotion_codes`. If Stripe rejects the coupon, retry once without it.
- Metadata on the session and the subscription: `{userId, plan, interval, currency, founding}`.
- Replace the user-create fallback (`:108-140`) with a 409.
- The Shopify block uses the entitlement check.
- `success_url`: `/ayarlar?tab=billing&checkout=success`.

**Webhook — `pages/api/stripe/webhook.ts` (basil-correct)**
- New `lib/billing/syncSubscription.ts` exposes `syncSubscriptionToUser(sub, user)`. It retrieves the subscription with `expand:['discounts']` and writes:
  - `subscriptionPlan` via `planFromPriceId` (including legacy ids), `billingInterval`, `billingCurrency=sub.currency`, `subscriptionStatus`
  - `stripeSubscriptionId`, `stripePriceId`, `billingProvider:'stripe'` (fixes D1)
  - `currentPeriodEnd = sub.items.data[0].current_period_end` (basil)
  - `foundingMember` and `foundingMemberAt`, read from `sub.discounts[].coupon.id`. If the API version is later upgraded to clover, read `discount.source.coupon`.
  - It does **not** write `trialExpiresAt` for Stripe users. Store the Stripe trial end in `currentPeriodEnd`, or leave `trialExpiresAt` unchanged. That keeps the app trial and the Stripe trial apart (fixes D3/D14).
- Call it from `checkout.session.completed` (`:169-215`), `customer.subscription.updated` (`:289-317`, fixes D4) and the new `customer.subscription.created`. Add `created` to `relevantEvents` (`:68-74`).
- **Invoice events:** read the subscription id from `invoice.parent?.subscription_details?.subscription`, falling back to the legacy `invoice.subscription` (fixes D15).
  - `payment_succeeded`: clear `graceEndsAt`; no counter resets.
  - `payment_failed`: set `graceEndsAt = now + 3d` if it is null, and send a `paymentFailed` notification linking to the portal.
- `subscription.deleted`: keep the current behaviour, set `billingProvider` to null only if it was `'stripe'`, and never touch `shopify_free`.
- Verify the webhook endpoint's API version in the dashboard and make it match `lib/stripe.ts`.

**`cron/reset-usage.ts`**
- Remove the yearly reset (`:33-55`). It becomes a daily `rollPeriodIfDue` for users who are due.
- **Expired-trial sweep:** `stripeSubscriptionId IS NULL AND billingProvider IS DISTINCT FROM 'shopify_free' AND trialExpiresAt + 3d <= now` → `subscriptionStatus='expired'`. Do not null the plan (fixes D12/D14).
- Send trial-ending notifications at T-3, T-1 and the start of grace, deduped.

**Trial: `lib/billing/trial.ts` with `startTrial()`**
- Sets 14 days; no card needed.
- Used in `signup.ts:47-50` and `lib/auth.ts:51-60`.
- `shopify/callback.ts:53-66` sets `trialExpiresAt: null`.

**Shopify callback (`:247-264`)**
- `isPayingStripeCustomer = stripeSubscriptionId != null && status in (active, trialing, past_due)`.
- Apply the D16 decision: only switch to shopify_free when `appStoreInstall` is true.

**New endpoints**
- `pages/api/billing/entitlement.ts` (GET, auth): entitlement, all 4 meters, limits, features, state, `graceEndsAt`, `stripeUpsell`.
- `pages/api/billing/founding-spots.ts` (GET, public, `s-maxage=60`):
  - Primary source: Stripe coupon `max_redemptions - times_redeemed`.
  - Fallback: `20 - count(foundingMember)`.
  - Returns 0 when the env var is unset.
- Extend `UserSettingsResponse` in `lib/hooks/useSettings.ts:9-17` with `billingProvider`, `pro`, `shopify_free` and `expired`.
- Update the admin pages and `lib/admin/monitoring.ts` for `pro` and `expired`. Add `aiCreditCount`, `limitOverrides` and `foundingMember` to the admin `allowedFields` (`admin/users/[userId].ts`).

**Stripe objects and env vars the founder must create (test mode first, then live)**

| What | Details |
|---|---|
| Products | Starter, Growth, Pro |
| `PRICE_STARTER_MONTH` | TRY 2,499.00 + `currency_options.usd` 59.00 |
| `PRICE_STARTER_YEAR` | TRY 24,990 / USD 590 |
| `PRICE_GROWTH_MONTH` | TRY 4,999 / USD 99 |
| `PRICE_GROWTH_YEAR` | TRY 49,990 / USD 990 |
| `PRICE_PRO_MONTH` | TRY 7,999 / USD 149 |
| `PRICE_PRO_YEAR` | TRY 79,990 / USD 1,490 |
| Fallback (if multi-currency Prices are not allowed) | 12 Prices named `PRICE_{PLAN}_{INTERVAL}_{TRY\|USD}` |
| Tax (decision) | Prices incl. or excl. KDV/VAT, and Stripe Tax on or off. The `tax_behavior` setting on each Price must match. |
| `STRIPE_FOUNDING_COUPON_ID` | `percent_off 40`, `duration forever`, `max_redemptions 20` |
| `PRICE_{STARTER,GROWTH}_{MONTH,YEAR}_LEGACY` | Set to the current price ids before overwriting them |
| Existing, unchanged | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Webhook endpoint | Add `customer.subscription.created`; check its API version |
| Customer Portal | Switching only between the 6 new prices, prorations on, cancel at period end, invoices on |

## 3. DB changes (additive migration `prisma/migrations/20261016xxxxxx_billing_v2`)

```
aiCreditCount Int @default(0)
usagePeriodStart DateTime?
billingCurrency String?
stripeSubscriptionId String? @unique
stripePriceId String?
currentPeriodEnd DateTime?
graceEndsAt DateTime?
foundingMember Boolean @default(false)
foundingMemberAt DateTime?
limitOverrides Json?
@@index([subscriptionStatus, trialExpiresAt])
```

- Optional: `UsageLedger {id, userId, meter, amount, action, createdAt, @@index([userId, createdAt])}`.
- `'expired'` and `'pro'` are plain strings, so no enum migration is needed.
- Keep `orderSyncCount` and `usageResetAt`, marked deprecated.

## 4. Client changes

**`pages/fiyatlandirma.js` → `.tsx`**
- Prices and limits come from `PLANS`.
- TRY/USD toggle defaulting by locale; "2 ay bedava" (2 months free) on yearly.
- Four cards: Starter, Growth (highlighted), Pro, Enterprise → `/iletisim`.
- Feature matrix: the 4 meters, the 3 Pro features and the support level. Remove the user counts and API Access (D11).
- Founding banner from `/api/billing/founding-spots`, with the struck-through price; hidden at 0 spots left.
- "14 gün ücretsiz — kart gerekmez" (14 days free, no card needed).
- The shopify_free redirect (`:51-64`) is based on `stripeUpsell`.
- The English summary block (`:272-286`) is generated from `PLANS` and stays visible in every locale, for app reviewers.
- Rewrite `marketing.pricing.*` in `en.json` and `tr.json`: every 30-day string, the 15% strings, user counts and API Access; add `plans.pro`, `currency`, `founding` and an updated FAQ.

**`components/billing/PlanBadge.tsx`**
- Shows the plan, plus "Kurucu" (founding member), "Deneme · X gün" (trial, X days left) or "Ödeme bekleniyor" (payment pending).
- For shopify_free it shows "Shopify" with no link.
- Placed in the AppLayout user menu and the billing tab.

**BillingPanel / SubscriptionDashboard**
- Replace `PLAN_LIMITS` (`:50-56`) with entitlement data.
- 4 usage meters with the reset date.
- Currency and interval card, and a past-due/grace alert with a portal button.
- shopify_free keeps its current behaviour.

**TrialNotification**
- Delete `TRIAL_LIMITS` (`:21`).
- Add a grace banner that cannot be dismissed. Also show it for `expired`.

**`limitInterceptor.ts`**
- Extend `LimitType` (`:19`) and `LimitReason` (`:20`).
- `parseLimitResponse` (`:113-127`) prefers `b.reason` and `b.limitType` and reads `feature` and `neutral`.
- `inferLimitType` (`:90-99`) gets path fallbacks for `/api/ai/`, `/api/finance/` and `/api/clawd/arbitrage`.

**LimitReachedDialog**
- Remove `LIMITS` (`:21-25`) and use the entitlement endpoint (`:73`).
- Copy for each limit type.
- The CTA points to the cheapest plan that unlocks the need.
- The neutral and shopify_free path stays as it is (`:79-91`), and also honours `b.neutral`.

**Connections tab**
- Shows "N/M mağaza" (N of M stores).
- On `?tab=connections&limit=connectedStore`, open the dialog.

## 5. Migrating existing users

Run read-only counts first:

```sql
SELECT "subscriptionPlan","subscriptionStatus","billingProvider",count(*),
       count(*) FILTER (WHERE "stripeCustomerId" IS NOT NULL) with_cust
FROM "User" GROUP BY 1,2,3 ORDER BY 4 DESC;
-- D14 victims: active Stripe customers with NULL plan
SELECT id FROM "User" WHERE "stripeCustomerId" IS NOT NULL AND "subscriptionStatus"='active' AND "subscriptionPlan" IS NULL;
-- D16 exposure: shopify_free users with no App Store install / with non-Shopify stores
```

1. **Deploy the resolver first.** Null new fields fall back safely: `usagePeriodStart` falls back to `usageResetAt − 30d`, or `createdAt`.
2. **Backfill script** `scripts/billing/backfill-v2.ts` (idempotent, dry-run by default):
   - For every `stripeCustomerId`, list the subscriptions and run `syncSubscriptionToUser`. This repairs D1/D14 users.
   - Legacy subscribers keep their price and get the new limits for their plan key.
   - Marking them as founding members is optional, manual, and does not use one of the 20 coupon spots.
3. **Users currently on the 30-day trial:** keep their `trialExpiresAt`, add 3 days of grace, and move them to the new caps (150/30/3/100).
4. **Users with `canceled` and no subscription** (expired trials): set `expired`. Founder decision: a 14-day relaunch trial (recommended).
5. **shopify_free:** align `billingProvider` and `subscriptionPlan`. Under the D16 option (b), users who are shopify_free only because of a settings-page connect are listed for the founder to decide. Do not auto-downgrade them without notice.
6. **Seed** `usagePeriodStart` and `aiCreditCount = 0`.
7. **Stripe cut-over order:**
   1. Copy the current ids into the `_LEGACY` vars.
   2. Create the new Prices.
   3. Set the `PRICE_*` vars.
   4. Fix and check the webhook API version.
   5. Deploy.
   6. Configure the portal.
   7. Create the founding coupon last.

## 6. Risks

- **Turkish cards and TRY.** Stripe has no Turkish merchant accounts, so TRY is only the presentment currency and cross-border declines are likely. Test real Turkish cards in live mode early; keep iyzico/PayTR as a fallback. Check e-fatura and KDV obligations.
- **Currency lock.** A Stripe customer is locked to one currency, so lock the toggle in the UI once `billingCurrency` is set.
- **Verify in test mode** that Checkout `currency` works with `currency_options`; otherwise use the 12-price fallback.
- **API version.** Under basil, invoice and period fields have moved (D15). A future clover upgrade moves `discount.coupon` again. Pin the version and add a unit test of the parse helpers with recorded basil payloads.
- **Founding count.** It counts at subscription creation, including carried-over trials. Spots freed by cancellations never come back. Stripe's `max_redemptions` is the hard stop.
- **Order counting** depends on `uiOrderDate` or `createdAt`. Webhook-ingested orders keep arriving over the limit (soft enforcement by design).
- **Cron gating** stops sync for expired users. Notify and email them first.
- **Shopify rule 1.2.1.** Every 402, ProGate and badge path must check `stripeUpsell`. Add a Vitest test that shopify_free never gets upsell copy or a `/fiyatlandirma` link. Keep `scripts/provision-shopify-review-account.ts` working.
- **D16.** If the Shopify loophole is not closed, the tiers have no effect.
- **AI refunds** need `finally` in every handler. The in-memory rate limits are per process only.
- **Bulk Photo Studio's** non-AI gate is client-only.
- **Downgrades over the store limit** are not disconnected, only blocked from adding more. Say so in the FAQ.
- **Arbitrage.** The `CLAWD_API_KEY` path stays ungated. The job runner must check the feature before resuming a job.
- **Money paths.** Before going live, run end-to-end in test mode: checkout, upgrade through the portal, payment failure, recovery, cancel, D14 trial-end timing, and `planFromPriceId` with legacy ids.