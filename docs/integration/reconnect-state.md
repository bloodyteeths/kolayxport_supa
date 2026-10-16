# Reconnect state for failing marketplace auth

Server side is done (lib/integrations/authFailures.ts, table `ConnectionAuthState`, migration
`20261016120000_connection_auth_state`).

## Behaviour

- Shopify (per shop, `accountId` = shop domain), Trendyol (`accountId` = supplier id) and Amazon
  (`accountId` = seller id, `''` when unknown) record auth failures from their order sync.
- Only auth rejections count: HTTP 401, 403 (not a Cloudflare/HTML edge block), `invalid_grant`,
  "token refresh failed: 401/403". Network errors, 429, 5xx and Amazon `invalid_client` (our config)
  never count. A success resets the streak.
- After 3 consecutive failures the row gets `needsReconnect = true`, a `reauthRequired` notification is
  raised once (`onlyIfNew`, dedupe key `reauth:<provider>:<accountId>`, title `types.reauthRejected`)
  and a live `{ type: 'connection', kind: 'reauth_required' }` event is published.
- While flagged, the sync skips that connection (no API calls). Other shops keep syncing.
- Cleared (row deleted, notification resolved, live `reconnected` event) by:
  - a successful authenticated call;
  - Shopify OAuth callback for that shop / Amazon OAuth callback;
  - `PATCH /api/user/settings` with a new Trendyol key or secret, or a different supplier id.
- `GET /api/integrations/status` (lib/integrations/connectionStatus.ts `applyReconnectFlags`) sets
  `needsReauth: true, reason: 'reauth_required'` on the flagged account and provider entry.

## UI: works as is

The Connections tile already turns `needs_reconnect` with a "Reconnect" button
(components/domain/settings/connections/connectionView.ts). Trendyol opens its credentials panel
(re-saving clears the flag); Amazon reuses its reconnect flow; the Shopify panel shows the flagged shop
with a "Needs reconnect" pill and the user reconnects by entering the store address.

## Optional UI follow-up (not done here — Settings files are owned elsewhere)

File: `components/domain/settings/connections/ShopifyPanel.tsx`, in the `accounts.map(...)` `ListRow`:

1. When `s.needsReauth` is true, pass a trailing action to the row: a secondary `ActionButton` /
   link labelled with the existing key `settings.connections.action.reconnect` (`tc('action.reconnect')`)
   whose `href` is `shopifyConnectHref(normalizeShopifySubdomain(s.externalId ?? ''))` (both already
   imported in that file), so the user does not have to retype the store address.
2. No new i18n keys are needed.
3. Test: in `test/settings/b-render.test.tsx` (or the Shopify panel test), render the panel with one
   account `{ needsReauth: true, externalId: 'abc.myshopify.com' }` and assert the row's Reconnect link
   points at the connect URL for `abc`.
