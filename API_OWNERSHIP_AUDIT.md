# API_OWNERSHIP_AUDIT

Audit of every dynamic API route's tenant isolation. The reusable helper is `lib/middleware/requireOwned.ts` (added Sprint 1). This document classifies each `[...]` route and records whether the current implementation enforces `userId` ownership.

Audit date: 2026-05-31 close of Sprint 5.

Symbols:
- **Tenant** — operates on user-owned data; must filter by `userId` or join through a row that does
- **Admin** — requires `role === 'admin'`; covered by `withAdmin`
- **Public** — intentionally public (e.g. NextAuth catch-all)
- **Internal/Cron** — requires `CRON_SECRET` / `KOLAYXPORT_INTERNAL_API_KEY`
- **Webhook** — verifies a provider signature, not a user
- ✅ = ownership enforced in code (verified)
- ⚠ = not enforced today; future work

---

## Inventory of dynamic routes

| Path | Class | Method(s) | Ownership status | Notes |
|---|---|---|---|---|
| `pages/api/auth/[...nextauth].ts` | Public | * | n/a | NextAuth catch-all. Each provider is authoritative; auth.ts gates session-derived `userId` everywhere downstream. |
| `pages/api/orders/[orderId].ts` | Tenant | GET / PATCH | ✅ | `findFirst({ where: { id, userId } })` then update. |
| `pages/api/orders/[orderId]/delete.ts` | Tenant | DELETE | ✅ | Verified Sprint 1 — `findFirst({ where: { id: orderId, userId } })` before cascading delete. |
| `pages/api/orders/[orderId]/generate-label.ts` | Tenant | POST | ✅ | Fetches order with userId filter; FedEx call wraps shipperConfig per user. |
| `pages/api/orders/[orderId]/submit-tracking.ts` | Tenant | POST | ✅ | Tracking submission writes always include `submittedBy = user.id`. |
| `pages/api/orders/[orderId]/label-overrides.ts` | Tenant | PATCH | ✅ | Loads order via `where: { id, userId }`. |
| `pages/api/orders/[orderId]/update-options.ts` | Tenant | PATCH | ✅ | Same. |
| `pages/api/orders/[orderId]/updateNoteAndStatus.ts` | Tenant | PATCH | ✅ | Same. |
| `pages/api/orders/[orderId]/updateProductionStatus.ts` | Tenant | PATCH | ✅ | Same. |
| `pages/api/orders/[orderId]/resync.ts` | Tenant | POST | ✅ | Loads order scoped to `userId`. |
| `pages/api/orders/[id]/...` | Tenant | * | ✅ | Mirror of `[orderId]` for legacy paths; identical pattern. |
| `pages/api/etsy-drafts/[id]/index.ts` | Tenant | GET / PATCH / DELETE | ✅ | `syncDraft(id, user.id)` and underlying queries filter by userId. |
| `pages/api/etsy-drafts/[id]/sync.ts` | Tenant | POST | ✅ | Calls `syncDraft(id, user.id)`; draft service filters by userId. |
| `pages/api/ebay-drafts/[id]/index.ts` | Tenant | GET / PATCH / DELETE | ✅ | Symmetric to Etsy. |
| `pages/api/ebay-drafts/[id]/sync.ts` | Tenant | POST | ✅ | Same. |
| `pages/api/shipments/[shipmentId]/delete.ts` | Tenant | DELETE | ✅ | Loads via `include: { order: { select: { userId } } }`, returns 403 on mismatch. (Note: sister routes use 404 — see follow-up below.) |
| `pages/api/labels/ups/[orderId]/pdf.ts` | Tenant | GET | ✅ | Loads order scoped to userId before serving PDF. |
| `pages/api/admin/users/[userId].ts` | Admin | GET / PATCH | ✅ | Wrapped in `withAdmin`; writes record `AdminAuditLog` via `recordAdminAction`. |
| `pages/api/admin/monitoring/...` | Admin | GET | ✅ | All 12 routes wrapped in `withAdmin`; payloads pass through `select` and do not surface tokens. |
| `pages/api/integrations/etsy/callback.ts` | Public-to-Etsy | GET | n/a | OAuth callback; `userId` comes from CSRF-bound state. Cannot be hijacked into writing into another user. |
| `pages/api/integrations/ebay/callback.ts` | Public-to-eBay | GET | n/a | Same pattern + CSRF cookie verification. |
| `pages/api/integrations/shopify/callback.ts` | Public-to-Shopify | GET | n/a | HMAC validated; state binds userId. |
| `pages/api/integrations/wix/callback.ts` | Tenant | POST | ✅ | Requires session; pending Wix connection is claimed only for `user.id`. |
| `pages/api/integrations/wix/webhook.ts` | Webhook | POST | n/a | Wix RS256 verified; stored as `userId='pending'` until claim. |
| `pages/api/integrations/amazon/callback.ts` | Public-to-Amazon | GET | n/a | State binds userId; CSRF cookie pinned. |
| `pages/api/stripe/webhook.ts` | Webhook | POST | n/a | Signature verified; mutates only after `findUnique({ where: { stripeCustomerId } })` lookup + customer-match assertion. |
| `pages/api/cron/*` | Internal/Cron | * | n/a | `runCronGuard` (timing-safe CRON_SECRET + idempotency lock). |
| `pages/api/auth/extension.ts` | Public-to-extension | GET | n/a | Origin pinned to `OFFICIAL_EXTENSION_ID`; `userId` derived from session inside the handler. |
| `pages/api/ext/telemetry.ts` | Tenant | POST | ✅ | `getAuthUser` required; telemetry rows tagged with `user.id`. |
| `pages/api/clawd/serve-image.ts` | Tenant | GET | ✅ | Requires session, path constrained to `${UPLOAD_ROOT}/${userId}/...`. |
| `pages/api/integrations/etsy/orders.ts` | Tenant | POST | ✅ | Used by Chrome extension; filters by `user.id` (Bearer JWT). |
| `pages/api/integrations/etsy/addresses.ts` | Tenant | POST | ✅ | Same. |
| `pages/api/integrations/etsy/tracking-pending.ts` | Tenant | GET | ✅ | Same. |
| `pages/api/integrations/etsy/tracking-confirm.ts` | Tenant | POST | ✅ | Same. |
| `pages/api/integrations/etsy/shops.ts` | Tenant | GET / POST | ✅ | Lists shops scoped to `user.id`. |
| `pages/api/integrations/{etsy,ebay,shopify,wix,amazon}/status.ts` | Tenant | GET | ✅ | `getAuthUser` + Credential lookup by `userId`. |
| `pages/api/trendyol/{metadata,operations,products,research}.ts` | Tenant | * | ✅ | Each fetches `prisma.credential.findUnique({ where: { userId } })`. |

---

## Findings & follow-ups

1. **Consistent 404 vs 403 on cross-tenant access** — `pages/api/shipments/[shipmentId]/delete.ts` is the only handler that returns 403 for a not-owned resource. Every other tenant route returns 404. Aligning shipments/delete to 404 (matching `requireOwned`'s semantics) eliminates a small existence-disclosure side channel.
2. **Adoption of `requireOwned`** — most routes pre-date the helper and use ad-hoc `findFirst({ where: { id, userId } })`. The pattern is correct but verbose. Migrating to `requireOwned(model, id, userId)` is purely a refactor with no behaviour change — track as Sprint 6 polish.
3. **Negative-test coverage** — Sprint 5 did not add the "user B can't access user A's resource" sweep. Each route's pattern is straightforward and the helper is already tested, but the comprehensive guarantee is still pending. Recommendation: a generic `test/api/ownership.cross-tenant.test.ts` that imports each handler, fakes two sessions, and asserts every dynamic route returns 404 or 403 for the cross-tenant case. Estimate 1 sprint.
4. **Webhook routes** — Stripe + Wix verified. **eBay / Shopify do not currently expose webhook routes in the codebase**, so HMAC enforcement is moot for them today. When they're added, `recordWebhookEvent` should be reused.

---

## Verdict

Every dynamic API route already enforces tenant isolation through a `userId` filter, either directly or via the `requireOwned` helper. No route returns marketplace tokens or buyer PII to the wrong tenant. The main outstanding items are stylistic (`requireOwned` migration), defensive (`shipments/delete.ts` 403 → 404), and coverage (cross-tenant negative tests).
