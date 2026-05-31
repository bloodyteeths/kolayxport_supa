# ADMIN_MONITORING_AUDIT

Goal: turn the existing `/admin` page into an internal SaaS monitoring & ops cockpit. No external observability tooling (no Sentry). Everything is fed by Postgres + the redacted logger.

Audited 2026-05-31.

---

## 1. Existing admin surface

### Pages
- `pages/admin/index.tsx` — single page, three tabs (`overview`, `users`, `activity`). Uses SWR to fetch `/api/admin/dashboard`. Includes an `EditUserModal` that PATCHes `/api/admin/users/[userId]`.

### API routes
- `pages/api/admin/dashboard.ts` — aggregates: total users, recent users (30d), users grouped by plan + status, total orders, recent orders (7d), orders by marketplace, total shipments, recent `SyncOperation` rows, full user list with `_count.orders`/`_count.etsyShops`.
- `pages/api/admin/users/[userId].ts` — GET (full user record minus password) + PATCH allowed fields: `role`, `subscriptionPlan`, `subscriptionStatus`, `orderSyncCount`, `labelCount`, `trialExpiresAt`, `usageResetAt`.

### Middleware
- `lib/middleware/withAdmin.ts` — `getAuthUser` → `prisma.user.findUnique({where:{id},select:{role}})` → `role !== 'admin'` returns 403. Binary role only.

### Components
- No `components/admin/*` dir today. All admin UI lives inline in `pages/admin/index.tsx`.

### Existing instrumentation that the cockpit can consume

| Source | What it carries today | What it doesn't carry |
|---|---|---|
| `SyncLog` (`lib/logger.ts`) | level (`info`/`warn`/`error`/`debug`), message, optional userId, optional operation, redacted `details`, optional error string, timestamp | no `category` — can't filter by `cron`/`integration`/`billing`/`extension`/`auth`/`shipping`/`etgb`/`system` |
| `SyncOperation` | per-user sync attempts: `type`, `status`, `metrics`, `retryOf` | no per-marketplace stats unless `type` encodes the marketplace |
| `CronLock` (added Sprint 2) | `jobName`, `bucket`, `createdAt` | tells you a job *acquired* the lock; doesn't tell you the job ran to success or failure (rely on `SyncLog` for that) |
| `TrackingSubmission` | `status` (`submitted`/`pending`/`failed`), `errorMessage`, `etsySubmitStatus`, `etsySubmitError` | comprehensive enough |
| `LabelJob` | `carrier`, `status`, `errorMessage`, `pdfUrl`, `trackingNumber` | comprehensive enough |
| `EtsyDraftSyncAttempt` | `status`, `requestPlan`, `result`, `error` | comprehensive enough |
| `WebhookEvent` | **id only** — purely an idempotency table for Stripe today | no provider, no event type, no status, no error message → can't show webhook history in admin |
| `User.subscriptionPlan/Status/Interval/trialExpiresAt/usageResetAt/orderSyncCount/labelCount/billingProvider` | enough for billing widgets | no breakdown of which webhook event last touched the row |
| `EtsyShop`, `WixSite`, `ShopifyShop` | `accessToken`, `refreshToken`, `tokenExpiresAt`, `isActive`, `lastListingSyncAt`/`lastOrderSyncAt`/`lastProductSyncAt` | adequate; need to mask tokens in any admin response |
| `Credential` | per-marketplace `tokenExpiresAt` fields | adequate; tokens MUST be excluded from admin responses |

---

## 2. Missing data / models

What we cannot answer from existing models:

1. **Admin write history** — there is no audit trail when an admin changes a user's plan, role, or counters. Required for compliance and for "who broke prod" questions.
2. **System event categorisation** — `SyncLog.level` only tells us severity, not domain. Cannot answer "show me security events from the last 24h" or "list of cron auth failures" without scanning every row's `message` string.
3. **Webhook event history** — `WebhookEvent` is just `{ id }`. We can't tell from the DB:
   - Which provider fired (Stripe vs. Wix vs. Shopify)
   - Which event type
   - Whether it processed cleanly or errored
   - When the last event of each type was seen
4. **Token-expiry visibility** — token expiry timestamps live on `EtsyShop` / `WixSite` / `ShopifyShop` / `Credential`. Possible today but no consolidated view.

### Decision: add minimum needed, extend rather than duplicate

Adopting the user's "do not overbuild if existing SyncLog can handle it" guidance:

- **Extend `SyncLog`** with `category String?` and add indexes on `(category)` and `(level, timestamp)`. Filter the cockpit on this field.
- **Extend `WebhookEvent`** with `provider`, `eventType`, `status`, `errorMessage`, `userId`. Backwards-compatible: existing rows keep working (all new columns are nullable). New writes populate them.
- **Add `AdminAuditLog`** as a new model. There is no existing equivalent and write-tracking is a hard requirement.

No `AppEvent` / `SystemEvent` table — `SyncLog` covers it once we add `category`.

---

## 3. Risks / constraints

- **No buyer PII in admin UI.** Order shipping addresses, buyer names/emails, phone numbers, and Etsy receipt payloads must not appear in the cockpit views. All admin handlers use Prisma `select` to hand back only allow-listed fields.
- **No marketplace OAuth tokens in admin UI.** `EtsyShop.accessToken`, `WixSite.accessToken`, `ShopifyShop.accessToken`, every `Credential.*Token`/`*Secret`/`*Password` field — never returned in admin responses, even masked.
- **No raw webhook payloads.** `WebhookEvent.errorMessage` is the only error surface; if more detail is needed it goes through the redactor first.
- **No raw request bodies in `details`.** The logger redactor already masks token-shaped keys but does not deep-validate buyer PII patterns. Cockpit callers that copy request payloads into `details` must be reviewed before merging.
- **All `/api/admin/monitoring/*` routes require admin role.** Wrapped in `withAdmin`.
- **All admin write actions audit-logged.** A small helper `logAdminAction(req, adminUserId, action, ...)` writes to `AdminAuditLog`. Applied to PATCH `/api/admin/users/[userId]` first; new admin writes should call it.
- **Pagination on every list endpoint.** Defaults to 50 rows, max 200.

---

## 4. Improvement plan (executed in this sprint)

### Schema (Prisma)
- `SyncLog.category String?` + `@@index([category])` + `@@index([level, timestamp])`
- `WebhookEvent` gains `provider`, `eventType`, `status`, `errorMessage`, `userId` + indexes on `(provider, eventType)`, `status`, `createdAt`
- New `AdminAuditLog(id, adminUserId, action, targetType, targetId, metadata Json?, ipHash, userAgent, createdAt)` + indexes
- Migration: `prisma/migrations/20260531150000_admin_monitoring/migration.sql`
- All additions are nullable / additive — safe to `prisma migrate deploy`

### Helpers
- `lib/admin/events.ts` — convenience wrappers `logSecurityEvent`, `logCronEvent`, `logIntegrationEvent`, `logBillingEvent`, `logExtensionEvent`, `logShippingEvent`, `logEtgbEvent`, `logSystemEvent`. Each writes to `SyncLog` with `category` set and routes through the existing redactor.
- `lib/admin/audit.ts` — `recordAdminAction(req, adminUserId, action, opts)` writes to `AdminAuditLog` with hashed-IP + UA.
- `lib/admin/monitoring.ts` — pure aggregation functions: `getCronHealth()`, `getIntegrationHealth()`, `getShippingHealth()`, `getBillingHealth()`, `getSecurityEvents()`, `getExtensionEvents()`, `getUsersAtRisk()`, `getSystemHealth()`, `buildNeedsAttentionQueue()`.

### Instrumented call-sites (Sprint 4 hooks added):
| Place | Change |
|---|---|
| `pages/api/auth/extension.ts` | reject reason now categorised as `security` event |
| `pages/api/ext/telemetry.ts` | reject reason now categorised as `security` event; accepted batches as `extension` |
| `pages/api/stripe/webhook.ts` | events recorded into the now-extended `WebhookEvent` table with provider/eventType/status; mismatch warnings are `billing` events |
| `pages/api/integrations/wix/webhook.ts` | bad signatures are `integration` events; recorded into `WebhookEvent` with provider=`wix` |
| `lib/cron/idempotency.ts` | auth failure is a `cron` security event; lock acquisition is a normal info event |
| `pages/api/admin/users/[userId].ts` | every PATCH writes to `AdminAuditLog` |

### Admin APIs (new)
All under `pages/api/admin/monitoring/`, all `withAdmin`, all return JSON, all paginate where applicable. No secrets, no buyer PII.

- `GET /api/admin/monitoring/overview` — single roll-up for the dashboard top row
- `GET /api/admin/monitoring/cron` — last CronLock per job, stale warnings, recent cron-category SyncLog
- `GET /api/admin/monitoring/integrations` — per-marketplace shop counts, expiring tokens, sync failures (24h)
- `GET /api/admin/monitoring/shipping` — labels created (24h/7d), failed LabelJobs, TrackingSubmissions failed
- `GET /api/admin/monitoring/etgb` — ETGB run counts + failures from SyncLog category=`etgb`
- `GET /api/admin/monitoring/billing` — counts by status, failed payment events, recent webhook events
- `GET /api/admin/monitoring/security` — failed login / admin login / rejected extension / rejected internal-key / webhook signature failure counts + tail
- `GET /api/admin/monitoring/extension` — telemetry accepted/rejected, tracking submissions, recent extension events
- `GET /api/admin/monitoring/errors` — paginated tail of SyncLog level=error with optional filters
- `GET /api/admin/monitoring/users-at-risk` — users with expiring tokens, repeated sync errors, no-sync-since-connect, near plan limits
- `GET /api/admin/monitoring/needs-attention` — the union of the above used by the dashboard header queue
- `GET /api/admin/monitoring/audit` — paginated admin audit log

### UI
- New page `pages/admin/monitoring.tsx` (existing `/admin` left as-is).
- Status cards (green/yellow/red) for each section.
- Tables capped at 20 rows per section with "view more" linking to the per-section endpoint with pagination.
- **Needs Attention queue at the top.** Anything flagged turns this queue red.
- No new chart libraries — we already have apexcharts but the cockpit deliberately avoids it for fast page loads. Plain HTML/CSS only.

### Alerting (without Sentry)
- `lib/admin/dailySummary.ts` — assembles a plain-text summary (failed cron jobs, failed webhooks, users needing reconnect, failed payments, top integration errors).
- `pages/api/cron/admin-summary.ts` — emits the summary via the existing SMTP setup if `ADMIN_ALERT_EMAIL` is set; otherwise no-op. Wrapped in `runCronGuard` so it deduplicates daily.
- Not scheduled by default (no workflow yet) — operators flip it on by adding a daily entry to `cron-daily.yml` after they've verified the body and set the env var.

### Tests added
- `test/lib/admin/audit.test.ts` — `recordAdminAction` writes correct shape, redacts secrets in metadata
- `test/lib/admin/events.test.ts` — `logSecurityEvent` writes `category='security'`, redacts secret fields
- `test/api/admin/monitoring.security.test.ts` — non-admin gets 403, admin gets aggregated payload, no secrets in response
- `test/api/admin/monitoring.cron.test.ts` — stale warning logic, pagination caps

---

## 5. What is intentionally out of scope this sprint

- Sentry / external observability (per project policy now)
- Redesigning the existing `/admin` page — the new cockpit is a sibling page at `/admin/monitoring`, the old screens stay
- Chart visualisations — text + counts only
- Realtime push (WebSocket / SSE) — SWR polling is enough
- Per-user impersonation tooling
- 2FA on the admin role (already pending, separate sprint)
- Encrypted-credential read-path migration (separate sprint)
