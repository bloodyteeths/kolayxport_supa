# Admin monitoring cockpit — runbook

Companion to `ADMIN_MONITORING_AUDIT.md`. This is the operational guide: where each section comes from, what to do when it goes red, and what to verify after a deploy.

---

## Where the cockpit lives

- UI: `https://kolayxport.com/admin/monitoring`
- Requires a signed-in user with `role='admin'` (enforced by `lib/middleware/withAdmin.ts`).
- The existing `/admin` page is unchanged. The cockpit is a new sibling page.
- Auto-refresh via SWR. Cron + security sections re-poll every 30s; everything else every 60–120s.

---

## Data sources

| Section | Endpoint | Backed by |
|---|---|---|
| System | `GET /api/admin/monitoring/overview` (`.system`) | `process.uptime`, `process.version`, `prisma.$queryRaw\`SELECT 1\``, env vars |
| Needs attention | `GET /api/admin/monitoring/needs-attention` | union of cron / integration / billing / errors |
| Cron | `GET /api/admin/monitoring/cron` | `CronLock` rows + `SyncLog` rows where `category='cron'` |
| Integrations | `GET /api/admin/monitoring/integrations` | `EtsyShop`, `WixSite`, `ShopifyShop` token expiry + `SyncLog` category=`integration` |
| Shipping | `GET /api/admin/monitoring/shipping` | `LabelJob`, `TrackingSubmission` |
| ETGB | `GET /api/admin/monitoring/etgb` | `SyncLog` category=`etgb` |
| Billing | `GET /api/admin/monitoring/billing` | `User.subscriptionStatus` + `WebhookEvent` (Sprint 4 extended fields) |
| Security | `GET /api/admin/monitoring/security` | `SyncLog` category=`security` |
| Extension | `GET /api/admin/monitoring/extension` | `SyncLog` category=`extension`/`security` + `TrackingSubmission.etsySubmitStatus` |
| Errors feed | `GET /api/admin/monitoring/errors` | `SyncLog` level in (`warn`, `error`) |
| Users at risk | `GET /api/admin/monitoring/users-at-risk` | token expiry across shops + `SyncOperation` failures |
| Audit log | `GET /api/admin/monitoring/audit` | `AdminAuditLog` |

All endpoints are admin-only, pagination-clamped (50 default, 200 max), and return `Cache-Control: no-store, private`.

---

## Stale-cron thresholds

| Job | Threshold (after which section turns red) |
|---|---|
| `sync-orders` | 30 minutes |
| `reset-usage` | 26 hours |
| `track-ranks` | 26 hours |

If a job is stale:
1. Open `https://github.com/<repo>/actions` and look at the matching workflow (`cron-jobs.yml` for sync-orders, `cron-daily.yml` for reset-usage/track-ranks).
2. Confirm the most recent run status is green and the curl returned 2xx.
3. If the run was skipped, check whether `KOLAYXPORT_BASE_URL` and `CRON_SECRET` repo secrets are present.
4. As a last resort, trigger manually:
   ```bash
   gh workflow run cron-jobs.yml
   gh run watch
   ```
5. Verify the cron table accumulated:
   ```bash
   ssh deploy@kolayxport.com 'psql "$DATABASE_URL" -c "SELECT \"jobName\", \"bucket\", \"createdAt\" FROM \"CronLock\" ORDER BY \"createdAt\" DESC LIMIT 10;"'
   ```

---

## Marketplace token health

The Integrations card shows three columns per marketplace: active shops, expired tokens, tokens expiring in 7 days.

- **Expired > 0** → the marketplace API will start returning 401s for those tenants. Some clients refresh on 401 (Wix, Etsy, eBay); some don't and require user-initiated reconnect.
- **Action**: open the Users at Risk card; the affected `userId`s are listed.
- Do **not** try to refresh tokens from the admin panel directly — the cockpit is read-only.

---

## Webhook activity

Billing card → `recentWebhookEvents`. Each row carries `provider`, `eventType`, `status` (`received | processed | failed | ignored`) and a short redacted `errorMessage`.

- `received` → arrived, not yet processed (transient state; usually replaced quickly).
- `processed` → handler completed cleanly.
- `failed` → handler threw. Check the message; full context is in `SyncLog` category=`billing`.
- `ignored` → event was signed and authentic but not in our `relevantEvents` set.

We deliberately store no raw payloads. If you need the full event for debugging, fetch it from the Stripe dashboard by event id.

---

## Security events

Anything emitted by `logSecurityEvent` lands here. Operations to watch:

| Operation code | What it means |
|---|---|
| `extension.origin_rejected` | Someone hit `/api/auth/extension` with an unpinned `chrome-extension://` origin |
| `telemetry.origin_rejected` | Same, for `/api/ext/telemetry` |
| `telemetry.unauthenticated` | Telemetry POST without a session/Bearer |
| `cron.auth_failed` | A cron HTTP request lacked the correct `Authorization: Bearer <CRON_SECRET>` |
| `stripe.signature_failed` | Stripe webhook signature verification failed |
| `wix.signature_failed` | Wix webhook JWT signature did not verify |

A burst of any of these in the last 24h is a real signal. Cross-reference IP and origin in the underlying `SyncLog.details`.

---

## Admin audit log

Every PATCH to `/api/admin/users/[userId]` writes a row via `recordAdminAction()` to `AdminAuditLog`. Fields:

- `adminUserId` — who took the action
- `action` — stable code, e.g. `user.update`
- `targetType` + `targetId` — what they touched
- `metadata` — the change set, with secret-shaped keys redacted
- `ipHash` — SHA-256(`NEXTAUTH_SECRET:ip`) truncated to 32 chars
- `userAgent` — first 256 chars

The cockpit shows the last 25 entries with `Prev/Next` paging. The endpoint never returns the raw client IP.

To add audit logging to a new admin write:
```ts
import { recordAdminAction } from '@/lib/admin/audit';

await recordAdminAction(req, adminUser.id, {
  action: 'user.refund',
  targetType: 'user',
  targetId: userId,
  metadata: { amountCents, reason },
});
```

`recordAdminAction` never throws; an audit-write failure is logged as a `security` `SyncLog` row but does not block the original action.

---

## Daily admin email

- Module: `lib/admin/dailySummary.ts`.
- Cron route: `pages/api/cron/admin-summary.ts`.
- **Not scheduled by default** — `cron-jobs.yml` / `cron-daily.yml` do not yet call it. Add a step to `cron-daily.yml` only after you have:
  1. Triggered it manually and inspected the body:
     ```bash
     curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
       https://kolayxport.com/api/cron/admin-summary
     ```
  2. Set `ADMIN_ALERT_EMAIL` and the `ETGB_SMTP_*` env vars on Hetzner (we reuse the existing SMTP wiring).
- Behaviour matrix:
  - `ADMIN_ALERT_EMAIL` unset → summary is built, logged as a `system` SyncLog row, no email sent. Response: `{built:true, sent:false, reason:'no_admin_email'}`.
  - `ADMIN_ALERT_EMAIL` set, SMTP env partial → summary built, no email sent, `reason:'smtp_env_missing'`.
  - All set → email sent; response `{built:true, sent:true, bytes}`.
- The route uses `runCronGuard` so duplicate triggers within a day return `{skipped:true,reason:'duplicate'}`.

---

## Post-deploy checks

```bash
# 1. Migration applied?
ssh deploy@kolayxport.com 'cd /home/deploy/kolayxport && npx prisma migrate status'

# 2. CronLock rows accumulating? (should be true after the next scheduled cron run)
psql "$DATABASE_URL" -c 'SELECT "jobName", "bucket", "createdAt" FROM "CronLock" ORDER BY "createdAt" DESC LIMIT 10;'

# 3. WebhookEvent rows now carry provider/eventType/status?
psql "$DATABASE_URL" -c 'SELECT id, provider, "eventType", status, "createdAt" FROM "WebhookEvent" ORDER BY "createdAt" DESC LIMIT 10;'

# 4. SyncLog rows now carry category for new events?
psql "$DATABASE_URL" -c 'SELECT category, COUNT(*) FROM "SyncLog" WHERE timestamp > NOW() - INTERVAL '"'"'24 hours'"'"' GROUP BY category;'

# 5. AdminAuditLog reachable from /admin/monitoring?
# - Sign in as an admin, open /admin/monitoring, scroll to the Admin audit log card.
# - PATCH a user via /admin (edit modal) — a new audit row should appear on refresh.

# 6. Smoke for admin-summary (no email sent if env unset):
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://kolayxport.com/api/cron/admin-summary
# expect: {"ok":true,"built":true,"sent":false,"reason":"no_admin_email","bytes":...}
```

---

## What this cockpit does NOT do

- It is **read-only**. No write actions are exposed via `/admin/monitoring`. All writes go through the existing `/admin` page or programmatic admin routes, which audit-log.
- It does not ship logs to any external service (per project policy: no Sentry).
- It does not return marketplace OAuth tokens, raw webhook payloads, raw request bodies, or buyer PII at any level.
- It does not expose Stripe webhook secrets, internal API keys, or session cookies.
- It does not impersonate users.
- It does not reset passwords. Password reset is a separate sprint.

---

## Glossary

- **Category** — coarse domain bucket on `SyncLog`: `security | cron | integration | billing | extension | shipping | etgb | system | auth`. Set via `logger.event(category, level, ...)` or the convenience wrappers in `lib/admin/events.ts`.
- **Needs attention queue** — a derived feed assembled from stale cron jobs, expired tokens, failed webhooks, and the recent error tail. The dashboard considers everything in this queue actionable.
- **Audit log** — append-only `AdminAuditLog` table. Never edited, never deleted via any admin route.
- **`runCronGuard`** — `lib/cron/idempotency.ts` helper that enforces both timing-safe `CRON_SECRET` verification and `(jobName, bucket)` deduplication. Applied to the new `admin-summary` cron too.
