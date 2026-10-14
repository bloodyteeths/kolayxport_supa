# W3 listing intel: integration notes

W3 adds:

- a listing cache that webhooks keep fresh, with a timestamp guard on writes
- an offering cache keyed by variantKey
- change history with attribution, plus undo, which only creates a draft
- alerts when a listing is deactivated, expires or is deleted
- SEO cohort experiments
- a new page, `/app/etsy-aktivite`

All backend code and the new page and components are done. The other session needs to make the presentation changes in sections 1 to 4 below.

## 0. What the integrator merges

| Fragment | Merge as |
|---|---|
| `messages/fragments/listingHistory.{en,tr}.json` | new top-level `listingHistory` |
| `messages/fragments/seoExperiments.{en,tr}.json` | new top-level `seoExperiments` |

The en and tr key sets are identical: 113 keys in `listingHistory` and 46 in `seoExperiments`.

Notification texts for the types W3 emits already exist in W5's `notificationCenter.types.*`. Section 5 lists the params W3 sends with each type.

## 1. `components/etsy/ListingEditorDrawer.tsx`: History tab

**Imports** (top of file):

```tsx
import HistoryIcon from '@mui/icons-material/History';
import ListingHistoryPanel from '@/components/etsy-history/ListingHistoryPanel';
```

**Inside the component**, next to the existing `const t = useTranslations(...)`:

```tsx
const tHistory = useTranslations('listingHistory');
```

**`editorTabs`** (around line 1720): add a tab as the last entry, after `actions`:

```tsx
{ id: 'history', label: tHistory('editorTab'), icon: <HistoryIcon fontSize="small" /> },
```

**Content area**: add this block next to the other `activeTab === ...` blocks, for example right after the `activeTab === 'actions'` block (around line 3069):

```tsx
{activeTab === 'history' && listingId && (
  <Box sx={{ p: { xs: 2, md: 2.5 } }}>
    <ListingHistoryPanel
      shopId={shopId}
      listingId={listingId}
      onRestored={applyRestoredDraft}
    />
  </Box>
)}
```

**Why `refreshDraftState()` alone is not enough.** `refreshDraftState` (line ~1556) only refreshes `draftId`, `draftStatus`, `draftLastError` and `draftQueuedDelete`. It never loads the server draft's `fieldPatch` into the editor's `fields`. The drawer's Save **always stages with `replaceFields: true`**, built from its own diff of `fields` against the Etsy original (`handleSave`, lines ~1179 and ~1257). `lib/etsy/draftService.ts` then sets `fieldPatch = params.fields`. So unless the restored values are put into `fields`, the next Save (even with no edits) wipes the restored title, tags and description. The restore must therefore overlay the restored patch onto the editor.

**Add, inside the component, after `refreshDraftState` is defined (line ~1575):**

```tsx
// Restored fieldPatch keys the editor has no input for (e.g. taxonomy_id).
// handleSave re-sends them so replaceFields does not drop them.
const restoredExtraFieldsRef = useRef<Record<string, any>>({});

const applyRestoredDraft = useCallback(async (draft: any) => {
  await refreshDraftState();
  const base = fieldsRef.current;
  if (!base || !listingId) return;
  const patch: Record<string, any> =
    draft && draft.fieldPatch && typeof draft.fieldPatch === 'object' ? draft.fieldPatch : {};
  const next: EditableFields = { ...base, tags: [...base.tags], materials: [...base.materials] };
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k in next) (next as any)[k] = Array.isArray(v) ? [...v] : v;
    else extra[k] = v;
  }
  restoredExtraFieldsRef.current = extra;
  setFields(next);
  clearDraft(listingId);          // the DB draft is now the source, not the device copy
  markStaged(listingId, next);    // "same as the DB draft" for the status label / close confirm
  setSaveTarget('draft');
  setAutoSaveStatus('saved');
  setLastSavedAt(new Date());
  onSaved();                      // parent refreshes its pending-draft badges
}, [refreshDraftState, listingId, onSaved]);
```

The `fieldPatch` keys written by the restore are snake_case and match `EditableFields` one to one (`title`, `description`, `tags`, `materials`, `who_made`, `when_made`, `is_supply`, `shop_section_id`, `shipping_profile_id`, `return_policy_id`, `processing_min`, `processing_max`, `item_weight`, `item_weight_unit`, `item_length`, `item_width`, `item_height`, `item_dimensions_unit`). Only `taxonomy_id` has no editor input; it goes to `restoredExtraFieldsRef`.

**In `handleSave`:**

- In the "no changes" branch (line ~1179), change `fields: {}` to `fields: { ...restoredExtraFieldsRef.current }`.
- Right before `if (Object.keys(payload).length === 0) {` (line ~1250), add:

  ```tsx
  for (const [k, v] of Object.entries(restoredExtraFieldsRef.current)) {
    if (payload[k] === undefined) payload[k] = v;
  }
  ```

**In `fetchListing`** (line ~601), add `restoredExtraFieldsRef.current = {};` before `setLoading(true)`, so the extras never leak to another listing.

How the panel behaves:

- It loads `GET /api/etsy/listings/:id/versions` and refreshes itself on live `listing.changed` and `listing.removed` events for that listing.
- Its "Restore as draft" confirmation is its own MUI Dialog with `zIndex: 1550`, so it opens above the drawer.
- Restore calls `POST .../versions/:versionId/restore`. That only stages a draft through `upsertDraftPatch` (a merge, not a replace). The response is `{ draft, restoredKeys, unrestorable, nothingToRestore }`. The panel calls `onRestored(draft)` only when `draft` is not null. Nothing is written to Etsy.
- Restored image reorder/alt-text operations go to `EtsyDraftMedia`, which `replaceFields` does not touch.

W2's `StockManagedQtyChip` next to the quantity field is mounted per W2's notes (`docs/integration/parts/W2-*.md`); W3 does not mount it.

## 2. `pages/app/etsy-listings.tsx`

### 2a. Freshness chip next to "Sync from Etsy" (around line 2887)

**Import:**

```tsx
import CacheFreshnessChip from '@/components/etsy-history/CacheFreshnessChip';
```

**Where:** directly after the `</Tooltip>` that wraps the Sync button. On desktop it replaces the hand-made `lastSync` caption; on mobile it shows the chip only.

```tsx
{selectedShopId && <CacheFreshnessChip shopId={selectedShopId} />}
```

The chip uses this wording, and never the word "webhook":

- "Etsy canlı bağlı · son değişiklik 2 dk önce" when Etsy push notifications were seen in the last 24 h
- "Gecikmeli · günde bir kontrol · son kontrol …" otherwise, because listings without push are re-checked by the nightly reconcile, not every 15 min

### 2b. Live refresh with no manual sync (founder requirement A2)

**Rule: a live event must never call `fetchListings()`.** `fetchListings` (line ~1399) first returns the in-memory `listingsCacheRef` entry when it is under 5 min old, so a live event would do nothing for 5 min. Otherwise it pages `action=listings_with_images`, which is a LIVE Etsy call per 100 listings (`clawd/etsy.ts` ~2948). On every `listing.changed` (every sale, every bulk sync), in every open tab, that would re-read the whole catalog from Etsy. The DB cache is already webhook-fresh, so live events refetch from the DB, exactly like the existing post-sync path inside `syncListings` (lines ~1512–1531).

**Imports:**

```tsx
import { useLiveEvent } from '@/components/live/useLiveEvent';
```

**Add after `fetchPendingDrafts` is defined and before the `useEffect` that calls `fetchListings().then(() => fetchStatusCounts())` (line ~1586):**

```tsx
// DB-only refetch (no Etsy call): same steps as syncListings after a sync.
const refetchListingsFromDb = useCallback(async () => {
  if (!selectedShopId) return;
  const shopId = selectedShopId;
  const state = statusFilter || 'active';
  Object.keys(listingsCacheRef.current).forEach((key) => {
    if (key.startsWith(shopId)) delete listingsCacheRef.current[key];
  });
  statusCountsCacheRef.current[shopId] = {};
  try {
    const r = await fetch(`/api/clawd/etsy?action=cached_listings&shop_id=${shopId}&state=${state}`);
    if (r.ok) {
      const d = await r.json();
      const rows: EtsyListingRow[] = (d.listings || []).map(mapListing);
      setListings(rows);
      setTotalCount(d.count || rows.length);
      setListingsLoadedFor(shopId);
      if (d.stateCounts) statusCountsCacheRef.current[shopId] = d.stateCounts;
      setStatusCountsVersion((v) => v + 1);
      listingsCacheRef.current[`${shopId}:${state}`] = { listings: rows, total: d.count || rows.length, ts: Date.now() };
      if (d.lastSyncAt) setLastSyncAt(d.lastSyncAt);
    }
  } catch {
    /* the next live event or the reconnect revalidate retries */
  }
  await fetchPendingDrafts();
}, [selectedShopId, statusFilter, fetchPendingDrafts]);

// Coalesce bursts (a bulk sync emits one event per listing): at most one
// DB refetch per 2 s, trailing.
const liveRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const refetchFromDbRef = useRef(refetchListingsFromDb);
refetchFromDbRef.current = refetchListingsFromDb;
useEffect(() => () => { if (liveRefetchTimerRef.current) clearTimeout(liveRefetchTimerRef.current); }, []);

useLiveEvent(
  ['listing.changed', 'listing.removed', 'sync.progress', 'sync.finished', 'sync.status'],
  (ev) => {
    if (ev.type === 'sync') {
      if (ev.kind === 'status') {
        // only after a reconnect / while polling (events may have been missed)
        if (ev.phase !== 'reconnected' && ev.phase !== 'polling') return;
      } else if (ev.scope !== 'listings:etsy') {
        return; // order syncs etc.
      }
    } else if ('shopId' in ev && ev.shopId && String(ev.shopId) !== selectedShopId) {
      return; // another shop's listing / draft
    }
    if (syncing) return; // the manual Sync handler refetches itself when done
    if (liveRefetchTimerRef.current) return;
    liveRefetchTimerRef.current = setTimeout(() => {
      liveRefetchTimerRef.current = null;
      void refetchFromDbRef.current();
    }, 2000);
  },
);
```

Notes:

- `listing.changed` also covers `draft.*` (W6 aliases `draft` to `listing.changed`), so draft status badges update too. That is why the callback also calls `fetchPendingDrafts()`.
- `sync.progress` / `sync.finished` with `scope: 'listings:etsy'` come from the reconcile (first import after connect, nightly, manual sync). The reconcile writes rows without per-row listing events, so these are what fill an empty listings tab right after a first Etsy connect, with no refresh. `sync.progress` is throttled server-side to one per 3 s and is only sent when rows were written.
- The `ev.phase` field exists on `sync.status` events (see `lib/live/types.ts`). If TypeScript narrows awkwardly, cast: `(ev as any).phase`.
- There is no `invalidateShopListingsCache()` in the page. An earlier draft of this note referenced it; ignore that.

### 2c. Sidebar counts (optional, deferred in the spec)

`listing_count` is now served from a DB `groupBy(state)` and makes zero Etsy calls. Only a shop that was never imported falls back to one live call. The 4 requests can be replaced with the `stateCounts` that `cached_listings` already returns. There is no API change either way.

### 2d. `sync_listings` response

On success (HTTP 200) the shape is `{ success, partial, synced, changed, fetched, errors: number, removed, lastSyncAt }`.

- `synced` keeps its old meaning: listings fetched from Etsy and confirmed in the DB (changed plus unchanged). `changed` is the number of rows actually written. The existing `t('syncSuccess', { count: data.synced })` toast stays correct.
- Hard failures are now non-2xx, so the existing `if (!res.ok)` branch shows `syncFailed` with `errData.error`:

  | Status | `code` | When |
  |---|---|---|
  | 409 | `ETSY_REAUTH` | the shop needs reconnecting |
  | 404 | `ETSY_SHOP_NOT_FOUND` | shop missing or inactive |
  | 503 | `ETSY_RATE_LIMITED` | budget stop / abort / defer before anything was fetched |
  | 502 | `ETSY_SYNC_FAILED` | every page failed |

  Optional polish: map `code === 'ETSY_REAUTH'` to the existing reconnect wording instead of the English `error` text.
- A partial run that still fetched listings answers 200 with `partial: true`. Optional: when `data.partial`, show `toast(...)` (warning) instead of `toast.success`.
- It runs the shared reconcile and deletes nothing on doubt: each unseen listing is re-checked with a GET, and only a 404 leads to a deletion.
- `lastSyncAt` only moves on full success. On a partial run it returns the previous value.

## 3. Navigation: `components/AppLayout.js`

In the `listings` group (around line 136), add an entry after `etsy-listings`:

```js
{ href: '/app/etsy-aktivite', icon: Activity, label: tLH('navLabel'), requires: 'etsy', listings: true },
```

You also need:

- `import { Activity } from 'lucide-react'`
- `const tLH = useTranslations('listingHistory');`

You can instead add `nav.etsyActivity` ("Etsy activity" / "Etsy aktivite") to `messages/*.json` and use `t('etsyActivity')`.

`CommandPalette` builds its destinations from the nav, so nothing else is needed there.

**Deep link:** `/app/etsy-aktivite?tab=seo` opens the SEO tab. The `seoExperimentReady` notification links there.

## 4. New page and components (already created; no action needed)

- `pages/app/etsy-aktivite.tsx`
  - pill tabs for Changes and SEO experiments
  - an attribution filter (Changed on Etsy / Synced from KolayXport / Stock sync / Found in a check)
  - a shop selector when there are several shops
  - the freshness chip
  - expandable mobile cards
  - live prepend of new changes on `listing.changed`, `listing.removed` and `sync.finished`, plus a reconnect revalidate
- `components/etsy-history/`: `ListingHistoryPanel`, `VersionDiffView`, `ActivityFeedCard`, `AttributionChip`, `CacheFreshnessChip`, `types.ts`
- `components/etsy-seo/`: `SeoExperimentList`, `SeoExperimentCard`, `types.ts`

## 5. Notification types emitted by W3 (W5 registry / templates)

All rows use `titleKey: 'types.<type>'` and `entity: { type: 'etsyListing', id: '<shopId>:<listingId>' }`.

| type | severity | dedupeKey | params | link | notes |
|---|---|---|---|---|---|
| `listingDeactivated` | error | `listing:deactivated:<shop>:<listing>:<YYYY-MM-DD>` | `title`, `listingId` | `/app/etsy-listings` | Only for active→inactive that is external, or a transition found by the nightly reconcile, with no order for that listing in the last 30 min. Resolved automatically when the listing becomes active again. |
| `listingExpired` | warning | `listing:expired:<shop>:<listing>` | `title`, `listingId` | `/app/etsy-listings` | Digest candidate. Resolved on re-activation. |
| `listingDeleted` | error | `listing:deleted:<shop>:<listing>` | `title`, `listingId` | `/app/etsy-aktivite` | Suppressed when KolayXport deleted the listing in the last 10 min, through a draft `delete` or clawd `delete_listing`. |
| `listingChangedExternally` | info, `badge: false` | `listing:changed:<shop>:<listing>` | `title`, `listingId`, `fields` | `/app/etsy-aktivite` | Emitted only when the listing has an open draft. |
| `stockOutOfStock` | warning | `stock:oos:<shop>:<listing>:<6h bucket>` | `sku` (the SKUs at qty 0, or the title when there are none), `title`, `listingId` | `/app/etsy-listings` | Only for `inventory.out_of_stock` events on listings that stock sync does not manage. It replaces the old processor out-of-stock email; email delivery now goes through W5's channel. |
| `seoExperimentReady` | info | `seo:ready:<ISO-week Monday>` | `count`, `title` (one listing) | `/app/etsy-aktivite?tab=seo` | Weekly rollup with `escalateOn: 'count'`. W5's template uses `{title}`. A plural `{count}` form would read better for rollups. |

## 6. Live events published

Every event has `marketplace: 'etsy'` plus `shopId` and `listingId` as strings, `title`, `state`, `attribution` and `versionId`.

| Event | When |
|---|---|
| `listing.created` | A listing first appears through a webhook. |
| `listing.updated` | Any non-stale refresh, including our own draft sync and manual refreshes. |
| `listing.deactivated`, `listing.expired` | Those state transitions. |
| `listing.changed_externally` | External content changes, when the listing has an open draft. |
| `listing.deleted` | A 404 or `listing.deleted`. |

W6 aliases the first five to `listing.changed` and `listing.deleted` to `listing.removed`.

The reconcile publishes `sync.started`, throttled `sync.progress` (one per 3 s at most, only when rows were written, `processed` = listings seen so far) and finally `sync.finished` or `sync.failed`, all with `scope: 'listings:etsy'`. It does not publish per-row listing events (except `listing.deactivated` / `listing.expired` when it raises those alerts, and `listing.deleted` on a confirmed 404); open pages refetch from the DB on the `sync.*` events (section 2b).

## 7. Cross-workstream notes

### W1 (event backbone)

- `handleEtsyListingEvent` is real now: it never returns `stub:`. The `legacyListingHandler.ts` fallback and the old `checkDraftConflicts`/`markOpenDraftsConflict` copies in `processor.ts` can be deleted. The replacements are in `lib/etsy/draftConflicts.ts`.
- It throws `EtsyDeferError` for two reasons:
  - `min_interval`: on a webhook refresh less than 30 s after the last one, with retryAfter = the rest of the 30 s;
  - `lock_busy`: when W2's `observeEtsyOfferings` returns `deferMs`.
- Event types are handled as follows:

  | Event types | Handling |
  |---|---|
  | `listing.deleted` in the union | Removal path, no Etsy call. |
  | `listing.created`, `listing.updated`, `reconcile.changed`, or content changes | Draft conflict check. |
  | Only `inventory.*` with no content change (a sale) | Does not conflict drafts (same rule as the old processor). |

- `reconcileShopListings` uses `enqueueSyntheticEtsyEvent({ resourceKey: 'listing:<id>', eventType: 'reconcile.changed', priority: 2 })`. The worker must route `reconcile.changed` to the listing handler. `parseResourceKey` already does this via `listing:`.
- In `clawd/etsy.ts`, `callEtsyAPI` passes `{ retries: 0, timeoutMs: 120000 }` for non-GET requests and the default options for GET requests. Raw multipart uploads keep plain `fetch` (they must not be retried) and call `recordEtsyResponse(res, currentEtsyPriority(), shopId)`.

### W2 (stock)

- `observeEtsyOfferings` is called in three cases:

  | Case | `source` | `listingState` | `offerings` |
  |---|---|---|---|
  | (a) every non-stale webhook refresh | `'webhook'` | listing state | the listing's offerings |
  | (b) `refreshListingFull(source: 'draft_sync')`, i.e. our own draft PUT, for echo detection | `'draft_sync'` | listing state | the listing's offerings |
  | (c) on removal by a webhook / the worker's 404 path | `'webhook'` | `'removed'` | `[]` |

- The reconcile (nightly / manual / initial) never calls `observeEtsyOfferings`. When its deletion check gets a 404 it removes the cache rows, tombstones, conflicts drafts and alerts, then enqueues a synthetic `reconcile.changed` event for `listing:<id>`; the worker's 404 path then observes `'removed'` (case c).
- `EtsyOfferingObservation.variantKey` is the full `etsyVariantKeys` key. The listing's `quantity_on_property` is cached on `EtsyListing.quantityOnProperty`, so derive `etsyQuantityKey` from that for shared-quantity listings.
- `update_listing_inventory` returns `409 { code: 'STOCK_SYNC_MANAGED', key: 'listingHistory.errors.stockSyncManaged' }` when `isListingStockManaged` is true. `copy_listing` is not blocked, because it writes a new draft listing. Its inventory PUT runs under the new listing's inventory lock.
- `onEtsyShopOwnershipChanged` is called from the callback when the shop's previous `EtsyShop.userId` differs. `EtsyShop.shopId` is globally unique and the upsert is keyed by `userId_shopId`, so a cross-user reconnect fails the EtsyShop save today. The hook is therefore effectively dormant until ownership transfer is supported.

### W4 (orders)

These use `OrderItem.listingRef`, falling back to `rawData.transactions[].listing_id` until the backfill runs:

- daily sales stats
- the "order in the last 30 min" deactivation check
- the 30-min `etsy-listing-cache-backfill` job

On reconnect, the callback runs `runEtsyOrderIncremental(shopId, { reason: 'reconnect' })` fire-and-forget. Today it throws `not_implemented`, which is caught and logged.

### W5

Section 5 lists the params W3 sends.

## 8. Jobs (`lib/etsy/listingJobs.ts`, registered by `lib/scheduler/jobs.ts`)

| Job | Schedule (UTC) | What |
|---|---|---|
| `etsy-listings-reconcile` | daily 02:30 | Shops one after another, oldest reconcile first. Skips needsReauth. Stops on `canSpend(P2)`. Never observes stock. |
| `etsy-listing-stats-sales` | daily 01:15 | Yesterday's units, orders and revenue per listing. Falls back to cached totals when the reconcile did not run. |
| `etsy-seo-evaluate` | daily 04:00 | Evaluates due experiments and sends the weekly rollup notification. |
| `etsy-listing-version-retention` | daily 04:20 | Keeps 180 d, then one version per listing per ISO week. Tombstones are kept. |
| `etsy-listing-cache-backfill` | every 30 min | Caches listing ids from the last 3 days of orders that are missing from the cache (max 20 per shop per run, with a 24 h negative memo). |

## 9. Ops notes

- **First run:** the first reconcile, or the first webhook per listing, writes one silent baseline version per listing. These have `changedKeys = []` and are hidden in the UI. Each holds a full snapshot of roughly 2–15 KB. Real history starts after that.
- **Callback:** after OAuth, the callback clears `needsReauth`, requeues `blocked_reauth` events and starts a listing reconcile in the background; the redirect never waits on it.
  - Mode `initial` (silent: no alerts, no SEO cohorts, attribution `unknown`) only when the shop was never imported (`lastListingSyncAt` null and no cached rows) or its owner changed.
  - Any other reconnect runs with `nightly` semantics, so transitions missed during the reauth gap (deactivated, expired, deleted) still alert.
  - When parked events were requeued, the reconcile waits (polling every 5 s, at most 3 min) until no `listing:*` webhook event of the shop is `received`/`processing`. The webhooks therefore keep their `external` attribution and alert context, and the reconcile only picks up what no webhook covered.

## 10. Cross-workstream issues

- **ListingEditorDrawer (presentation session):** independent of restore, the drawer never loads a server draft's `fieldPatch` into `fields`. When a listing has a DB draft but no localStorage copy (other device, cleared storage, or a draft staged by the bulk editor), opening the drawer shows the Etsy values, and any Save (`replaceFields: true`) overwrites the DB draft's fields with the drawer's diff. The `applyRestoredDraft` overlay in section 1 can be reused on open: after `fetchListing()` and `refreshDraftState()`, overlay `drafts[0].fieldPatch` the same way when the draft status is `draft`, `failed` or `conflict`.
- **etsy-listings page (presentation session):** the `syncListings` success toast ignores `data.partial`; see section 2d for the optional warning toast.
