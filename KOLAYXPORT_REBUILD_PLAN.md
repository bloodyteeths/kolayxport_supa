# KOLAYXPORT_REBUILD_PLAN

Companion document to `KOLAYXPORT_AUDIT.md`. Goal: the smallest set of disciplined patterns that the existing code can be **migrated into incrementally** — not a from-scratch rewrite. Every section answers "what is the canonical way to do X in this repo going forward?"

---

## 1. Recommended folder / module structure

Goal: one obvious home per concern. Migrate gradually; don't move everything in one PR.

```
.
├─ app-config/                 # central app constants (plans, marketplaces, carriers, scopes)
├─ pages/                      # Next.js Pages Router (unchanged for now)
│  ├─ api/
│  │  ├─ auth/                 # NextAuth + signup + verify + reset
│  │  ├─ marketplaces/
│  │  │  ├─ etsy/              # connect, callback, status, addresses, orders, listings, drafts
│  │  │  ├─ ebay/
│  │  │  ├─ shopify/
│  │  │  ├─ wix/
│  │  │  ├─ amazon/
│  │  │  └─ trendyol/
│  │  ├─ carriers/
│  │  │  ├─ fedex/
│  │  │  ├─ ups/
│  │  │  └─ mng/
│  │  ├─ orders/               # cross-marketplace order ops
│  │  ├─ labels/                # carrier-agnostic label endpoints
│  │  ├─ research/              # was pages/api/clawd/* — rename
│  │  ├─ ai/                    # gemini-backed assistant endpoints
│  │  ├─ etgb/                  # micro-export workflow
│  │  ├─ billing/               # was pages/api/stripe/*
│  │  ├─ admin/                 # admin-only
│  │  ├─ cron/                  # cron-only routes
│  │  └─ webhooks/              # marketplace + payments webhooks (separate from cron)
│  └─ app/                     # all authenticated user-facing pages
├─ lib/
│  ├─ auth/                    # auth.ts, getAuthUser, getAuthUserOrApiKey, requireOwned
│  ├─ crypto/                  # credential envelope encryption helpers
│  ├─ db/                      # prisma client + small repo helpers
│  ├─ http/                    # apiHandler wrapper, response shape, errors
│  ├─ logger/                  # logger + redactor + sentry bridge
│  ├─ connectors/
│  │  ├─ marketplace/          # one folder per marketplace, all implement MarketplaceConnector
│  │  │  ├─ etsy/
│  │  │  ├─ ebay/
│  │  │  ├─ shopify/
│  │  │  ├─ wix/
│  │  │  ├─ amazon/
│  │  │  └─ trendyol/
│  │  └─ carrier/              # one folder per carrier, all implement CarrierConnector
│  │     ├─ fedex/
│  │     ├─ ups/
│  │     └─ mng/
│  ├─ drafts/                  # was lib/etsy/, lib/ebay/ — listing-draft staging
│  ├─ services/                # cross-cutting business services: etgb, invoice, finance, sync
│  ├─ mappers/                 # external → internal Order / Listing / Address
│  ├─ middleware/              # withAuth, withAdmin, withUsageLimiter, requireOwned, withRateLimit
│  └─ types/                   # shared domain types
├─ prisma/
├─ components/
├─ messages/                   # i18n
├─ scripts/                    # one-off scripts, debug, smoke (was root junk)
└─ docs/                       # internal docs, research, screenshots
```

What to move first (low-risk, high-clarity):
1. Rename `pages/api/clawd/` → `pages/api/research/`. Keep old paths as `307 → new` for one release.
2. Move `lib/etsy/` and `lib/ebay/` under `lib/drafts/etsy/` and `lib/drafts/ebay/`.
3. Create `lib/connectors/` and migrate one marketplace at a time behind the new interface.

---

## 2. Naming cleanup

| From | To | Where | Notes |
|---|---|---|---|
| `package.json name = "mybaby-sync-product"` | `"kolayxport"` | package.json | Cosmetic |
| `pages/api/clawd/*` | `pages/api/research/*` | filesystem + clients | Remove internal code name |
| `CLAWD_API_KEY` env | `KOLAYXPORT_INTERNAL_API_KEY` | `.env`, `lib/auth.ts` | Rotate at the same time |
| `lib/marketplace_adapters/` | delete | filesystem | Dead |
| `clawd*` references in PR titles / commit messages | n/a | going forward | Stop using "clawd" |
| `User.googleSheetId`, `driveFolderId`, `userAppsScriptId`, `googleAccountId` | drop | Prisma migration | After confirming no callers |
| `OrderItem.recipientEmail` `@map("recipient_email")` | rename to plain camelCase column | migration | Get rid of mixed casing |
| `setScriptProps.js` | delete | filesystem | Confirmed leaks creds via `console.info` |
| `pages/api/debug-etsy-matching.ts` | delete | filesystem | Debug route in prod |
| `userIntegrationSettings` references | replace with `Credential` | grep | Schema model is `Credential` |

---

## 3. API route standards

Every route under `pages/api/*` must follow this skeleton. Keep it boring.

```ts
// pages/api/some/route.ts
import { apiHandler } from '@/lib/http/apiHandler';
import { requireAuth, requireOwned } from '@/lib/middleware';
import { z } from 'zod';

const Body = z.object({ orderId: z.string().cuid() });

export default apiHandler({
  POST: async ({ req, res, user }) => {
    const { orderId } = Body.parse(req.body);
    const order = await requireOwned('order', orderId, user.id);
    // ...do the thing...
    return { ok: true, data: { id: order.id } };
  },
}, { auth: requireAuth });
```

Rules:
- Default export must be `apiHandler({...})`.
- One file = one resource. Multiple HTTP methods in the same handler.
- All input validated by Zod; no `req.body as any`.
- All DB reads/writes that take an `id` from the request go through `requireOwned(model, id, userId)`.
- No `console.log` outside `lib/logger`.
- No raw `res.status(500).json({ error: e.message })`. Use `throw new HttpError(...)` and let `apiHandler` translate.

---

## 4. Auth / authorization standard

Single source of truth: `lib/auth/index.ts`.

- `getAuthUser(req, res)`: returns `{ id, email, name }` or null. NextAuth session cookie OR `Authorization: Bearer <jwt>` OR `X-Extension-Auth: Bearer <jwt>` (extension only, with origin pin).
- `getAuthUserOrApiKey(req, res, { allowedKeys })`: never accepts the key from query string; header only; logs `Cache-Control: no-store`.
- `requireAuth(handler)`: wraps a handler so `user` is always defined; rejects with 401 otherwise.
- `requireAdmin(handler)`: wraps `requireAuth` + checks `user.role === 'admin'`. Logs every admin call to `AdminAuditLog`.
- `requireOwned<T>(model: 'order' | 'etsyListing' | ..., id: string, userId: string)`: throws `HttpError(404)` if the row doesn't exist or isn't owned. Single chokepoint for tenant isolation.
- Roles: only `user` and `admin` for now. Don't grow this without an RFC.

Hard rule: no Prisma query in a route handler may omit the userId filter on tenant-owned tables. The handler must either:
1. Call `requireOwned(...)`, or
2. Pass `{ where: { ..., userId: user.id } }` explicitly.

Static check (cheap): add an ESLint rule or simple grep guard in CI that flags `prisma.<tenantTable>.findUnique` and `prisma.<tenantTable>.update` without `userId` in the same expression.

---

## 5. Error response standard

```ts
// success
{ ok: true, data: T }

// failure
{ ok: false, error: { code: string, message: string, fields?: Record<string,string> } }
```

`HttpError(status, code, message, fields?)` thrown anywhere in a handler is translated by `apiHandler`. Internal stack traces never leak to clients; they go to Sentry.

Codes (initial set):
- `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`
- `VALIDATION_ERROR`
- `RATE_LIMITED`, `PLAN_LIMIT`
- `MARKETPLACE_UNAVAILABLE`, `MARKETPLACE_AUTH_EXPIRED`
- `CARRIER_REJECTED`
- `INTERNAL_ERROR` (fallback)

The frontend uses `error.code` to switch on, never the message.

---

## 6. Logging standard

`lib/logger/index.ts` is the only allowed logger.

- Levels: `debug`, `info`, `warn`, `error`. `debug` is dropped in production.
- All payloads go through a redactor that masks keys matching `/token|secret|password|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization/i` and known nested paths (`oauth.access_token`, `tokenResponse`, `body`, `headers.authorization`, etc.).
- Every log call carries `userId` if available.
- Errors are forwarded to Sentry via `sentry.server.config.ts`, with the same redactor in `beforeSend`.
- `SyncLog` model continues to receive structured records but only writes the redacted payload.

Forbidden:
- `console.log` / `console.info` / `console.error` outside `lib/logger`.
- Logging request bodies verbatim. Use whitelist: log only known keys (`marketplace`, `orderId`, `count`).

---

## 7. Integration abstraction standard — `MarketplaceConnector`

Every marketplace adapter implements:

```ts
export interface MarketplaceConnector {
  readonly marketplace: 'etsy' | 'ebay' | 'shopify' | 'wix' | 'amazon' | 'trendyol';

  // Auth
  getAuthorizeUrl(args: { userId: string; csrf: string }): string;
  handleCallback(args: { userId: string; query: Record<string,string>; cookies: Record<string,string> }): Promise<void>;
  refreshTokenIfNeeded(userId: string, shopRef?: string): Promise<void>;
  disconnect(userId: string, shopRef?: string): Promise<void>;

  // Listings (optional — null if unsupported)
  listings?: {
    list(userId: string, q: ListingQuery): Promise<Page<MarketplaceListing>>;
    get(userId: string, listingId: string): Promise<MarketplaceListing | null>;
    update(userId: string, listingId: string, patch: ListingPatch): Promise<MarketplaceListing>;
    delete?(userId: string, listingId: string): Promise<void>;
    uploadMedia?(userId: string, listingId: string, file: MediaFile): Promise<MarketplaceMedia>;
  };

  // Orders
  orders: {
    list(userId: string, q: OrderQuery): Promise<Page<MarketplaceOrder>>;
    submitTracking(userId: string, orderRef: string, tracking: TrackingPayload): Promise<void>;
  };

  // Finance (optional)
  finance?: {
    listTransactions(userId: string, q: FinanceQuery): Promise<Page<FinancialTransaction>>;
  };

  // Webhooks (optional)
  webhooks?: {
    verify(req: Request): Promise<{ event: string; payload: unknown } | null>;
    handle(userId: string, event: { event: string; payload: unknown }): Promise<void>;
  };
}
```

Conventions:
- Every implementation lives under `lib/connectors/marketplace/<name>/`.
- File layout: `index.ts` (exports the connector), `client.ts` (HTTP client + retry/backoff/rate-limit), `mapper.ts` (raw → internal), `auth.ts` (OAuth flow).
- All transient errors (5xx, 429) go through a single `withRetry` helper. All 4xx surface as `MarketplaceError(code)` for the route layer to translate.
- The connector never logs the body or headers of a marketplace response.
- Tokens are read/written via `lib/crypto/credentials.ts`; the connector never touches the raw column.

Registry: `lib/connectors/marketplace/index.ts` exports `getMarketplaceConnector(marketplace)`. Routes get adapters from the registry, not from per-file imports.

---

## 8. Carrier connector standard — `CarrierConnector`

```ts
export interface CarrierConnector {
  readonly carrier: 'fedex' | 'ups' | 'mng';
  quote(args: QuoteArgs): Promise<Quote[]>;
  createLabel(args: CreateLabelArgs): Promise<LabelResult>;
  cancelLabel(args: CancelArgs): Promise<void>;
  trackStatus(trackingNumber: string): Promise<TrackingStatus>;
  uploadCommercialInvoice?(args: InvoiceUploadArgs): Promise<void>; // UPS paperless, FedEx ETD
}
```

Same conventions as marketplace connectors. The order route picks the carrier from `ShipperProfile` defaults and delegates.

---

## 9. Database ownership rules

- Every tenant table has a non-null `userId` column.
- Every tenant table has `onDelete: Cascade` on the user relation.
- Every tenant table has `@@index([userId])` plus the most common secondary key (`(userId, status, updatedAt)` for listing-like tables; `(userId, marketplace, marketplaceKey)` for orders).
- All marketplace-derived rows include a stable `remoteId` and a unique `(userId, marketplace, remoteId)` constraint so re-sync is idempotent.
- Prisma enums replace string-typed enum columns (see audit §5).
- `Json` columns are wrapped with a Zod schema on write; the schema lives next to the model in `lib/types/`.
- Plain hard-deletes are reserved for user-initiated actions. Sync operations use soft delete (`deletedAt`) to survive bad merges.

Credentials specifically:
- All tokens go through `lib/crypto/credentials.ts` (AES-GCM, key from `CREDENTIAL_ENCRYPTION_KEY` env, never logged).
- Migration: introduce `${field}Encrypted` columns, dual-write for one release, backfill, then drop the plaintext column.

---

## 10. Testing strategy

- **Unit** (Vitest, jsdom): all mappers + utilities + connectors with mocked HTTP. Goal: 80% line coverage on `lib/connectors/*` and `lib/mappers/*`.
- **API** (Vitest, node env): per-route integration test that boots Next.js handler with a real Prisma test DB (Postgres via Docker). Required for every route that mutates data.
- **E2E smoke** (Playwright): one happy path — signup → connect a fake Etsy shop → import an order → buy a label → push tracking. Runs against a staging deploy.
- **Multi-tenant negative tests**: for every `[id]` route, a paired test that creates two users and asserts user B cannot read/write user A's rows. Add a fixture helper `makeTwoTenants()` to make this cheap.
- **Webhook signature tests**: for every webhook route, one happy-path-with-correct-signature test and one forged-signature test.
- Delete Jest config + setup files; vitest is canonical.

CI:
- `pnpm/npm test` runs unit + api in parallel.
- Playwright smoke runs nightly on staging and on tag pushes.

---

## 11. Deployment checklist

Production environment = Hetzner systemd (`kolayxport.service`).

Before every prod deploy:
- [ ] `npx prisma generate && npm run build` is green locally
- [ ] No new `console.log` outside `lib/logger`
- [ ] No new `any` in changed files (lint rule)
- [ ] No new untyped `req.body` parsing
- [ ] CHANGELOG entry includes migration notes if Prisma migration was added
- [ ] Sentry events tagged with `release = <git sha>`
- [ ] If schema changed: `prisma migrate deploy` order is documented (down → app off → migrate → app on, if columns drop)

Cron source-of-truth:
- Pick one: Hetzner systemd timers **OR** GitHub Actions cron hitting prod. Delete `vercel.json` cron block if Hetzner wins.
- Cron secret is rotated every 90 days; comparison is `crypto.timingSafeEqual`.

Secret management:
- Production `.env` lives only in `/home/deploy/kolayxport/.env` on Hetzner. Local dev uses `.env.local`. Neither is in git.
- All marketplace tokens stored in Postgres are encrypted; the master key (`CREDENTIAL_ENCRYPTION_KEY`) is set on the VPS and not checked in anywhere.

Migration ordering for the cleanup work (suggested branches):
1. `chore/repo-hygiene` — delete junk, gitignore additions, drop unused deps. No code logic changes.
2. `feat/security-p0` — items P0-1 through P0-11 from the audit's action plan.
3. `feat/auth-completeness` — email verification, password reset (P0-12).
4. `feat/credential-encryption` — encrypt token columns at rest (P0-5).
5. `feat/connector-interface-foundation` — introduce `MarketplaceConnector` + `CarrierConnector` + registry. No new behavior; one marketplace migrated as a proof.
6. `feat/migrate-etsy-to-connector` — switch Etsy to the connector pattern. Use this PR to also fix the bulk-sync `queuedActions` safety.
7. `feat/wix-token-refresh` — fix Wix or hide it.
8. `chore/enum-migration` — string → Prisma enum.

Each branch should ship to staging behind a feature flag where applicable and be reverted-able in one commit.

---

## 12. Out of scope (intentionally)

These are not in this plan because they would expand it beyond rebuild discipline:
- Switching the framework (Pages → App Router) — wait for the security debt to land.
- Multi-region hosting.
- A queue (BullMQ/Redis) — yes eventually (audit P3-6), no for the rebuild plan.
- Public partner API.
- Mobile app.

---

## Confidence + caveats

- This plan is intentionally non-disruptive: every section can be adopted incrementally without freezing the codebase.
- Items dependent on `[NEEDS CONFIRMATION]` tags in the audit (Etsy scopes, Wix JWT verification specifics, exact list of ownership-check gaps) must be checked before writing the corresponding migration PR.
- The connector interfaces above are deliberately small. Resist adding methods until two marketplaces or two carriers need them — premature interface = future churn.
