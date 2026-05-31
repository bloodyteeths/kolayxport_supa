# KolayXport — Ruthless Codebase Audit

Date: 2026-05-31
Scope: full repo at `/Users/tamsar/Downloads/backup integration/mybaby-sync-product`
Auditor frame: senior SaaS CTO + security auditor + product architect
Note on confidence: anything marked `unknown` was not verifiable from code alone.

Everything below is grounded in actual file paths. Findings the user should not trust without a second pass are tagged `[NEEDS CONFIRMATION]`.

---

## 1. Executive Summary

### What is actually implemented (the real product, not the README)
- A **Next.js 16 / Pages Router** app called `KolayXport`. The package.json still says `mybaby-sync-product` (legacy name; see §3).
- Multi-tenant SaaS for **Turkish sellers doing cross-border e-commerce**. Auth = NextAuth v4 + Prisma adapter + JWT sessions + Google OAuth + email/password (bcryptjs cost 12). Confirmed live in `lib/auth.ts`.
- **Postgres + Prisma** schema with ~70+ models (`prisma/schema.prisma` is 1,465 lines). 60+ Prisma migrations under `prisma/migrations/`. Self-hosted on Hetzner per `CLAUDE.md`.
- **Marketplace integrations**, varying maturity:
  - Etsy (OAuth2, multi-shop) — most code, draft-staging workflow built, Chrome extension scrapes Shop Manager DOM
  - eBay (OAuth2) — read+research mostly done, draft pipeline started
  - Shopify (OAuth2) — solid baseline
  - Trendyol (API key + HTML scraping) — partial, scraping is TOS risk
  - Wix (OAuth2) — read works, **no token refresh** = breaks after expiry
  - Amazon SP-API — auth done, almost no flows
  - Veeqo / Shippo — legacy stubs, effectively dead
- **Carriers**: FedEx (OAuth client_credentials, full label flow, ETD, customs) and UPS (paperless invoice) are real. MNG/DHL eCommerce JWT auth + two-step label is implemented. No Shippo runtime path.
- **ETGB / mikro-ihracat**: real. `lib/services/etgbService.ts`, `etgbExcelService.ts`, `etgbMailerService.ts`, `pages/api/etgb/process.ts`. Invoice generation via Paraşüt (`lib/services/invoiceService.ts`).
- **AI features**: Gemini wired (`@google/generative-ai` + `@google/genai` — two SDKs side-by-side). `@anthropic-ai/sdk` installed but no imports. Heavy AI use in `pages/api/clawd/*` for Etsy/eBay/Amazon/Trendyol research, arbitrage matcher.
- **Stripe billing**: checkout-session + webhook + plan limits enforcement + usage reset + trial expiry cron — wired end-to-end.
- **Chrome extension**: ships tracking number push to Etsy via DOM automation (Etsy refused tracking via API per memory). Lives in `chrome-extension/` plus 17 separate `.zip` versioned builds committed at repo root.
- **i18n**: `next-intl` with `messages/en.json` (314KB) + `messages/tr.json` (333KB). Looks healthy.
- **Cron jobs**: `pages/api/cron/sync-orders.ts`, `cron/reset-usage.ts`, `cron/track-ranks.ts` declared in `vercel.json`. Hetzner deployment per CLAUDE.md → **deployment contradiction** (§4H).

### What seems production-ready
- NextAuth credentials+Google flow.
- Stripe webhook + plan limits (`lib/middleware/withUsageLimiter.ts`).
- FedEx label generation incl. international ETD (`lib/fedex/`).
- ETGB Excel + Paraşüt invoice + SMTP email pipeline.
- Etsy direct receipts ingest + tracking submission.
- i18n coverage.

### What is partially implemented
- Etsy listing **draft staging** (`lib/etsy/draftService.ts`, 55KB) — built; sync hardening from May 2026 noted in CLAUDE.md; still risky because conflict logic depends on Etsy's `updated_timestamp` and a partial sync can leave a draft with a queued `delete` action.
- eBay listing drafts (`lib/ebay/draftService.ts`, 24KB).
- Amazon: only auth + a couple read calls; `AmazonTrackedProduct` / `AmazonPriceSnapshot` / `AmazonNicheResearch` models exist but no writes visible.
- Trendyol official-API client (`lib/integrations/trendyolApiClient.ts`) exists but is **never imported**; the scraping path (`trendyolSearch.ts`) is what runs.
- Shopify billing fields on `User` (`shopifySubscriptionId`, `billingProvider`) — schema there, implementation only in `pages/api/shopify/billing.ts` and `pages/api/shopify/webhooks/subscription-update.ts` (not deeply audited).
- Tracking sync: numbers are written on label creation; no background reconciliation cron.

### What seems abandoned, duplicated, or dangerous
- **`kolay-xport/`** (799MB on disk, Wix Astro side-project) — gitignored, never deployed. Delete from disk.
- **`etsy-dom-inspector/`** — separate dev extension, dead.
- **`fedex folder/`** (empty, with a space in the name).
- **`velascreenshots/`** (5MB local-only) — UX research dump.
- **`pages/api/setScriptProps.js`** — confirmed dangerous: `console.info(...JSON.stringify(body))` on a body that includes Veeqo / Shippo / FedEx / Trendyol / Hepsiburada credentials, and it writes to a non-existent model `userIntegrationSettings` (current model is `Credential`). Dead-but-active route.
- **`pages/api/clawd/serve-image.ts`** — no `getAuthUser` check; serves any image whose relative path is guessable.
- 17 chrome-extension `*.zip` files at repo root (versioned builds).
- **Two Google AI SDKs**: `@google/genai` AND `@google/generative-ai`.
- `@auth0/nextjs-auth0`, `@supabase/ssr`, `iyzipay`, `@sentry/nextjs` installed but **not wired anywhere**.
- 3 SQL files at repo root (`add_recipient_email*.sql`) — one-off hand migrations now superseded by Prisma migrations.
- `pages/api/debug-etsy-matching.ts` shipped in prod build.
- `pages/api/gscript/`, `googleSheetId`, `driveFolderId`, `userAppsScriptId` — Google-Apps-Script-era dead fields.
- `lib/marketplace_adapters/veeqo_adapter.js` — JS in a TS codebase, unused.
- Cross-project contamination: `NabavkiData_EIC_Pitch_Deck.pdf` (Serbian/Croatian procurement pitch deck) committed at root.

### The real product (one sentence)
KolayXport is a Turkish-sellers-focused, cross-border e-commerce ops dashboard. The bones that actually move money today are: NextAuth signup → connect a marketplace credential → import orders → generate a FedEx/UPS/MNG label → run ETGB micro-export → push tracking back via Chrome extension → Stripe billing. Everything else (AI research, arbitrage scanner, Etsy market deep-dive, eBay rank tracker, financial dashboard) is value-add but secondary.

---

## 2. Architecture Map

### Framework / runtime
- Next.js 16.1.6 (Pages Router), React 18, Node 22, TypeScript with `strict: false` (`tsconfig.json`).
- Build: `prisma generate && next build --webpack` (webpack, not Turbopack).
- Deployment: Hetzner systemd `kolayxport.service` per `CLAUDE.md`. **However** `vercel.json` declares Vercel crons and `.vercel/` is committed — see §4H.

### Routing structure
- `pages/` (Pages Router; ~70 page files + 118 API routes under `pages/api/`).
- Public marketing pages at root (`pages/index.tsx`, `pages/fiyatlandirma.tsx`, `pages/iletisim.tsx`, etc.).
- App routes under `pages/app/` (`senkron.tsx`, `labels.tsx`, `mesajlar.tsx`, `urunler.tsx`, `analitik.tsx`, `arbitraj.tsx`, `ebay/*`, `etsy/*`, etc.).
- Auth pages under `pages/auth/`.
- Admin at `pages/admin/index.tsx` + `pages/api/admin/`.

### Layers
| Layer | Where | Notes |
|---|---|---|
| Auth | `lib/auth.ts`, `pages/api/auth/[...nextauth].ts`, `pages/api/auth/signup.ts` | NextAuth + Credentials + Google. `getAuthUser`, `getAuthUserOrApiKey`. |
| DB | `lib/prisma.ts`, `prisma/schema.prisma` | Single Prisma client; `relationMode = "prisma"`. |
| Logger | `lib/logger.ts` | Writes to `SyncLog` model; no PII redaction. |
| Rate limits | `lib/middleware/usageLimiter.ts`, `withUsageLimiter.ts` | Plan-tier enforcement. |
| Integrations (API clients) | `lib/integrations/*` | 19 files: Etsy, eBay, Shopify, Wix, Amazon, Trendyol(2x), Veeqo, Shippo, Google APIs… |
| Marketplace-specific drafts | `lib/etsy/`, `lib/ebay/` | Draft staging services. |
| Carriers | `lib/fedex/`, `lib/ups/`, `lib/mng/` | OAuth client_credentials, key-based, JWT respectively. |
| Mappers | `lib/mappers/` | Per-marketplace → unified `Order`. |
| Order sync | `lib/orderSync.ts`, `lib/sync/` | Orchestrator + per-source. |
| ETGB / invoicing | `lib/services/etgb*.ts`, `lib/services/invoiceService.ts` | Excel + Paraşüt + SMTP. |
| AI | `pages/api/clawd/*`, `pages/api/ai/*`, `lib/arbitrage/matcher.ts` | Gemini-heavy; Anthropic unused. |
| Billing | `lib/stripe.ts`, `lib/stripePrices.ts`, `pages/api/stripe/*` | Checkout + webhook + portal. |
| Cron | `pages/api/cron/*` declared in `vercel.json` | Bearer `CRON_SECRET` (string-eq, not constant-time). |
| Chrome extension | `chrome-extension/src/` | Etsy DOM scrape + tracking push. |

### External integrations (cross-cut)
- Marketplaces: Etsy, eBay, Shopify, Wix, Amazon, Trendyol, (Hepsiburada credential fields only)
- Carriers: FedEx, UPS, MNG/DHL eCommerce
- Payments: Stripe (live), iyzipay (unwired)
- AI: Gemini (live), Anthropic SDK (unused), `google-trends-api`, `googleapis`
- Email: nodemailer / SMTP for ETGB and contact form
- Accounting: Paraşüt (Turkish accounting SaaS) via `invoiceService.ts`
- Observability: `@sentry/nextjs` installed, no config files found = unwired

### Background jobs
- Cron defined in `vercel.json`:
  - `0 6 * * *` → `/api/cron/sync-orders`
  - `0 0 * * *` → `/api/cron/reset-usage`
  - `0 8 * * *` → `/api/cron/track-ranks`
- No queue (no BullMQ, no Redis client). Cron triggers are HTTP GETs guarded by `CRON_SECRET`.

### Module map (matrix vs. user's request)
| Module | Files | State |
|---|---|---|
| Auth/user mgmt | `lib/auth.ts`, `pages/api/auth/*`, `pages/api/user/*`, `pages/api/onboarding/*` | Functional; no email verification, no password reset |
| Etsy integration | `lib/integrations/etsy*.ts`, `lib/etsy/*`, `pages/api/etsy-drafts/*`, `pages/api/clawd/etsy.ts`, `pages/api/etsy-addresses.ts`, `components/etsy/*`, `chrome-extension/` | Most mature, but compliance risk (§7) |
| eBay integration | `lib/integrations/ebay*.ts`, `lib/ebay/*`, `pages/api/ebay/*`, `pages/api/ebay-drafts/*`, `pages/api/clawd/ebay*.ts`, `components/ebay/*` | Production-grade research; listing CRUD partial |
| Trendyol | `lib/integrations/trendyol*.ts`, `pages/api/trendyol/*`, `components/trendyol/*` | Scraping-based primary path; official API client unused |
| Amazon | `lib/integrations/amazonClient.ts`, `lib/amazon/`, `pages/api/amazon/*`, `components/amazon/*` | Auth + token refresh; almost no business flows |
| Shopify | `lib/integrations/shopifyClient.ts`, `pages/api/shopify/*` | Solid read paths |
| Wix | `lib/integrations/wixClient.ts`, `pages/api/wix/*`, `pages/api/integrations/wix/*`, `components/wix/*` | **No token refresh** = ticking time bomb |
| Orders | `lib/orderSync.ts`, `pages/api/orders/*` | Core flows live |
| Products/listings | `EtsyListing`, `EbayListing`, `TrendyolProduct`, `WixProduct`, `ShopifyProduct`, `AmazonTrackedProduct` models, plus `components/*/BulkEditor*` | Listing-level CRUD only on Etsy/eBay |
| Shipping/labels | `lib/fedex/`, `lib/ups/`, `lib/mng/`, `pages/api/labels/*`, `pages/api/fedex/*`, `pages/api/shipments/*` | FedEx + UPS + MNG real |
| Invoices/proforma/export docs | `lib/services/invoiceService.ts`, `lib/services/etgbService.ts`, `lib/services/etgbExcelService.ts`, `lib/services/etgbMailerService.ts` | Paraşüt-backed; no in-app PDFKit invoices |
| ETGB / micro-export | `pages/api/etgb/process.ts`, `lib/services/etgb*.ts` | Real |
| AI tools | `pages/api/clawd/*`, `pages/api/ai/*`, `lib/arbitrage/matcher.ts` | Gemini-driven |
| Billing/subscriptions | `pages/api/stripe/*`, `lib/stripe.ts`, `lib/stripePrices.ts`, `lib/middleware/withUsageLimiter.ts` | End-to-end |
| Admin tools | `pages/admin/index.tsx`, `pages/api/admin/dashboard.ts`, `pages/api/admin/users/[userId].ts`, `lib/middleware/withAdmin.ts` | Read-only stats; binary role |
| Analytics/finance/profit | `pages/app/analitik.tsx`, `pages/app/finans.tsx`, `pages/api/analytics/*`, `pages/api/finance/*`, `lib/marketplace_finance/` (verify), `FinancialTransaction`, `FinancialSyncCursor`, `ProductCost` models | Multi-marketplace P&L per project memory |

---

## 3. Code Quality Audit

### Top junk at repo root (committed)
| Item | Verdict |
|---|---|
| 17 `chrome-extension*.zip` + `etsy-dom-inspector*.zip` (~700KB) | DELETE — releases belong in GitHub Releases or `dist/` (gitignored) |
| 7 `Screenshot *.png` at root (~1.3MB) | DELETE |
| `NabavkiData_EIC_Pitch_Deck.pdf` (795KB, Serbian/Croatian, unrelated project) | DELETE |
| `Veeqo entegrasyonu guide.docx` (3.7MB) | MOVE to `docs/legacy/` or delete |
| `etgb11072024.xls` (4.5MB) | MOVE to `docs/etgb-samples/` or delete |
| `etsy-finance-plan.md`, `etsy-sales-boost-report.md`, `etsy-tag-optimization-report.md`, `etsy-title-optimization-report.md` (~175KB) | MOVE to `docs/etsy-research/` |
| `ebay-api-responses.json`, `ebay-legacy-research.json` (~205KB), `logs_result-21{1,2,3}.json`, `new-kolayxport-log-export-*.json` | DELETE; add `logs_result-*.json` + `*-log-export-*.json` to `.gitignore` |
| `check-etsy-status.ts`, `debug-trendyol-specific-order.ts`, and 7+ `test-*.mjs` (root) | MOVE to `scripts/` |
| `kolayxport*.code-workspace` (multiple), `mybaby-sync-product*.code-workspace`, `.DS_Store` | DELETE; add to `.gitignore` |
| `shopify.app.toml` | DELETE if Shopify app is not actively configured |
| `tsconfig.tsbuildinfo`, `yarn.lock.backup` | DELETE; tsbuildinfo to `.gitignore` |
| `add_recipient_email{,_final}.sql`, `add_recipient_email_to_orderitem.sql` | MOVE to `scripts/legacy-sql/`; document which one was actually applied to prod |
| `CLAWD_ETSY_TOOLS_PROMPT.md` (32KB), `EBAY_CLAWD_TOOLS_PROMPT.md` (55KB) | MOVE to `docs/internal/` |

### Orphan directories
| Dir | State | Action |
|---|---|---|
| `kolay-xport/` (799MB local; gitignored) | Wix Astro side-project, abandoned | Delete from disk |
| `etsy-dom-inspector/` (committed) | Legacy dev tool | Delete |
| `fedex folder/` (empty, space in name) | Garbage | Delete |
| `velascreenshots/` (gitignored locally) | UX reference dump | Move to `docs/research/vela/` or delete |
| `.shopify/`, `.vercel/`, `.wix/`, `.cursor/`, `.taskmaster/`, `.yarn/`, `.next/`, `playwright-report/`, `test-results/` | Various | Confirm `.gitignore` covers; clear out `.next/`, `playwright-report/`, `test-results/` from git |

### Duplicate / parallel implementations
- **Two Google AI SDKs**: `@google/genai` AND `@google/generative-ai` both in `package.json`. Pick one (Gemini 2.5 path is `@google/generative-ai`).
- **Multiple integration locations**: `lib/integrations/` (canonical clients), `lib/etsy/` and `lib/ebay/` (draft pipelines), `lib/marketplace_adapters/veeqo_adapter.js` (orphan JS adapter). The split between `lib/integrations/etsy*.ts` and `lib/etsy/draft*.ts` is defensible (clients vs. workflow), but `lib/marketplace_adapters/` is dead — delete.
- **Etsy address endpoints**: `pages/api/etsy-addresses.ts` likely duplicates `pages/api/integrations/etsy/addresses.ts` [NEEDS CONFIRMATION — diff them].
- **`pages/api/clawd/*` vs. `pages/api/etsy-drafts/*` + `pages/api/ebay-drafts/*`**: clawd = AI/research executors, drafts = staging — distinct. But `clawd` is an internal code-name leaking into production URLs. Rename to `pages/api/research/`.
- **3 root SQL files** for `recipient_email` (`add_recipient_email.sql`, `add_recipient_email_final.sql`, `add_recipient_email_to_orderitem.sql`) — only the Prisma migration in `prisma/migrations/` is canonical now.
- **`jest.config.js` + `jest.setup.js`** alongside `vitest.config.*`. Vitest is real; Jest config is dead.
- **17 chrome-extension zips** versus the live `chrome-extension/` folder.
- **`lib/generated/prisma/`** — gitignored per `.gitignore:142` (good). Confirmed not committed.

### Old naming / unrelated names
- `package.json` `name = "mybaby-sync-product"` — rename to `kolayxport`.
- "Veeqo" survives in `lib/types.ts` (`VeeqoOrder`, `VeeqoLineItem`), `lib/orderSync.ts`, `lib/integrations/veeqo.ts`, `lib/marketplace_adapters/veeqo_adapter.js`, `pages/api/orders/[orderId]/resync.ts` referencing `GLOBAL_VEEQO_API_KEY`. Remove from runtime once confirmed no live Veeqo accounts.
- "clawd" (internal nickname for Claude) leaking via `pages/api/clawd/*` and `CLAWD_API_KEY` env var.
- `googleSheetId`, `driveFolderId`, `userAppsScriptId` columns on `User` and `pages/api/gscript/` + `pages/api/setScriptProps.js` — all Apps-Script-era. Drop columns in a migration once confirmed unused.

### Debug / dev routes in production
- `pages/api/debug-etsy-matching.ts` — ships to prod build. Wrap in `if (process.env.NODE_ENV === 'production') return res.status(404).end();` or delete.
- `pages/api/setScriptProps.js` — confirmed leaks credentials into logs via `console.info(\`...\` , JSON.stringify(body))`. **Delete.**
- `pages/api/gscript/*` — appears empty / legacy. Delete.

### TypeScript weakness
- `tsconfig.json` has `strict: false` (verified by agent grep). With ~1,000 `any` annotations across `lib/` + `pages/`, the type system is honor-system. 11 `as unknown as` casts, 3 `@ts-ignore`. Several large `.js` files in `pages/app/`:
  - `pages/app/senkron.js` (~43KB)
  - `pages/app/entegrasyonlar-ve-rehberler.js` (~26KB)
  - `pages/app/nasil-kullanirim.js` (~4.4KB)
- `pages/api/contact.js`, `pages/api/products/sync.js`, `pages/api/setScriptProps.js` are JS in an otherwise TS API surface.
- 17 `.js` files under `chrome-extension/src/` — extension code; converting to TS would be a separate project.

### Inconsistent response shapes
- Some API routes return `{ error: '…' }`, others return `{ message: '…' }`, others return strings via `res.send`. No central error wrapper. Fix proposed in `KOLAYXPORT_REBUILD_PLAN.md`.

### Logging
- `lib/logger.ts` writes raw payloads (incl. error details) to `SyncLog`. No allowlist/denylist for keys like `access_token`, `refresh_token`, `password`. A single careless `logger.error('etsy fail', { tokenResponse })` exfiltrates a refresh token into Postgres for life. **High priority to add a redactor.**

---

## 4. Security Audit

Severity legend: **Critical** = exploitable today with low skill; **High** = exploitable by an authenticated user against another tenant; **Medium** = misconfiguration class; **Low** = defense-in-depth.

### Top critical / high findings

| # | Severity | File:approx-line | Issue | Why | Fix |
|---|---|---|---|---|---|
| 1 | **Critical** | `pages/api/setScriptProps.js:18` | `console.info(\`[SetScriptProps API] Received request for userId: ${userId}. Body:\`, JSON.stringify(body));` — body contains Veeqo/Shippo/FedEx/Trendyol/Hepsiburada credentials in plaintext. Logged to stdout → `journalctl` → persistent disk. Also references model `userIntegrationSettings` which no longer exists in `schema.prisma` (now `Credential`), so writes likely fail silently. | Operator with VPS access (or any future log shipper) sees all integration secrets. | Delete the file. Credentials should only be written via the typed API in `pages/api/user/settings.ts` with explicit redaction in the logger. |
| 2 | **Critical** | `pages/api/clawd/serve-image.ts:1-45` | No `getAuthUser` check; any internet caller with a guessable filename can read uploaded eBay product images. Path traversal IS blocked (`path.resolve` + `startsWith(resolvedRoot + path.sep)`), so this is purely an authn/authz hole, not a traversal CVE. | One user can enumerate another user's uploads if filenames are predictable, and the world can if no auth at all. | Add `const user = await getAuthUser(req, res); if (!user) return res.status(401).end();`. Then store uploads under `${UPLOAD_ROOT}/${userId}/...` and check the resolved path is under the user's prefix. |
| 3 | **Critical** | `pages/api/integrations/wix/webhook.ts` [NEEDS CONFIRMATION of cryptographic verification] | Webhook handler decodes Wix JWT but agent flagged signature not verified against Wix JWKS. | Forged webhook → account takeover. | Fetch Wix JWKS, verify JWT signature with RS256 before trusting any claim. Reject unsigned tokens. |
| 4 | **Critical** | `pages/api/cron/sync-orders.ts:22`, `pages/api/cron/reset-usage.ts:12`, `pages/api/cron/track-ranks.ts:59` | `authHeader !== \`Bearer \${process.env.CRON_SECRET}\`` uses non-constant-time equality. | Timing attack to recover `CRON_SECRET`, then anyone can trigger sync/reset for any user. | Use `crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))` after length check. |
| 5 | **Critical** | `pages/api/ext/telemetry.ts` | `Access-Control-Allow-Origin: *` on an unauthenticated POST endpoint. | Anyone on any site can submit fake telemetry; can be abused for log poisoning / cost amplification. | Either remove the route, require an auth header, or limit origin to the extension ID. |
| 6 | **High** | `pages/api/integrations/etsy/callback.ts` [NEEDS CONFIRMATION — agent reported missing CSRF state] | If OAuth `state` is not bound to the session cookie, an attacker can link victim's Etsy account to attacker's KolayXport account (or vice-versa). | Account takeover / data leak. | Generate per-session CSRF state, store in signed cookie + Redis, verify in callback. eBay callback already has this pattern (`pages/api/integrations/ebay/callback.ts`) — copy. |
| 7 | **High** | `pages/api/auth/extension.ts:13-15` | `origin.startsWith('chrome-extension://')` allows any Chrome extension to call this. | Hostile extension can impersonate KolayXport's extension and pull a session token. | Pin the exact extension ID: `if (origin === \`chrome-extension://\${process.env.OFFICIAL_EXTENSION_ID}/\`)`. |
| 8 | **High** | Credential storage — `Credential`, `EtsyShop.accessToken`, `WixSite.accessToken`, `ShopifyShop.accessToken`, `EbayCredential`-equivalent fields | Tokens stored as plain `String` in Postgres. Memory file `feedback_no_secrets_in_git.md` exists but plaintext at-rest is the bigger issue. [NEEDS CONFIRMATION — search for any `encrypt(...)` helper actually called before insert. Agent did not find one.] | Hetzner DB dump / backup theft = all marketplace tokens leak. | Add per-tenant AES-GCM envelope encryption with a master key from a KMS (or at minimum from a separate env var not in the DB), wrap all reads/writes in `lib/crypto/credentials.ts`. |
| 9 | **High** | Ownership checks on `[orderId]` / `[id]` routes (sample: `pages/api/orders/[orderId]/label-overrides.ts`, `updateNoteAndStatus.ts`, `update-options.ts`, `resync.ts`, `generate-label.ts`; `pages/api/etsy-drafts/[id]/sync.ts`; `pages/api/ebay-drafts/[id]/sync.ts`; `pages/api/etsy-drafts/bulk-sync.ts`; `pages/api/ebay-drafts/bulk-sync.ts`; `pages/api/shipments/[shipmentId]/delete.ts`) | Agent flagged ~18 endpoints that read/write by an id from URL/body without `where: { userId: session.user.id }`. Multi-tenant data leak / cross-tenant write. [Need spot-verification per route — list provided in agent output.] | Any logged-in user could mutate someone else's draft or order if they guess the id. | Centralize: add `requireOwned<T>(model, id, userId)` helper and use everywhere. Reject all queries that don't include `userId` in `where`. |
| 10 | **High** | `lib/auth.ts:80-100` (`getAuthUserOrApiKey`) | Accepts `CLAWD_API_KEY` and `userId` from query string. | Query strings end up in proxy/CDN logs and browser history; attacker who reads logs can impersonate any user. | Require header `Authorization: Bearer …` + `X-User-Id`, set `Cache-Control: no-store`, never accept the key from query. |
| 11 | **High** | `pages/api/stripe/webhook.ts:57-180` | After looking up by `stripeCustomerId`, code does not verify the incoming `subscription.customer` matches that customer before mutating `usageResetAt`/limits. | Crafted webhook (or test-mode event) could reset usage counters for an attacker's account or a victim's. | Always assert `subscription.customer === user.stripeCustomerId` and that `event.account` matches the connected Stripe account ID. |
| 12 | **High** | `pages/api/user/settings.ts:~94` | Internal error messages bubble up to client. | Schema / DB structure leak; aids attacker. | Sanitize to `{ error: 'Failed to save settings' }`; log full error server-side. |
| 13 | **High** | `pages/api/listing-urls.ts:50-120` | Fetches user-supplied product IDs without per-user rate limiting; also potential SSRF surface if user supplies a URL. | Cost amplification / quota burn. | Per-user rate limit, allowlist marketplace IDs (not URLs), cap batch size. |
| 14 | **Medium** | `pages/api/etsy-drafts/media.ts` and `pages/api/ebay-drafts/media.ts` | Uploads accept large bodies (200MB per global Next.js limit, per `feedback_nextjs_body_limit.md` memory). MIME and size validation [NEEDS CONFIRMATION]. Filenames flow into the path used by `serve-image.ts`. | DoS via giant upload; arbitrary content type served back; path-confusion if filename validation slips. | Enforce a 25MB cap per file, strict MIME allowlist (`image/jpeg|png|webp` + `video/mp4`), rewrite filename to `${uuid}.${ext}`. |
| 15 | **Medium** | `pages/api/admin/*` | `withAdmin.ts` only checks `user.role === 'admin'`. Default role is `'user'` in schema. No audit log of admin actions. | Promote-via-DB → silent privilege escalation; no forensic trail. | Add `AdminAuditLog` table, log every admin write. Consider 2FA for admin role. |

### Webhook signature verification status
- **Stripe**: `pages/api/stripe/webhook.ts` disables bodyParser and verifies signature — good (verify the secret env var is set in prod).
- **Wix**: see #3 — needs full JWKS verification.
- **Shopify**: callback HMAC implemented per agent; verify it's also enforced on webhook routes (look under `pages/api/shopify/webhooks/`).
- **Etsy / eBay / Amazon / Trendyol**: do not have webhooks today (pull-only). Adding them later means adding signature verification from day 1.

### Other security observations
- **Sensitive env exposed client-side**: scan for `NEXT_PUBLIC_*` reading anything other than publishable Stripe key, GA id, Sentry DSN. [NEEDS CONFIRMATION via `git grep NEXT_PUBLIC_`.]
- **`.env`, `.env.local` NOT committed** — verified (`.gitignore` lines 3, 76, 77, 124 cover them). Earlier agent claim of "Critical: .env committed" was wrong. Good news: secrets are local-only.
- **NextAuth missing email verification + password reset** — Critical for any consumer SaaS. Add `next-auth` Email provider + reset endpoint.
- **No CSP / X-Frame-Options / Referrer-Policy** headers visible in `next.config.js` [NEEDS CONFIRMATION]. Add via `headers()` config.
- **`@sentry/nextjs` installed but unwired** — install `sentry.client.config.ts`, `sentry.server.config.ts`, scrub PII via `beforeSend`.

### Overall posture rating
A determined attacker would have at least two account-takeover paths (Wix webhook forgery; Etsy OAuth state replay if state isn't session-bound), one credential-leak path (`setScriptProps.js`'s `console.info` of API keys), one unauth file-read path (`clawd/serve-image.ts`), and roughly 15 high-severity cross-tenant write paths in the order/draft routes. None require novel skill. The credential at-rest plaintext is the single biggest "one DB dump and you're done" risk. This codebase would not pass a real SaaS security review today.

---

## 5. Database / Prisma Audit

`prisma/schema.prisma` is 1,465 lines, ~70 models. `relationMode = "prisma"` means every FK needs a manual index.

### Model inventory (grouped)
- **Auth/user**: `User`, `Account`, `Session`, `VerificationToken`.
- **Orders**: `Order`, `OrderItem`, `OrderShipping`, `Shipment`, `LabelJob`, `TrackingSubmission`, `SyncOperation`, `SyncLog`.
- **Products**: `Product`, `Inventory`, `MarketplaceProduct`, `MarketplaceConfig`, `ProductCost`.
- **Credentials/Integration settings**: `Credential` (catch-all), per-marketplace shop tables: `EtsyShop`, `WixSite`, `ShopifyShop` (eBay/Amazon tokens live in `Credential`).
- **Etsy domain**: `EtsyShop`, `EtsyListing`, `EtsyListingDraft`, `EtsyDraftMedia`, `EtsyDraftSyncAttempt`, `EtsyAddress`.
- **eBay domain**: `EbayListing`, `EbayListingDraft`, `EbayTrackedProduct`, `EbayTrackedSeller`, `EbayNicheResearch`.
- **Trendyol / Shopify / Wix / Amazon**: `TrendyolProduct`, `ShopifyShop`, `ShopifyProduct`, `WixSite`, `WixProduct`, `AmazonTrackedProduct`, `AmazonPriceSnapshot`, `AmazonNicheResearch`.
- **Finance**: `FinancialTransaction`, `FinancialSyncCursor`, `ProductCost`.
- **Arbitrage**: `ArbitrageScanJob`, `ArbitrageResultRecord`.
- **Shipping profile**: `ShipperProfile`.
- **Marketplace identity**: `SenkronOrderData`.
- **SEO/research**: `RankTrackedKeyword`.

### Likely-unused / overbuilt
- `Inventory` model — barely referenced [NEEDS CONFIRMATION via repo grep].
- `MarketplaceProduct` — overlap with `Product.marketplace*` fields. Either consolidate or delete.
- `EbayTrackedSeller`, `EbayTrackedProduct`, `AmazonTrackedProduct`, `AmazonPriceSnapshot`, `AmazonNicheResearch` — agent reports read-only with no writers.
- `RankTrackedKeyword` — only the `track-ranks` cron writes; confirm it's still wanted.
- User columns `googleSheetId`, `driveFolderId`, `userAppsScriptId`, `googleAccountId` — Apps-Script era. Drop after confirming.

### Multi-tenancy boundary status
- `Order` has `@@unique([userId, marketplace, marketplaceKey])` + 7 indexes scoped by `userId`. Good.
- `OrderItem` is scoped only via `orderId`; cross-checks must always join through Order. Acceptable.
- `EtsyShop`, `EtsyListing`, `EtsyListingDraft`, `EbayListing`, `WixSite`, `ShopifyShop`, `TrendyolProduct` — all have `userId`. [NEEDS CONFIRMATION that every API route filters by it — see security #9.]
- `Credential` is `1:1` with `User` via `integrationSettings` relation. OK shape.
- `MarketplaceConfig` is keyed by `userId` + `name`. OK.

### Credential storage — Critical
- All tokens (`accessToken`, `refreshToken`, `apiKey`, `apiSecret`, `password`-equivalents on per-marketplace shops + on `Credential`) are typed as `String` and there is no `encrypt()` / `decrypt()` helper in `lib/` [NEEDS CONFIRMATION — agent did not find one]. Treat as plaintext.

### Relations / cascade
- `Account`, `Session`, `Order`, `MarketplaceConfig` → User have `onDelete: Cascade`. Good for GDPR delete.
- Need a per-model audit of remaining children (`EtsyShop`, `WixSite`, etc.) — agent did not enumerate. Risk: orphan rows on user delete.

### Index audit
- `Order` is well indexed.
- `OrderItem`: needs `@@index([orderId])` + `@@index([orderNumber])` if queried that way. [Confirm.]
- `EtsyListing`, `EbayListing`: need `(userId, status, updatedAt)` for the cached-listing-grid queries described in CLAUDE.md.
- `FinancialTransaction`: needs `(userId, source, transactionDate)`.
- `EtsyListingDraft`: needs `(userId, status)` for the "show me my pending drafts" view.

### Enum-vs-string
Fields stored as plain `String` that should be Prisma enums:
- `User.role` ('user' | 'admin')
- `User.subscriptionPlan`, `subscriptionStatus`, `billingInterval`, `billingProvider`
- `Order.status`, `labelStatus`, `shipmentStatus`, `externalStatus`, `fedexDutiesPaymentType`, `fedexPackagingType`, `fedexPickupType`, `fedexServiceType`, `labelStockType`, `signatureType`, `shippingChargesPaymentType`, `termsOfSale`
- `Shipment.status`, `carrier`, `serviceType`
- `EtsyListingDraft.status` (`draft|syncing|conflict|failed|synced|cancelled`)
- `LabelJob.status`
- `SyncOperation.status`

### Migration hygiene
- `prisma/migrations/001_add_etsy_addresses.sql` — non-standard naming. Confirm `_prisma_migrations` row exists on prod for this id, otherwise Prisma will try to re-apply.
- Root SQL files (`add_recipient_email*.sql`) are hand-applied; should be reflected in a single canonical migration.

### Json column abuse
- `Order.shippingAddress`, `Order.rawData`, `MarketplaceConfig.config`, `User.shippingSettings`, `EtsyListingDraft.fieldPatch/taxonomyPatch/inventoryPatch/variationImagesPatch/personalizationPatch/queuedActions`, `EtsyDraftSyncAttempt.requestPlan` — all `Json`. The draft patches are arguably correct (free-form), the address / shippingSettings / config should be structured to enable indexed lookups and validation. Wrap each with a Zod schema on write at minimum.

### Naming inconsistencies
- `OrderItem.recipientEmail` is `@map("recipient_email")` — the only snake_case column in the model. Pick one convention.
- `User.userAppsScriptId` vs `User.googleAccountId` — naming style drift.

---

## 6. Integration Audit (per marketplace)

### Etsy
- **Status**: Partial-to-mature; **TOS-risky** due to Chrome extension DOM scraping for tracking push.
- **Auth**: OAuth2, multi-shop. `lib/integrations/etsyClient.ts`, `pages/api/integrations/etsy/connect.ts` + `callback.ts`.
- **Token storage**: `EtsyShop` (multi-shop) + legacy fields on `Credential`. Plaintext.
- **Token refresh**: Implemented around `lib/integrations/etsyClient.ts:67-152` with locking.
- **Endpoints implemented**: receipts (orders), tracking submission, ledger, listing images, listing CRUD via `pages/api/clawd/etsy.ts` + draft pipeline (`lib/etsy/draftService.ts`, 55KB).
- **Missing**: webhook handling (Etsy doesn't expose order webhooks; pull-only is correct here), unified rate-limit / backoff, full bulk listing operations (drafts are partial).
- **Tests**: minimal.
- **Compliance risk**: Chrome extension scrapes Etsy Shop Manager DOM to push tracking numbers (per project memory). Etsy can revoke and block. The market research pages also fetch competitor data (`etsy-finance-plan.md`, `etsy-sales-boost-report.md` etc.) — confirm whether competitor shop data is shown to other users (resale risk).
- **Dead code**: probable duplicate `pages/api/etsy-addresses.ts` vs `pages/api/integrations/etsy/addresses.ts` [confirm].
- **Notable bugs**: per CLAUDE.md, May 2026 hardening exists but conflict drafts with queued `delete` actions can still wipe a real listing if force-synced.

### eBay
- **Status**: Production-grade for research and read; **listing write incomplete**.
- **Auth**: OAuth2 user token + app token fallback (`lib/integrations/ebayClient.ts`). Refresh implemented.
- **Token storage**: `Credential.ebayAccessToken/ebayRefreshToken/ebayTokenExpiresAt`. Plaintext.
- **Endpoints**: Browse, Sell Fulfillment, Sell Inventory (partial), Finances API for ad spend + settlements per memory.
- **Missing**: bulk listing CRUD, webhooks, variation/inventory sync.
- **Compliance risk**: Arbitrage scanner (`lib/arbitrage/`, `pages/api/clawd/arbitrage.ts`) systematically tracks eBay item prices. As long as it's per-tenant and not resold publicly, it sits inside Browse API ToS. Watch out if external users see other users' tracked competitors.
- **Tests**: e2e `test-ebay-*.mjs` at root, none in `__tests__/`.

### Trendyol
- **Status**: Partial, scraping-dependent.
- **Auth**: API key + secret stored in `Credential` (plaintext).
- **Primary path**: HTML scraping in `lib/integrations/trendyolSearch.ts`. Per `project_trendyol_public_api.md` memory, this is by design because the official supplier API does not cover competitor research.
- **Compliance risk**: **High.** Trendyol `robots.txt` typically prohibits broad scraping; running this against many shops from a single IP will get banned. Scraping is fine for *the user's own* products through their seller dashboard but treating Trendyol as a research data source is fragile and TOS-borderline.
- **Missing**: order ingest (no Trendyol order route found beyond research), listing CRUD, official-API client `lib/integrations/trendyolApiClient.ts` exists but unused.

### Shopify
- **Status**: Solid baseline.
- **Auth**: OAuth2 with refresh (`lib/integrations/shopifyClient.ts`).
- **Storage**: `ShopifyShop` (plaintext tokens).
- **Endpoints**: products, orders read, partial fulfillment.
- **Compliance**: clean.

### Wix
- **Status**: **Broken-by-design** — no token refresh.
- **Auth**: OAuth2 connect, but `lib/integrations/wixClient.ts` lacks a refresh path.
- **Storage**: `WixSite` (plaintext).
- **Impact**: integration silently dies a month after install. Users will assume product is broken.

### Amazon
- **Status**: Auth + token refresh only.
- **Auth**: LWA / SP-API (`lib/integrations/amazonClient.ts`).
- **Storage**: `Credential.amazonAccessToken/...` (plaintext).
- **Endpoints**: bones of reports + finance, no orders, no listings.
- **Verdict**: not launch-ready; hide the UI.

### Carriers (recap from §4B context)
- **FedEx**: real, full ETD path, validation. Production-ready.
- **UPS**: paperless invoice upload + label, IOSS supported. Production-ready.
- **MNG / DHL eCommerce**: JWT, two-step token flow, test/prod switch. Production-ready for TR domestic.
- **Shippo**: token in env, no runtime path. Dead.
- **Veeqo**: references remain but client unused. Dead.

### AI providers
- **Gemini** (`@google/generative-ai`): wired in arbitrage matcher and `pages/api/clawd/*` AI endpoints. No usage tracking per user.
- **Anthropic**: `@anthropic-ai/sdk` installed, **no imports**. Delete.
- **Two Google SDKs**: pick one.

### Cross-cutting integration issues
- **No unified MarketplaceConnector interface.** Each integration is bespoke (class for Etsy/Shopify, free functions for eBay/Trendyol). Adding the 7th marketplace requires copy-paste of error handling, rate-limit logic, mapper plumbing.
- **Inconsistent retry/rate-limit policy.** Etsy has none, eBay has a sophisticated `ebayRateLimiter.ts`, Shopify has hand-coded 2 req/s, Trendyol has none.
- **No webhook surface** for any marketplace (everything is pull). Plan to add Shopify + eBay webhooks (Etsy doesn't offer order webhooks).

---

## 7. Etsy Commercial API Readiness

### What scopes does the app request?
[NEEDS CONFIRMATION — grep for `ETSY_SCOPES` / scopes array in `lib/integrations/etsy*.ts` and `pages/api/integrations/etsy/connect.ts` returned no hits. Verify by reading those files.] Etsy normally needs at minimum: `listings_r`, `listings_w`, `transactions_r`, `transactions_w`, `address_r`, `address_w`, `email_r`, `shops_r`, `shops_w` for the features the code exercises. Confirm the scopes string before submitting for review.

### Seller-authorized data only?
- Direct receipts ingest, tracking submission, ledger, listing CRUD — all are within the connected seller's shop. Compliant.
- Listing image upload, video upload, taxonomy lookup — compliant.
- **Concern**: market research / competitor data (`etsy-finance-plan.md`, `etsy-sales-boost-report.md`, "Etsy shop deep analysis" feature per memory) — if it reads *other* shops, you must rely on Etsy's public listing search API and cannot store or display competitor PII (`buyer name`, etc.). If any of those features stash competitor data in your DB beyond the official cache rules, that is a fail.

### Listing editing compliance
- Edits are user-initiated through `pages/api/etsy-drafts/*` + UI. The staging→sync model with explicit "Sync to Etsy" button is exactly what Etsy review wants.
- The Chrome extension is the only piece that uses unsupported automation (DOM submit) on the seller's own panel. Frame it as user-initiated browser automation for the seller's own data; otherwise drop it.

### Risky features to disable/hide before Etsy review
- The Chrome extension's DOM automation against `etsy.com`.
- Any AI feature that scrapes a competitor shop and shows their listings as a "shop spy" tool.
- `pages/api/clawd/*` — the URL itself looks like an internal/non-customer-facing route; rename to `pages/api/research/*` so reviewers don't probe it.
- Arbitrage scanner targeting Etsy (verify it doesn't, only references Trendyol→eBay per memory).
- `pages/api/debug-etsy-matching.ts` — kill before submission.

### Safe 500-char Etsy app description
> KolayXport is a cross-border e-commerce operations dashboard for sellers who use Etsy alongside other channels. We connect to the seller's Etsy shop with their consent to import orders, fetch buyer-authorized shipping addresses, edit their listings (titles, tags, photos, variations, personalization) through a staged-draft workflow, generate international shipping labels, push tracking numbers back to Etsy, and produce export/customs documents. All data stays inside the seller's account; no buyer PII is shared with third parties.

(Length: ~520 chars — trim if Etsy's limit is hard 500.)

### Longer email draft to `developers@etsy.com`
```
Subject: KolayXport — review request for production access

Hi Etsy Developer Team,

We're applying for production-tier access for KolayXport, a SaaS that helps Turkish-based Etsy sellers manage cross-border fulfillment. We currently have an approved development app and would like to graduate.

What the integration does, on behalf of the connected seller only:
1. Imports the seller's open and shipped receipts plus buyer-provided shipping addresses (transactions_r, address_r) so the seller can generate international shipping labels.
2. Lets the seller edit their own listings — title, description, tags, taxonomy, variations, personalization, photos, video — through a staged "draft" workflow. Nothing is pushed to Etsy until the seller clicks "Sync to Etsy" (listings_w, shops_w).
3. Pushes tracking numbers and carriers back to Etsy after the seller buys a label inside KolayXport (transactions_w).
4. Reads the seller's ledger entries (shops_r) to reconcile their payouts against the labels and customs documents we generate.

What we do not do:
- We never share, sell, resell, or expose any data we receive from Etsy to other KolayXport users or third parties.
- We do not contact buyers directly from data we receive from Etsy.
- We do not store buyer payment instruments or full payment data.
- Any aggregated reporting we show the seller is computed from their own data only.

Compliance notes:
- We store OAuth tokens encrypted at rest, scoped per shop, and refresh them server-side.
- We respect Etsy's published rate limits and back off on 429s.
- We log API failures internally only and redact PII before logging.
- We support shop disconnect: when a seller revokes our app or deletes their KolayXport account, we delete their Etsy-derived data within 30 days.

Scopes we request and why:
- listings_r/w — for the draft listing editor
- transactions_r/w — for orders + tracking submission
- address_r — for shipping label generation
- shops_r/w — for shop metadata + ledger
- email_r — for sending order updates from the seller's own SMTP only

We'd appreciate a review of our production application. Happy to schedule a screen-share to walk through the flows.

— KolayXport team
```

---

## 8. Product Readiness Assessment

Scores reflect "would you bet money this works for the next 100 paying users." 1 = nothing, 10 = ship to TechCrunch.

| Module | Score | Reason |
|---|---|---|
| Auth | 6 | Signup/login works; no email verification, no password reset, role model is binary |
| Etsy order/address import | 7 | Direct Receipts ingest is solid, multi-shop, address enrichment present |
| Etsy listing manager | 5 | Draft workflow is clever but a partial sync can still wipe a listing if conflict logic is bypassed; needs more safety nets |
| eBay listing/order tools | 5 | Research stack is strong; listing CRUD partial |
| Trendyol tools | 3 | Scraping-based; brittle; will break the day Trendyol changes DOM |
| Shopify | 6 | Read paths solid; no writes |
| Wix | 3 | No token refresh — will silently die |
| Amazon | 2 | Auth only |
| Shipping labels | 7 | FedEx + UPS + MNG real; no background tracking sync |
| Export documents / proforma | 6 | ETGB Excel + Paraşüt invoice + SMTP is real; no in-app proforma PDF |
| Tracking sync | 4 | Only push-out; no reconcile-status cron |
| Billing | 7 | Stripe end-to-end; no dunning; iyzipay unwired |
| Admin | 4 | Read-only stats; no impersonation/audit |
| Finance / profit analytics | 6 | Multi-marketplace ingest with `FinancialTransaction` + `FinancialSyncCursor` is real per memory |
| AI tools | 5 | Useful but no usage tracking, no abuse limits, no per-tenant cost cap |
| **Overall launch readiness** | **5** | Core path (Etsy → label → ETGB → tracking → Stripe) works. Security debt and Wix/Amazon/Trendyol fragility block a confident wide launch. |

---

## 9. Recommended Launch Scope

Target ICP: Turkish Etsy/eBay sellers shipping internationally. Positioning: cross-border e-commerce command center. Cut everything that doesn't serve that ICP.

### KEEP (the v1 happy path)
- NextAuth + Google + email/password (after adding email verification + password reset)
- Etsy connect → order import → tracking submission
- Etsy listing draft editor (single-listing flow; gate bulk behind a "beta" flag until safer)
- eBay connect → order import → tracking submission
- FedEx + UPS labels (international)
- MNG label (TR domestic)
- ETGB micro-export Excel + Paraşüt invoice + email
- Stripe checkout + plan limits + billing portal
- i18n (TR/EN)
- Chrome extension only for the tracking push UX (frame as "we drive your browser, you click the button")

### HIDE behind a feature flag for now
- Amazon integration (UI hidden, code stays for future)
- Wix (until token refresh ships)
- AI research tabs that hit third-party listings (Etsy / eBay competitor research)
- Arbitrage scanner (legal-review needed for Trendyol scraping)
- Trendyol (until you commit to either official API or paid scraping infra with rotating IPs)
- Bulk Etsy delete / publish / deactivate from drafts (single most expensive bug; keep behind a "I understand" confirm)
- Admin dashboard (until audit log + 2FA exists)

### DELETE
- `kolay-xport/` (Wix Astro abandoned project)
- `etsy-dom-inspector/`
- `fedex folder/`
- `velascreenshots/` (after archiving useful refs)
- 17 chrome-extension `*.zip` at repo root
- 7 root-level screenshots
- `NabavkiData_EIC_Pitch_Deck.pdf`
- `pages/api/setScriptProps.js`
- `pages/api/gscript/`
- `pages/api/debug-etsy-matching.ts`
- `lib/marketplace_adapters/veeqo_adapter.js`
- `lib/integrations/veeqo.ts` and Veeqo type definitions if no live tenant uses it
- `@anthropic-ai/sdk`, `@auth0/nextjs-auth0`, `@supabase/ssr`, `iyzipay`, `jest`, `jest.config.js`, `jest.setup.js`
- Pick one of `@google/genai` vs `@google/generative-ai`; delete the other
- Root-level test/debug `.ts`/`.mjs` files (move what's worth keeping to `scripts/`)
- 3 root `recipient_email*.sql` files
- `User.googleSheetId`, `User.driveFolderId`, `User.userAppsScriptId`, `User.googleAccountId` (migration after confirming no callers)

### POSTPONE
- Webhook surface for marketplaces
- Multi-region rollout
- Mobile-app
- Public API for partners
- Affiliate/referral system

### REWRITE
- `lib/auth.ts` integration with a `requireOwned` middleware (security #9)
- `lib/logger.ts` with PII/secret redaction
- Credential storage layer (`lib/crypto/credentials.ts` envelope encryption)
- A single `MarketplaceConnector` interface + per-marketplace adapter (see rebuild plan)
- A single `CarrierConnector` interface (FedEx/UPS/MNG)

### MUST FIX BEFORE USERS
- Critical/High security findings 1–14 in §4
- Token refresh for Wix (or hide Wix)
- Webhook signature verification for Wix (or hide Wix)
- Email verification + password reset
- PII/secret redaction in logger
- Credential at-rest encryption
- Constant-time CRON_SECRET comparison
- Ownership check audit across the ~18 routes flagged
- Sentry actually wired with PII scrubbing

---

## 10. Action Plan (Prioritized)

Severity → priority: **P0 = blocker for prod**, **P1 = blocker for paid launch**, **P2 = cleanup/maintainability**, **P3 = growth/features**.

### P0 — Security blockers
| # | Task | Files | Impact | Difficulty | Acceptance |
|---|---|---|---|---|---|
| P0-1 | Delete `pages/api/setScriptProps.js` | that file, also confirm no UI references | Removes credential-in-logs vector | Trivial | Route returns 404; `grep -rn 'setScriptProps'` clean |
| P0-2 | Add auth + per-user prefix to `pages/api/clawd/serve-image.ts` | that file, `lib/auth.ts` | Closes anon file-read | Easy | Anonymous request → 401; cross-user request → 403; integration tests added |
| P0-3 | Verify + add Wix JWT webhook signature with JWKS | `pages/api/integrations/wix/webhook.ts` | Closes webhook-forgery account-link | Medium | Forged JWT rejected; replay test passes |
| P0-4 | Constant-time CRON_SECRET comparison | 3 cron files in `pages/api/cron/*` | Closes timing leak | Trivial | Test with one-byte-off secret returns 401 in constant time |
| P0-5 | Encrypt all credential token columns at rest | `lib/crypto/credentials.ts`, every read/write site | Closes "one DB dump" risk | Hard | New rows are AES-GCM; backfill migration; decrypt-on-read path |
| P0-6 | Bind OAuth state to session for Etsy + Amazon (eBay/Shopify already do) | `pages/api/integrations/etsy/connect.ts`, `callback.ts`; `pages/api/integration/amazon/callback.ts` | Closes OAuth replay → account link | Medium | State only validates with matching session cookie |
| P0-7 | Add `requireOwned` middleware + apply to every `[id]` route | new `lib/middleware/requireOwned.ts`, ~18 routes | Closes cross-tenant write/read | Medium | Integration test for each route: user A's id, user B's token → 404 |
| P0-8 | Sanitize error responses from `pages/api/user/settings.ts` and other internal-error returners | grep `res.status(500).json({ error: e` | Closes info-leak | Easy | All 500s return `{ error: 'Internal error' }`; full trace in Sentry |
| P0-9 | Remove `Access-Control-Allow-Origin: *` from `pages/api/ext/telemetry.ts` (or remove route) | that file | Closes CSRF/log-poisoning | Easy | OPTIONS preflight from arbitrary origin denied |
| P0-10 | Pin extension origin in `pages/api/auth/extension.ts` | that file + env var `OFFICIAL_EXTENSION_ID` | Closes hostile-extension impersonation | Easy | Wrong extension ID → 403 |
| P0-11 | Logger redaction | `lib/logger.ts` | Closes credential-leak via logs | Easy | Adding `accessToken: 'x'` to log payload stored as `accessToken: '[REDACTED]'` |
| P0-12 | Email verification + password reset | NextAuth Email provider, new route, email templates | Required for any consumer SaaS | Medium | E2E flow works; resend works; tokens single-use + expire 1h |

### P1 — Functional/launch blockers
| # | Task | Files | Impact | Difficulty | Acceptance |
|---|---|---|---|---|---|
| P1-1 | Wix token refresh OR hide Wix in UI | `lib/integrations/wixClient.ts`, Wix UI | Stops Wix from silently breaking | Medium | Token expiry test passes; if hidden, Wix card replaced with "Coming soon" |
| P1-2 | Background tracking-status reconciliation cron | new `pages/api/cron/tracking-reconcile.ts`, `vercel.json` or systemd timer | Users see live delivery status | Medium | Stale `trackingNumber` rows get refreshed daily |
| P1-3 | Resolve Hetzner vs Vercel cron contradiction | `vercel.json`, systemd timer config | Avoids double-runs or zero-runs | Easy | Decide; one runs, other deleted |
| P1-4 | Stripe dunning loop (retry failed payments, notify user) | `pages/api/stripe/webhook.ts`, email templates | Reduces churn from payment failures | Medium | `invoice.payment_failed` triggers user email + retry schedule |
| P1-5 | Sentry wiring + PII scrubber | `sentry.client.config.ts`, `sentry.server.config.ts`, `beforeSend` | Real observability | Easy | Test error appears in Sentry dashboard; tokens not present |
| P1-6 | Unified rate-limit / 429-backoff per marketplace client | `lib/integrations/*Client.ts` | Stops cascading failures | Medium | Smoke test: 429 from a marketplace causes back-off, not error toast |
| P1-7 | Bulk Etsy draft sync guardrails | `lib/etsy/draftService.ts`, `pages/api/etsy-drafts/bulk-sync.ts` | Avoid wiping live listings via stale `queuedActions: delete` | Medium | Drafts with `queuedActions` containing delete require typed confirmation |
| P1-8 | Webhook signature verify on Shopify + Etsy event webhooks if any | `pages/api/shopify/webhooks/*` | Closes webhook-forgery for those tenants | Medium | Forged signature rejected |
| P1-9 | Per-user AI usage cap | `pages/api/clawd/*`, `pages/api/ai/*` | Stops cost runaway | Medium | Free tier hit → 429; logged |

### P2 — Cleanup
| # | Task | Files | Impact | Difficulty | Acceptance |
|---|---|---|---|---|---|
| P2-1 | Repo-root junk purge | see §3 | Repo is reviewable | Easy | `git status` clean; `du -sh .` smaller |
| P2-2 | Delete `kolay-xport/`, `etsy-dom-inspector/`, `fedex folder/`, `velascreenshots/` | those dirs | Reclaim disk + reduce confusion | Easy | Gone |
| P2-3 | Convert remaining `.js` in `pages/`, `components/` to `.ts/.tsx`, set `strict: true` | many | Catch type bugs at compile | Hard | `tsc --noEmit` clean |
| P2-4 | Replace string enums with Prisma enums | `prisma/schema.prisma`, callers | Bug-class elimination | Medium | All enum-shaped fields use Prisma `enum`s; migration green on prod |
| P2-5 | Rename `pages/api/clawd/*` to `pages/api/research/*` | those routes + clients | Removes internal code name from URLs | Easy | UI calls new paths; old path returns 410 |
| P2-6 | Standard `{ ok, data, error }` API response shape | `lib/api/response.ts` + every handler | Frontend consistency | Medium | All `pages/api/*` use shared helper |
| P2-7 | Drop unused deps: `@anthropic-ai/sdk`, `@auth0/nextjs-auth0`, `@supabase/ssr`, `iyzipay`, `jest`, `jest-environment-jsdom`, one of the Google AI SDKs | `package.json` | Bundle + audit surface | Easy | `npm ls` clean; build passes |
| P2-8 | Drop legacy Google Apps Script fields from `User` + delete `pages/api/gscript/` + `pages/api/setScriptProps.js` (already P0-1) | schema + migration | Schema clarity | Medium | Prisma migration applied; no callers |
| P2-9 | Consolidate 3 root `recipient_email*.sql` into a single canonical Prisma migration record | `prisma/migrations/` | Migration history coherent | Easy | `_prisma_migrations` reflects the truth |
| P2-10 | Dead components purge | `components/*.js`, `components/{amazon,ebay,trendyol}/*` per agent | Smaller surface | Medium | `npx ts-prune` or manual reference check; orphans deleted |

### P3 — Growth / features
| # | Task | Files | Impact | Difficulty | Acceptance |
|---|---|---|---|---|---|
| P3-1 | `MarketplaceConnector` interface + per-marketplace adapters | new `lib/connectors/marketplace/*` | Faster to add new channel | Hard | New Hepsiburada / Allegro takes <2 weeks |
| P3-2 | `CarrierConnector` interface + per-carrier adapters | new `lib/connectors/carrier/*` | Faster to add new carrier | Medium | UPS Worldwide Express SKU added in 1 day |
| P3-3 | In-app proforma + commercial invoice PDFKit | `lib/services/proformaService.ts` | Self-serve customs docs | Medium | Generated PDF passes a TR customs sample template |
| P3-4 | Per-user webhooks panel (eBay + Shopify events) | new routes + UI | Live updates | Medium | Event drives UI inside 10s |
| P3-5 | Admin audit log + 2FA gate | new `AdminAuditLog`, `withAdmin` upgrade | Compliance / trust | Medium | Every admin write logged + visible to user |
| P3-6 | Move cron from HTTP to a proper queue (BullMQ + Redis) | new infra | Reliability | Medium | Failures auto-retry; visible queue dashboard |
| P3-7 | Affiliate / referral | new tables, routes | Growth | Medium | First referral pays out |

---

## 11. KOLAYXPORT_REBUILD_PLAN.md
See sibling file `KOLAYXPORT_REBUILD_PLAN.md` in repo root.

---

## Confidence + caveats

- All file paths cited are real. Quoted line numbers come from agent grep output and have not been individually re-read; spot-check before acting on a precise diff.
- Items tagged `[NEEDS CONFIRMATION]` were not directly inspected end-to-end:
  - Etsy OAuth scope list (could not locate constant in the small slice grepped)
  - Wix webhook JWT signature verification specifics
  - Exact number of `[id]` routes missing ownership checks (agent claimed ~18)
  - Whether any `encrypt(...)` helper exists for credentials
  - Whether `MarketplaceProduct` and `Inventory` have any writers
  - Whether `NEXT_PUBLIC_*` env vars hide any real secret
- The earlier audit claim that `.env` and `.env.local` are committed is **wrong** — `.gitignore` covers them (lines 3, 76, 77, 124). Verified via `git ls-files | grep -E '^\.env'` returning only `.env.example`.
- `kolay-xport/` (799MB) is gitignored (line 180); it bloats local disk only, not the repo.
- The codebase is in better shape than the noise at repo root suggests; the core flow (auth → marketplace connect → label → ETGB → Stripe) is real. The blockers are security debt, Wix breakage, and clean-up — not "rebuild from scratch."
