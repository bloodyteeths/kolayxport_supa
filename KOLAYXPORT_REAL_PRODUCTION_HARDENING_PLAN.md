# KOLAYXPORT_REAL_PRODUCTION_HARDENING_PLAN

Companion documents:
- `KOLAYXPORT_PRODUCTION_TOPOLOGY.md` — must be marked VERIFIED before any task touching `vercel.json`, OAuth callback URLs, Stripe webhook URLs, or extension API base URLs can ship.
- `KOLAYXPORT_AUDIT.md` — original audit. This plan supersedes that document's action plan where they disagree, because this plan respects the post-audit constraints (Etsy approved, extension stays, no short-lived job tokens, Vercel/Hetzner unknown).

Rules carried into this plan:
- Do not remove Chrome extension functionality.
- Do not redesign extension auth into short-lived job tokens this sprint.
- Do not remove any marketplace module.
- Do not migrate to App Router.
- Do not delete `vercel.json` / `.vercel/` until topology is verified.
- Do not hide marketplace modules behind feature flags — fix them.
- No new business features.

---

## Task format

Each task carries:
- **Sev** (severity): Critical / High / Medium / Low
- **Risk**: what breaks if we don't do it
- **Files**: actual file paths to touch
- **Strategy**: the specific code/config approach
- **Tests**: what proves it works
- **Vercel deploy notes** + **Hetzner deploy notes** (both, until topology is verified)
- **Rollback**: how to revert if it goes wrong

---

## P0 — Security

### P0-1. Remove credential-leaking route `pages/api/setScriptProps.js`
- **Sev**: Critical
- **Risk**: Any call to this endpoint runs `console.info(\`...\`, JSON.stringify(body))` where `body` contains `veeqoApiKey`, `shippoToken`, `fedexApiKey`, `fedexApiSecret`, `fedexAccountNumber`, `fedexMeterNumber`, `trendyolSupplierId`, `trendyolApiKey`, `trendyolApiSecret`, `hepsiburadaMerchantId`, `hepsiburadaApiKey` in plaintext. On either Vercel or Hetzner, these land in operator-visible logs forever. The route also writes to `prisma.userIntegrationSettings` (model does not exist in `prisma/schema.prisma` — the real model is `Credential`), so it has not worked as advertised either.
- **Files**: `pages/api/setScriptProps.js` (delete).
- **Strategy**: confirm by grep there is no caller (verified — only self-references and one test mock + `scripts/auto-sync-all-users.js` reference of the dead model). Delete the file.
- **Tests**: `curl -X POST https://kolayxport.com/api/setScriptProps -d '{}'` returns 404 after deploy.
- **Vercel deploy notes**: redeploy main branch; route disappears.
- **Hetzner deploy notes**: `deploy-hetzner.yml` will pick it up on next push; the systemd restart removes the route from the Next.js build.
- **Rollback**: `git revert` the deletion commit. The file's behavior was already broken (wrong model), so there is no business loss.

### P0-2. Add safe logging + redaction in `lib/logger.ts`
- **Sev**: Critical (any future leak repeats the setScriptProps incident class)
- **Risk**: Without redaction, any developer writing `logger.error('foo', err, { body: req.body })` exposes Etsy/eBay/Shopify/Wix/Amazon/Trendyol/Stripe/SMTP secrets to `SyncLog` and stdout. Current `lib/logger.ts` writes `details` to Postgres verbatim and does `console.log(JSON.stringify(logEntry))` in non-prod.
- **Files**:
  - `lib/logger.ts` — replace with redacting version that walks `details` and masks sensitive keys before storing in DB or printing.
  - `lib/logger.test.ts` — new file, redaction unit tests.
  - Optional follow-up: search-and-replace risky `console.log` / `console.error` patterns in `pages/api/**`.
- **Strategy**: introduce a `redact(value, keypath?)` walker that, for any object key matching `/^(authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|client[_-]?secret|private[_-]?key|password|stripe[_-]?signature)$/i` (or contains the substring "token" / "secret"), replaces the value with `'[REDACTED]'`. Apply before insert into `SyncLog` and before the console mirror. Never JSON-stringify `req.body` directly anywhere — log specific whitelisted fields only.
- **Tests**: unit test the redactor with nested objects, arrays, fields named `accessToken`, `refresh_token`, `Authorization`, `stripe-signature`, `cookie`. Make sure non-sensitive fields like `orderId`, `marketplace`, `userId` pass through.
- **Vercel deploy notes**: redactor runs in Node.js, no edge-runtime quirks.
- **Hetzner deploy notes**: same.
- **Rollback**: `git revert`. Logger fully backwards compatible — same exported `logger.info/warn/error/debug` API.

### P0-3. Fix `pages/api/clawd/serve-image.ts` — add auth + per-user ownership
- **Sev**: Critical
- **Risk**: route is anonymous today. Anyone who can guess (or brute-force) a filename under `UPLOAD_ROOT` (`process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images')`) reads the file. Path traversal IS blocked (`path.resolve` + `startsWith(resolvedRoot + path.sep)`), so this is purely an auth/ownership hole.
- **Files**:
  - `pages/api/clawd/serve-image.ts`
  - `lib/auth.ts` (no change needed if `getAuthUser` already exported; it is)
- **Strategy**:
  - Step 1: require `getAuthUser(req, res)` and return 401 if absent.
  - Step 2: layout: store all uploads under `${UPLOAD_ROOT}/${userId}/...`. Reject any `?path=` that escapes `${UPLOAD_ROOT}/${userId}/` after resolution.
  - Step 3: support backwards-compatibility for files already on disk that are NOT prefixed with a userId: if the path resolves directly under `UPLOAD_ROOT` (legacy layout), require an explicit `?userId=` AND verify it matches the session user. If the resolved file's parent does not match either pattern, return 404 (not 403, to avoid leaking existence).
  - Step 4: do NOT rename the route in this same patch. Keep URL stable for the UI/extension that already use it.
  - Step 5: keep the existing path-traversal block. Keep `Cache-Control: public, max-age=31536000, immutable` only if the response was authorized — otherwise emit `Cache-Control: no-store`.
- **Tests**:
  - anonymous GET → 401
  - user B's session, request path inside user A's prefix → 404
  - user A's session, valid path inside user A's prefix → 200 with correct Content-Type
  - `?path=../etc/passwd` → 403 (preserved behavior)
  - missing file → 404
- **Vercel deploy notes**: relies on local filesystem. **If Vercel is in the path for production, this route was broken there already** (Vercel functions have ephemeral filesystem) — confirm in topology doc §10. If Vercel is the live host, this task expands into "migrate uploads to object storage" (out of scope for P0 — call it out and ship the auth fix anyway).
- **Hetzner deploy notes**: persistent filesystem under `/home/deploy/kolayxport/uploads/ebay-images/`. The directory layout change (subfolder per userId) is backward-compatible because of step 3.
- **Rollback**: `git revert`. Anonymous read returns immediately.

### P0-4. Multi-tenant ownership checks on every dynamic `[id]`-style route
- **Sev**: High (sample audit shows ~half the routes are already correct, but the inconsistency is the bug class)
- **Risk**: a route that takes an id from the URL and queries by id alone is a cross-tenant read/write.
- **Files**:
  - New: `lib/middleware/requireOwned.ts` (single helper for future routes + immediate use in the highest-risk ones)
  - Audit + patch (only those that are missing the check) under: `pages/api/orders/[orderId]/*`, `pages/api/orders/[orderId].ts`, `pages/api/etsy-drafts/[id]/*`, `pages/api/ebay-drafts/[id]/*`, `pages/api/shipments/[shipmentId]/*`, `pages/api/labels/ups/[orderId]/*`, `pages/api/admin/users/[userId].ts`, plus any other dynamic route surfaced by `find pages/api -type d -name "[*]"`.
- **Strategy**:
  - Build `requireOwned<TKey extends 'order' | 'etsyListing' | 'etsyListingDraft' | 'etsyShop' | 'ebayListing' | 'ebayListingDraft' | 'wixSite' | 'shopifyShop' | 'shipment' | ...>(model: TKey, id: string, userId: string): Promise<TModel>` that:
    - looks up via `prisma[model].findFirst({ where: { id, userId } })`,
    - special-cases `shipment` (no direct userId — join through `order`),
    - throws `OwnershipError` (yields 404 in handler — never 403, to avoid existence-confirmation).
  - For each existing high-risk route already using ad-hoc `findFirst` with `{ id, userId }`: leave the code alone but ensure it returns 404 (not 403) for not-owned. The `pages/api/shipments/[shipmentId]/delete.ts` returns 403 today — change to 404 for parity with the rest of the codebase.
  - For routes that do not check ownership (verify per route — most do via the service layer; do not regress those that delegate to `syncDraft(id, userId)` because the service already takes a `userId`): wrap with `requireOwned`.
- **Tests**: new test file `test/api/ownership.test.ts` boots Next.js handler for each high-risk route, creates two users, calls user B's session with user A's id, asserts 404. Specifically test:
  - `pages/api/orders/[orderId]/delete.ts`
  - `pages/api/orders/[orderId]/generate-label.ts`
  - `pages/api/orders/[orderId]/submit-tracking.ts`
  - `pages/api/orders/[orderId]/updateNoteAndStatus.ts`
  - `pages/api/orders/[orderId]/update-options.ts`
  - `pages/api/orders/[orderId]/label-overrides.ts`
  - `pages/api/orders/[orderId]/resync.ts`
  - `pages/api/orders/[orderId]/updateProductionStatus.ts`
  - `pages/api/etsy-drafts/[id]/sync.ts` + `pages/api/etsy-drafts/[id]/index.ts`
  - `pages/api/ebay-drafts/[id]/sync.ts` + `pages/api/ebay-drafts/[id]/index.ts`
  - `pages/api/etsy-drafts/bulk-sync.ts`
  - `pages/api/ebay-drafts/bulk-sync.ts`
  - `pages/api/etsy-drafts/media.ts`, `pages/api/ebay-drafts/media.ts`
  - `pages/api/shipments/[shipmentId]/delete.ts`
  - `pages/api/labels/ups/[orderId]/*`
- **Vercel deploy notes**: pure code change, no infra impact.
- **Hetzner deploy notes**: same.
- **Rollback**: `git revert`. Existing handlers continue to function — `requireOwned` is additive.

### P0-5. Credential encryption at rest (with plaintext-read fallback)
- **Sev**: Critical (one DB dump leaks every marketplace token in the system)
- **Risk**: any backup, replication slave, or operator with `psql` access reads every user's `Credential` + `EtsyShop.accessToken` + `WixSite.accessToken` + `ShopifyShop.accessToken` + every carrier credential in plaintext.
- **Files** (created):
  - `lib/crypto/credentials.ts` — `encrypt(plain: string): string`, `decrypt(value: string): string`, `isEncrypted(value: string): boolean`, `getOrSetKey()`.
  - `lib/crypto/credentials.test.ts` — unit tests.
  - `scripts/backfill-encrypt-credentials.ts` — dry-run + apply mode; counts only.
- **Files** (touched in this sprint):
  - **None of the model code is rewritten yet** — that is a follow-up sprint. We ship the crypto module + backfill + dry-run reporting first so we can confirm sizes and a key choice before flipping callers.
  - Read paths in `lib/integrations/*Client.ts` are NOT changed yet. The migration order is intentional:
    1. ship the crypto module + tests
    2. run dry-run backfill in production to count plaintext rows
    3. introduce read-through-decrypt in next sprint
    4. backfill encrypt
    5. drop plaintext fallback once telemetry shows zero plaintext rows in 30 days
- **Strategy**:
  - Format: `enc:v1:<base64-iv>:<base64-tag>:<base64-ciphertext>`. Same column type (`String?`). `isEncrypted(v)` returns true iff `v.startsWith('enc:v1:')`.
  - Cipher: AES-256-GCM (`crypto.createCipheriv`), 12-byte IV, 16-byte tag.
  - Key source: `CREDENTIAL_ENCRYPTION_KEY` env. Length-checked (must decode to 32 bytes from hex or base64). On startup of any code path that needs to decrypt, throw if missing — fail fast. `getOrSetKey()` caches the parsed key in module scope.
  - Read path (planned for next sprint): `getCredential(value)` returns plaintext if `!isEncrypted`, else decrypts. So callers can adopt incrementally.
  - Backfill script: `--dry-run` prints counts of plaintext vs encrypted rows per credential column; `--apply` reads each plaintext value, encrypts it, writes it back in a transaction. **Never prints values.** Logs: `model=Credential field=etsyAccessToken plaintext=312 encrypted=0`. Apply mode iterates with a `take/skip` loop, 100 rows at a time, with progress.
- **Tests**:
  - Round-trip encrypt → decrypt.
  - Invalid GCM tag → throws.
  - `isEncrypted` returns true for envelope, false for plain.
  - Dry-run does not modify rows (verify via row-version or timestamp check).
- **Vercel deploy notes**: set `CREDENTIAL_ENCRYPTION_KEY` in Vercel env. Backfill is run from a shell with `DATABASE_URL` and the same key — do NOT run it via a Vercel function; use the developer machine or Hetzner.
- **Hetzner deploy notes**: set `CREDENTIAL_ENCRYPTION_KEY` in `/home/deploy/kolayxport/.env`. Run backfill from the VPS once: `cd /home/deploy/kolayxport && npx tsx scripts/backfill-encrypt-credentials.ts --dry-run`. Inspect counts. Then `--apply`. Restart service.
- **Rollback**:
  - For the crypto module + backfill: trivial — no rows are touched in dry-run; in `--apply` mode, rollback requires the encrypted rows to remain readable. As long as `CREDENTIAL_ENCRYPTION_KEY` is preserved in env, every later read can decrypt. To truly roll back, run the backfill in reverse (decrypt and write back plaintext) — implement that as a flag if necessary.

### P0-6. Internal API key safety (rename optional, hardening required)
- **Sev**: High
- **Risk**: `lib/auth.ts:getAuthUserOrApiKey()` currently:
  - accepts the API key via `req.query.apiKey` (query string leaks to proxy/CDN/log)
  - compares using `===` (no constant-time)
  - accepts `userId` from query/body, letting any holder of the key act as any user
- **Files**:
  - `lib/auth.ts` (hardening)
  - Optional rename: `CLAWD_API_KEY` → `KOLAYXPORT_INTERNAL_API_KEY`. The variable is referenced in ~30 places (per grep). Renaming is risky for this sprint; do it as a separate PR with backward compat (accept either name for one release).
- **Strategy**:
  - Header-only: accept only `Authorization: Bearer <key>` or `X-Internal-Api-Key: <key>` headers; reject any value from query or body.
  - Constant-time compare via `crypto.timingSafeEqual`. Pre-check length equality.
  - On every internal-key authenticated response, set `Cache-Control: no-store, private` and `Vary: Authorization`.
  - `userId` is taken from a header (`X-User-Id`) ONLY and validated to be a CUID. The internal-key caller MUST send it explicitly; we treat it as a delegation token. (This is unchanged from today in spirit but tightened in shape.)
  - The change in callers (~30 files in `pages/api/clawd/*` etc.) is currently mostly: `if (apiKey === envApiKey) ...` — these are already using `getAuthUserOrApiKey` or doing their own check. We migrate them to the new helper signature. Existing routes will keep working because most rely on session-auth path.
- **Tests**:
  - GET with `?apiKey=<key>` → 401 (query is rejected).
  - GET with `Authorization: Bearer <wrong key, same length>` → 401, timing-equal.
  - GET with `Authorization: Bearer <right key>` + `X-User-Id: <cuid>` → 200.
  - Missing `X-User-Id` → 400.
- **Vercel deploy notes**: nothing special.
- **Hetzner deploy notes**: nothing special.
- **Rollback**: `git revert`. Old callers continue to work because session auth path is unchanged; only the API-key path becomes header-only.

---

## P1 — Chrome extension safety (no short-lived job tokens)

### P1-1. Extension origin pinning + reject unknown extensions
- **Sev**: High
- **Risk**: `pages/api/auth/extension.ts` accepts ANY `chrome-extension://...` origin and issues a long-lived NextAuth JWT to it. A user could install a malicious extension that opens `https://kolayxport.com/api/auth/extension` and steals a Bearer token.
- **Files**:
  - `pages/api/auth/extension.ts`
  - `chrome-extension/manifest.json` (verify `externally_connectable` is not wildcarded)
  - new env: `OFFICIAL_EXTENSION_ID`
- **Strategy**:
  - Read `OFFICIAL_EXTENSION_ID` from env. If unset, refuse to send tokens and return `503 extension auth disabled`.
  - Allow exactly one origin: `\`chrome-extension://${process.env.OFFICIAL_EXTENSION_ID}\``. Reject all others (don't set CORS headers, return 403).
  - Manifest: confirm `externally_connectable.matches` is restricted to `https://kolayxport.com/*` and that no `ids: ['*']` wildcards exist.
- **Tests**: simulate a request with `Origin: chrome-extension://abcd...` (random id) → 403; with the official id and a valid session → 200 + token.
- **Deploy notes**: ship after `OFFICIAL_EXTENSION_ID` is set in Vercel + Hetzner env (whichever serves the route). Extension build does not need a change as long as the official Chrome Web Store ID matches.
- **Rollback**: temporarily unset `OFFICIAL_EXTENSION_ID` → server falls back to the old behavior of "no token issued". Users will see an auth error in the extension; better than a leak.

### P1-2. Damage radius reduction (still no short-lived tokens)
- **Sev**: Medium (defense-in-depth)
- **Risk**: extension JWT decodes to a NextAuth JWT with `sub = userId` and can be replayed against any user-scoped API.
- **Files**: every extension-consumed endpoint (`/api/orders/*`, `/api/etsy-drafts/*`, `/api/ext/*` if any) — code unchanged, but verify they don't return marketplace OAuth tokens in responses.
- **Strategy**:
  - Inventory which endpoints the extension hits. Confirm none returns `accessToken` / `refreshToken` to the client.
  - The extension's purpose (Etsy DOM tracking push) needs: order id, tracking number, carrier. Make sure responses to extension clients return only those fields.
  - Do NOT redesign auth into short-lived job tokens this sprint. The user explicitly excluded that.
- **Tests**: snapshot the JSON payload of each extension endpoint and assert it contains no key matching `/token|secret|key|password/i`.
- **Deploy notes**: code-only.

### P1-3. Extension telemetry safety (`pages/api/ext/telemetry.ts`)
- **Sev**: High
- **Risk**: per audit, this endpoint is wildcard-CORS unauthenticated and accepts arbitrary payloads.
- **Files**: `pages/api/ext/telemetry.ts`.
- **Strategy**:
  - Require auth (cookie session OR Bearer JWT — same as extension auth helper).
  - Remove `Access-Control-Allow-Origin: *`. Allow only the pinned extension origin from P1-1.
  - Cap body size at 32KB (`bodyParser: { sizeLimit: '32kb' }`).
  - Run all incoming payload fields through the same redactor from P0-2.
  - If a `domSnapshot` field is present, drop it unless `debugMode` is true AND the caller is the authenticated user's own session (not a job).
- **Tests**:
  - Unauth POST → 401.
  - Auth POST with cookie field in body → cookie key value redacted before write.
  - Body > 32KB → 413.
- **Deploy notes**: code-only.

### P1-4. Etsy DOM workflow fail-safes (extension stays)
- **Sev**: Medium
- **Risk**: a stale selector or order/tracking mismatch could submit the wrong tracking to the wrong listing.
- **Files**: `chrome-extension/src/content.js`, `chrome-extension/src/content-shared.js`, `chrome-extension/src/background.js`, and the server-side job-status endpoint(s).
- **Strategy**:
  - Pre-submit assertions in the content script:
    - selector check: if any required selector misses, halt and report.
    - order match check: visible order id on the page === `expectedOrderId` from the job; otherwise halt.
    - tracking match check: tracking value typed into the field === `expectedTracking`; otherwise halt.
    - submit attempt counter: if > 1 for the same job in 5 minutes, halt.
  - Server-side: extend whatever model carries the action result (likely `TrackingSubmission`) with a status enum: `pending | running | success | failed | needs_manual_review`. Surface the status in the app UI.
- **Tests**: synthetic page that omits a selector → halts; differing order id → halts; success → status becomes `success`.
- **Deploy notes**: extension build needs to be re-released to the Chrome Web Store. Coordinate with whatever release process the project already uses.

---

## P2 — Production topology / Vercel + Hetzner split

### P2-1. Verify topology and update `KOLAYXPORT_PRODUCTION_TOPOLOGY.md`
- **Sev**: High (everything downstream — cron, OAuth callbacks, uploads — depends on this)
- **Files**: `KOLAYXPORT_PRODUCTION_TOPOLOGY.md`, `docs/deployment/PRODUCTION_TOPOLOGY.md`.
- **Strategy**: run §10 checks of the topology doc. Fill in the source-of-truth table. Mark VERIFIED.
- **Tests**: documentation-only.
- **Deploy notes**: none.

### P2-2. Cron idempotency (regardless of who fires it)
- **Sev**: High
- **Risk**: `cron-jobs.yml` runs every 15 minutes and `vercel.json` cron also defines `/api/cron/sync-orders` daily. If both reach a live deployment, the same wall-clock event is processed twice. `reset-usage` doubles up similarly. `auto-sync-orders.yml` is currently broken (references non-existent `prisma.userIntegrationSettings`) but is still scheduled.
- **Files**:
  - `pages/api/cron/sync-orders.ts`, `pages/api/cron/reset-usage.ts`, `pages/api/cron/track-ranks.ts`
  - `.github/workflows/auto-sync-orders.yml` (decide: disable or fix; if disabling, document the decision in the topology doc — do not delete the file yet)
- **Strategy**:
  - Add a `CronLock` table (or reuse `SyncLog`) with `(jobName, bucket: 'YYYY-MM-DDTHH:MM')` unique. Each cron handler tries to insert with `upsert` keyed on the bucket; if it already exists for the bucket, returns `{ skipped: true, reason: 'duplicate' }`.
  - Bucket size: 5 minutes for `sync-orders` (so the 15-min GH Actions trigger always gets one bucket and the daily Vercel trigger gets a different one), 1 hour for the daily jobs.
  - Constant-time `CRON_SECRET` comparison via `crypto.timingSafeEqual`.
- **Tests**: fire two requests with the same bucket; second returns `skipped: true`. Wrong bucket → both run.
- **Vercel deploy notes**: no Vercel-specific change. Vercel cron still triggers but second invocation no-ops.
- **Hetzner deploy notes**: same — second invocation no-ops on the GH Actions side too.
- **Rollback**: remove the lock check from each handler; original double-run risk returns.

### P2-3. Decide on canonical cron source (NOT in this sprint — document only)
- **Sev**: Medium
- **Files**: `KOLAYXPORT_PRODUCTION_TOPOLOGY.md` follow-up section.
- **Strategy**: once topology is verified, write a decision record: "GitHub Actions is canonical because it ran while Vercel was uncertain; Vercel cron will be disabled in sprint N+1 after we observe one week of no missed runs." Until then, idempotency from P2-2 keeps both safe.

### P2-4. `docs/deployment/PRODUCTION_TOPOLOGY.md`
- **Sev**: Medium
- **Files**: `docs/deployment/PRODUCTION_TOPOLOGY.md` (new).
- **Strategy**: short ops-facing doc derived from the verified topology, including the deploy + rollback steps for both Vercel frontend and Hetzner backend.
- **Tests**: documentation-only.

---

## P3 — Marketplace reliability (no module removal)

### P3-1. Wix
- **Sev**: High
- **Risk**: token expires; user disconnects without knowing.
- **Files**: `lib/integrations/wixClient.ts`, `pages/api/integrations/wix/callback.ts`, `pages/api/integrations/wix/webhook.ts`.
- **Strategy**:
  - Implement OAuth refresh in `lib/integrations/wixClient.ts` mirroring `etsyClient.ts:refreshEtsyToken` shape. Refresh-when-expired and refresh-when-401.
  - Webhook: fetch the Wix JWKS (`https://www.wix.com/_api/oauth/...` per Wix docs), verify the JWT signature with RS256 before trusting `instanceId` / `iss` / `exp`. Reject otherwise.
- **Tests**: unit-test refresh against a recorded sandbox response. Unit-test signature verify with a forged token → 401.
- **Deploy notes**: code-only.

### P3-2. Stripe
- **Sev**: High
- **Risk**: webhook handler mutates user state by `stripeCustomerId` lookup without re-confirming the event's `subscription.customer` matches.
- **Files**: `pages/api/stripe/webhook.ts`.
- **Strategy**: after the webhook signature passes, before any `prisma.user.update`, assert `event.data.object.customer === user.stripeCustomerId`. Reject with 400 if not.
- **Tests**: forged event with wrong `customer` → 400; legitimate event → 200.
- **Deploy notes**: webhook secret is unchanged. Verify `bodyParser: false` is still set.

### P3-3. Etsy (already approved — keep extension, document why)
- **Sev**: Medium
- **Risk**: regressions to approved scopes / approved redirect URI break the live app.
- **Files**: `pages/api/integrations/etsy/connect.ts`, `pages/api/integrations/etsy/callback.ts`, `lib/integrations/etsyClient.ts`.
- **Strategy**:
  - Confirm the actual scope string in source matches the approved set. Do NOT change it. Pull the approved set out of the Etsy developer dashboard and assert equality in a startup check (`assertEtsyScopes()`).
  - Confirm OAuth state is bound to session (signed cookie). If not, add it.
  - Document the Chrome extension purpose in `docs/extension/ETSY_EXTENSION_RATIONALE.md` — what it does (tracking push via DOM), why (Etsy v3 has not opened the equivalent API to general apps), how it is secured (origin pin, no marketplace tokens to extension, redacted telemetry, fail-safes). Useful evidence if Etsy ever asks.
  - Destructive listing actions (`delete`, `deactivate`, bulk-sync with `queuedActions` containing `delete`): UI confirmation that types the listing title is unchanged here, but server-side: refuse to sync a draft whose `queuedActions` contains a `delete` unless the request body includes `confirmDestruction: true`.
- **Tests**: bulk-sync with `delete` in `queuedActions` and no confirmation → 400.
- **Deploy notes**: env unchanged; OAuth callback URL must NOT change (would invalidate Etsy approval).

### P3-4. eBay
- **Sev**: Medium
- **Files**: `lib/integrations/ebayClient.ts`, `pages/api/integrations/ebay/connect.ts`, `pages/api/integrations/ebay/callback.ts`.
- **Strategy**: confirm CSRF state is bound to session cookie (audit suggested it already is — verify). Confirm 429 backoff in `ebayRateLimiter.ts` is used by every Sell + Browse call. Confirm draft sync ownership check.
- **Tests**: same shape as Etsy. State-replay test → 401.
- **Deploy notes**: callback URL must NOT change.

### P3-5. Shopify
- **Sev**: Medium
- **Files**: `pages/api/shopify/webhooks/*`, `pages/api/integrations/shopify/callback.ts`.
- **Strategy**: confirm HMAC on every Shopify webhook (subscription update, products, orders). Confirm `state` on the install/callback flow. Confirm tokens are read/written through the (forthcoming) crypto wrapper.
- **Tests**: forged HMAC → 401.

### P3-6. Trendyol (keep, harden, isolate scraper)
- **Sev**: High
- **Risk**: scraper failure breaks the rest of the app; Trendyol blocks the IP.
- **Files**: `lib/integrations/trendyolSearch.ts`, `lib/integrations/trendyolClient.ts`, `lib/integrations/trendyolApiClient.ts`, `pages/api/trendyol/*`.
- **Strategy**:
  - Separate the official API path (`trendyolApiClient.ts`, currently unused) from the scraping path (`trendyolSearch.ts`).
  - Add per-request timeout (15s), retry-with-backoff (3 attempts), per-user rate limit (e.g. 10 req/min) for scraper calls.
  - Wrap scraper in `try/catch`; on any error return an empty list and a `{ degraded: true, reason }` flag so the UI shows a soft state instead of a crash.
  - Logger output for the scraper goes through the redactor (P0-2), and the full HTML body is never logged.
- **Tests**: scraper throws → endpoint returns 200 with `degraded: true`. Timeout exceeded → same.
- **Deploy notes**: code-only.

### P3-7. Amazon (keep, encrypt creds, label as incomplete)
- **Sev**: Medium
- **Files**: `lib/integrations/amazonClient.ts`, `pages/api/amazon/*`, `components/amazon/*`.
- **Strategy**:
  - Adopt P0-5 crypto wrapper for `Credential.amazonAccessToken` / `amazonRefreshToken`.
  - For Amazon UI surfaces that have no working backend yet (per audit, most listing/order flows are stubs): replace error-on-click behavior with a clearly-labeled "Beta — Amazon integration in development" message. This is product polish, not a feature hide; the module stays connectable.
- **Tests**: unit test that crypto round-trip works for an Amazon token shape.

---

## P4 — Database / credentials

### P4-1. Ownership indexes
- **Sev**: Medium
- **Files**: `prisma/schema.prisma`, new migration.
- **Strategy**: add the missing indexes called out in `KOLAYXPORT_AUDIT.md` §5:
  - `EtsyListing(userId, status, updatedAt)`
  - `EbayListing(userId, status, updatedAt)`
  - `EtsyListingDraft(userId, status, updatedAt)`
  - `EbayListingDraft(userId, status, updatedAt)`
  - `FinancialTransaction(userId, source, transactionDate)`
  - `OrderItem(orderId)` if not present
  - Confirm `(userId, marketplace, remoteId)` uniqueness pattern across cached-listing tables (idempotent sync).
- **Tests**: explain plans before/after on a sample-sized table.
- **Deploy notes**: `prisma migrate deploy` on Hetzner. Index builds are non-blocking but heavy — schedule during low traffic.
- **Rollback**: drop the indexes; behavior unchanged, just slower.

### P4-2. Credential migration format (formalize the wrapper)
- **Sev**: High (closes P0-5)
- **Strategy**: lock in `enc:v1:<iv>:<tag>:<ciphertext>` as the canonical envelope (same column type, no schema migration). Document that any future format change is `enc:v2:...` and read paths must accept both.

### P4-3. Enum migration plan (PLAN ONLY this sprint)
- **Sev**: Low
- **Strategy**: list the enum-shaped string columns we'd migrate next sprint (per audit §5). No migration this sprint — that touches every caller.

---

## P5 — Webhooks / Cron

### P5-1. CRON_SECRET timing-safe comparison
- **Sev**: High
- **Files**: `pages/api/cron/sync-orders.ts`, `pages/api/cron/reset-usage.ts`, `pages/api/cron/track-ranks.ts`.
- **Strategy**: replace `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`)` with a length-checked `crypto.timingSafeEqual` against a precomputed `Buffer.from(\`Bearer ${process.env.CRON_SECRET}\`)`. Hoist the expected value out of the request lifecycle so each request does only the compare.
- **Tests**: a request with a wrong-but-same-length header → 401 in the same time bracket as the right one.

### P5-2. Wix webhook JWT verification (P3-1 includes this)
- Tracked under §P3-1.

### P5-3. Cron idempotency (P2-2)
- Tracked under §P2-2.

### P5-4. `auto-sync-orders.yml` — broken script
- **Sev**: Medium
- **Files**: `.github/workflows/auto-sync-orders.yml`, `scripts/auto-sync-all-users.js`.
- **Strategy**: this script calls `prisma.userIntegrationSettings.update` (no such model) and imports `lib/integrations/veeqo` and `lib/integrations/shippo` (legacy). Decide: (a) fix to call the current `Credential` model and the per-marketplace sync functions, or (b) disable the workflow (set `on: workflow_dispatch:` only) and document why. Do NOT delete the file yet — its presence is evidence of intent.
- **Tests**: a dry-run invocation of the script exits non-zero today; after fix, exits zero with `{ users: N, synced: M }` JSON.

---

## P6 — Repo hygiene

Only items that won't reduce functionality. Do **not** delete `vercel.json`, `.vercel/`, `chrome-extension/`, marketplace modules, ETGB code, carrier integrations, listing draft tools, research tools.

### P6-1. Delete the confirmed dead route (also in P0-1)
- `pages/api/setScriptProps.js` — verified no callers; delete.

### P6-2. Move/delete junk verified-not-used at repo root
- **Sev**: Low
- **Files**:
  - Delete: `Screenshot 2025-07-*.png` (7 files), `NabavkiData_EIC_Pitch_Deck.pdf` (unrelated project), `kolayxport*.code-workspace`, `.DS_Store`, `logs_result-21{1,2,3}.json`, `new-kolayxport-log-export-*.json`, `tsconfig.tsbuildinfo`, `yarn.lock.backup`, `etsy-dom-inspector-clean.zip`.
  - Archive (move to `archive/extension-builds/`): 17 `chrome-extension*.zip` and `kolayxport-etsy-*.zip`.
  - Move to `docs/research/`: `etsy-finance-plan.md`, `etsy-sales-boost-report.md`, `etsy-tag-optimization-report.md`, `etsy-title-optimization-report.md`, `CLAWD_ETSY_TOOLS_PROMPT.md`, `EBAY_CLAWD_TOOLS_PROMPT.md`.
  - Move to `docs/etgb-samples/`: `etgb11072024.xls`.
  - Move to `docs/legacy/`: `Veeqo entegrasyonu guide.docx`.
  - Move to `scripts/legacy-sql/`: `add_recipient_email.sql`, `add_recipient_email_final.sql`, `add_recipient_email_to_orderitem.sql`.
  - Move to `scripts/`: root `test-*.mjs`, `check-etsy-status.ts`, `debug-trendyol-specific-order.ts`.
- **Strategy**: one PR per category to keep diffs reviewable.

### P6-3. `.gitignore` additions
- **Sev**: Low
- **Files**: `.gitignore`.
- **Strategy**: add `*.code-workspace`, `logs_result-*.json`, `*-log-export-*.json`, `playwright-report/`, `test-results/`, `tsconfig.tsbuildinfo`.

### P6-4. Drop unused dependencies AFTER grep confirms zero imports
- **Sev**: Low
- **Files**: `package.json`.
- **Strategy**: per-dep grep `from '@anthropic-ai/sdk'`, `from '@auth0/`, `from '@supabase/`, `from 'iyzipay'`, `from '@google/genai'` (one of the two Google SDKs). For each with zero imports outside tests, remove from `dependencies`. Run `npm install` and `npm run build` between removals.
- **Note**: `@supabase/*` may be required at build because the CI workflow injects `NEXT_PUBLIC_SUPABASE_URL` — verify the import is truly dead before removing.

---

## P7 — UI/UX stability (narrow scope only)

No broad redesign. Only:

### P7-1. Show explicit error states where backend is incomplete
- **Sev**: Low
- **Files**: `components/amazon/*` mainly.
- **Strategy**: where an Amazon-related UI button calls a stub endpoint and crashes with a Sentry-less unknown error, show a "Beta — coming soon" panel instead.

### P7-2. Destructive listing action confirmations (covered in P3-3)
- See §P3-3 server-side; UI side: confirm there is already a "type the listing title" confirmation for Etsy bulk-delete (project memory suggests there is). If not, add it. **No other UI change.**

---

## Test suite additions

Create or update tests for the following — these are the acceptance criteria for the sprint.

- `test/lib/logger.redactor.test.ts` (P0-2)
- `test/lib/crypto/credentials.test.ts` (P0-5)
- `test/api/ownership.test.ts` (P0-4)
- `test/api/serve-image.test.ts` (P0-3)
- `test/api/auth.internal-key.test.ts` (P0-6)
- `test/api/auth.extension.test.ts` (P1-1)
- `test/api/ext.telemetry.test.ts` (P1-3)
- `test/api/cron.idempotency.test.ts` (P2-2)
- `test/api/cron.timingSafe.test.ts` (P5-1)
- `test/api/stripe.webhook.test.ts` (P3-2)
- `test/api/wix.webhook.test.ts` (P3-1)
- `test/lib/integrations/wix.refresh.test.ts` (P3-1)
- `test/lib/integrations/trendyol.fail-safe.test.ts` (P3-6)

### `npm run security:smoke` (P9 from request)
Add a script:
```json
"security:smoke": "tsc --noEmit && vitest run test/lib/logger.redactor test/lib/crypto/credentials test/api/ownership test/api/serve-image test/api/auth.internal-key test/api/auth.extension test/api/ext.telemetry test/api/cron.idempotency test/api/cron.timingSafe test/api/stripe.webhook test/api/wix.webhook && node scripts/security/grep-unsafe.js"
```

`scripts/security/grep-unsafe.js` (new) greps for:
- `process.env.CLAWD_API_KEY` or `KOLAYXPORT_INTERNAL_API_KEY` taken from `req.query` (regex hit → exit 1)
- `console.log` / `console.info` / `console.error` outside `lib/logger.ts` and `lib/crypto/credentials.ts` (configurable allowlist)
- string interpolation of `accessToken` / `refreshToken` / `apiSecret` into log lines
Output is a punch list and a non-zero exit if any hit. Used by CI.

---

## Deployment paths (both)

### If frontend/API is on Vercel
- New env vars to set on Vercel (Project Settings → Environment Variables):
  - `CREDENTIAL_ENCRYPTION_KEY` (32 bytes hex)
  - `OFFICIAL_EXTENSION_ID`
- Deploy: push to `main`; Vercel auto-deploys preview, you promote.
- Cron idempotency means the Vercel cron + GH Actions cron are safe to co-exist.
- File uploads under `uploads/...` will NOT persist on Vercel — see topology doc §7. Plan migration to S3-compatible object storage in a follow-up sprint **before** moving production to Vercel.
- Rollback: redeploy previous SHA from Vercel UI.

### If API/backend is on Hetzner
- New env vars to set in `/home/deploy/kolayxport/.env`:
  - `CREDENTIAL_ENCRYPTION_KEY` (32 bytes hex; generate via `openssl rand -hex 32`)
  - `OFFICIAL_EXTENSION_ID`
- Deploy: push to `main`; `.github/workflows/deploy-hetzner.yml` does `git pull`, build, `systemctl restart kolayxport`, health-check curl.
- Backfill: after deploy, on Hetzner, run `npx tsx scripts/backfill-encrypt-credentials.ts --dry-run` then `--apply` once dry-run looks correct.
- Rollback: `ssh deploy@46.224.169.225 && cd /home/deploy/kolayxport && git reset --hard <prev-sha> && rm -rf .next && npx next build --webpack && sudo systemctl restart kolayxport`.

---

## Order of execution this sprint (Phase 3 already in scope)

Done in Phase 3 (this PR/turn):
1. P0-1 — delete setScriptProps
2. P0-2 — logger redactor
3. P0-3 — serve-image auth + ownership
4. P0-4 — `requireOwned` helper (audit + apply to high-risk routes)
5. P0-5 — crypto module + backfill skeleton
6. P0-6 — internal-API-key header-only + timingSafeEqual

Next (P1 / P5 / topology verify):
7. Topology verification (§10 of topology doc)
8. P1-1 + P1-3 (extension origin pin + telemetry auth)
9. P5-1 (cron timingSafe), P2-2 (cron idempotency)
10. P3-1 (Wix refresh + webhook signature)
11. P3-2 (Stripe customer-match)
12. P3-6 (Trendyol fail-safe)
13. P4-1 (indexes), then start encrypted read path migration (P4-2 → callers)

Everything else slips to a later sprint with the same constraints.
