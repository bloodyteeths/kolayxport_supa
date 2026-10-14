# W5-notifications — integration notes

W5 delivers the notification backend and a new page at `/app/bildirimler`. The backend covers the registry, preferences, the outbox/dispatcher, the digest, retention, live events and the APIs. The UI session owns the presentation files listed below, and W5 does not edit them. Each section here describes an exact change for that session to make.

## 1. What landed (no action needed)

| Area | Files |
|---|---|
| Core `notify()` / `resolve()` / feed (contract kept) | `lib/notifications.ts` |
| Registry (isomorphic) | `lib/notificationCenter/registry.ts`, `params.ts`, `time.ts` |
| Preferences | `lib/notificationCenter/preferences.ts`, `preferencesService.ts` |
| Outbox / dispatcher / digest / retention | `lib/notificationCenter/outbox.ts`, `dispatcher.ts`, `digest.ts`, `retention.ts`, `jobs.ts` |
| Channels | `lib/notificationCenter/channels/{types,inApp,email,telegram,index}.ts` |
| Server render (email) | `lib/notificationCenter/render.ts` |
| APIs | `pages/api/notifications/index.ts` (extended), `activity.ts` (new), `preferences.ts` (new); `read.ts` is unchanged |
| Page + UI | `pages/app/bildirimler.tsx`, `components/notification-center/*` |
| i18n | `messages/fragments/notificationCenter.{en,tr}.json`, `scripts/i18n/merge-fragments.ts` (+ `mergeFragmentsCore.ts`) |
| Tests | `test/lib/notifications.test.ts` (rewritten), `test/notifications/{preferences,dispatcher}.test.ts`, `test/i18n/mergeFragments.test.ts` |

### API contracts

- **`GET /api/notifications`**: the existing call (`?limit=20`) still returns `{ items, unreadCount }`. Two fields are additive: `nextCursor`, and new per-item fields `badge`, `entityType`, `entityId` and `resolvedAt`.
  - Optional query parameters: `feed=badge|activity|all` (default `badge`, the bell), `cursor`, `group=orders|dispatch|listings|stock|account|system`, `unread=1` and `includeResolved=1`.
  - **`unreadCount` now counts only `badge=true`, unread, unresolved rows.**
  - Optional header `X-KX-Locale: tr|en`. The server stores it as `NotificationSettings.locale` at most once per hour, so emails go out in the UI language.
- **`POST /api/notifications/read`**: unchanged (`{ ids?: string[], all?: boolean }` returns `{ ok: true }`). It now also publishes a live `notification.read` event, so the other tabs update.
- **`GET /api/notifications/activity`** (new): returns `{ items, unreadCount, nextCursor }` for the `badge=false` rows, including resolved ones.
- **`GET|PUT /api/notifications/preferences`** (new): see the header comment in `pages/api/notifications/preferences.ts`. Admin-only types are hidden from, and rejected for, non-admin users.

### Behaviour

- **Registry.** `lib/notificationCenter/registry.ts` is the single source of the per-type defaults. It follows spec W5 T1 (changing a default is a founder decision, not a code default):

  | Type(s) | In-app | Email |
  |---|---|---|
  | `orderCanceledAfterLabel`, `dispatchOverdue`, `dispatchDueToday`, `stockPushFailed`, `listingDeleted`, `listingDeactivated`, `reauthRequired` | on | instant |
  | `dispatchDueTomorrow`, `listingExpired`, `stockOutOfStock`, `seoExperimentReady` | on | daily digest |
  | `orderCanceled`, `orderSyncFailed`, `stockDrift`, `stockUnmatchedSale`, `draftSyncFailed`, `draftConflict`, `usageNearLimit`, `usageLimitReached` | on | off |
  | `orderNew`, `orderShippedExternal`, `listingChangedExternally` | activity feed only (no badge; `listingChangedExternally` is also in-app off) | off |
  | `webhookBacklog` | admin only | instant |

  New orders do not raise the bell badge: the chime and the live row on the orders page come from W6's `order` live event; the `orderNew` row shows in the Activity feed.

  There are three presets:
  - **critical** (*Sadece kritik*): error-severity types only.
  - **recommended** (*Önerilen*): the defaults in the table above.
  - **all** (*Hepsi*): every type.
- **Preference resolution.** The first match wins:
  1. the user's row for the type
  2. the user's `'*'` row
  3. the preset
  4. the registry default

  A type whose in-app setting is off is still written, with `badge=false`, so it shows in the Activity feed.
- **Emitter `badge` option.** `NotifyInput.badge` defaults to true. An explicit `badge:false` always makes the row activity-only. `badge:true` cannot override a registry activity type or an in-app preference that is off.
- **Raise rules.** Every raise (a create or a re-raise) does three things:
  - inserts a `NotificationDelivery` row per enabled channel, with status `pending`, or `digest` when the email mode is digest. Older open deliveries (`pending`/`held`/`digest`) of the same notification and channel are marked `skipped` (`superseded`), so there is at most one open delivery per notification and channel. An instant channel is not re-queued if the same notification was sent (or is being sent) on it within the last 6 h (`REEMAIL_COOLDOWN_MS`), unless the raise escalated (`escalateOn` param rose, or severity went up). Losing a concurrent create race for the same dedupeKey only refreshes params (no second delivery or live event);
  - triggers the dispatcher in-process. The trigger is debounced by 1.5 s and is off when `KX_DISABLE_INPROCESS_JOBS=1`;
  - publishes a live event:
    - badge rows publish `{type:'notification', action:'raised', notification, unreadCount}`, which the W6 client maps to the names `notification.new` and `notification.changed`;
    - activity rows publish `{type:'invalidate', keys:['/api/notifications/activity']}`.
- **Resolving.** `resolve()` and `resolveByPrefix()` mark open deliveries `skipped` and publish `notification.resolved`.
- **Dispatcher.**
  - Quiet hours default to 23:00–08:00 in the user's timezone (default `Europe/Istanbul`). They hold non-error emails; errors are always sent immediately.
  - Failed sends are retried after 1 min, 5 min, 30 min and 2 h, then marked `failed`.
  - When Postmark is not configured, the delivery is marked `skipped`.
  - If the user reads the notification before a held email goes out, the email is skipped.
- **Digest.** At most one email per user per local day, at `digestHour` (default 08:00). If `digestHour` falls inside quiet hours, the digest goes out at the first non-quiet moment after it (e.g. digestHour 23 with quiet 23–08 sends at 08:00). It lists the digest items plus the unread badge items from the last 24 h. Candidate users are picked with a distinct query, so one user's backlog cannot starve others.
- **Scheduled jobs.** These are registered through `lib/scheduler/jobs.ts`, so W1's runner and cron fallback pick them up:

  | Job | Schedule | Purpose |
  |---|---|---|
  | `notifications-dispatch` | every 1 min | send due deliveries |
  | `notifications-digest` | every 15 min | daily digest |
  | `notifications-retention` | daily at 04:40 UTC | delete read or resolved rows older than 90 d, unread rows older than 180 d, and terminal deliveries older than 30 d. Unresolved rows of state-bearing types (`reauthRequired`, read by `getOpenReauthFlags` / connectionStatus) are never deleted by age |

- **Telegram.** The channel exists behind the `NotificationChannel` interface but sends nothing in this build. It needs both `TELEGRAM_BOT_TOKEN` and a linked chat id, and there is no linking flow yet. The preferences screen shows it as "Yakında" (coming soon).

Production (read-only check on 2026-10-15): `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` are set, `TELEGRAM_BOT_TOKEN` is not set, there is 1 admin and there are 7 users, and the `Notification` table is empty. **Once deployed, instant emails for the types listed above go to users' account email addresses by default.**

---

## 2. `components/NotificationBell.tsx` (UI session)

Goal: show the new types correctly, desktop Popover 380 px, mobile full-height Drawer (z-index 1500), Today/Earlier, severity dot, "Tümünü gör" link, settings gear.

Replace the local `titleFor` / `REQUIRED_PARAMS` / `list` JSX with the W5 panel:

```tsx
import NotificationPanel from '@/components/notification-center/NotificationPanel';
// ...inside the component (keep useNotifications, router, isMobile, anchorEl, close):
const panel = (
  <NotificationPanel
    items={items}
    unreadCount={unreadCount}
    isLoading={isLoading}
    locale={locale}
    fullHeight={isMobile}
    onItemClick={(item) => {
      if (!item.readAt) void markRead([item.id]);
      close();
      if (item.link) router.push(item.link);
    }}
    onMarkAllRead={() => void markAllRead()}
    onNavigate={close}
  />
);
```

Mobile drawer (replaces the bottom sheet):

```tsx
<Drawer
  anchor="right"
  open={open}
  onClose={close}
  sx={{ zIndex: 1500 }}
  PaperProps={{ sx: { width: '100%', maxWidth: '100vw', height: '100%', pt: 'env(safe-area-inset-top, 0px)' } }}
>
  {panel}
</Drawer>
```

Desktop: keep the existing `<Popover>`. Put `{panel}` inside it; the panel is already 380 px wide (`sm:w-[380px]`).

`NotificationPanel` renders titles with `useNotificationText`. That hook uses `notifications.<titleKey>` and falls back to `notificationCenter.<titleKey>`, applies the same required-parameter fallback as today, and covers the new types. Remove the bell's `kinds.*` rewrite of the `kind` param. The usage messages already `select` on the raw `kind` value, so the rewrite made them fall through to `other`.

Badge semantics are unchanged: the bell shows `unreadCount` from the API, which now counts only `badge=true` rows.

## 3. `lib/hooks/useNotifications.ts` (UI session)

1. **Send the UI locale** so emails are rendered in it:
   ```ts
   import useLocaleStore from '@/lib/stores/useLocaleStore';
   const fetcher = async (url: string) => {
     const locale = useLocaleStore.getState().locale || 'tr';
     const res = await fetch(`${url}?limit=${LIMIT}`, { credentials: 'same-origin', headers: { 'X-KX-Locale': locale } });
     ...
   };
   ```
2. **Live updates (W6).**
   - `lib/live/names.ts` maps the `notification.raised`, `read` and `resolved` events to `notification.changed`. Inside the hook, add:
     ```ts
     import { useLiveRevalidate } from '@/components/live/useLiveEvent';
     useLiveRevalidate(['notification.*'], NOTIFICATIONS_KEY, { enabled });
     ```
   - Optionally, apply `event.unreadCount` and `event.notification` optimistically through `mutate(prev => ...)` before revalidating.
   - When the stream is live, relax `refreshInterval` from 60 s to 120 s.
3. Optionally, extend `NotificationItem` with `badge?: boolean; resolvedAt?: string | null; entityType?: string | null; entityId?: string | null;`. Everything is additive, and `normalizeNotifications` may ignore these fields.

## 4. `components/AppLayout.js` (UI session): nav entry

In `buildNavGroups` → group `id: 'account'` (bottom), add before Settings:

```js
{ href: '/app/bildirimler', icon: Bell, label: t('notifications') },
```

`Bell` is not imported in AppLayout yet: add it to the existing `lucide-react` import list (around line 39). The `nav.notifications` key already exists in both EN and TR, so it needs no new i18n key. The Cmd+K palette picks up nav entries automatically.

Optional: add an `unreadBadge: true` flag that shows `useNotifications().unreadCount` next to the nav entry, using the same pattern as `messageBadge`.

## 5. `pages/ayarlar.tsx` (UI session): optional link only

The preferences live on `/app/bildirimler?tab=preferences`, not in ayarlar (per A8). If a pointer is wanted, add a row to the Account tab:

```tsx
<Link href="/app/bildirimler?tab=preferences" className="...">{t('notificationCenter.prefs.title')}</Link>
```

That would need `useTranslations()` without a namespace, or `useTranslations('notificationCenter')` with `t('prefs.title')`.

## 6. i18n (integrator)

- The fragments are `messages/fragments/notificationCenter.{en,tr}.json`, with the single top-level key `notificationCenter`.
- **Relocation:** move `notificationCenter.types.*` to `notifications.types.*`. The `titleKey` values (`'types.orderNew'`) resolve under the `notifications` namespace.
  - `scripts/i18n/merge-fragments.ts` already performs this move through `RELOCATIONS` in `mergeFragmentsCore.ts`.
  - Everything else stays in the new top-level `notificationCenter` namespace: `typeLabels`, `groups`, `severity`, `page`, `panel`, `prefs` and `email`.
- Commands:
  ```bash
  npx tsx scripts/i18n/merge-fragments.ts --check          # validate all fragments (exit 1 lists conflicts / en-tr mismatches)
  npx tsx scripts/i18n/merge-fragments.ts                  # write messages/en.json + tr.json (key order kept, new keys appended)
  npx tsx scripts/i18n/merge-fragments.ts --out /tmp/i18n  # dry write to a scratch dir
  ```
  `--check` passed on 2026-10-15 with the notificationCenter and liveOrders fragments: +133 leaves in each locale.
- Before the merge, the server renderer reads the fragment from disk, so emails are correct on day one. The client UI (page and panel) falls back from `notifications.types.*` to `notificationCenter.types.*`. Other `notificationCenter.*` UI strings render only after the merge, so the merge must ship with this page.

## 7. Emitter contract (W1–W4): new notification types

Use `titleKey: 'types.<type>'`, take dedupe keys from `notificationKeys.*` in `lib/notifications.ts`, and send at least the **required params**. If a required param is missing, the generic fallback line is shown instead (`lib/notificationCenter/params.ts`).

| type | severity | dedupeKey | required params (optional) | escalateOn | link |
|---|---|---|---|---|---|
| orderNew | info | `notificationKeys.order(id,'new')` | orderNumber (total, currency, itemCount, lastUnit) | – | `/app/labels?highlight=<id>` |
| orderCanceled | warning | `order(id,'canceled')` | orderNumber | – | `/app/labels` |
| orderCanceledAfterLabel | error | `order(id,'canceledAfterLabel')` | orderNumber (carrier, tracking, labelCost) | – | label/void page |
| orderShippedExternal | info | `order(id,'shippedExternal')` | orderNumber | – | `/app/labels` |
| dispatchOverdue / DueToday / DueTomorrow | warning / warning / info | `dispatch('overdue'\|'today'\|'tomorrow', localDate)` | count (labelNotPushed, orderNumbers) | `count` | `/app/labels` |
| listingDeactivated / Expired / Deleted | error / warning / error | `listing(listingId, kind, day?)` | title | – | `/app/etsy-listings` |
| listingChangedExternally | info | `listing(listingId,'changed', day)` | title | – | `/app/etsy-listings` |
| stockOutOfStock | warning | `stockOut(stockItemId)` | sku | – | `/app/stok-senkron` |
| stockPushFailed | error | `stockPush(linkId, window)` | sku, channel | – | `/app/stok-senkron` |
| stockDrift | warning | `stockDrift(localDate)` | count | `count` | `/app/stok-senkron` |
| stockUnmatchedSale | warning | `stockUnmatched(localDate)` | count (skus) | `count` | `/app/stok-senkron` |
| seoExperimentReady | info | `seoExperiment(id)` | title | – | experiment page |
| webhookBacklog (via `notifyAdmins`) | error | `webhookBacklog(hourBucket)` | – (count, oldestMinutes) | – | admin cockpit |

Pass `entity: { type: 'order'|'listing'|'stockItem'|..., id }` where it applies; it is stored as `entityType` and `entityId`. A rollup that should alert again only when it grows must pass `escalateOn: 'count'`; otherwise every call re-raises. To clear a row, call `resolve(userId, key)` with the same key, for example when an order is labelled or a listing is reactivated.

## 8. Env / ops

- `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` are already set in production.
- `KX_DISABLE_INPROCESS_JOBS=1` is the kill switch for the in-process dispatcher trigger. The scheduled jobs still run through W1's scheduler and the cron fallback.
- `TELEGRAM_BOT_TOKEN` is optional, and Telegram stays inert without a linking flow.
- `relationMode="prisma"`: retention deletes deliveries explicitly before it deletes notifications.

## 9. Cross-workstream issues (found in the W5 review; owners must act)

W5 now limits emails on its side: a raise supersedes the older open deliveries, and there is a 6 h re-email cooldown unless the raise escalated. The emitters below still re-raise on every call, which bumps the bell and publishes a live event each time. Each owner should add the flag shown:

- **`lib/etsy/etsyToken.ts` (legacy-Credential path, owner of etsyToken).** It calls `raiseReauth` on every `InvalidGrantError`, so it fires on every token fetch. Pass `onlyIfNew: true` in that `notify()` call. A resolved row still re-raises, so a fresh incident after a reconnect is not lost.
- **`lib/orderSync.ts` `notifyOrderSyncFailed` (owner of orderSync).** It runs on every failed provider fetch (cron every 15 min) without `onlyIfNew`. Pass `onlyIfNew: true`. `resolve(ordersync:<provider>)` on success already re-arms it.
- **`lib/integrations/connectionStatus.ts` (owner of connectionStatus).** It treats an Etsy shop as needing reauth only when an unresolved `reauthRequired` notification exists, and its `etsyShops` select ignores `EtsyShop.needsReauth`. W5 retention now never deletes unresolved `reauthRequired` rows. Still, also read `EtsyShop.needsReauth` (or `isShopReauthBlocked`) so the connections page does not depend on a notification row. A parked shop never raises that row again.
- **UI session (`components/NotificationBell.tsx`, orders page).** `orderNew` is an activity-feed row (`badge=false`, spec W5 T1), so new orders do not raise the bell's unread count. The new-order chime and the live row come from W6's `order` live event. The bell gets `{type:'invalidate', keys:['/api/notifications/activity']}` for each order, so do not play a sound on `notification.raised` for orders.
- **Emitters passing `badge:false` (W4 `lib/orders/orderEffects.ts`).** This is now honoured for every type, not only unknown ones.
