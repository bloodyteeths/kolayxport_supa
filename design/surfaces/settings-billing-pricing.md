# Surface spec: Settings, Billing tab, public Pricing page

Status: design only, ready to build. Date: 2026-10-15. Nothing in the app was changed.
Binding inputs: `design/DESIGN_SYSTEM.md` (DS) and `design/tokens.md`. The DS wins every conflict.
Refines: `scratchpad/settings_spec.md` (the "settings spec"). Billing backend contract: `design/launch/tiers.md` (the "tiers plan": `lib/billing/plans.ts`, entitlements, webhook, checkout, migration `billing_v2`).
Code read at `kx-ux-phase0` HEAD `92087ba`: `pages/ayarlar.tsx`, `components/settings/*`, `components/SubscriptionDashboard.tsx`, `components/TrialNotification.tsx`, `components/billing/LimitReachedDialog.tsx`, `pages/fiyatlandirma.js`, `pages/faturalar.tsx`, `pages/subscribe.js`, `pages/api/stripe/*`, `pages/api/user/settings.ts`, `pages/api/cron/reset-usage.ts`, `pages/api/auth/signup.ts`, `lib/auth.ts`, `pages/api/integrations/shopify/callback.ts`, `lib/middleware/withUsageLimiter.ts`, `lib/hooks/useSettings.ts`, `lib/hooks/useConnections.ts`, `lib/integrations/connectionStatus.ts`, `lib/mng/mng.credentials.ts`, `components/AppLayout.js`, `components/PublicLayout.js`, `messages/en.json` (`subscription`, `invoices`, `settings`, `marketing.pricing`).

---

## 0. Decisions and corrections

### 0.1 What this spec changes in the settings spec (to match the final DS)

| Settings spec said | Final (DS rule) |
|---|---|
| Surfaces radius 12, card padding 20 | Card = `Section variant="card"`: radius 8 (`radius-md`), padding 16, 1px `neutral-200`, no shadow (DS §2.5–2.7) |
| Group headings "12px / 600 uppercase with tracking" | Sentence case, `caption` 12/500 `neutral-500`. **No uppercase anywhere** (P5) |
| Nav active = `slate-100` fill + 2px left accent, 36px items, radius 8 | Same selection style as `SideNav`: `neutral-0` fill, `neutral-900` text, `e1` hairline, 32px, radius 6, `label` 13/500. The left accent bar means "selected table row" only (DS §2.6) |
| `StatusPill` with free `label` and statuses `connected/attention/incomplete/off/error/syncing` | DS `StatusPill domain="connection"` with fixed keys `connected · needs_reconnect · incomplete · not_connected · check_failed` (DS §3.9). Two new domains, `subscription` and `invoice`, are added (§14) |
| "Reconnect" as a **solid amber** button | Amber is not a button color (DS §3.8 has 5 variants). Tile uses `secondary` "Reconnect"; the view's one primary is the warning `Banner` action at the top of Connections (§4.3) |
| `SideDrawerForm` 440px; bottom sheet with 16px top radius; 52px mobile top bar | DS `SidePanel size="sm"` (440), full-height sheet below 600px with 12px top radius (`radius-lg`); mobile TopBar 48px (DS §2.10, §3.5) |
| `SettingsSaveBar` rewrite, fixed above tab bar | DS `StickyActionBar` (desktop: sticky footer bar inside the content column; mobile: fixed above `--kx-bottom-nav`, 50/50 at 48px) |
| Labels-above via local MUI tricks | DS `FormField` + DS inputs; `SettingsRow` (240px label column) for Sender profile and Preferences only |
| Toasts via `hotToast` directly | `useToast()` (one visible, bottom-center, i18n text only, never raw API errors) |
| MNG drawer gets `mngAppId`, `mngAppSecret`, `mngApiEnvironment` (bug 2, "confirm the client reads them first") | **Checked: it does not.** `lib/mng/mng.credentials.ts:5-18` reads app id/secret from `MNG_APP_ID`/`MNG_APP_SECRET` env and the environment from `MNG_API_ENVIRONMENT`; the per-user column is ignored on purpose (it sent merchants to the sandbox). The DHL eCommerce panel shows **customer number + password only**. Delete the three fields from `initialFormData` and the i18n keys `settings.mngAppId/mngAppSecret/mngEnvironment` |
| Tile "MNG Kargo / DHL eCommerce" | "DHL eCommerce" only (DS glossary §3.19) |
| Billing card "Billed through Shopify" | Wrong and risky for Shopify review: Shopify merchants are not billed at all. Wording: "Included with the KolayXport Shopify app. There's nothing to pay here." |
| Billing usage: 2 meters (order syncs, labels) from `PLAN_LIMITS` | 4 meters (orders, labels, connected stores, AI credits) from `GET /api/billing/entitlement` (tiers plan). Fallback to 2 meters from the settings payload until that endpoint ships (§9.6) |
| Invoices: last 5 + link to `/faturalar` | DS moves Invoices into Settings. Full list lives in the Billing tab (`?tab=billing&invoices=all`); `/faturalar` becomes a redirect |
| Tab "Sync & Advanced", button "Full sync" | Glossary forbids "Sync" for pull. Tab label "Refresh history" / "Yenileme geçmişi"; button "Refresh all orders" / "Tüm siparişleri yenile". Tab key stays `syncAdvanced` |
| No timezone setting | DS §3.12 requires "the seller's timezone (an account setting, default Europe/Istanbul)". New tab **Preferences** (`?tab=preferences`) holds language and timezone (§7) |

### 0.2 Business rules this surface displays (from the founder brief + tiers plan; values live in `lib/billing/plans.ts`, never in UI code)

| Plan | Monthly | Yearly (2 months free) | Orders / mo | Labels / mo | Connected stores | AI credits / mo | Pro features |
|---|---|---|---|---|---|---|---|
| Trial (14 days, no card) | — | — | 150 | 30 | 3 | 100 | on |
| Starter | ₺2,499 · $59 | ₺24,990 · $590 | 500 | 250 | 2 | 300 | off |
| Growth | ₺4,999 · $99 | ₺49,990 · $990 | 2,000 | 1,000 | 5 | 1,500 | off |
| Pro | ₺7,999 · $149 | ₺79,990 · $1,490 | 6,000 | 3,000 | 10 | 5,000 | on |
| Enterprise | custom | custom | unlimited | unlimited | unlimited | unlimited | on |
| shopify_free | free, never priced | — | unlimited | unlimited | per tiers plan D16 decision | 300 | off |

- Pro features = arbitrage scanner, financials, bulk photo studio.
- Founding member: 40% off for life (Stripe coupon `percent_off 40`, `duration forever`, `max_redemptions 20`). It applies to monthly and yearly. Spots left = Stripe `max_redemptions − times_redeemed`.
- Grace: 3 days after trial end (`GRACE_DAYS`), and 3 days after a failed payment.
- **Shopify-installed merchants never see Stripe upsells**: no prices, no "Upgrade", no "Choose a plan", no invoices, no `/fiyatlandirma` link, no founding offer, no Stripe portal. The single check is `entitlement.stripeUpsell === false` (tiers plan §1). Until that endpoint ships, the check is the existing `billingProvider === 'shopify_free' || subscriptionPlan === 'shopify_free'` from `/api/user/settings` (which already folds in "has an active ShopifyShop").
- **If the viewer's billing provider is unknown** (request failed or still loading), Stripe surfaces are **not** rendered. That is the safe direction (same rule as `LimitReachedDialog.tsx:84`).

All derived prices shown in this spec (founding prices, per-month equivalents) are computed by `lib/billing/price.ts` (§2.4), never typed by hand:

| | Starter | Growth | Pro |
|---|---|---|---|
| Founding monthly | ₺1,499.40 · $35.40 | ₺2,999.40 · $59.40 | ₺4,799.40 · $89.40 |
| Founding yearly | ₺14,994 · $354 | ₺29,994 · $594 | ₺47,994 · $894 |
| Yearly per-month equivalent | ₺2,082.50 · $49.17 | ₺4,165.83 · $82.50 | ₺6,665.83 · $124.17 |

### 0.3 Defects in current billing UI code that this rebuild removes

1. Plan limits are copied in 4 UI places that disagree with the new tiers (`SubscriptionDashboard.tsx:50`, `LimitReachedDialog.tsx:21`, `TrialNotification.tsx:21`, `fiyatlandirma.js:32`). The UI reads only `lib/billing/plans.ts` / the entitlement endpoint.
2. `billing-history.ts:30` lists only `status: 'paid'` invoices. A `past_due` user cannot see the invoice they owe. It also returns `details: error.message` to the browser on 500 (`:51`).
3. `BillingPanel.tsx:33` shows an `EmptyState` titled "Settings" when data is missing, and toasts raw `response.data.error` (`:28`).
4. `fiyatlandirma.js`: purple/indigo gradients, `hover:scale-105`, framer-motion `translateY`, `uppercase tracking-wider` table headers, green "15% OFF" rotated badge, "30-day" everywhere, claims "1/5 users" and "API access" that do not exist (tiers plan D11). The Shopify redirect fires after first paint, so a Shopify merchant briefly sees Stripe prices.
5. `pages/subscribe.js` is dead: 3 fake plans at ₺149–499, posts to `/api/checkout`, which does not exist. Delete.
6. `useSettings.ts:10` subscription type has no `billingProvider`, `pro`, `shopify_free` or `expired`.

---

## 1. Information architecture

### 1.1 Routes

| Route | What | Notes |
|---|---|---|
| `/ayarlar` | Settings. Desktop: Connections. Mobile: `SettingsMobileIndex` | unchanged default |
| `/ayarlar?tab=connections\|apiKeys\|senderProfile\|billing\|syncAdvanced` | the five existing sections | **keys unchanged** (links in `lib/notifications.ts:56`, `AppLayout.js:138,263`, `create-portal-session.ts:36`, `ConnectEmptyState.tsx:41`, `pages/app/index.js:249,267`) |
| `/ayarlar?tab=preferences` | new section | additive |
| `&provider=<id>` | opens that provider's panel (`connections` or `apiKeys`). Providers with **no** panel (eBay, Wix and other OAuth-only tiles): scroll the tile into view and give it the 1.5s focus ring of §3.3; when it `needsReauth`, the tile's "Reconnect" button gets focus. Nothing starts an OAuth flow by itself (Overview queue links land here; CRITIQUE C15) | additive |
| `/ayarlar?tab=billing&invoices=all` | Billing with the full invoice list expanded | replaces `/faturalar` |
| `/ayarlar?tab=billing&checkout=success` | checkout return (tiers plan sets this `success_url`) | §9.5 |
| `/ayarlar?tab=connections&limit=connectedStore` | store limit hit during OAuth (tiers plan) | opens the store-limit Modal (§4.6) |
| `/faturalar` | **redirect** (302, `getServerSideProps`) to `/ayarlar?tab=billing&invoices=all` | shopify_free lands on billing without invoices |
| `/fiyatlandirma` | public pricing page | `?interval=month\|year&currency=try\|usd&plan=starter\|growth\|pro` restores state |
| `/subscribe` | deleted (404) | dead page |

### 1.2 Settings navigation (`SettingsLayout` nav groups)

| Group (EN / TR) | Item (EN / TR) | Key | Icon (registry) | Badge / summary |
|---|---|---|---|---|
| Workspace / Çalışma alanı | Connections / Bağlantılar | `connections` | `Plug` | warning dot when `needsReauth.length > 0`; mobile summary "4 connected · 1 needs attention" |
| | Carriers & API keys / Kargo ve API anahtarları | `apiKeys` | `KeyRound` | mobile summary "3 of 7 set up" |
| Shipping / Gönderim | Sender profile / Gönderici profili | `senderProfile` | `Warehouse` (the note below; `Package` is the Thumb placeholder, CRITIQUE C14) | attention dot when dirty |
| Account / Hesap | Plan & billing / Plan ve faturalandırma | `billing` | `CreditCard` | danger dot in `past_due_grace`/`grace`/`expired`; mobile summary "Growth · 72% of orders used". **shopify_free:** label "Plan" / "Plan", summary "Included with Shopify" |
| | Preferences / Tercihler | `preferences` | `Globe` | attention dot when dirty |
| System / Sistem | Refresh history / Yenileme geçmişi | `syncAdvanced` | `History` | danger dot when the last run failed |

Icons are new registry entries (DS §3.15; one meaning each): `Plug` = connections, `KeyRound` = credentials, `Warehouse` = sender profile, `CreditCard` = billing, `Globe` = language & region, `History` = run history. (`Package` is taken by the Thumb placeholder, and `Send` means push, so neither is used for Sender profile.)

### 1.3 Page frame

- `<Page title={t('settings.pageTitle')} width="form">`: 220px nav + 40px gap + 880px content, left-aligned (DS §3.2).
- `PageHeader title="Settings"`, subtitle "Connections, carriers, sender address and your plan" (1 line). No header actions. The TopBar shows breadcrumbs only ("Settings / Plan & billing").
- `<title>`: "Plan & billing · Settings · KolayXport" pattern via `Page title` = section label + " · " + "Settings".
- Each section starts with `Section` title (`title-md`) + description (caption, ≤ 2 lines). That is the only heading inside the content column. There is never a second "Settings" title.

---

## 2. Data contracts

### 2.1 Existing endpoints used (verified)

| Endpoint | Used by | Fields |
|---|---|---|
| `GET /api/user/settings` | `useSettings` | `integrationSettings` (masked), `shipperProfile`, `shippingSettings`, `subscription{subscriptionPlan, subscriptionStatus, billingInterval, billingProvider (effective), trialExpiresAt, usageResetAt, orderSyncCount, labelCount}` |
| `PATCH /api/user/settings` | `saveSlice` | `{ integrationSettings?, shipperProfile?, shippingSettings? }`; masked secrets are stripped server-side; undefined fields are untouched |
| `GET /api/integrations/status` | `useConnections()` | `connections[provider] = { connected, accounts[{ externalId, name, lastSyncAt, needsReauth, reason }], needsReauth, reason }`, `extension` |
| `GET/DELETE /api/integrations/amazon/status`, `DELETE /api/integrations/{ebay,wix,shopify}/status`, `POST /api/integrations/etsy/shops`, `GET /api/integrations/wix/connect`, `POST /api/integrations/wix/callback`, `/api/integrations/{etsy,ebay}/connect` | Connections panels | same flows as `ConnectionsPanel.tsx` today (moved verbatim) |
| `GET /api/sync/history?cursor=` | Refresh history | cursor pagination by `createdAt` |
| `POST /api/orders/fullSync`, `POST /api/sync/retry?id=` | Refresh history | unchanged |
| `POST /api/stripe/create-portal-session` | Billing | `{ url }`; 403 for shopify_free; 400 when no Stripe customer |
| `GET /api/stripe/billing-history` | Invoices | changed, §2.3 |
| `POST /api/stripe/create-checkout-session` | Pricing, Billing | body becomes `{ plan, interval, currency }` (tiers plan); one delta in §2.3 |

### 2.2 Endpoints from the tiers plan (billing backend track) that this surface consumes

`GET /api/billing/entitlement` (auth). The UI type, which the backend must return exactly:

```ts
// lib/billing/types.ts (shared; pure types)
export type BillingState = 'trial'|'grace'|'active'|'past_due_grace'|'expired'|'shopify_free'|'enterprise';
export type MeterKey = 'orders'|'labels'|'connectedStores'|'aiCredits';
export interface Entitlement {
  plan: 'trial'|'starter'|'growth'|'pro'|'enterprise'|'shopify_free';
  state: BillingState;
  stripeUpsell: boolean;                 // false => render no Stripe/pricing surface at all
  interval: 'month'|'year'|null;
  currency: 'TRY'|'USD'|null;            // billingCurrency, locked once set
  foundingMember: boolean;
  trialEndsAt: string|null;              // app trial (no card)
  graceEndsAt: string|null;
  currentPeriodEnd: string|null;         // next renewal / Stripe trial end
  cancelAtPeriodEnd: boolean;            // ADDITION to tiers plan, see §2.3
  period: { start: string; end: string };// usage period (monthly, also for yearly plans)
  meters: Record<MeterKey, { used: number; limit: number|null }>; // null = unlimited
  features: Record<'arbitrage'|'financials'|'bulkPhotoStudio', boolean>;
}
```

`GET /api/billing/founding-spots` (public, `Cache-Control: s-maxage=60`): `{ active: boolean; total: number; remaining: number; percentOff: number }`. `active` is false when `STRIPE_FOUNDING_COUPON_ID` is unset, the coupon is invalid, or Stripe errored. **The UI never shows a counter that did not come from this endpoint.**

### 2.3 Minimal API additions owned by this surface (Group F)

| # | Change | File | Why |
|---|---|---|---|
| A1 | `billing-history`: accept `?limit=5..100` (default 20) and `?starting_after=<invoiceId>`; drop the `status:'paid'` filter and exclude only `draft`; return `{ invoices, hasMore }`; each invoice adds `number`, `status ∈ paid\|open\|void\|uncollectible`, `plan` and `interval` (via `planFromPriceId(lines[0].pricing?.price_details?.price ?? lines[0].price?.id)`); on 500 return `{ error: 'billing_history_failed' }` with no `details` | `pages/api/stripe/billing-history.ts` | past-due users must see the open invoice; pagination for "View all"; no raw errors reach the UI; plan name rendered by us, not Stripe's English line text |
| A2 | `create-portal-session`: accept body `{ flow?: 'payment_method_update'\|'subscription_update'\|'subscription_cancel' }` and pass Stripe `flow_data` (`subscription` from `User.stripeSubscriptionId`); keep the 403/400 guards | `pages/api/stripe/create-portal-session.ts` | "Update payment method", "Change plan" and "Cancel subscription" land on the exact portal screen. Verify `flow_data` types against the pinned basil API in test mode |
| A3 | New `GET /api/stripe/billing-summary` (auth; 403 for shopify_free; `{ paymentMethod: { brand, last4, expMonth, expYear } \| null, upcoming: { amount, currency, date } \| null }`), using `customers.retrieve(expand default_payment_method / invoice_settings.default_payment_method)` and `invoices.createPreview` (basil removed the old upcoming-invoice call; verify) | `pages/api/stripe/billing-summary.ts` | payment method row and "Next payment" line. Kept out of the entitlement endpoint so the entitlement call stays DB-only and fast |
| A4 | `create-checkout-session`: accept `expectFounding?: boolean`. If true and the coupon is exhausted, return **409 `{ reason: 'founding_full' }`** instead of silently charging full price | delta to the tiers-plan rewrite of `pages/api/stripe/create-checkout-session.ts` (that track owns the file; Group F hands it this delta) | the page showed a founding price; never change the price behind the user's back |
| A5 | `cancelAtPeriodEnd Boolean @default(false)` written by `syncSubscriptionToUser` from `subscription.cancel_at_period_end` | tiers-plan migration `billing_v2` + `lib/billing/syncSubscription.ts` (delta handed to that track) | "Cancels on Nov 1" state |
| A6 | `timezone String? ` (IANA, null = `Europe/Istanbul`) on `User`; `GET /api/user/settings` returns `preferences: { timezone }`; `PATCH` accepts `preferences: { timezone }`, validated with `Intl.supportedValuesOf('timeZone')` | `prisma/migrations/20261016100000_user_timezone/`, `prisma/schema.prisma`, `pages/api/user/settings.ts` | DS §3.12 timezone setting |
| A7 | `UserSettingsResponse.subscription` adds `billingProvider`, plan keys `pro\|shopify_free`, status `expired`; adds `preferences` | `lib/hooks/useSettings.ts` (Group A owns this file; listed here for completeness) | settings spec bug 8 |

No other endpoint is added. No credential "test" endpoint in v1 (settings spec bug 9 stands: the panel shows Save only, never a fake test result).

### 2.4 Client hooks and pure libs

| File | Exports | Notes |
|---|---|---|
| `lib/billing/useEntitlement.ts` | `useEntitlement(): { data?: Entitlement; state: AsyncState; mutate }` | SWR key `/api/billing/entitlement`, `revalidateOnFocus: true`, `dedupingInterval: 30_000`. **Fallback mode** while the endpoint 404s: derives an `Entitlement` from `/api/user/settings` (`subscription`) + `PLANS` with only `orders` and `labels` meters and `stripeUpsell = !(billingProvider==='shopify_free' \|\| plan==='shopify_free')`. Remove the fallback once the endpoint ships |
| `lib/billing/useInvoices.ts` | `useInvoices({ limit })` → `{ invoices, hasMore, loadMore, state }` | `useSWRInfinite` over A1; disabled when `stripeUpsell` is false |
| `lib/billing/useFoundingSpots.ts` | `useFoundingSpots()` | SWR, `refreshInterval: 60_000`, never retries on error (shows nothing) |
| `lib/billing/price.ts` | `listPrice(plan, interval, currency)`, `foundingPrice(...)`, `perMonthEquivalent(...)`, `cheapestPlanFor(meter, needed)` | pure; computes from `PLANS`; cents-exact (`Math.round(x*100)/100`); unit-tested against §0.2 table |
| `lib/billing/billingState.ts` | `billingView(e: Entitlement, now): BillingView` | pure; returns which banner, which primary, which pill, which lines to show (the whole §9 decision table in one tested function) |
| `lib/ds/status/billing.ts` | `subscriptionStatus(e)`, `invoiceStatus(raw)` | DS status maps (§14) |

---

## 3. Settings shell

### 3.1 Desktop 1440 (Billing tab shown; other tabs use the same frame)

```
┌──────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
│ SideNav  │ Settings / Plan & billing                [⌘K Search or jump…]                 (bell) (TS)      │ TopBar 52
│ 240      ├───────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ Settings                                                                                       │ PageHeader 56
│          │ Connections, carriers, sender address and your plan                                            │
│          │                                                                                                │ 16
│          │ ┌ nav 220 ───────────┐ 40 ┌ content 880 ─────────────────────────────────────────────────────┐ │
│          │ │ Workspace          │    │ Plan & billing                                     (title-md)    │ │
│          │ │  ⌁ Connections   • │    │ Your plan, usage this month and invoices.          (caption)     │ │
│          │ │  ⚿ Carriers & API  │    │                                                                  │ │
│          │ │ Shipping           │    │ [ Plan card ]          §9                                        │ │
│          │ │  ▦ Sender profile  │    │ 32                                                               │ │
│          │ │ Account            │    │ [ Usage card ]                                                   │ │
│          │ │ ▌Plan & billing  ● │    │ 32                                                               │ │
│          │ │  ◎ Preferences     │    │ [ Included in your plan ]                                        │ │
│          │ │ System             │    │ 32                                                               │ │
│          │ │  ↺ Refresh history │    │ [ Invoices ]                                                     │ │
│          │ └────────────────────┘    └──────────────────────────────────────────────────────────────────┘ │
│          │   sticky top: 52+16                                                                            │
└──────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘
```
(`▌` = the SideNav-style selected item: white fill, `e1` hairline. `●` = danger dot, `•` = warning dot.)

### 3.2 Mobile 390

```
/ayarlar (index)                          /ayarlar?tab=billing
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ Settings                   ⌕     │ 48   │ ‹  Plan & billing                │ 48 TopBar (back → /ayarlar)
├──────────────────────────────────┤      ├──────────────────────────────────┤
│ Workspace                        │      │ 16 gutter                        │
│ ┌──────────────────────────────┐ │      │ [ Plan card ]                    │
│ │[⌁] Connections            •› │ │ 56   │ [ Usage card ]                   │
│ │    4 connected · 1 needs att.│ │      │ [ Included in your plan ]        │
│ ├──────────────────────────────┤ │      │ [ Invoices as cards ]            │
│ │[⚿] Carriers & API keys     › │ │      │                                  │
│ │    3 of 7 set up             │ │      │                                  │
│ └──────────────────────────────┘ │      ├──────────────────────────────────┤
│ Shipping                         │      │ [ Update payment method ]  48    │ StickyActionBar (only when the
│ │[▦] Sender profile          › │ │      ├──────────────────────────────────┤ view has a state-driven primary)
│ Account                          │      │  tab bar 56 + safe area          │
│ │[▭] Plan & billing        ● › │ │      └──────────────────────────────────┘
│ │    Growth · 72% of orders    │ │
│ │[◎] Preferences             › │ │
│ System                           │
│ │[↺] Refresh history         › │ │
│ tab bar                          │
└──────────────────────────────────┘
```

- Rows are 56px (icon tile 32, `label` + caption summary, chevron), separated by 1px `neutral-100`, inside a `Section variant="card"` per group.
- Desktop with no `tab` still opens Connections. Every `?tab=` deep link behaves as today on desktop and opens the drill-in on mobile.
- Back on a drill-in: `router.replace('/ayarlar')`, guarded by the dirty check.

### 3.3 Shell behavior

- `?tab=` changes use `router.replace(..., { shallow: true })`. Unknown keys fall back to `connections` (desktop) or the index (mobile).
- The OAuth `success`/`error` block in `pages/ayarlar.tsx:73-120` is kept **verbatim**, except: `hotToast.*` → `useToast()`, and after the toast the matching tile gets a 1.5s focus ring (`focusRing` token) and scrolls into view.
- Sections that need `/api/user/settings` (`apiKeys`, `senderProfile`, `preferences`) render their own skeleton; Connections, Billing and Refresh history render at once from their own hooks. No page-wide spinner (today's `CircularProgress` at `ayarlar.tsx:162` is removed).
- `useUnsavedChangesGuard(isDirty)` (settings spec §4) covers `beforeunload`, `routeChangeStart` and dirty `?tab=` changes; the confirm is the DS `ConfirmDialog` ("Discard unsaved changes?" · [Keep editing] [Discard]).

---

## 4. Connections (`?tab=connections`)

### 4.1 Layout (desktop)

```
Connections                                                          (title-md)
Connect stores, carriers and tools. KolayXport reads orders and sends tracking through these.
[! Etsy needs reconnecting. Orders from BelleCoutureGifts stopped on Oct 12.   [Reconnect Etsy]]   ← warning Banner, only if needsReauth
Stores · 4 of 5 used                                                  Compare plans ›   (caption; link hidden if !stripeUpsell)
┌──────────────────────────────────────────┐┌──────────────────────────────────────────┐   2 columns × 432 in the 880 column,
│[E] Etsy                                ⋯ ││[a] Amazon                              ⋯ │   1 column below 600
│● Connected                               ││● Reconnect needed                        │
│3 shops · Refreshed 5 min ago             ││Seller A1B2 · Authorization expired       │
│[Manage]                                  ││[Reconnect]                               │
└──────────────────────────────────────────┘└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐┌──────────────────────────────────────────┐
│[e] eBay                                ⋯ ││[T] Trendyol                            ⋯ │
│○ Not connected                           ││◐ Setup incomplete                        │
│Orders, listings, research                ││Supplier ID missing                       │
│[Connect eBay]                            ││[Finish setup]                            │
└──────────────────────────────────────────┘└──────────────────────────────────────────┘
Shipping
[F] FedEx  ● Connected  · Account ••••5678  [Manage]      [U] UPS ○ Not connected [Set up]
[D] DHL eCommerce  ◐ Setup incomplete  [Finish setup]
Accounting
[P] Paraşüt  ○ Not connected  [Set up]
Tools
[C] Chrome extension  ● Connected · Last activity 2h ago      (readonly; "Install extension" link when not detected)
```

- Content is 880 wide, so the tile grid is **2 columns** (each 432px, 16px gap) and 1 column below 600px. (The settings spec's 3-column grid only fits wider content.)
- Group headings: `caption` 12/500 `neutral-500`, sentence case, 24px above, 8px below.
- Tile: `Section variant="card"`, min-height 120, padding 16. Row 1: `LogoTile size=32` + name (`title-sm`) + `OverflowMenu` (`IconButton` sm, label "More actions for Etsy"). Row 2: `StatusPill domain="connection"`. Row 3: one-line meta (caption, ellipsis). Row 4: one `secondary` `Button` size sm (32; 44 on coarse pointer).
- Shipping/Accounting/Tools tiles use the same tile component (no separate "list" style).

### 4.2 Tile content per state

| Data (`useConnections().get(p)`) | Pill | Meta line | Button |
|---|---|---|---|
| `isLoading && !connections` | skeleton pill | skeleton bar | none |
| `!connected`, `reason !== 'incomplete_credentials'` | `not_connected` | registry one-liner ("Orders, listings, research") | "Connect {name}" (oauth) / "Set up" (credentials) |
| `!connected`, `reason === 'incomplete_credentials'` | `incomplete` | "Supplier ID missing" (from the registry's required-field check) | "Finish setup" |
| `connected && needsReauth` | `needs_reconnect` | `reason` → "Authorization expired" / "Incomplete credentials" | "Reconnect" |
| `connected` | `connected` | Etsy: "3 shops" or shop name; others: account name · `DateText relative` of max `accounts[].lastSyncAt` ("Refreshed 5 min ago"). If older than 24h: text in `warning-fg` **followed by an inline ghost link "Refresh all orders"** (the same confirm and `POST /api/orders/fullSync` as the ⋯ item), which closes visual finding #35 "Last sync 3 weeks ago with no sync action" (CRITIQUE V3) | "Manage" |
| `connError && !connections` | — | whole grid replaced by `ErrorState variant="page"` "Couldn't check your connections" + Retry (never "Not connected") | — |
| `connError && connections` | `check_failed` on each tile | last known meta | as last known |
| Hepsiburada (readonly) | `not_connected` | "Set up by our support team" | ghost "Contact support" → `/support` |
| Wix polling (from `useWixInstallPoll`, logic moved verbatim) | `not_connected` | info text "Waiting for Wix… 0:42" in place of meta; on timeout "Didn't hear back from Wix" | "Check again" (+ ⋯ "Open Wix install again") |

Overflow (⋯) per tile, in this order: "Refresh all orders" (connected only; calls `POST /api/orders/fullSync` with the existing confirm; there is no per-provider refresh endpoint and the label says "all" honestly) · "Reconnect" · "View setup guide" → `/app/entegrasyonlar-ve-rehberler#<id>` · divider · `danger-ghost` "Disconnect {name}…" (oauth; same `runDisconnect` flow and endpoints as today) or "Remove credentials…" (credential providers; PATCH empty strings for that provider's fields after `ConfirmDialog`).

### 4.3 The one primary

Connections has **no page primary**. When `needsReauth.length > 0`, a warning `Banner` at the top carries the single action: one provider → "Reconnect {name}"; several → "Review 2 connections" (scrolls to the first flagged tile). Tile buttons are all `secondary`.

### 4.4 Panels (all `SidePanel size="sm"`, sheet below 600)

| Panel | Opened by | Body | Footer |
|---|---|---|---|
| Etsy shops | Etsy "Manage" | Info `Banner` (one line): Etsy API restriction text (moved from the page top). One `SettingsRow` per shop: name, mono "Shop ID 12345678", `DateText` last refresh, pill, row ⋯ (Reconnect, Disconnect…) | secondary "Close" · primary "Connect another shop" (hidden when stores meter is full; then a caption "Store limit reached · Compare plans", link hidden if `!stripeUpsell`) |
| Amazon | Amazon "Connect"/"Manage" | marketplace multiselect (`Combobox multiple`), current seller id; keeps the `amazonLoading \|\| amazonError` guard | secondary "Cancel" · primary "Connect Amazon" / "Save marketplaces" |
| Shopify | Shopify "Connect" | `FormField` "Store address" + `TextField suffix=".myshopify.com"` | secondary "Cancel" · primary "Connect Shopify" |
| Provider credentials | credential tiles, `apiKeys` rows, `&provider=` | §5.2 | §5.2 |

### 4.5 Data per element

| Element | Source |
|---|---|
| Tiles, pills, meta | `useConnections()` (`/api/integrations/status`) + `lib/settings/integrations.ts` registry |
| Amazon marketplaces | `GET /api/integrations/amazon/status` |
| "Stores · 4 of 5 used" | `entitlement.meters.connectedStores` (hidden in fallback mode, because the settings payload has no store meter) |
| Reauth banner | `useConnections().needsReauth` |

### 4.6 Store-limit return (`&limit=connectedStore`)

`Modal size="sm"`: title "You've used all 5 store slots"; body "Growth includes 5 connected stores. Disconnect a store or move to Pro for 10." Footer: secondary "Not now" · primary "Compare plans" → `/fiyatlandirma?plan=pro`. **shopify_free / unknown provider:** title "Store limit reached", body "Disconnect a store to add a new one.", only primary "OK". The param is stripped after showing.

---

## 5. Carriers & API keys (`?tab=apiKeys`)

### 5.1 List

```
Carriers & API keys                                                                (title-md)
Keys for services that don't use a "Connect" button. They're stored encrypted.
Marketplaces
┌──────────────────────────────────────────────────────────────────────────────────────┐
│[T] Trendyol    ◐ Setup incomplete   API key ••••1234 · Supplier ID 123456  [Configure]│ 56 row
│[V] Veeqo       ○ Not connected                                             [Set up]   │
│[S] Shippo      ● Connected          Token ••••9f2a                         [Configure]│
└──────────────────────────────────────────────────────────────────────────────────────┘
Shipping
│[F] FedEx       ● Connected          Account ••••5678                       [Configure]│
│[U] UPS         ○ Not connected                                             [Set up]   │
│[D] DHL eCommerce ○ Not connected                                           [Set up]   │
Accounting
│[P] Paraşüt     ○ Not connected                                             [Set up]   │
```

- `SettingsRow` per provider inside one card per group; `leading` = `LogoTile 32`; the masked hint is caption mono. Mobile: the row stacks (logo + name + pill on line 1, hint on line 2, button full-width 44 on line 3).
- No page save bar on this tab. Every save goes through the panel.

### 5.2 Provider credentials panel (`ProviderCredentialsPanel`, `SidePanel sm`)

```
┌──────────────────────────────────────── 440 ┐
│[T] Trendyol        ◐ Setup incomplete    ✕ │ header 56
│ Orders, questions and finance from Trendyol │ caption
├─────────────────────────────────────────────┤
│ [! Fix 1 field to continue]                 │ danger Banner, only after a failed save
│ API key                                     │ FormField label 13/500
│ [••••1234                         ] 👁      │ CredentialField (mask logic unchanged)
│ Saved. Type a new key to replace it.        │ helper 12
│ API secret                                  │
│ [                                 ] 👁      │
│ ⓧ Enter the API secret too                  │ error 12 danger-fg
│ Supplier ID                                 │
│ [123456          ]  (short width 240)       │
│ Where do I find these? ↗                    │ Link
├─────────────────────────────────────────────┤
│ Unsaved changes          [Cancel] [Save]    │ footer 64 (saveState)
└─────────────────────────────────────────────┘
```

Field map (registry `fields`; `*` secret):

| Provider | Fields |
|---|---|
| Trendyol | `trendyolApiKey*`, `trendyolApiSecret*`, `trendyolSupplierId` (digits only) |
| Veeqo | `veeqoApiKey*` |
| Shippo | `shippoToken*` |
| FedEx | `fedexApiKey*`, `fedexApiSecret*`, `fedexAccountNumber` (trimmed) |
| UPS | `upsApiKey*`, `upsApiSecret*`, `upsAccountNumber` (trimmed) |
| DHL eCommerce | `mngCustomerNumber`, `mngPassword*` (**only these two**, §0.1) |
| Paraşüt | `parasutClientId`, `parasutClientSecret*`, `parasutUsername`, `parasutPassword*`, `parasutCompanyId` (no base URL / redirect URI: they were never saved) |

Behavior:
- Key/Secret pairs sit side by side ≥ 600px (DS natural pair rule); otherwise stacked.
- Validation on blur and on Save: required-together (any field filled → all required filled, mirrors the server's `incomplete_credentials`), digits for Trendyol supplier ID. Save stays enabled; on errors it focuses the first one and shows the summary Banner.
- Save → `saveSlice('integrationSettings', fieldNames)` → toast "Trendyol keys saved" → `useConnections().mutate()` → `refetch()` settings (values come back masked) → close. Error: inline danger `Banner` "Couldn't save. Your keys weren't changed." + toast with Retry. The button shows "Saving…" and keeps its width.
- Close/Esc with dirty fields → nested `ConfirmDialog` (z 1550) "Discard changes?" · [Keep editing] [Discard].
- ⌘S saves, ⌘↵ saves, Esc closes.
- New credential provider that would exceed the store meter: PATCH returns 402 (tiers plan); the panel shows the §4.6 Modal content inline as a warning Banner instead of closing.

---

## 6. Sender profile (`?tab=senderProfile`)

Unchanged content from the settings spec §3.4, on DS parts:

```
Sender profile                                                                   (title-md)
This address prints on every label and customs form.
┌ Business ────────────────────────────────────────────────────────────────────────────┐
│ Company name          [Modsons Yazılım E-Ticaret Ltd. Şti.        ]  (label col 240)  │
│ Authorized person     [Tamer S.                   ]                                   │
│ Phone                 [🇹🇷 +90 ▾][532 000 00 00   ]   PhoneInput                       │
│ Tax number            [1234567890  ] [VKN ▾]           natural pair                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ Address ─────────────────────────────────────────────────────────────────────────────┐
│ Address line 1 · Address line 2 (optional) · City | State/region (optional)           │
│ Postal code | Country [🇹🇷 Türkiye (TR) ▾]  CountrySelect                              │
│ Label preview   ┌ mono 13, neutral-50 box ───────────────┐                            │
│                 │ MODSONS YAZILIM … (as printed)           │  formatted with toLocaleUpperCase('tr') only if the carrier needs caps
│                 └──────────────────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ Customs & currency ─ Default currency [₺ TRY ▾] (CurrencySelect, TRY first for TR) · Duties paid by · Shipping paid by · FedEx folder ID (optional)
┌ Importer of record (optional) ─ collapsed row + [Edit] (ImporterFormCollapsible untouched; importerJsonError inline)
┌ ETGB ─ Switch "Send ETGB documents automatically"; Recipient email shows when on (validated); collapsed for EN locale (config.etgbProminence)
StickyActionBar (only when dirty):  Unsaved changes            [Discard]  [Save changes]
```

- Default currency picker: `initialFormData.shipperProfile.defaultCurrencyCode` is `'USD'` today; the field's empty-state default becomes `TRY` when `useLocale().config.currencyListFirst === 'TRY'` (DS §3.7 "prefill the seller's base currency"). Stored values are never overwritten.
- Required: company, person, phone, tax number + type, address 1, city, postal code, country. "(optional)" on the rest; no asterisks.
- Save → `saveSlice` with `shipperProfile` and `shippingSettings`. Load error → `ErrorState inline` "Couldn't load your sender profile" + Retry (today: plain `Alert`, no retry).

---

## 7. Preferences (`?tab=preferences`, new)

```
Preferences                                                                    (title-md)
Language and the timezone used for ship-by times and reports.
┌───────────────────────────────────────────────────────────────────────────────┐
│ Language            ( English | Türkçe )        SegmentedControl, applies now  │
│                     Applies to this browser.                                   │
│ Timezone            [Europe/Istanbul (GMT+3)            ▾]  Combobox, search   │
│                     Ship-by times and daily reports use this timezone.         │
└───────────────────────────────────────────────────────────────────────────────┘
StickyActionBar when timezone is dirty:  Unsaved changes   [Discard] [Save changes]
```

- Language writes `useLocaleStore.setLocale` immediately (same as the avatar menu today; no save needed, helper says so).
- Timezone: options from `Intl.supportedValuesOf('timeZone')`, label "Europe/Istanbul (GMT+3)" computed client-side; default `Europe/Istanbul` when null. Saved via A6. `useFormatters()` reads it (DS §3.12).
- States: skeleton rows; load error → `ErrorState inline`.

---

## 8. Refresh history (`?tab=syncAdvanced`)

```
Refresh history                                                         [Refresh all orders]  ← Section action (secondary)
Every time KolayXport imported orders from your stores.
Last successful refresh: today 10:42 · Etsy, eBay, Trendyol                 (caption)
┌ DataTable (compact 36) ─────────────────────────────────────────────────────────────────┐
│ Type                │ Status      │ Started        │ Duration │ Orders (new/ok/failed) │ ⋯ │
│ Scheduled refresh   │ ● Done      │ Today 10:42    │   1m 12s │        120 / 118 / 2   │ ⋯ │
│ Manual refresh      │ ● Failed    │ 14 Oct 18:03   │      9s  │          0 / 0 / 0     │ ⋯ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

Columns: Type (`settings.refresh.types.<rawType>`, raw value in the tooltip) · Status (`StatusPill domain="run"`, added in §14: `completed` success, `running` info, `failed` danger; the `sync` domain means pushing staged drafts and is not reused) · Started (`DateText datetime`) · Duration (computed `finishedAt − startedAt`, `Num` + unit) · Orders "120 / 118 / 2" tabular · row ⋯ "View errors" (opens `SyncErrorsPanel`, SidePanel md, read-only rows "message · order #"; footer secondary "Copy error details" copies the JSON) and "Retry" (confirm). Footer: "Load more" (cursor). Mobile: cards (title = type, status pill, meta = started · duration, trailing = orders).

- "Refresh all orders" keeps the `useConfirm` dialog. It is `secondary` (the tab has no primary; it is not state-driven). While running: "Refreshing…" in the Section meta, button disabled with reason "A refresh is already running".
- Empty: `EmptyState first-use` "No refreshes yet" + action "Refresh all orders". Error: `ErrorState inline` + Retry.
- No danger zone (no account deletion is invented).

---

## 9. Plan & billing (`?tab=billing`)

### 9.1 Desktop wireframe (Growth, monthly, founding member, 82% of labels)

```
Plan & billing                                                                          (title-md)
Your plan, usage this month and invoices.

┌ Plan ───────────────────────────────────────────────────────────────────────────────────────────┐
│ Growth   ● Active                                                       [Change plan]   ⋯       │ title-md + StatusPill; Change plan = secondary
│ Billed monthly in TRY · ₺2.999,40 / ay   ₺4.999  (struck, neutral-400)                          │ body
│ Founding member · 40% off for life                                                             │ caption accent-700, Sparkle-free, text only
│ Next payment ₺2.999,40 on 1 Kas                                                                 │ caption (A3)
│ ───────────────────────────────────────────────────────────────────────────────────────────────│ 1px neutral-100
│ Payment method   Visa •••• 4242 · expires 08/28                                  Update ›       │ SettingsRow (A3); link-style ghost
│ Billing details  Name, address and tax ID on your invoices                       Edit in Stripe ↗ │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
   ⋯ = Compare plans · Manage billing in Stripe ↗ · ─── · Cancel subscription… (danger-ghost)

┌ Usage this period ─────────────────────────────────────────────── Resets on 1 Kas · in 17 days ┐
│ Orders                                     1,442 / 2,000                                       │ UsageMeter
│ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱                                                     │
│ Labels                                       820 / 1,000                                       │ amber ≥ 80%
│ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱                                                     │
│ ! 82% of your labels are used. Pro includes 3,000 a month.   Compare plans ›                    │ caption warning-fg, one line
│ Connected stores                                 4 / 5                         Manage stores ›  │
│ AI credits                                   610 / 1,500                                       │
│ A text action uses 1 credit, an image uses 10.                                                 │ caption
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Included in your plan ─────────────────────────────────────────────────────────────────────────┐
│ Arbitrage scanner          Pro plan                                       See Pro ›            │ KeyValueList, 2 columns
│ Financials                 Pro plan                                                            │
│ Bulk photo studio          Pro plan                                                            │
│ Listing editor, bulk editor, research, shipping labels      Included                           │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Invoices ─────────────────────────────────────────────────────────────────────────── View all ┐
│ Date      │ Invoice      │ Plan                  │        Amount │ Status    │                │ DataTable compact
│ 1 Eki     │ KX-0012      │ Growth · 1 Eki–1 Kas  │    ₺2.999,40 │ ● Paid    │  ⤓  ↗          │ ⤓ = IconButton "Download PDF", ↗ = "Open invoice"
│ 1 Eyl     │ KX-0011      │ Growth · 1 Eyl–1 Eki  │    ₺2.999,40 │ ● Paid    │  ⤓  ↗          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Width: everything inside the 880 content column. Money via `Money` (tr-TR `₺2.999,40`; en-US `₺2,999.40`), dates via `DateText`. No ISO codes in cells.

### 9.2 Mobile 390 (trial, 2 days left: state-driven primary)

```
┌──────────────────────────────────┐
│ ‹  Plan & billing                │
├──────────────────────────────────┤
│ ┌ Plan ────────────────────────┐ │
│ │ Free trial   ● Trial         │ │
│ │ Ends Fri 17 Oct · 2 days left│ │ warning-fg (≤ 3 days)
│ │ All Pro features included.   │ │
│ │ No card on file.             │ │
│ │ [ Compare plans ]  (secondary)│ │ full width 44
│ └──────────────────────────────┘ │
│ ┌ Usage this trial ────────────┐ │
│ │ Orders            96 / 150   │ │
│ │ ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱               │ │
│ │ Labels             12 / 30   │ │
│ │ Connected stores    2 / 3    │ │
│ │ AI credits        41 / 100   │ │
│ └──────────────────────────────┘ │
│ (Invoices card hidden: no Stripe │
│  customer → nothing to show)     │
├──────────────────────────────────┤
│ [      Choose a plan       ] 48  │ StickyActionBar → /fiyatlandirma?from=billing
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```

Invoice rows on mobile render as DataTable cards: title = plan · period, subtitle = invoice number (mono), trailing = Money, status = pill, action = "Download PDF" (44).

### 9.3 State table (output of `billingView()`; every row has a unit test)

| State (`entitlement`) | Plan card title · pill | Lines | Banner inside Plan card | View primary (desktop: in card, right; mobile: StickyActionBar) | Secondary / ⋯ | Invoices card |
|---|---|---|---|---|---|---|
| `trial` (> 3 days) | "Free trial" · `subscription.trial` (info) | "Ends 29 Oct · 14 days left" · "All Pro features included. No card on file." | — | "Choose a plan" → `/fiyatlandirma?from=billing` | — | hidden if no Stripe customer, else shown |
| `trial` (≤ 3 days) | same | days line in `warning-fg` | — | same | — | same |
| `grace` | "Free trial" · `subscription.grace` (warning) | — | warning: "Your trial ended. Choose a plan by 31 Oct to keep importing orders and creating labels." | "Choose a plan" | — | as above |
| `expired` | "No plan" · `subscription.expired` (danger) | "Your data is safe. Importing orders, labels and AI are paused." | danger: "Your account is paused." | "Choose a plan" | — | shown if any invoices |
| `active` (starter/growth/pro) | plan name · `subscription.active` (success) | interval + currency + price (founding: discounted + struck list price) · founding line · "Next payment … on …" (A3; line hidden if A3 fails) | — | none, **unless** a meter ≥ 80%: then "Change plan" becomes primary | "Change plan" (portal `subscription_update`) · ⋯ Compare plans · Manage billing in Stripe · Cancel subscription… | shown |
| `active` + `cancelAtPeriodEnd` | plan name · `subscription.canceling` (warning) | "Cancels on 1 Kas. You keep Growth until then." | — | "Keep my plan" (portal `subscription_update`; Stripe's portal offers "renew") | ⋯ Manage billing in Stripe | shown |
| `past_due_grace` | plan name · `subscription.past_due` (danger) | — | danger: "Your last payment failed. Update your card by 18 Oct to keep importing orders." | "Update payment method" (portal `payment_method_update`) | ⋯ Manage billing in Stripe | shown, open invoice first |
| `enterprise` | "Enterprise" · `subscription.active` | "Managed by your account manager." | — | none | ghost "Contact us" → `/iletisim` | shown if any |
| `shopify_free` | "Shopify plan" · no pill | "Included with the KolayXport Shopify app. There's nothing to pay here." | — | none | none (no portal, no compare, no pricing link) | **never rendered** |
| provider unknown (entitlement error and settings error) | — | — | `ErrorState inline` "Couldn't load your plan" + Retry, **no Stripe actions** | none | none | not rendered |

Rules:
- The Plan card never shows more than one Banner. Past-due wins over near-limit.
- "Cancel subscription…" opens the portal `subscription_cancel` flow (Stripe owns the confirmation; no second KolayXport confirm).
- Founding members switching plans keep the coupon (Stripe keeps subscription-level discounts on price changes; verify in test mode). The card copy never promises it beyond "40% off for life".

### 9.4 Usage card rules

- `UsageMeter { label, used, limit }`; `limit === null` → "Unlimited" text, no bar. Amber ≥ 80%, red ≥ 100% (DS §4.2).
- Header meta: "Resets on {date} · in {n} days" from `entitlement.period.end`. Yearly plans still reset monthly (tiers plan D2 fix); the meta says so implicitly by showing the monthly date.
- One caption line per meter at most:
  - ≥ 80%: "82% of your labels are used." + if `stripeUpsell`: " {Plan} includes {limit} a month. Compare plans ›" (next plan from `cheapestPlanFor`).
  - ≥ 100% orders: "Limit reached. Scheduled imports pause at 2,200 (110%)." (tiers plan soft enforcement: `OVERAGE_BUFFER`).
  - ≥ 100% labels/AI: "Limit reached. New labels are paused until {date}."
  - shopify_free: same facts, no plan names, no links.
- Connected stores row: right link "Manage stores ›" → `?tab=connections`.
- Fallback mode (entitlement 404): Orders + Labels only, labelled "Order imports" (counts API runs today; tiers plan D6) and "Labels"; caption under the card: "Detailed usage will appear here soon." (removed with the fallback).
- Trial: card title "Usage this trial".

### 9.5 Checkout return (`?checkout=success`)

1. Strip the param, then `mutate()` the entitlement.
2. If the plan already shows the new paid plan → toast "You're on Growth now."
3. Otherwise show an info Banner in the Plan card "Confirming your payment with Stripe…" and poll every 3s for up to 30s (webhook latency). Success → toast as above. Timeout → info Banner "Payment received. Your plan will update within a few minutes." + [Refresh] (ghost). Never claim failure: Stripe already accepted the payment.

### 9.6 Invoices card

- Data: `useInvoices({ limit: 5 })`; "View all" sets `?invoices=all` and switches the card to `limit: 20` with "Load more" (`starting_after`); the card title gets the count when known.
- Columns: Date (`DateText date`) · Invoice (mono `number`, `CopyText`) · Plan (`billing.planName.<plan>` · period range) · Amount (`Money`, right, tabular) · Status (`StatusPill domain="invoice"`) · actions: inline `IconButton` "Download PDF" (`invoicePdf`) + `IconButton` "Open invoice" (`hostedInvoiceUrl`, new tab). Row click = open invoice.
- Open invoice in `past_due_grace` is sorted first and its row action is "Pay now" (`hostedInvoiceUrl`) as the inline action instead of download.
- Empty: `EmptyState first-use` "No invoices yet" · "Invoices appear here after your first payment." (no action).
- Error: `ErrorState inline` "Couldn't load invoices" + Retry + error ID. The rest of Billing stays usable.
- Hidden entirely when `stripeUpsell` is false or unknown.

### 9.7 Data per element

| Element | Source | Field |
|---|---|---|
| Title, pill, state lines, banner, primary | `useEntitlement` → `billingView()` | `plan, state, trialEndsAt, graceEndsAt, cancelAtPeriodEnd, stripeUpsell` |
| Price line | `lib/billing/price.ts` | `plan, interval, currency, foundingMember` |
| Next payment | A3 `billing-summary.upcoming` | `amount, currency, date` |
| Payment method | A3 `billing-summary.paymentMethod` | `brand, last4, expMonth, expYear` |
| Meters, reset date | entitlement | `meters.*, period.end` |
| Included features | entitlement + `PLANS` | `features.*` |
| Invoices | A1 | `invoices[], hasMore` |
| Portal actions | A2 | `{ flow }` → `{ url }`; 403 → toast "Billing is managed elsewhere for this account." (never raw text) |

### 9.8 Loading and errors (Billing)

| Region | Loading (after 200ms) | 15s | 30s / error |
|---|---|---|---|
| Plan card | `PanelSkeleton` (title bar, 3 lines) | "Still loading… Retry" | `ErrorState inline` "Couldn't load your plan" (no Stripe actions rendered) |
| Usage card | 4 meter skeletons | same | `ErrorState inline` "Couldn't load usage" |
| Payment method / next payment rows | text skeleton | — | rows hidden silently (A3 is optional detail; the plan card stays) |
| Invoices | `TableSkeleton rows=3` | same | `ErrorState inline` |

---

## 10. Public pricing page (`/fiyatlandirma`)

### 10.1 Layout rules (public page; justified use of the DS)

- Rendered in `PublicLayout` (marketing nav/footer stay; the framer-motion page transition in `PublicLayout.js` is out of scope). Content max width 1280 (`layout.maxDetail`), 24px gutters desktop, 16 mobile. Background `neutral-50`; cards `neutral-0` with 1px border.
- Uses DS tokens and components only: `Button`, `SegmentedControl`, `Section variant="card"`, `Money`, `Num`, `Tooltip`, `Modal`, `Skeletons`. No gradients, no `motion` hover lift, no colored badges, no uppercase, weights ≤ 600.
- Page H1 uses `display` (28/36) — the one place outside KPI tiles where `display` is used, because a public page has no PageHeader. This is recorded as a DS addition in §14.
- Recommended plan (Growth) = 1px `accent-600` border + caption "Most popular" in `accent-700` above the name. Not a pill (pills are statuses only).

### 10.2 Desktop 1440

```
┌ PublicNav ───────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       (content 1280, centered)                                            │
│ Pricing                                                                       (display 28/36, 600)        │
│ Orders, labels, listings and research for Etsy, eBay, Amazon, Trendyol and more.                (body)   │
│ 14 days free. No card needed.                                                          (body, neutral-700)│
│                                                                                                           │
│ ( Monthly | Yearly · 2 months free )        ( ₺ TRY | $ USD )                     SegmentedControl md 40  │
│ Founding member offer: 40% off for life for our first 20 subscribers · 7 of 20 spots left   (caption)    │
│                                                                                                           │
│ ┌ Starter ──────────────┐ ┌ Most popular ─────────┐ ┌ Pro ──────────────────┐ ┌ Enterprise ───────────┐ │
│ │ For one or two stores │ │ Growth                │ │ For multi-store teams │ │ For high volume and   │ │ 4 × 296, gap 16
│ │                       │ │ For growing shops on  │ │ that need finance and │ │ custom setups         │ │
│ │ ₺1.499,40 /ay         │ │ every marketplace     │ │ arbitrage             │ │                       │ │
│ │ ₺2.499 (struck)       │ │ ₺2.999,40 /ay         │ │ ₺4.799,40 /ay         │ │ Custom pricing        │ │ display 28 tabular
│ │ Founding price, for   │ │ ₺4.999 (struck)       │ │ ₺7.999 (struck)       │ │                       │ │
│ │ life                  │ │ Founding price, life  │ │ Founding price, life  │ │                       │ │
│ │ [Start free trial]    │ │ [Start free trial]    │ │ [Start free trial]    │ │ [Talk to us]          │ │ secondary / PRIMARY / secondary / secondary
│ │ ─────────────────     │ │ ─────────────────     │ │ ─────────────────     │ │ ─────────────────     │ │
│ │ 500 orders a month    │ │ 2,000 orders a month  │ │ 6,000 orders a month  │ │ Unlimited orders      │ │ Num
│ │ 250 labels a month    │ │ 1,000 labels a month  │ │ 3,000 labels a month  │ │ Unlimited labels      │ │
│ │ 2 connected stores    │ │ 5 connected stores    │ │ 10 connected stores   │ │ Unlimited stores      │ │
│ │ 300 AI credits        │ │ 1,500 AI credits      │ │ 5,000 AI credits      │ │ Unlimited AI          │ │
│ │ ✓ Listing & bulk edit │ │ ✓ Everything in Start.│ │ ✓ Everything in Growth│ │ ✓ Everything in Pro   │ │ ✓ neutral-700, 16px
│ │ ✓ Shipping labels     │ │                       │ │ ✓ Arbitrage scanner   │ │ ✓ Dedicated contact   │ │
│ │ ✓ Research tools      │ │                       │ │ ✓ Financials          │ │                       │ │
│ │                       │ │                       │ │ ✓ Bulk photo studio   │ │                       │ │
│ │                       │ │                       │ │ ✓ Priority support    │ │                       │ │
│ └───────────────────────┘ └───────────────────────┘ └───────────────────────┘ └───────────────────────┘ │
│ Prices include KDV. (or: "Prices exclude KDV." — founder decision, §18)                     (caption)    │
│                                                                                                           │
│ Compare plans                                                                       (title-lg 20)        │
│ ┌──────────────────────────────┬────────────┬────────────┬────────────┬────────────┐                     │ MUI Table via DS styles,
│ │                              │ Starter    │ Growth     │ Pro        │ Enterprise │                     │ sticky header 36,
│ │ Orders a month (?)           │        500 │      2,000 │      6,000 │  Unlimited │                     │ rows 44, numbers right
│ │ Labels a month (?)           │        250 │      1,000 │      3,000 │  Unlimited │                     │
│ │ Connected stores (?)         │          2 │          5 │         10 │  Unlimited │                     │
│ │ AI credits a month (?)       │        300 │      1,500 │      5,000 │  Unlimited │                     │
│ │ Marketplaces                 │ All        │ All        │ All        │ All        │                     │
│ │ Carriers: FedEx, UPS, DHL eC.│ ✓          │ ✓          │ ✓          │ ✓          │                     │
│ │ Listing editor, bulk editor  │ ✓          │ ✓          │ ✓          │ ✓          │                     │
│ │ Research tools               │ ✓          │ ✓          │ ✓          │ ✓          │                     │
│ │ Arbitrage scanner            │ —          │ —          │ ✓          │ ✓          │                     │ "—" = not included
│ │ Financials                   │ —          │ —          │ ✓          │ ✓          │                     │
│ │ Bulk photo studio            │ —          │ —          │ ✓          │ ✓          │                     │
│ │ Support                      │ Email      │ Email      │ Priority   │ Dedicated  │                     │
│ └──────────────────────────────┴────────────┴────────────┴────────────┴────────────┘                     │
│ (?) = TermHint: "An order counts once, when it's imported." / "Each Etsy shop, eBay account, Amazon       │
│       account, Trendyol account… counts as one store. Carriers don't count." / "A text action uses 1      │
│       credit, an image uses 10."                                                                          │
│                                                                                                           │
│ Questions                                                         (title-lg; reading width 720)           │
│ How does the free trial work?                                                    (title-sm)               │
│ You get 14 days with Pro features and no card. …                                 (body)                   │
│ … 6 questions, all visible (no accordion) …                                                               │
│                                                                                                           │
│ Pricing summary (English)        lang="en"                                     (title-sm, caption body)   │
│ Starter ₺2,499/month (₺24,990/year) or $59/month ($590/year): 500 orders, 250 labels, 2 stores…           │
│                                                                                                           │
│ Need more than Pro?  Talk to us about Enterprise.                [Talk to us]  (secondary)                │
└ PublicFooter ─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Card widths at 1280: 4 × 296 + 3 × 16 = 1232. At 900–1199: 2 × 2 grid. Below 900: one column (§10.3).
- Yearly view: price shows the yearly amount "₺24.990 /yıl" and a caption "₺2.082,50 a month · 2 months free". With founding: "₺14.994 /yıl", struck "₺24.990", caption "Founding price, for life · ₺1.249,50 a month".
- Founding line hidden → cards show list prices only, no struck price, no "Founding price" caption.
- Spots ≤ 5: the count part reads "Only 3 spots left" in `warning-fg`. Never animated, never a countdown timer.

### 10.3 Mobile 390

```
┌──────────────────────────────────┐
│ PublicNav                        │
├──────────────────────────────────┤
│ Pricing                          │ display 28
│ 14 days free. No card needed.    │
│ (Monthly | Yearly · 2 mo free)   │ full width 44
│ ( ₺ TRY | $ USD )                │ full width 44
│ Founding offer: 40% off for life │
│ · 7 of 20 spots left             │
│ ┌ Most popular ────────────────┐ │ Growth first on mobile (recommended), then Starter, Pro, Enterprise
│ │ Growth                       │ │
│ │ ₺2.999,40 /ay  ₺4.999        │ │
│ │ [   Start free trial    ] 48 │ │ primary
│ │ 2,000 orders · 1,000 labels  │ │
│ │ 5 stores · 1,500 AI credits  │ │
│ └──────────────────────────────┘ │
│ ┌ Starter … [Start free trial] ┐ │ secondary
│ ┌ Pro …     [Start free trial] ┐ │
│ ┌ Enterprise   [Talk to us]    ┐ │
│ Compare plans                    │
│ ( Starter | Growth | Pro | Ent ) │ SegmentedControl picks ONE column; table = 2 cols (feature, value)
│ Orders a month         2,000     │
│ Labels a month         1,000     │
│ …                                │
│ Questions …                      │
└──────────────────────────────────┘
```

No horizontal scroll: the 4-column comparison table is desktop-only; mobile shows one plan's column at a time (justified in §14).

### 10.4 CTA by viewer (one decision function `pricingCta(viewer, plan)` in `lib/billing/billingState.ts`)

| Viewer | Starter/Growth/Pro button | Click |
|---|---|---|
| Anonymous | "Start free trial" | `/login?mode=signup&callbackUrl=/app&plan=…&interval=…&currency=…` (signup starts the 14-day no-card trial; **no checkout**) |
| Signed in, `trial`/`grace`/`expired` | "Choose {Plan}" | `POST create-checkout-session { plan, interval, currency, expectFounding }` → `window.location.assign(url)`; button "Opening checkout…"; if the trial has > 49h left the backend sets `trial_end = trialExpiresAt` and the card caption under the button reads "You won't be charged until 29 Oct." |
| Signed in, `active` on this plan + interval | "Current plan" (disabled, reason "You're on this plan") | — |
| Signed in, `active` on another plan | "Switch to {Plan}" | `POST create-portal-session { flow: 'subscription_update' }` |
| Signed in, `past_due_grace` | "Update payment first" (disabled, reason) for all; a danger `Banner` above the cards: "Your last payment failed." + [Update payment method] | portal `payment_method_update` |
| `stripeUpsell === false` (shopify_free) | — | **page is not rendered**: `router.replace('/ayarlar?tab=billing')` before paint (see §10.5) |
| Signed in, provider unknown (settings/entitlement error) | "Start free trial"-style anonymous CTAs are **not** shown; buttons render disabled with reason "Couldn't check your account. Reload to continue." | — |

Enterprise is always "Talk to us" → `/iletisim?subject=enterprise` (secondary). The single primary on the page is the recommended plan's button (Growth), or for a signed-in active user the button for the next plan up (computed), so P1 holds.

Currency rules: default from the UI locale (`tr` → TRY, `en` → USD); URL `?currency=` overrides; a signed-in user with `entitlement.currency` set sees the toggle locked to it with tooltip "Your account is billed in TRY." (Stripe customers are single-currency; tiers plan risk). Interval and currency are mirrored into the URL with `router.replace(shallow)` so the "back from login" flow (today's `?plan=&interval=` restore at `fiyatlandirma.js:67-80`) keeps working and gains `currency`.

Founding race (A4): checkout 409 `founding_full` → `Modal sm` "The founding spots just ran out" · body "Growth is ₺4.999 a month. Continue to checkout?" · [Not now] [Continue] (re-posts with `expectFounding: false`). The founding line is re-fetched and disappears.

Errors: 401 → login redirect (unchanged); 403 → toast "This account can't buy a plan here." (no Shopify wording in the toast: the reason can also be enterprise/admin); other failures → toast "Couldn't open checkout. Try again." with Retry. Never raw server text.

### 10.5 Shopify-free gating on the pricing page (no flash)

- `getServerSideProps` stays out (the page must stay cacheable/SEO). Instead: if a NextAuth session cookie is present on the client (`useAuth().session`), the plan-card CTA area and the founding line render `Skeleton` until `useEntitlement` resolves. If `stripeUpsell === false` → `router.replace('/ayarlar?tab=billing')` and the page body keeps showing the skeleton (no prices ever painted with a CTA for that user).
- Anonymous visitors see the full page immediately (SSR-friendly; prices are static from `PLANS`).
- When a session exists, the **whole plans section** (prices, CTAs, founding line) is a skeleton until the entitlement resolves, so a shopify_free user never sees a price, even for one frame. The header and the comparison table (limits only, no money) can render at once.
- The FAQ and the English summary contain prices, so they are part of the gated region too.

### 10.6 Data per element

| Element | Source |
|---|---|
| Prices, limits, features, support row | `PLANS` (`lib/billing/plans.ts`, pure, client-safe; Stripe price ids stay server-only in `lib/billing/stripePrices.server.ts`) |
| Founding line, founding prices | `useFoundingSpots()` (`/api/billing/founding-spots`) + `price.ts` |
| CTA state | `useAuth().session` + `useEntitlement()` |
| Trial-carry caption | `entitlement.trialEndsAt` |
| Tax note | `PLANS.taxIncluded` boolean (founder decision; one i18n key per value) |

### 10.7 States

| Region | Loading | Empty / off | Error |
|---|---|---|---|
| Founding line | 16px caption skeleton (height reserved, no layout jump) | `active:false` or `remaining:0` → line and founding prices hidden | hidden (never a guessed count) |
| Plan CTAs (signed in) | button skeletons 40 | — | disabled with reason (§10.4) |
| Checkout | button "Opening checkout…" keeps width; other plan buttons disabled | — | toast + Retry; 409 founding Modal |

### 10.8 SEO and copy

- `title`: "Pricing · KolayXport" / "Fiyatlandırma · KolayXport"; `description` built from `PLANS` ("From ₺2,499 a month. 14 days free, no card."). The OG image `og-pricing.png` stays.
- Remove every claim tiers plan D11 lists: users per plan, "API access", "15% off", "30-day".
- Marketplace names are text only (brand plan); no third-party logos on the pricing page.

---

## 11. Shopify gating matrix (the test list)

| Surface | shopify_free / `stripeUpsell:false` | Provider unknown |
|---|---|---|
| Settings nav label | "Plan" (not "Plan & billing"), summary "Included with Shopify" | "Plan & billing", no summary |
| Plan card | §9.3 shopify_free row: no Stripe button, no compare, no ⋯ | ErrorState, no Stripe button |
| Usage captions | facts only, no plan names, no links | card error |
| Included-in-plan card | locked rows read "Not included", no "See Pro" link | hidden |
| Invoices card | not rendered | not rendered |
| Connections store meter link "Compare plans" | hidden | hidden |
| Store-limit Modal | neutral copy, only "OK" | neutral copy |
| ⌘K actions (Manage subscription, Compare plans, View invoices) | not registered | not registered |
| `/fiyatlandirma` | redirect to `/ayarlar?tab=billing`, prices never painted | CTAs disabled |
| `/faturalar` | redirect to `/ayarlar?tab=billing` (invoices card absent) | same redirect |

Vitest: render each component with a shopify_free fixture and assert no element contains `/fiyatlandirma`, "Stripe", a currency symbol, or a `create-portal-session`/`create-checkout-session` call (spy on `fetch`).

---

## 12. Interactions and keyboard

- Global: ⌘K, `?`, Esc as DS. `g` then `s` (via palette) goes to Settings.
- `usePageActions` registrations per tab: Connections — "Connect a store" (goto, scrolls to first `not_connected` marketplace); Billing (only if `stripeUpsell`) — "Manage subscription", "Update payment method", "Compare plans", "View invoices"; Refresh history — "Refresh all orders". Nothing reachable only from the palette.
- Forms (Sender profile, Preferences, credential panel): ⌘S save, ⌘↵ save (panel primary), Esc closes panel (dirty guard). Shortcuts ignore inputs except Esc/⌘S/⌘↵.
- Focus: opening a panel focuses its first field; closing returns focus to the tile/row button; nav items use `aria-current="page"`; the mobile index rows are links.
- Toasts (i18n, ≤ 80 chars): saved, connected, disconnected, plan changed. No toast for validation or when a pill already changed.
- No optimistic UI for credentials or billing; everything re-reads from the server (`mutate()`).
- Nothing auto-saves to a marketplace or to Stripe.

---

## 13. All states at a glance

| Surface | Loading | Empty | Error | Partial |
|---|---|---|---|---|
| Settings shell | per-section skeletons (no page spinner) | — | per section | sections independent |
| Connections grid | tile skeletons (logo square + 2 bars) | n/a (catalog always renders) | page ErrorState if no cache | cached + `check_failed` pills + stale `ErrorState variant="stale"` "Showing status from 10:42 · Retry" |
| Etsy panel | row skeletons | "No Etsy shops yet" + Connect | inline | — |
| Credential panel | field skeletons until `initialDataLoaded` | — | inline danger Banner on save failure | — |
| Credentials list | row skeletons | n/a | inline | — |
| Sender profile | form skeleton | — | inline + Retry | — |
| Preferences | row skeletons | — | inline | — |
| Refresh history | 5 row skeletons | "No refreshes yet" + Refresh all orders | inline + Retry | "Load more" failure → inline row "Couldn't load more · Retry" |
| Billing | §9.8 | invoices "No invoices yet" | §9.8 | A3 rows hidden; fallback-mode meters |
| Pricing | founding + CTA skeletons | founding off → hidden | CTA disabled with reason | — |

All async regions use `useAsyncState` (200ms delay, 15s "Still loading… Retry", 30s ErrorState).

---

## 14. Additions to the design system (justified; add to DESIGN_SYSTEM.md in the same PR)

| Addition | Where | Why it is needed and why existing parts don't fit |
|---|---|---|
| `StatusPill domain="subscription"`: `trial` Trial/Deneme (info) · `grace` Grace period/Ek süre (warning) · `active` Active/Aktif (success) · `canceling` Cancels soon/İptal edilecek (warning) · `past_due` Payment failed/Ödeme başarısız (danger) · `expired` Paused/Durduruldu (danger) · `near_limit` Near limit/Limite yakın (warning) · `trial_ending` Trial ending/Deneme bitiyor (warning). The last two serve the Overview queue, which no longer defines its own `account` domain (CRITIQUE C7) | DS §3.9 table + `lib/ds/status/billing.ts` | the pill vocabulary is closed by design; billing states have no existing key |
| `StatusPill domain="invoice"`: `paid` Paid/Ödendi (success) · `open` Unpaid/Ödenmedi (warning) · `void` Voided/İptal edildi (neutral) · `uncollectible` Not collected/Tahsil edilemedi (danger) | same | same |
| `StatusPill domain="run"`: `completed` Done/Tamamlandı (success) · `running` Running/Çalışıyor (info, pulsing) · `failed` Failed/Başarısız (danger) | same | refresh runs are pull jobs; the `sync` domain means push of staged drafts and must not be reused |
| Icons `Plug`, `KeyRound`, `Warehouse`, `CreditCard`, `Globe`, `History` | DS §3.15 registry | one meaning each; no existing registry icon covers them |
| `Money { wholeIfIntegral?: boolean }` | DS §4.4 | price lists read "₺2.499" not "₺2.499,00"; founding prices with cents still show cents. Only `PricingCard`, the Billing price line and Modal copy use it |
| `display` type token for a public page H1 | DS §2.2 | public pages have no PageHeader; 28/36 is the largest token, no new size |
| Public page frame: `PublicLayout` + 1280 max width + DS tokens | DS §3.2 note | `<Page>` belongs to the app shell |
| Mobile comparison = `SegmentedControl` column picker | DS §3.4 note | `DataTable` cards are for record lists; a plan matrix needs one column at a time to avoid horizontal scroll |
| Reviewer summary exception to P5 | DS P5 | Shopify/Etsy reviewers need an English pricing summary on `/fiyatlandirma` in every locale. Keys `marketing.pricing.reviewerSummary.*` hold **English in both en.json and tr.json** and the block has `lang="en"`. It is the only allowed English block on a TR screen |
| `SettingsRow` already in DS (§4.2) — no change | — | — |

Domain compositions (not DS components; built only from DS parts): `components/domain/settings/*`, `components/domain/billing/*`, `components/domain/pricing/*`.

---

## 15. i18n keys (EN + TR)

Rules: sentence case, real Turkish characters, glossary wording, ICU plurals. Existing namespaces kept where they still fit: `settings.oauth.*`, `settings.credential.*` (mask helpers), `settings.countryCodes/currencyCodes`, sender field labels (`settings.companyName` … `settings.customsDutyPayment`), `settings.etgb*`, `settings.disconnectKeepsData`, `settings.wix*` poll strings, `settings.etsyApiLimited*`. Everything below is new. Status keys go under the DS `status.*` namespace.

### 15.1 `settings.*` (new)

| Key | EN | TR |
|---|---|---|
| `settings.pageSubtitle` (rewrite) | Connections, carriers, sender address and your plan | Bağlantılar, kargo firmaları, gönderici adresi ve planınız |
| `settings.nav.group.workspace` | Workspace | Çalışma alanı |
| `settings.nav.group.shipping` | Shipping | Gönderim |
| `settings.nav.group.account` | Account | Hesap |
| `settings.nav.group.system` | System | Sistem |
| `settings.nav.connections` | Connections | Bağlantılar |
| `settings.nav.apiKeys` | Carriers & API keys | Kargo ve API anahtarları |
| `settings.nav.senderProfile` | Sender profile | Gönderici profili |
| `settings.nav.billing` | Plan & billing | Plan ve faturalandırma |
| `settings.nav.billingShopify` | Plan | Plan |
| `settings.nav.preferences` | Preferences | Tercihler |
| `settings.nav.syncAdvanced` | Refresh history | Yenileme geçmişi |
| `settings.nav.summary.connections` | {connected} connected{attention, plural, =0 {} other { · # needs attention}} | {connected} bağlı{attention, plural, =0 {} other { · # dikkat gerektiriyor}} |
| `settings.nav.summary.apiKeys` | {done} of {total} set up | {total} servisten {done} tanesi kurulu |
| `settings.nav.summary.billing` | {plan} · {percent} of orders used | {plan} · siparişlerin %{percent} kullanıldı |
| `settings.nav.summary.billingShopify` | Included with Shopify | Shopify ile dahil |
| `settings.back` | Back to settings | Ayarlara dön |
| `settings.unsaved.title` | Discard unsaved changes? | Kaydedilmemiş değişiklikler silinsin mi? |
| `settings.unsaved.keep` | Keep editing | Düzenlemeye devam et |
| `settings.unsaved.discard` | Discard | Sil |
| `settings.saveBar.status` | Unsaved changes | Kaydedilmemiş değişiklikler |
| `settings.saveBar.discard` | Discard | Vazgeç |
| `settings.saveBar.save` | Save changes | Değişiklikleri kaydet |
| `settings.saveBar.saving` | Saving… | Kaydediliyor… |
| `settings.connections.title` | Connections | Bağlantılar |
| `settings.connections.description` | Connect stores, carriers and tools. KolayXport reads orders and sends tracking through these. | Mağazalarınızı, kargo firmalarınızı ve araçlarınızı bağlayın. KolayXport siparişleri bunlar üzerinden okur ve takip numaralarını bunlar üzerinden gönderir. |
| `settings.connections.group.marketplaces` | Stores | Mağazalar |
| `settings.connections.group.shipping` | Shipping | Kargo |
| `settings.connections.group.accounting` | Accounting | Muhasebe |
| `settings.connections.group.tools` | Tools | Araçlar |
| `settings.connections.storesUsed` | Stores · {used} of {limit} used | Mağazalar · {limit} haktan {used} tanesi kullanılıyor |
| `settings.connections.comparePlans` | Compare plans | Planları karşılaştır |
| `settings.connections.reauthBanner.one` | {provider} needs reconnecting. Orders from {account} stopped on {date}. | {provider} yeniden bağlanmalı. {account} siparişleri {date} tarihinde durdu. |
| `settings.connections.reauthBanner.many` | {count} connections need attention. | {count} bağlantı dikkat gerektiriyor. |
| `settings.connections.reauthBanner.reconnect` | Reconnect {provider} | {provider} hesabını yeniden bağla |
| `settings.connections.reauthBanner.review` | Review {count} connections | {count} bağlantıyı incele |
| `settings.connections.loadFailed` | Couldn't check your connections | Bağlantılarınız kontrol edilemedi |
| `settings.connections.stale` | Showing status from {time} | {time} itibarıyla durum gösteriliyor |
| `settings.connections.action.connect` | Connect {provider} | {provider} bağla |
| `settings.connections.action.setUp` | Set up | Kur |
| `settings.connections.action.finishSetup` | Finish setup | Kurulumu tamamla |
| `settings.connections.action.reconnect` | Reconnect | Yeniden bağla |
| `settings.connections.action.manage` | Manage | Yönet |
| `settings.connections.action.contactSupport` | Contact support | Destekle iletişime geç |
| `settings.connections.action.checkAgain` | Check again | Tekrar kontrol et |
| `settings.connections.menu.more` | More actions for {provider} | {provider} için diğer işlemler |
| `settings.connections.menu.refreshAll` | Refresh all orders | Tüm siparişleri yenile |
| `settings.connections.menu.guide` | View setup guide | Kurulum rehberini aç |
| `settings.connections.menu.disconnect` | Disconnect {provider}… | {provider} bağlantısını kes… |
| `settings.connections.menu.removeCredentials` | Remove credentials… | Bilgileri kaldır… |
| `settings.connections.removeConfirm.title` | Remove {provider} credentials? | {provider} bilgileri kaldırılsın mı? |
| `settings.connections.removeConfirm.body` | KolayXport stops using {provider} until you add them again. Your past data stays. | Tekrar ekleyene kadar KolayXport {provider} kullanmaz. Geçmiş verileriniz silinmez. |
| `settings.connections.meta.shops` | {count, plural, one {# shop} other {# shops}} | {count} mağaza |
| `settings.connections.meta.refreshed` | Refreshed {time} | {time} yenilendi |
| `settings.connections.meta.lastActivity` | Last activity {time} | Son etkinlik {time} |
| `settings.connections.meta.notDetected` | Not detected in this browser | Bu tarayıcıda bulunamadı |
| `settings.connections.meta.installExtension` | Install extension | Eklentiyi yükle |
| `settings.connections.meta.supportManaged` | Set up by our support team | Destek ekibimiz tarafından kurulur |
| `settings.connections.meta.missingField` | {field} missing | {field} eksik |
| `settings.connections.meta.wixWaiting` | Waiting for Wix… {elapsed} | Wix bekleniyor… {elapsed} |
| `settings.connections.reason.authExpired` | Authorization expired | Yetki süresi doldu |
| `settings.connections.reason.incomplete` | Incomplete credentials | Bilgiler eksik |
| `settings.connections.blurb.etsy` | Orders, listings, research | Siparişler, ilanlar, araştırma |
| `settings.connections.blurb.ebay` | Orders, listings, research | Siparişler, ilanlar, araştırma |
| `settings.connections.blurb.amazon` | Orders and finance | Siparişler ve finans |
| `settings.connections.blurb.shopify` | Orders and products | Siparişler ve ürünler |
| `settings.connections.blurb.wix` | Orders, products and messages | Siparişler, ürünler ve mesajlar |
| `settings.connections.blurb.trendyol` | Orders, questions and finance | Siparişler, sorular ve finans |
| `settings.connections.blurb.hepsiburada` | Orders | Siparişler |
| `settings.connections.blurb.veeqo` | Orders from Veeqo channels | Veeqo kanallarından siparişler |
| `settings.connections.blurb.shippo` | Orders and labels | Siparişler ve etiketler |
| `settings.connections.blurb.fedex` | International labels and rates | Uluslararası etiketler ve fiyatlar |
| `settings.connections.blurb.ups` | International labels and rates | Uluslararası etiketler ve fiyatlar |
| `settings.connections.blurb.mng` | Turkey domestic labels | Yurt içi etiketler |
| `settings.connections.blurb.parasut` | Invoices to Paraşüt | Paraşüt'e faturalar |
| `settings.connections.blurb.chrome` | Sends tracking to Etsy and fills buyer details | Takip numarasını Etsy'ye gönderir, alıcı bilgilerini tamamlar |
| `settings.connections.etsyPanel.title` | Etsy shops | Etsy mağazaları |
| `settings.connections.etsyPanel.shopId` | Shop ID {id} | Mağaza ID {id} |
| `settings.connections.etsyPanel.connectAnother` | Connect another shop | Başka bir mağaza bağla |
| `settings.connections.etsyPanel.limitReached` | Store limit reached | Mağaza sınırına ulaşıldı |
| `settings.connections.amazonPanel.connect` | Connect Amazon | Amazon bağla |
| `settings.connections.amazonPanel.save` | Save marketplaces | Pazaryerlerini kaydet |
| `settings.connections.shopifyPanel.storeAddress` | Store address | Mağaza adresi |
| `settings.connections.shopifyPanel.connect` | Connect Shopify | Shopify bağla |
| `settings.connections.storeLimit.title` | You've used all {limit} store slots | {limit} mağaza hakkının tamamını kullandınız |
| `settings.connections.storeLimit.body` | {plan} includes {limit} connected stores. Disconnect a store or move to {nextPlan} for {nextLimit}. | {plan} planı {limit} bağlı mağaza içerir. Bir mağazanın bağlantısını kesin ya da {nextLimit} mağaza için {nextPlan} planına geçin. |
| `settings.connections.storeLimit.neutralTitle` | Store limit reached | Mağaza sınırına ulaşıldı |
| `settings.connections.storeLimit.neutralBody` | Disconnect a store to add a new one. | Yeni bir mağaza eklemek için bir mağazanın bağlantısını kesin. |
| `settings.connections.storeLimit.notNow` | Not now | Şimdi değil |
| `settings.connections.storeLimit.ok` | OK | Tamam |
| `settings.credentials.title` | Carriers & API keys | Kargo ve API anahtarları |
| `settings.credentials.description` | Keys for services that don't use a "Connect" button. They're stored encrypted. | "Bağla" düğmesi olmayan servislerin anahtarları. Şifrelenmiş olarak saklanır. |
| `settings.credentials.configure` | Configure | Düzenle |
| `settings.credentials.whereToFind` | Where do I find these? | Bunları nerede bulurum? |
| `settings.credentials.save` | Save | Kaydet |
| `settings.credentials.cancel` | Cancel | Vazgeç |
| `settings.credentials.saved` | {provider} keys saved | {provider} anahtarları kaydedildi |
| `settings.credentials.saveFailed` | Couldn't save. Your keys weren't changed. | Kaydedilemedi. Anahtarlarınız değişmedi. |
| `settings.credentials.fixFields` | {count, plural, one {Fix 1 field to continue} other {Fix # fields to continue}} | Devam etmek için {count} alanı düzeltin |
| `settings.credentials.requiredWith` | Enter the {field} too | {field} alanını da girin |
| `settings.credentials.digitsOnly` | Use digits only | Yalnızca rakam kullanın |
| `settings.credentials.field.mngCustomerNumber` | Customer number | Müşteri numarası |
| `settings.credentials.field.mngPassword` | Password | Şifre |
| `settings.sender.title` | Sender profile | Gönderici profili |
| `settings.sender.description` | This address prints on every label and customs form. | Bu adres her etikette ve gümrük formunda yazdırılır. |
| `settings.sender.group.business` | Business | İşletme |
| `settings.sender.group.address` | Address | Adres |
| `settings.sender.group.customs` | Customs & currency | Gümrük ve para birimi |
| `settings.sender.group.importer` | Importer of record | Kayıtlı ithalatçı |
| `settings.sender.group.etgb` | ETGB | ETGB |
| `settings.sender.labelPreview` | Label preview | Etiket önizlemesi |
| `settings.sender.etgbSwitch` | Send ETGB documents automatically | ETGB belgelerini otomatik gönder |
| `settings.sender.optional` | (optional) | (isteğe bağlı) |
| `settings.sender.edit` | Edit | Düzenle |
| `settings.sender.loadFailed` | Couldn't load your sender profile | Gönderici profiliniz yüklenemedi |
| `settings.preferences.title` | Preferences | Tercihler |
| `settings.preferences.description` | Language and the timezone used for ship-by times and reports. | Dil ve kargo son tarihleri ile raporlarda kullanılan saat dilimi. |
| `settings.preferences.language` | Language | Dil |
| `settings.preferences.languageHelp` | Applies to this browser right away. | Bu tarayıcıda hemen uygulanır. |
| `settings.preferences.timezone` | Timezone | Saat dilimi |
| `settings.preferences.timezoneHelp` | Ship-by times and daily reports use this timezone. | Kargo son tarihleri ve günlük raporlar bu saat dilimini kullanır. |
| `settings.preferences.saved` | Preferences saved | Tercihler kaydedildi |
| `settings.refresh.title` | Refresh history | Yenileme geçmişi |
| `settings.refresh.description` | Every time KolayXport imported orders from your stores. | KolayXport'un mağazalarınızdan sipariş aktardığı her seferi gösterir. |
| `settings.refresh.refreshAll` | Refresh all orders | Tüm siparişleri yenile |
| `settings.refresh.refreshing` | Refreshing… | Yenileniyor… |
| `settings.refresh.alreadyRunning` | A refresh is already running | Zaten bir yenileme çalışıyor |
| `settings.refresh.lastSuccess` | Last successful refresh: {time} · {sources} | Son başarılı yenileme: {time} · {sources} |
| `settings.refresh.col.type` | Type | Tür |
| `settings.refresh.col.status` | Status | Durum |
| `settings.refresh.col.started` | Started | Başlangıç |
| `settings.refresh.col.duration` | Duration | Süre |
| `settings.refresh.col.orders` | Orders (new / ok / failed) | Siparişler (yeni / başarılı / hatalı) |
| `settings.refresh.viewErrors` | View errors | Hataları gör |
| `settings.refresh.retry` | Retry | Tekrar dene |
| `settings.refresh.copyErrors` | Copy error details | Hata ayrıntılarını kopyala |
| `settings.refresh.errorsTitle` | Errors in this refresh | Bu yenilemedeki hatalar |
| `settings.refresh.empty.title` | No refreshes yet | Henüz yenileme yok |
| `settings.refresh.empty.body` | Connect a store, then refresh to import your orders. | Bir mağaza bağlayın, ardından siparişlerinizi aktarmak için yenileyin. |
| `settings.refresh.loadFailed` | Couldn't load refresh history | Yenileme geçmişi yüklenemedi |
| `settings.refresh.types.scheduled` | Scheduled refresh | Zamanlanmış yenileme |
| `settings.refresh.types.manual` | Manual refresh | Elle yenileme |
| `settings.refresh.types.full` | Full refresh | Tam yenileme |

(`settings.refresh.types.*`: one key per raw `SyncHistory.type` value found in production; the integrator runs `SELECT DISTINCT type FROM "SyncHistory"` and adds any missing key. Unknown types fall back to the raw value in the tooltip and "Refresh" as the label.)

### 15.2 `billing.*` (new namespace; replaces `subscription.*` and `invoices.*`)

| Key | EN | TR |
|---|---|---|
| `billing.title` | Plan & billing | Plan ve faturalandırma |
| `billing.titleShopify` | Plan | Plan |
| `billing.description` | Your plan, usage this month and invoices. | Planınız, bu ayki kullanımınız ve faturalarınız. |
| `billing.planName.trial` | Free trial | Ücretsiz deneme |
| `billing.planName.starter` | Starter | Starter |
| `billing.planName.growth` | Growth | Growth |
| `billing.planName.pro` | Pro | Pro |
| `billing.planName.enterprise` | Enterprise | Enterprise |
| `billing.planName.shopify_free` | Shopify plan | Shopify planı |
| `billing.planName.none` | No plan | Plan yok |
| `billing.plan.billedMonthly` | Billed monthly in {currency} | Aylık, {currency} olarak faturalandırılır |
| `billing.plan.billedYearly` | Billed yearly in {currency} | Yıllık, {currency} olarak faturalandırılır |
| `billing.plan.perMonth` | {price} / month | {price} / ay |
| `billing.plan.perYear` | {price} / year | {price} / yıl |
| `billing.plan.founding` | Founding member · 40% off for life | Kurucu üye · ömür boyu %40 indirim |
| `billing.plan.nextPayment` | Next payment {amount} on {date} | Sonraki ödeme: {date} · {amount} |
| `billing.plan.trialEnds` | Ends {date} · {days, plural, one {# day left} other {# days left}} | {date} tarihinde bitiyor · {days} gün kaldı |
| `billing.plan.trialIncludes` | All Pro features included. No card on file. | Tüm Pro özellikleri dahil. Kayıtlı kart yok. |
| `billing.plan.canceling` | Cancels on {date}. You keep {plan} until then. | {date} tarihinde iptal edilecek. O tarihe kadar {plan} planınız devam eder. |
| `billing.plan.expired` | Your data is safe. Importing orders, labels and AI are paused. | Verileriniz güvende. Sipariş aktarımı, etiketler ve AI duraklatıldı. |
| `billing.plan.enterprise` | Managed by your account manager. | Hesap yöneticiniz tarafından yönetilir. |
| `billing.plan.shopify` | Included with the KolayXport Shopify app. There's nothing to pay here. | KolayXport Shopify uygulamasına dahildir. Burada ödenecek bir şey yok. |
| `billing.banner.grace` | Your trial ended. Choose a plan by {date} to keep importing orders and creating labels. | Denemeniz bitti. Sipariş aktarmaya ve etiket oluşturmaya devam etmek için {date} tarihine kadar bir plan seçin. |
| `billing.banner.expired` | Your account is paused. | Hesabınız duraklatıldı. |
| `billing.banner.pastDue` | Your last payment failed. Update your card by {date} to keep importing orders. | Son ödemeniz başarısız oldu. Sipariş aktarmaya devam etmek için kartınızı {date} tarihine kadar güncelleyin. |
| `billing.banner.confirming` | Confirming your payment with Stripe… | Ödemeniz Stripe ile doğrulanıyor… |
| `billing.banner.confirmTimeout` | Payment received. Your plan will update within a few minutes. | Ödeme alındı. Planınız birkaç dakika içinde güncellenecek. |
| `billing.action.choosePlan` | Choose a plan | Plan seç |
| `billing.action.comparePlans` | Compare plans | Planları karşılaştır |
| `billing.action.changePlan` | Change plan | Planı değiştir |
| `billing.action.keepPlan` | Keep my plan | Planımı koru |
| `billing.action.updatePayment` | Update payment method | Ödeme yöntemini güncelle |
| `billing.action.manageInStripe` | Manage billing in Stripe | Faturalandırmayı Stripe'ta yönet |
| `billing.action.cancel` | Cancel subscription… | Aboneliği iptal et… |
| `billing.action.contactUs` | Contact us | Bize ulaşın |
| `billing.action.refresh` | Refresh | Yenile |
| `billing.action.opening` | Opening… | Açılıyor… |
| `billing.paymentMethod.label` | Payment method | Ödeme yöntemi |
| `billing.paymentMethod.card` | {brand} •••• {last4} · expires {month}/{year} | {brand} •••• {last4} · son kullanma {month}/{year} |
| `billing.paymentMethod.update` | Update | Güncelle |
| `billing.details.label` | Billing details | Fatura bilgileri |
| `billing.details.help` | Name, address and tax ID on your invoices | Faturalarınızdaki ad, adres ve vergi numarası |
| `billing.details.edit` | Edit in Stripe | Stripe'ta düzenle |
| `billing.usage.title` | Usage this period | Bu dönemdeki kullanım |
| `billing.usage.titleTrial` | Usage this trial | Deneme süresindeki kullanım |
| `billing.usage.resets` | Resets on {date} · in {days, plural, one {# day} other {# days}} | {date} tarihinde sıfırlanır · {days} gün sonra |
| `billing.usage.meter.orders` | Orders | Siparişler |
| `billing.usage.meter.ordersLegacy` | Order imports | Sipariş aktarımları |
| `billing.usage.meter.labels` | Labels | Kargo etiketleri |
| `billing.usage.meter.connectedStores` | Connected stores | Bağlı mağazalar |
| `billing.usage.meter.aiCredits` | AI credits | AI kredisi |
| `billing.usage.unlimited` | Unlimited | Sınırsız |
| `billing.usage.near` | {percent} of your {meter} are used. | {meter} hakkınızın %{percent} kadarı kullanıldı. |
| `billing.usage.nearUpsell` | {plan} includes {limit} a month. | {plan} planı ayda {limit} içerir. |
| `billing.usage.ordersOver` | Limit reached. Scheduled imports pause at {cap}. | Sınıra ulaşıldı. Zamanlanmış aktarımlar {cap} siparişte durur. |
| `billing.usage.paused` | Limit reached. Paused until {date}. | Sınıra ulaşıldı. {date} tarihine kadar duraklatıldı. |
| `billing.usage.aiHelp` | A text action uses 1 credit, an image uses 10. | Bir metin işlemi 1, bir görsel 10 kredi kullanır. |
| `billing.usage.manageStores` | Manage stores | Mağazaları yönet |
| `billing.usage.soon` | Detailed usage will appear here soon. | Ayrıntılı kullanım yakında burada görünecek. |
| `billing.usage.loadFailed` | Couldn't load usage | Kullanım bilgisi yüklenemedi |
| `billing.features.title` | Included in your plan | Planınıza dahil olanlar |
| `billing.features.arbitrage` | Arbitrage scanner | Arbitraj tarayıcı |
| `billing.features.financials` | Financials | Finans |
| `billing.features.bulkPhotoStudio` | Bulk photo studio | Toplu fotoğraf stüdyosu |
| `billing.features.core` | Listing editor, bulk editor, research, shipping labels | İlan düzenleyici, toplu düzenleyici, araştırma, kargo etiketleri |
| `billing.features.included` | Included | Dahil |
| `billing.features.proOnly` | Pro plan | Pro planı |
| `billing.features.notIncluded` | Not included | Dahil değil |
| `billing.features.seePro` | See Pro | Pro'yu incele |
| `billing.invoices.title` | Invoices | Faturalar |
| `billing.invoices.viewAll` | View all | Tümünü gör |
| `billing.invoices.col.date` | Date | Tarih |
| `billing.invoices.col.number` | Invoice | Fatura |
| `billing.invoices.col.plan` | Plan | Plan |
| `billing.invoices.col.amount` | Amount | Tutar |
| `billing.invoices.col.status` | Status | Durum |
| `billing.invoices.download` | Download PDF | PDF indir |
| `billing.invoices.open` | Open invoice | Faturayı aç |
| `billing.invoices.payNow` | Pay now | Şimdi öde |
| `billing.invoices.period` | {plan} · {start}–{end} | {plan} · {start}–{end} |
| `billing.invoices.loadMore` | Load more | Daha fazla yükle |
| `billing.invoices.empty.title` | No invoices yet | Henüz fatura yok |
| `billing.invoices.empty.body` | Invoices appear here after your first payment. | Faturalar ilk ödemenizden sonra burada görünür. |
| `billing.invoices.loadFailed` | Couldn't load invoices | Faturalar yüklenemedi |
| `billing.loadFailed` | Couldn't load your plan | Planınız yüklenemedi |
| `billing.toast.planChanged` | You're on {plan} now. | Artık {plan} planındasınız. |
| `billing.toast.portalFailed` | Couldn't open Stripe. Try again. | Stripe açılamadı. Tekrar deneyin. |
| `billing.toast.managedElsewhere` | Billing is managed elsewhere for this account. | Bu hesabın faturalandırması başka bir yerden yönetiliyor. |
| `billing.palette.manage` | Manage subscription | Aboneliği yönet |
| `billing.palette.invoices` | View invoices | Faturaları gör |

### 15.3 `status.*` additions (DS namespace)

| Key | EN | TR |
|---|---|---|
| `status.subscription.trial` | Trial | Deneme |
| `status.subscription.grace` | Grace period | Ek süre |
| `status.subscription.active` | Active | Aktif |
| `status.subscription.canceling` | Cancels soon | İptal edilecek |
| `status.subscription.past_due` | Payment failed | Ödeme başarısız |
| `status.subscription.expired` | Paused | Durduruldu |
| `status.subscription.near_limit` | Near limit | Limite yakın |
| `status.subscription.trial_ending` | Trial ending | Deneme bitiyor |
| `status.invoice.paid` | Paid | Ödendi |
| `status.invoice.open` | Unpaid | Ödenmedi |
| `status.invoice.void` | Voided | İptal edildi |
| `status.invoice.uncollectible` | Not collected | Tahsil edilemedi |
| `status.run.completed` | Done | Tamamlandı |
| `status.run.running` | Running | Çalışıyor |
| `status.run.failed` | Failed | Başarısız |

### 15.4 `marketing.pricing.*` (full rewrite; old keys deleted)

| Key | EN | TR |
|---|---|---|
| `marketing.pricing.seo.title` | Pricing · KolayXport | Fiyatlandırma · KolayXport |
| `marketing.pricing.seo.description` | From {price} a month. 14 days free, no card needed. | Aylık {price} fiyatından başlayan planlar. 14 gün ücretsiz, kart gerekmez. |
| `marketing.pricing.seo.ogAlt` | KolayXport pricing plans | KolayXport fiyat planları |
| `marketing.pricing.title` | Pricing | Fiyatlandırma |
| `marketing.pricing.subtitle` | Orders, labels, listings and research for Etsy, eBay, Amazon, Trendyol and more. | Etsy, eBay, Amazon, Trendyol ve daha fazlası için siparişler, etiketler, ilanlar ve araştırma. |
| `marketing.pricing.trialLine` | 14 days free. No card needed. | 14 gün ücretsiz. Kart gerekmez. |
| `marketing.pricing.interval.monthly` | Monthly | Aylık |
| `marketing.pricing.interval.yearly` | Yearly · 2 months free | Yıllık · 2 ay bedava |
| `marketing.pricing.currency.try` | ₺ TRY | ₺ TL |
| `marketing.pricing.currency.usd` | $ USD | $ USD |
| `marketing.pricing.currency.locked` | Your account is billed in {currency}. | Hesabınız {currency} ile faturalandırılıyor. |
| `marketing.pricing.founding.line` | Founding member offer: 40% off for life for our first {total} subscribers · {remaining} of {total} spots left | Kurucu üye fırsatı: İlk {total} aboneye ömür boyu %40 indirim · {total} yerden {remaining} tanesi kaldı |
| `marketing.pricing.founding.few` | Only {remaining, plural, one {# spot} other {# spots}} left | Yalnızca {remaining} yer kaldı |
| `marketing.pricing.founding.priceNote` | Founding price, for life | Kurucu üye fiyatı, ömür boyu |
| `marketing.pricing.founding.fullTitle` | The founding spots just ran out | Kurucu üye kontenjanı az önce doldu |
| `marketing.pricing.founding.fullBody` | {plan} is {price}. Continue to checkout? | {plan} planı {price}. Ödemeye devam edilsin mi? |
| `marketing.pricing.founding.continue` | Continue | Devam et |
| `marketing.pricing.founding.notNow` | Not now | Şimdi değil |
| `marketing.pricing.mostPopular` | Most popular | En çok tercih edilen |
| `marketing.pricing.perMonth` | / month | / ay |
| `marketing.pricing.perYear` | / year | / yıl |
| `marketing.pricing.monthlyEquivalent` | {price} a month · 2 months free | Aylık {price} karşılığı · 2 ay bedava |
| `marketing.pricing.customPrice` | Custom pricing | Size özel fiyat |
| `marketing.pricing.plans.starter.tagline` | For one or two stores | Bir veya iki mağaza için |
| `marketing.pricing.plans.growth.tagline` | For growing shops on every marketplace | Her pazaryerinde büyüyen mağazalar için |
| `marketing.pricing.plans.pro.tagline` | For multi-store teams that need finance and arbitrage | Finans ve arbitraj ihtiyacı olan çok mağazalı ekipler için |
| `marketing.pricing.plans.enterprise.tagline` | For high volume and custom setups | Yüksek hacim ve özel kurulumlar için |
| `marketing.pricing.limit.orders` | {count} orders a month | Ayda {count} sipariş |
| `marketing.pricing.limit.labels` | {count} labels a month | Ayda {count} etiket |
| `marketing.pricing.limit.stores` | {count, plural, one {# connected store} other {# connected stores}} | {count} bağlı mağaza |
| `marketing.pricing.limit.ai` | {count} AI credits a month | Ayda {count} AI kredisi |
| `marketing.pricing.limit.unlimitedOrders` | Unlimited orders | Sınırsız sipariş |
| `marketing.pricing.limit.unlimitedLabels` | Unlimited labels | Sınırsız etiket |
| `marketing.pricing.limit.unlimitedStores` | Unlimited stores | Sınırsız mağaza |
| `marketing.pricing.limit.unlimitedAi` | Unlimited AI | Sınırsız AI |
| `marketing.pricing.feature.listing` | Listing and bulk editing | İlan ve toplu düzenleme |
| `marketing.pricing.feature.labels` | Shipping labels | Kargo etiketleri |
| `marketing.pricing.feature.research` | Research tools | Araştırma araçları |
| `marketing.pricing.feature.everythingIn` | Everything in {plan} | {plan} planındaki her şey |
| `marketing.pricing.feature.arbitrage` | Arbitrage scanner | Arbitraj tarayıcı |
| `marketing.pricing.feature.financials` | Financials | Finans |
| `marketing.pricing.feature.bulkPhotoStudio` | Bulk photo studio | Toplu fotoğraf stüdyosu |
| `marketing.pricing.feature.prioritySupport` | Priority support | Öncelikli destek |
| `marketing.pricing.feature.dedicatedContact` | Dedicated contact | Size özel iletişim kişisi |
| `marketing.pricing.cta.startTrial` | Start free trial | Ücretsiz denemeyi başlat |
| `marketing.pricing.cta.choose` | Choose {plan} | {plan} planını seç |
| `marketing.pricing.cta.switch` | Switch to {plan} | {plan} planına geç |
| `marketing.pricing.cta.current` | Current plan | Mevcut plan |
| `marketing.pricing.cta.currentReason` | You're on this plan | Bu plandasınız |
| `marketing.pricing.cta.talk` | Talk to us | Bize ulaşın |
| `marketing.pricing.cta.opening` | Opening checkout… | Ödeme sayfası açılıyor… |
| `marketing.pricing.cta.updatePaymentFirst` | Update payment first | Önce ödemeyi güncelleyin |
| `marketing.pricing.cta.unknownReason` | Couldn't check your account. Reload to continue. | Hesabınız kontrol edilemedi. Devam etmek için sayfayı yenileyin. |
| `marketing.pricing.cta.trialCarry` | You won't be charged until {date}. | {date} tarihine kadar ücret alınmaz. |
| `marketing.pricing.pastDueBanner` | Your last payment failed. | Son ödemeniz başarısız oldu. |
| `marketing.pricing.taxIncluded` | Prices include KDV. | Fiyatlara KDV dahildir. |
| `marketing.pricing.taxExcluded` | Prices exclude KDV. | Fiyatlara KDV dahil değildir. |
| `marketing.pricing.compare.title` | Compare plans | Planları karşılaştır |
| `marketing.pricing.compare.orders` | Orders a month | Aylık sipariş |
| `marketing.pricing.compare.labels` | Labels a month | Aylık etiket |
| `marketing.pricing.compare.stores` | Connected stores | Bağlı mağaza |
| `marketing.pricing.compare.ai` | AI credits a month | Aylık AI kredisi |
| `marketing.pricing.compare.marketplaces` | Marketplaces | Pazaryerleri |
| `marketing.pricing.compare.all` | All | Tümü |
| `marketing.pricing.compare.carriers` | Carriers: FedEx, UPS, DHL eCommerce | Kargo: FedEx, UPS, DHL eCommerce |
| `marketing.pricing.compare.support` | Support | Destek |
| `marketing.pricing.compare.supportEmail` | Email | E-posta |
| `marketing.pricing.compare.supportPriority` | Priority | Öncelikli |
| `marketing.pricing.compare.supportDedicated` | Dedicated | Özel |
| `marketing.pricing.compare.unlimited` | Unlimited | Sınırsız |
| `marketing.pricing.compare.notIncluded` | Not included | Dahil değil |
| `marketing.pricing.compare.pickPlan` | Show plan | Planı göster |
| `marketing.pricing.hint.orders` | An order counts once, when it's imported. | Bir sipariş, aktarıldığında bir kez sayılır. |
| `marketing.pricing.hint.stores` | Each Etsy shop, eBay account, Amazon account, Trendyol account, Wix site or Shopify store counts as one. Carriers don't count. | Her Etsy mağazası, eBay hesabı, Amazon hesabı, Trendyol hesabı, Wix sitesi veya Shopify mağazası bir mağaza sayılır. Kargo firmaları sayılmaz. |
| `marketing.pricing.hint.ai` | A text action uses 1 credit, an image uses 10. | Bir metin işlemi 1, bir görsel 10 kredi kullanır. |
| `marketing.pricing.faq.title` | Questions | Sık sorulan sorular |
| `marketing.pricing.faq.trial.q` | How does the free trial work? | Ücretsiz deneme nasıl işler? |
| `marketing.pricing.faq.trial.a` | You get 14 days with Pro features and no card. When it ends you have 3 more days to choose a plan. After that, importing orders, labels and AI pause, and your data stays. | Kart girmeden 14 gün boyunca Pro özelliklerini kullanırsınız. Deneme bitince plan seçmek için 3 gününüz daha olur. Sonrasında sipariş aktarımı, etiketler ve AI duraklar; verileriniz silinmez. |
| `marketing.pricing.faq.limits.q` | What happens if I go over a limit? | Bir sınırı aşarsam ne olur? |
| `marketing.pricing.faq.limits.a` | We tell you at 80%. Orders your buyers place still arrive. Scheduled imports pause at 110% of your order limit, and new labels and AI pause at 100% until the next month or until you change plan. | %80'e geldiğinizde size haber veririz. Alıcılarınızın verdiği siparişler gelmeye devam eder. Zamanlanmış aktarımlar sipariş sınırınızın %110'unda, yeni etiketler ve AI ise %100'de bir sonraki aya veya plan değiştirene kadar durur. |
| `marketing.pricing.faq.founding.q` | What is the founding member offer? | Kurucu üye fırsatı nedir? |
| `marketing.pricing.faq.founding.a` | Our first 20 subscribers pay 40% less for as long as they stay subscribed, on any plan and either billing period. | İlk 20 abonemiz, abonelikleri devam ettiği sürece her planda ve her ödeme döneminde %40 daha az öder. |
| `marketing.pricing.faq.change.q` | Can I change or cancel my plan? | Planımı değiştirebilir veya iptal edebilir miyim? |
| `marketing.pricing.faq.change.a` | Yes, any time from Settings. Upgrades apply right away. If you cancel, you keep your plan until the end of the period you paid for. | Evet, Ayarlar'dan istediğiniz zaman. Yükseltmeler hemen geçerli olur. İptal ederseniz ödediğiniz dönemin sonuna kadar planınız devam eder. |
| `marketing.pricing.faq.currency.q` | Can I pay in lira or dollars? | Lira veya dolar ile ödeyebilir miyim? |
| `marketing.pricing.faq.currency.a` | Yes. Pick ₺ or $ before checkout. Your account stays in that currency afterwards. | Evet. Ödemeden önce ₺ veya $ seçin. Hesabınız sonrasında bu para biriminde kalır. |
| `marketing.pricing.faq.data.q` | How is my data protected? | Verilerim nasıl korunuyor? |
| `marketing.pricing.faq.data.a` | Marketplace keys are encrypted, and your data stays on our servers in the EU. We never sell it. | Pazaryeri anahtarları şifrelenir ve verileriniz AB'deki sunucularımızda kalır. Verilerinizi asla satmayız. |
| `marketing.pricing.enterprise.title` | Need more than Pro? | Pro yetmiyor mu? |
| `marketing.pricing.enterprise.body` | Talk to us about Enterprise: unlimited usage and a dedicated contact. | Enterprise için bize ulaşın: sınırsız kullanım ve size özel bir iletişim kişisi. |
| `marketing.pricing.checkout.failed` | Couldn't open checkout. Try again. | Ödeme sayfası açılamadı. Tekrar deneyin. |
| `marketing.pricing.checkout.forbidden` | This account can't buy a plan here. | Bu hesap buradan plan satın alamaz. |
| `marketing.pricing.reviewerSummary.title` | Pricing summary (English) | Pricing summary (English) |
| `marketing.pricing.reviewerSummary.plan` | {plan}: {monthTry}/month ({yearTry}/year) or {monthUsd}/month ({yearUsd}/year). {orders} orders, {labels} labels, {stores} connected stores and {ai} AI credits a month. | {plan}: {monthTry}/month ({yearTry}/year) or {monthUsd}/month ({yearUsd}/year). {orders} orders, {labels} labels, {stores} connected stores and {ai} AI credits a month. |
| `marketing.pricing.reviewerSummary.enterprise` | Enterprise: custom quote with unlimited usage, through our contact form. | Enterprise: custom quote with unlimited usage, through our contact form. |
| `marketing.pricing.reviewerSummary.footer` | Every plan starts with a 14-day free trial without a card. Every marketplace and carrier integration is included. No other fees. | Every plan starts with a 14-day free trial without a card. Every marketplace and carrier integration is included. No other fees. |

FAQ "data" answer: the integrator must confirm "servers in the EU" (Hetzner VPS location) before merging; if unsure, drop that clause.

---

## 16. Code to delete

| Delete | When | Note |
|---|---|---|
| `components/SubscriptionDashboard.tsx` | with Group D | only consumer is `BillingPanel` |
| `components/settings/ConnectionCard.tsx` | Group B | replaced by `IntegrationTile` |
| `components/settings/ErrorDetailsDialog.tsx` | Group C | replaced by `SyncErrorsPanel` |
| `ApiKeysPanel` 3-column grid body | Group B | file becomes the provider list |
| MUI `Tabs`/`Tab`/`@mui/icons-material` imports + `CircularProgress` block in `pages/ayarlar.tsx` | Group A | |
| `parasutBaseUrl`, `parasutRedirectUri`, `mngAppId`, `mngAppSecret`, `mngApiEnvironment` from `initialFormData` and the UI | Groups A/B | server PATCH still accepts and ignores them (no API change) |
| i18n: `settings.parasutBaseUrlPlaceholder`, `settings.parasutRedirectUriPlaceholder`, `settings.mngAppId`, `settings.mngAppSecret`, `settings.mngEnvironment`, `settings.tabs.*`, `settings.errorDialog.*`, all of `subscription.*`, all of `invoices.*`, all of `marketing.pricing.*` (rewritten) | integrator, after `grep -rn` shows no other user | `LimitReachedDialog` reads `subscription.*`: grep first, move its keys to `billing.*` |
| `pages/faturalar.tsx` body | Group D | becomes a 10-line redirect page |
| `pages/subscribe.js` | Group E | dead, posts to a non-existent `/api/checkout` |
| `pages/fiyatlandirma.js` | Group E | replaced by `pages/fiyatlandirma.tsx`; drops `framer-motion`, `@headlessui/react` Disclosure and `@stripe/stripe-js` `redirectToCheckout` (hosted `url` only; tiers-plan checkout always returns it) |
| `lib/stripePrices.ts` | billing backend track | superseded by `lib/billing/plans.ts` + `stripePrices.server.ts`; listed so nobody keeps it alive |
| Page-top Etsy restriction box | Group B | moved into the Etsy panel |

`TrialNotification.tsx` and the `AppLayout` "Invoices" nav item are **not** deleted here: the nav item works through the `/faturalar` redirect until M2 (`navConfig` drops it), and the trial banner is replaced by the M2 SideNav plan meter + the Overview "Needs attention" queue. Both trackers own those files.

---

## 17. Implementation split (disjoint file groups)

Rules for every group: do not edit `messages/en.json` / `messages/tr.json` (return a JSON fragment for your keys, EN and TR); import UI only from `components/ds/*` and the icon registry; add your paths to a fragment of `design/migrated-paths.json`; run `npx next build --webpack` and `npm run test` before finishing. Flags: `settings` and `pricing` in `NEXT_PUBLIC_UI_V2` (DS §7.1.5); the route renders `flag ? <New/> : <Legacy/>`.

**Prerequisites (other tracks, not in this split):** DS M1 primitives (`components/ds/*`, incl. `SettingsLayout`, `SettingsMobileIndex`, `SettingsRow`, `UsageMeter`, `SidePanel`, `StickyActionBar`, `DataTable`, `StatusPill`). Billing backend per `design/launch/tiers.md` (`lib/billing/plans.ts`, entitlements, checkout, webhook, `/api/billing/entitlement`, `/api/billing/founding-spots`). Groups code against the contracts in §2 and use the `useEntitlement` fallback until the backend lands.

| Group | Owns (create or edit) | Depends on |
|---|---|---|
| **A · Shell + hooks** | `pages/ayarlar.tsx`; `components/domain/settings/SettingsPage.tsx`, `settingsNav.ts`; `lib/hooks/useSettings.ts` (`saveSlice`, `discard`, `dirtySections`, `isSliceDirty`, `refetch`, saved-object ref, type additions A7); `lib/hooks/useUnsavedChangesGuard.ts`; `components/settings/SettingsSection.tsx` + `SettingsSaveBar.tsx` (turned into re-export shims of DS); `lib/ds/icons.ts` entries for §1.2 icons (single small edit; coordinate if M1 is mid-flight); `lib/ds/status/billing.ts` + `run` domain keys (§14) | DS M1 |
| **B · Connections + credentials** | `lib/settings/integrations.ts`; `components/domain/settings/connections/*` (`IntegrationGrid`, `IntegrationTile`, `EtsyShopsPanel`, `AmazonPanel`, `ShopifyPanel`, `ProviderCredentialsPanel`, `StoreLimitModal`, `useWixInstallPoll.ts` moved verbatim); `components/settings/ConnectionsPanel.tsx`, `ApiKeysPanel.tsx`, `CredentialField.tsx` (restyle, mask logic untouched); delete `ConnectionCard.tsx` | A's hook signatures |
| **C · Sender + preferences + refresh history** | `components/domain/settings/sender/*` (`SenderForm`, `LabelPreview`); `components/settings/SenderProfilePanel.tsx`; `components/domain/settings/PreferencesPanel.tsx`; `components/domain/settings/refresh/*` (`RefreshOverview`, `RefreshHistoryTable`, `SyncErrorsPanel`); `components/settings/SyncPanel.tsx`, `SyncHistoryList.tsx`; delete `ErrorDetailsDialog.tsx`. `components/ImporterFormCollapsible.tsx` untouched | A; F for timezone (A6) |
| **D · Billing tab** | `components/domain/billing/*` (`BillingPanel`, `PlanCard`, `UsageCard`, `IncludedCard`, `InvoicesCard`, `CheckoutReturn`); `components/settings/BillingPanel.tsx` (re-export); `lib/billing/useEntitlement.ts` (with fallback), `useInvoices.ts`, `billingState.ts` (+ `pricingCta`), `price.ts`, `types.ts`; `pages/faturalar.tsx` (redirect); delete `components/SubscriptionDashboard.tsx` | A; F (A1–A3); backend entitlement (fallback until then) |
| **E · Pricing page** | `pages/fiyatlandirma.tsx` (new) and delete `pages/fiyatlandirma.js`; `components/domain/pricing/*` (`PricingHeader`, `IntervalCurrencyControls`, `FoundingLine`, `PlanCard`, `CompareTable`, `CompareMobile`, `PricingFaq`, `ReviewerSummary`, `FoundingFullModal`); `lib/billing/useFoundingSpots.ts`; delete `pages/subscribe.js` | D's `price.ts`/`billingState.ts` (E imports, never edits; D lands those two files first, day 1); backend `PLANS` + founding endpoint |
| **F · API deltas** | `pages/api/stripe/billing-history.ts` (A1), `pages/api/stripe/create-portal-session.ts` (A2), `pages/api/stripe/billing-summary.ts` (A3, new), `pages/api/user/settings.ts` (A6), `prisma/schema.prisma` + `prisma/migrations/20261016100000_user_timezone/` (A6). Hands A4 and A5 to the billing backend track as written deltas (it owns `create-checkout-session.ts`, `webhook.ts`, `syncSubscription.ts`, `billing_v2`) | none |
| **G · Integration (last)** | `messages/en.json`, `messages/tr.json` (merge fragments, delete §16 keys after grep); `design/migrated-paths.json`; `__tests__/billing/*` and `__tests__/settings/*` additions listed below; removes A's shims once B/C are merged; `lib/ds/uiFlags.ts` entries `settings`, `pricing` | all |

Tests (each group writes its own under `__tests__/<group-area>/`; G only runs the suite):
- `billingState.test.ts`: every row of §9.3 and §10.4, including provider-unknown.
- `price.test.ts`: §0.2 tables exactly (founding, yearly equivalent, both currencies).
- `shopifyGating.test.tsx`: §11 assertions for PlanCard, UsageCard, InvoicesCard, StoreLimitModal, pricing page.
- `integrationsRegistry.test.ts`: DHL fields are exactly `mngCustomerNumber`, `mngPassword`; no `parasutBaseUrl`.
- `unsavedGuard.test.ts`, `useSettings.saveSlice.test.ts` (PATCH body only carries the slice keys, masks stripped).
- i18n parity: every new key exists in both files; TR values contain no ASCII-Turkish patterns (`Olustur`, `Iptal`, `Odeme`).

Build order: day 1 A (hooks/shims) + D's `price.ts`/`billingState.ts`/`types.ts` + F; then B, C, D, E in parallel; G last. Pricing flag flips only after the tiers-plan Stripe cut-over (new Prices + founding coupon live), because the page shows the new prices.

---

## 18. Open decisions for the founder (UI is built for both answers)

1. **KDV**: are TRY prices KDV-inclusive? One boolean in `PLANS` picks `taxIncluded`/`taxExcluded` copy. Stripe Price `tax_behavior` must match.
2. **shopify_free scope (tiers plan D16)**: option (b) is assumed; the UI only reads `stripeUpsell`, so either option renders correctly.
3. **Support row** wording (Email / Email / Priority / Dedicated). Confirm nothing more is promised.
4. **FAQ data-location claim** ("servers in the EU"): confirm or drop.
5. **Founding on yearly**: the brief and the Stripe coupon (`duration: forever`) allow stacking with "2 months free" (₺29.994/yıl for Growth). If the founder wants monthly-only, set `FOUNDING.intervals = ['month']` in `PLANS` and the yearly cards stop showing founding prices.

## 19. Definition of done (surface-specific, on top of DS §8)

- Screens at 1440 / 1024 / 390 in EN and TR for: Connections, credential panel, Sender profile, Preferences, Refresh history, Billing in **trial, grace, active founding, past due, canceling, shopify_free**, and Pricing as **anonymous, trial user, active Growth user, shopify_free (redirect, no price painted)**.
- A real test-mode run: anonymous → signup (no card) → trial Billing → Pricing "Choose Growth" (TRY, yearly, founding) → Stripe Checkout → `?checkout=success` confirms → invoice appears with status Paid → portal "Update payment method" opens the right screen → cancel → "Cancels on …" state.
- `/faturalar`, every `?tab=` deep link, `&provider=`, OAuth `?success=`/`?error=` returns, Wix poll, Amazon reconnect with marketplaces kept, store-limit return: all verified on the flag.
