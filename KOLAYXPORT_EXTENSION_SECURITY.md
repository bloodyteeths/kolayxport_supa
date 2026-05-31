# KOLAYXPORT_EXTENSION_SECURITY

## Why the extension exists, and why it stays

The KolayXport Chrome extension is required and stays in the product. Etsy does not expose a public API for several seller-facing actions that KolayXport users perform daily — most importantly pushing tracking numbers into the Etsy Shop Manager UI in a way Etsy considers user-initiated. The extension is the only way to automate those actions safely on the seller's own browser session.

The extension is not a replacement for the Etsy v3 OAuth integration. It runs **alongside** the OAuth path. OAuth covers order ingest, listing draft sync, ledger reads, and tracking submissions where Etsy accepts them. The extension covers the gaps.

This document describes the production security model — what the extension talks to, what it does not see, and how server-side endpoints accept (or refuse) connections from it.

---

## Identity and pinning

### Official extension ID

`OFFICIAL_EXTENSION_ID` — set on the Hetzner host. Holds the 32-character Chrome Web Store id of the production KolayXport extension. Any server endpoint that accepts a `chrome-extension://` origin requires this value to be set and to match.

If `OFFICIAL_EXTENSION_ID` is not set on the host, the server **fails closed** for `chrome-extension://` origins. Same-origin browser fetches from `https://kolayxport.com` continue to work, so the user-facing app keeps functioning while the env var is being rotated.

### Server-side origin policy

Implemented in:
- `pages/api/auth/extension.ts`
- `pages/api/ext/telemetry.ts`

Accept list:
- `https://kolayxport.com`
- `https://www.kolayxport.com`
- `chrome-extension://${OFFICIAL_EXTENSION_ID}` (and the trailing-slash variant)
- `http://localhost:<port>` only when `NODE_ENV !== 'production'`

Everything else returns `403 Forbidden`. `Access-Control-Allow-Origin: *` is never used by these routes.

### Manifest `externally_connectable`

Added in `chrome-extension/manifest.json` v9.3.0:

```json
"externally_connectable": {
  "matches": [
    "https://kolayxport.com/*",
    "https://www.kolayxport.com/*"
  ],
  "ids": []
}
```

Effect:
- Only pages on `kolayxport.com` and `www.kolayxport.com` can `chrome.runtime.connect` / `sendMessage` to the extension.
- `ids: []` means **no other extension** can connect — without this block, Chrome's default is "any extension can connect" (MV3 behaviour), which is unsafe.

The existing content-script communication path (content scripts on `etsy.com` / `ebay.com` / `amazon.com` → background via `chrome.runtime.sendMessage`) is intra-extension and is not affected by `externally_connectable`.

---

## What the extension does not receive

Server endpoints serving the extension never return:
- Marketplace OAuth access tokens or refresh tokens (Etsy, eBay, Shopify, Wix, Amazon, Trendyol)
- Stripe customer ids, payment instruments, or webhook secrets
- Internal API keys (`CLAWD_API_KEY` / `KOLAYXPORT_INTERNAL_API_KEY`)
- Other users' data, regardless of how a request is authenticated
- Full `Credential` rows

The extension's auth token is a NextAuth JWT scoped to the user's identity. It is used as a Bearer token against the same API surface the user's browser uses, with the same multi-tenant filtering enforced by `requireOwned()` and the per-route `userId` checks (`lib/middleware/requireOwned.ts`).

If a future endpoint is added for the extension, it must be reviewed against this list before it ships. Add a snapshot test if practical that asserts the response JSON contains no key matching `/token|secret|key|password|cookie/i`.

---

## Telemetry policy

Endpoint: `pages/api/ext/telemetry.ts`

- Requires authentication (cookie session or Bearer JWT).
- Body size capped at 32 KB (`bodyParser: { sizeLimit: '32kb' }`).
- Accepts only the pinned origins listed above.
- Each `failures[]` item is passed through `lib/logger.ts`'s `redact()` walker before any log call.
- DOM snapshots are dropped unless the request body carries `debugMode: true`.
- Even with `debugMode: true`, the snapshot is truncated to 2 KB and still flows through the redactor; any field matching the secret-key pattern is replaced with `[REDACTED]`.
- The endpoint never logs full request bodies. Only specific named fields are included in log payloads.

---

## DOM workflow fail-safes (planned, not yet shipped this sprint)

The Etsy tracking-push content script must, before submitting any form:
- Verify every required CSS selector resolves.
- Verify the visible order id on the page matches the `expectedOrderId` from the server-issued job.
- Verify the tracking number it is about to type matches `expectedTracking`.
- Halt and surface an error if any of the three checks fail.
- Refuse to submit more than once per job within a 5-minute window.

Server-side, the corresponding job state (`TrackingSubmission` or equivalent) must transition through `pending → running → success | failed | needs_manual_review` so the user can see what happened.

These fail-safes are not implemented in this sprint. Until they are, the human user is the safety net: they watch the Etsy UI and can stop the extension via the popup.

---

## Logging redaction

All extension-related server code logs through `lib/logger.ts`. The redactor masks any value whose key matches:

```
/^(authorization|cookie|set-cookie|x-api-key|x-extension-auth|password|passphrase|
   token|tokens|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|
   api[_-]?secret|secret|client[_-]?secret|private[_-]?key|stripe[_-]?signature|
   signing[_-]?secret)$/i
```

…and any key containing `token`, `secret`, `password`, `api[_-]?key`, `client[_-]?secret`, or `private[_-]?key`. Arrays, nested objects, and circular references are handled. Strings longer than 4 KB are truncated.

This applies to selector-failure telemetry, extension auth errors, and any future extension-facing endpoint that uses the logger.

---

## Required env vars (Hetzner `/home/deploy/kolayxport/.env`)

- `OFFICIAL_EXTENSION_ID` — exact Chrome Web Store id of the production extension.
- `NEXTAUTH_SECRET` — used to sign the JWT returned to the extension.

Generating `OFFICIAL_EXTENSION_ID` is not required; you read it from your Chrome Web Store developer dashboard. Set it once and rotate only if you publish a new extension ID (rare — happens if you migrate publishers).

---

## What still needs review

Known remaining risks:
- The extension's NextAuth JWT is long-lived. The user explicitly chose not to redesign this to short-lived job tokens this sprint. The mitigation is the origin pinning above — no other extension can request a JWT, and the pinned official extension must be installed via the Chrome Web Store (which Chrome enforces via the extension id).
- `pages/api/clawd/*` endpoints (Etsy / eBay / Amazon / Trendyol research) are reachable by the extension. Those endpoints already require auth or a CUID-shaped `X-User-Id` plus the internal API key (header-only after Sprint 1 hardening), so they cannot be hit anonymously.
- The DOM workflow fail-safes (above) are not yet wired. Schedule for the next sprint.
- Manifest version bumped to `9.3.0`. The Chrome Web Store will not serve the new `externally_connectable` block until a new build is uploaded and approved.
- `OFFICIAL_EXTENSION_ID` is not yet set on the Hetzner host. Until it is, the server returns 403 for any direct `chrome-extension://` origin. Same-origin (kolayxport.com) calls continue unaffected.

---

## Testing

Unit tests:
- `test/api/auth.extension.test.ts` — covers same-origin acceptance, official-id acceptance, foreign-id rejection, fail-closed when env unset, dev-only localhost acceptance.
- `test/api/ext.telemetry.test.ts` — covers auth required, origin rejection, no `*` CORS, debug-mode snapshot gating, empty-payload rejection.
- `lib/logger.ts` redactor coverage in `test/lib/logger.redactor.test.ts` (also exercises any field the telemetry endpoint may forward).

Run all of them together:
```bash
npm run security:smoke
```
