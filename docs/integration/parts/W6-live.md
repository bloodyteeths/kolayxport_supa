# W6-live — real-time events, new-order sound

The goal: a new order makes a sound and shows up in every open tab within seconds. Nobody presses Sync or reloads the page.

## What W6 landed (no presentation file edited)

| File | What it is |
|---|---|
| `lib/live/types.ts` | `LiveEvent` union, `LiveEnvelope`. Additive changes to the W0 contract: `sync.kind` gains `'status'` with `phase`/`serverTime`/`transport`; `LiveEnvelope.name?`; `LiveOrderSummary.thumbnail?`; `LiveOrderInput.thumbnail?` and `items[].image?` |
| `lib/live/names.ts` | Event names and aliases (isomorphic), `LIVE_SWR_PREFIXES` |
| `lib/live/bus.ts` | Postgres `NOTIFY kx_live` / `LISTEN` fan-out. It keeps one dedicated `pg` client per process, reconnects with backoff, runs a ping watchdog, delivers locally while not listening, truncates payloads to 7900 bytes, and keeps a per-user replay buffer |
| `lib/live/publish.ts` | `publishLive`, `publishOrderEvent`, `buildOrderLiveEvent`, **new** `publishNewOrders` (batch helper), **new** `LIVE_ORDER_SELECT` |
| `lib/live/sse.ts` | SSE framing and headers (pure) |
| `pages/api/live/stream.ts` | The authenticated SSE endpoint |
| `components/live/LiveEventsProvider.tsx` | The single browser consumer: stream, cross-tab relay, toasts, sound, title badge, SWR revalidation, polling fallback |
| `components/live/LiveAppMount.tsx` | The mount point: wraps the provider with `useSession()` + route gating (`/app/*` only) and the user id. Mounted once in `_app.tsx` |
| `components/live/useLiveEvent.ts` | `useLiveEvent`, `useLiveRevalidate`, `useLiveStatus`, `useRecentLiveOrders`, `useHighlightParam`, `revalidateSwrPrefix` |
| `components/live/orderSound.ts` | Web Audio chime. Settings in localStorage `kx_order_sound_muted` / `kx_order_sound_volume` |
| `components/live/LiveSoundToggle.tsx` | Header button for sound on/off with a live-status dot |
| `components/live/liveStore.ts` | Module stores for status, recent orders and the per-user resume state (lastEventId, seen ids, unseen count), plus the window-event helper |
| `messages/fragments/liveOrders.{en,tr}.json` | Strings under the `liveOrders` namespace |
| `test/live/bus.test.ts`, `test/live/stream.test.ts` | Unit tests, plus an HTTP test of the SSE handler |

`package.json` is unchanged: `pg@^8.16.0` and `@types/pg` are already dependencies. Next 16 externalises `pg` on the server by default.

## How it flows

```
publishLive(userId, event)                       (any process: Next server, in-process worker, tsx script, cron route)
  └─ NOTIFY kx_live {userId, envelope}  (Prisma, pooled connection; payload ≤ 7900 B)
       └─ LISTEN kx_live  (Next server: 1 dedicated pg connection, application_name kx-live-listen)
            └─ bus registry → GET /api/live/stream (SSE)  → leader tab's EventSource
                                                          └─ BroadcastChannel('kx-live:<userKey>') → that user's other tabs
                 every tab: window CustomEvent('kx:live') + SWR revalidate + toast/sound (order.new)
```

- **Delivery rule.** While the process is LISTENing, the bus sends each event only through NOTIFY, and LISTEN echoes it back. This gives one delivery path, no duplicates, and works across processes. While LISTEN is reconnecting, the bus also delivers in-process right away. With `KX_LIVE_TRANSPORT=local`, or when there is no DB URL, delivery is in-process only.
- **One stream per browser and account.** Production nginx speaks HTTP/1.1 (`listen 443 ssl;`, no http2), so a browser allows only 6 connections per origin. One SSE per tab would starve the page's API calls after a few tabs. Tabs therefore elect a leader with the Web Locks API (`kx-live-leader:<userKey>`), and only the leader holds the EventSource. If Web Locks or BroadcastChannel is missing, each tab opens its own stream.
- **Account isolation.** `userKey = liveUserKey(session.user.id)` (lib/live/names.ts) scopes the channel and lock names, so another account's tabs never share a leader or a relay. The server's hello frame (sent first, before any replay) carries the stream user's `userKey`; the client consumes nothing until it matches, and drops/reopens a foreign stream. The server also re-checks the session every ~5 min and closes the stream on sign-out or account switch.
- **Sound.** Audio unlock is per document, so the chime goes to whichever tab can play: the focused tab at once, a visible unfocused tab after ~80 ms, hidden armed tabs after 350-800 ms (staggered). The first to play posts a claim on the channel and the rest stand down. Leadership plays no role. If no tab has been clicked since load, nothing can play (browser policy); `LiveSoundToggle` shows "click to enable" in that state.
- **Missed events.**
  - Every event has an `id:`. On a native reconnect the browser sends `Last-Event-ID`; a manual reopen sends `?lastEventId=`. The server replays from a per-user buffer (last 50 events / 5 min).
  - After any reconnect, the client also dispatches a synthetic `sync.status` with phase `reconnected` and revalidates orders and notifications.
  - If the stream is down for more than 60 s, the client dispatches `sync.status` with phase `polling` every 60 s and revalidates.
- **SSE details (A5).**
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` (`no-transform` stops Next's `compress: true` gzip from buffering the stream), `X-Accel-Buffering: no`, and `retry: 5000`.
  - A `: ping` comment every 20 s. Every third ping is also a `sync.status` heartbeat data frame, so the client can detect a half-open connection: it reopens after 75 s without data.
  - Limits: 10 streams per user (the oldest is evicted), 5000 streams per process, connections rotated every ~30 min (with `retry: 250` and replay), and slow consumers above 1 MB of buffered data are dropped.
  - The bus unsubscribes on `req close`, `res close` and `res error`; the HTTP test checks that the subscriber count returns to 0.
- **Wire format.** Frames are unnamed (`data:` only, so every frame arrives as an EventSource `message`). The canonical name travels inside the JSON as `envelope.name`. Named SSE events would silently drop any name the client had not registered.

### Event names (what `useLiveEvent` / `useLiveRevalidate` accept)

The canonical name is `${type}.${kind|action}`. Each event also answers to `type`, `type.*` and `*`. The aliases in the table below let the names from the task brief work as written.

| Name you can subscribe to | Fires on |
|---|---|
| `order.new` | the importer published `order.new` |
| `order.updated` | `order.updated`, **and every `shipment.*`** |
| `order.canceled` / `order.cancelled` | order cancelled |
| `order.shipped`, `order.delivered`, `order.label_created` | as named |
| `notification.new` | `notification.raised` |
| `notification.changed` | raised, read or resolved |
| `listing.changed` | listing created, updated, deactivated, expired or changed_externally, **and every `draft.*`** |
| `listing.removed` | listing deleted |
| `stock.changed` | changed, push_applied, settings_changed, out_of_stock |
| `stock.alert` | out_of_stock, drift, unmatched_sale, push_failed |
| `sync.status` | client-side only: phase `reconnected` or `polling` (hello and heartbeat are not dispatched) |
| `sync.finished` | a sync run finished (`newOrders` / `updatedOrders`) |
| `invalidate` | generic: `keys[]` are SWR key prefixes |

**Automatic revalidation (no page code needed).** For every event, the provider revalidates the SWR keys that start with the prefixes below. It throttles per prefix with a 1 s leading + trailing window: the first event refetches at once, and any further events inside the window cause exactly one more refetch when it ends (so back-to-back orders both show up).

| Event type | SWR prefixes revalidated |
|---|---|
| `order` | `/api/orders` |
| `shipment` | `/api/orders`, `/api/shipments` |
| `notification` | `/api/notifications` |
| `stock` | `/api/stock` |
| `connection` | `/api/integrations/status` |
| `invalidate` | each key in `keys` |
| `sync.finished` with new orders | `/api/orders` |

Because of this, `useOrders` (orders/labels page), `useNotifications` (NotificationBell) and `useConnections` refresh live with **no edits**. Pages that fetch without SWR (the Etsy listings page) use `useLiveRevalidate` with their own refetch function; see section 3.

---

## Presentation changes for the UI session

### 1. `pages/_app.tsx` — mount the live provider ONCE (REQUIRED) and `components/AppLayout.js` — the sound toggle (REQUIRED)

**Why `_app.tsx` and not AppLayout:** AppLayout is rendered inside each page (`<AppLayout title=…>` in labels.tsx, etsy-listings.tsx, financials.tsx, …; only two pages use `getLayout`), so React unmounts it on every client-side navigation. A provider there would drop the stream and its Web Lock (leadership jumps to another, possibly never-clicked tab) on every click. `LiveAppMount` is safe in `_app.tsx`: it opens the stream only when `useSession()` is `authenticated` **and** the route is under `/app`, so public and marketing pages never open one.

`pages/_app.tsx` — add the import next to the other component imports:

```tsx
import LiveAppMount from '@/components/live/LiveAppMount';
```

and render it once, right after `<Toaster position="top-center" />` (it must be inside `SessionProvider`, `NextIntlClientProvider` and `ThemeProvider`, which it is there):

```tsx
        <Component {...pageProps} />
        <Toaster position="top-center" />
        {/* Live events: SSE stream, new-order chime + toast, live SWR refresh. Signed-in /app/* only. */}
        <LiveAppMount ordersPath="/app/labels" />
        <LimitReachedDialog />
```

Props: `ordersPath?: string` (default `/app/labels`), `pathPrefixes?: string[]` (default `['/app']`; add `'/admin'` if admins should get live events there). Do **not** also mount `LiveEventsProvider` in AppLayout. If you ever mount `LiveEventsProvider` directly, pass `userId={session.user.id}`: it scopes the cross-tab channel/lock and the hello check.

`components/AppLayout.js` — the sound toggle only. Add the import next to `import NotificationBell from './NotificationBell';` (line ~51):

```js
import LiveSoundToggle from './live/LiveSoundToggle';
```

Put the toggle immediately **before** the bell (line ~828), so the sound control and the bell sit together:

```jsx
              <LiveSoundToggle
                sx={{ width: 44, height: 44, borderRadius: '8px', '&:hover': { bgcolor: 'rgb(248 250 252)' } }}
              />
              <NotificationBell enabled={Boolean(session)} />
```

- **Size.** The 44×44 size and the hover colour match the neighbouring `w-11 h-11 … hover:bg-slate-50 rounded-lg` buttons. The toggle stays visible on phones, because sound is the main point of this feature.
- **Props.** `LiveSoundToggle` takes `size?: 'small' | 'medium'` and `sx?`. It only reads module stores, so remounting it with the page is fine.
- **Title.** The provider prefixes `document.title` with `(N) ` while new orders are unseen, and it re-applies the prefix when `<Head>` changes the title. Nothing else is needed for this.
- **Remounts are still safe.** If the provider does unmount (leaving `/app`, sign-out), it flushes a pending new-order batch (chime + toast) instead of dropping it, and a remount for the same user reconnects with `?lastEventId=` so the server replays what was published in between (buffer: last 50 events / 5 min).

### 2. `pages/app/labels.tsx` — highlight the order opened from the toast, and mark live arrivals (RECOMMENDED)

The list already refreshes by itself through the automatic `/api/orders` revalidation. The `highlight` query param already survives the page's filter↔URL sync, because non-filter keys are preserved at line ~1683.

Add the import:

```tsx
import { useHighlightParam, useRecentLiveOrders } from '@/components/live/useLiveEvent';
```

Inside the component, after `orderGroups` is defined (line ~1810), add:

```tsx
  // Live: ?highlight=<orderId> from the new-order toast; recently arrived orders get a "New" chip.
  const { highlightId, clear: clearHighlight } = useHighlightParam();
  const recentLiveOrders = useRecentLiveOrders();
  useEffect(() => {
    if (!highlightId) return;
    if (!orderGroups.some((g) => g.orderId === highlightId)) return;
    setExpandedCardId(highlightId);
    requestAnimationFrame(() => {
      document.getElementById(`order-card-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [highlightId, orderGroups]);
```

On the card `<Paper key={group.orderId} …>` (line ~2662), add the `id` and a temporary ring:

```tsx
                <Paper
                  key={group.orderId}
                  id={`order-card-${group.orderId}`}
                  elevation={isExpanded ? 3 : 1}
                  onClick={highlightId === group.orderId ? clearHighlight : undefined}
                  sx={{
                    border: '1px solid',
                    borderColor: highlightId === group.orderId ? 'success.main' : isExpanded ? 'primary.light' : 'divider',
                    boxShadow: highlightId === group.orderId ? (theme) => `0 0 0 3px ${theme.palette.success.light}` : undefined,
                    transition: 'box-shadow 300ms ease, border-color 300ms ease',
                    borderRadius: 1.5,
                    overflow: 'hidden',
                  }}
                >
```

In the card header, next to the order number, add a small chip for orders that arrived live in the last 15 min:

```tsx
{recentLiveOrders.has(group.orderId) && (
  <Chip size="small" color="success" label={tLive('badge.new')} sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />
)}
```

The chip needs `const tLive = useTranslations('liveOrders');` and the key `liveOrders.badge.new`, which is already in the fragment: EN "New", TR "Yeni". If the desktop table view uses different row markup, apply the same `id`, ring and chip there.

- **Optional.** Remove the 120 s `refreshInterval` that `useOrders(…, 'labelsPage')` passes, or raise it to 300 s (it lives in `lib/hooks/useOrders.ts:126`). Live events plus the reconnect and polling fallback make it redundant, but it is harmless to keep.
- **Optional.** The manual "Sync" button can stay. It now matters only for marketplaces whose importers do not publish (see the emitter checklist below).

### 3. `pages/app/etsy-listings.tsx` — live refresh without SWR (REQUIRED for live listings)

This page loads with `fetchListings()` / `fetchPendingDrafts()`, so automatic SWR revalidation does not reach it. Add the import:

```tsx
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
```

After `fetchPendingDrafts`, `fetchListings` and `fetchStatusCounts` are declared (around line ~1600), add:

```tsx
  // Live: Etsy webhooks / stock pushes / draft syncs refresh the grid without a manual Sync.
  useLiveRevalidate(
    ['listing.changed', 'listing.removed', 'stock.changed'],
    () => Promise.all([fetchListings().then(() => fetchStatusCounts()), fetchPendingDrafts()]),
    { throttleMs: 3000 },
  );
```

Because `listing.changed` also matches every `draft.*` event, staged-draft status (syncing, synced, failed, conflict) updates live too. The handler is held in a ref, so an inline function does not cause a re-subscribe. The throttle is leading plus trailing, so a burst of webhook events costs at most 2 fetches per 3 s.

**Caution.** If `fetchListings()` toggles a full-page loading state, use a "silent" variant (no spinner, keep the current rows) for this call. Otherwise every webhook makes the grid flash.

### 4. `components/NotificationBell.tsx` / `lib/hooks/useNotifications.ts` — nothing required

`/api/notifications` is revalidated automatically on every `notification.*` event, which means immediately after `notify()` once W5 publishes; global `mutate` bypasses `dedupingInterval`. One optional change: lower `refreshInterval` from 60 s to 300 s in `useNotifications`, since the reconnect and polling fallback covers outages.

### 5. Other pages (optional, same pattern)

| Page | Snippet |
|---|---|
| Any SWR page | `useLiveRevalidate([...names], '/api/<prefix>')` |
| Any custom-fetch page | `useLiveRevalidate([...names], refetchFn)` |
| Stock page (`pages/app/stok-senkron.tsx`, W2) | `useLiveRevalidate(['stock'], '/api/stock')` is redundant, because `/api/stock` is automatic; use `useLiveEvent(['stock.alert'], …)` for inline banners |
| Etsy activity (`pages/app/etsy-aktivite.tsx`, W3) | `useLiveRevalidate(['listing'], '/api/etsy/activity')` |
| Show connection state anywhere | `const { status } = useLiveStatus();` returns `'live' \| 'connecting' \| 'offline' \| 'polling' \| 'idle'` |

---

## i18n (`messages/fragments/liveOrders.{en,tr}.json`, namespace `liveOrders`)

| Key | Used by |
|---|---|
| `toast.newOrder`, `toast.newOrderFrom` ({marketplace}), `toast.newOrders` ({count}, plural), `toast.items` ({count}, plural), `toast.cancelled` ({orderNumber}), `toast.cancelledHint`, `toast.open`, `toast.close` | `LiveEventsProvider` toasts |
| `sound.on`, `sound.muted`, `sound.needsClick`, `sound.clickToMute`, `sound.clickToEnable` | `LiveSoundToggle` tooltip / aria-label |
| `status.live`, `status.connecting`, `status.offline`, `status.polling` | `LiveSoundToggle` tooltip |
| `badge.new` | labels page "New" chip (section 2) |

Merge each fragment as a new top-level `liveOrders` key. Until it is merged, next-intl shows the key paths.

---

## Emitter checklist (backend workstreams; nothing here is a presentation file)

All publish calls are fire-and-forget, never throw, and must run **after** the DB write commits. Import them with:

```ts
import { publishLive, publishOrderEvent, publishNewOrders, LIVE_ORDER_SELECT } from '@/lib/live/publish';
```

### W4 (orders): required for the founder's acceptance test

- **`lib/orders/etsyLifecycle.ts` → `upsertEtsyReceipt`.** This covers webhook `order.paid`, the poll, reconcile and the manual button. After the transaction commits:

  ```ts
  const row = await prisma.order.findUnique({ where: { id: orderId }, select: LIVE_ORDER_SELECT });
  if (row) {
    if (created) publishOrderEvent(userId, row, 'new');                 // chime + toast + live row
    else if (statusChangedTo === 'cancelled') publishOrderEvent(userId, row, 'cancelled');
    else if (statusChangedTo === 'shipped') publishOrderEvent(userId, row, 'shipped');
    else if (statusChangedTo === 'delivered') publishOrderEvent(userId, row, 'delivered');
    else if (changed) publishOrderEvent(userId, row, 'updated');
  }
  ```

  For a bulk catch-up (the first poll after connect, or a backfill), use `publishNewOrders(userId, rows, { scope: 'etsy' })` instead of a loop. It announces only orders dated within 72 h, at most the 10 newest individually, and the rest as one `sync.finished { newOrders }`, so a 500-order first import does not chime 500 times. The client also refuses to chime for orders older than 72 h.
- **Until W4 lands, the W0 stub `handleEtsyOrderEvent` path.** After `syncEtsyOrders` creates the order, add `publishOrderEvent(userId, createdRow, 'new')` there; `createdRow` comes from `findFirst(... select: LIVE_ORDER_SELECT)` at `lib/orders/etsyLifecycle.ts:66`.
- **`lib/orderSync.ts` batch writer** (Trendyol, eBay, Shopify, Wix, Amazon, Veeqo, Shippo). After the `ordersToCreate` transaction (line ~1566), add:

  ```ts
  const createdRows = await prisma.order.findMany({
    where: { userId, marketplaceKey: { in: ordersToCreate.map((o) => o.marketplaceKey) } },
    select: LIVE_ORDER_SELECT,
  });
  publishNewOrders(userId, createdRows, { scope: String(marketplace || 'orders') });
  ```

  At the end of a run with `ordersUpdated > 0`, publish once instead of per order: `publishLive(userId, { type: 'sync', kind: 'finished', scope, newOrders: 0, updatedOrders: ordersUpdated })`.
- **Label routes** (`generate-label.ts`, `labels/ups.ts`, `labels/mng.ts`, `shipments/[id]/void.ts`, `submit-tracking.ts`). Publish `publishLive(userId, { type: 'shipment', kind: 'created' | 'voided' | 'tracking_submitted' | 'failed', orderId, shipmentId, carrier, trackingNumber })`. The orders page in other tabs then refreshes, because `shipment.*` is aliased to `order.updated` and revalidates `/api/orders`.
- **Manual order creation** (`pages/api/orders/manual*`, if present): publish `publishOrderEvent(userId, row, 'new')`.

### W5 (notifications) — per A8

In `notify()`, after the upsert creates or re-raises a **badge** notification, call `publishLive(userId, { type: 'notification', action: 'raised', notification: toNotificationItem(row), unreadCount })`. The `notification` value has the same shape as the GET items, and `unreadCount` is optional. Mark-read should publish `{ type: 'notification', action: 'read', ids, all }`, and `resolve()` should publish `{ type: 'notification', action: 'resolved', dedupeKeys }`. The bell then refreshes in every tab and device.

### W3 (listings)

- After the refresh/upsert in `handleEtsyListingEvent` / `refreshListingFull`, publish `publishLive(userId, { type: 'listing', kind, marketplace: 'etsy', shopId: String(shopId), listingId: String(listingId), title, state, attribution, versionId })`. `kind` is `deleted` for a 404.
- The draft sync executor should publish `{ type: 'draft', kind: 'syncing' | 'synced' | 'failed' | 'conflict', marketplace: 'etsy', draftId, listingId }`. W1/W3 own `draftService.ts`.
- Reconcile jobs should publish at most one `{ type: 'invalidate', keys: ['live:listing'] }` per shop per run, never one event per listing.

### W2 (stock)

After ledger writes, publish `{ type: 'stock', kind: 'changed', stockItemId, sku, onHand }`. Alerts use `kind: 'out_of_stock' | 'drift' | 'unmatched_sale' | 'push_failed'`, push results use `push_applied`, and the setup wizard and Go Live use `settings_changed`.

### W1 (backbone)

- Nothing is required. `publishLive` works from the in-process worker; the bus state is a `globalThis` singleton, so separate Next bundles share one LISTEN connection.
- The admin monitoring cockpit can show `liveBusStatus()` from `lib/live/bus.ts`: transport, listenerState, subscriber count, and published/delivered/notifyErrors/reconnects counters.

---

## Ops notes (not code, for the integrator / founder)

- **No new env vars are required.** The transport is `pg` whenever `DIRECT_URL`/`DATABASE_URL` is set. `KX_LIVE_TRANSPORT=local` is a kill switch that keeps delivery in-process only; that still works because production is a single process.
- **DB cost.** One extra Postgres connection per server process (`application_name='kx-live-listen'`). Production has `max_connections=100` with ~15 in use.
- **nginx (recommended, not required).** The SSE response headers already disable buffering, and `proxy_read_timeout 300s` is well above the 20 s heartbeat. Two optional hardening steps for `/etc/nginx/sites-enabled/kolayxport`:

  ```nginx
  # lifts the 6-connections-per-origin HTTP/1.1 limit for users with many tabs
  listen 443 ssl;  http2 on;          # nginx ≥ 1.25.1  (older: `listen 443 ssl http2;`)

  location = /api/live/stream {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 1h;
  }
  ```

- **Smoke test after deploy.**
  1. Run `curl -N -H "Cookie: <session cookie>" https://kolayxport.com/api/live/stream`. It should print `retry: 5000`, then a `sync.status` hello, then `: ping` every 20 s.
  2. On the server, run `psql "$DATABASE_URL" -c "SELECT pg_notify('kx_live', json_build_object('userId','<id>','envelope',json_build_object('id','t1','v',1,'ts',(extract(epoch from now())*1000)::bigint,'name','order.new','event',json_build_object('type','order','kind','new','order',json_build_object('id','x','marketplace','etsy','orderNumber','TEST','totalPrice',1,'currency','USD'))))::text)"`. An open, clicked-once tab should chime and show the toast.

---

## Cross-workstream issues

- None open from the W6-live review. The mount location changed from `components/AppLayout.js` to `pages/_app.tsx` (section 1); the UI session must not mount the provider in AppLayout as an earlier draft of this note said. `LiveSoundToggle` still goes in AppLayout.
