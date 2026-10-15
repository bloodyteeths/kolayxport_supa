# Surface spec: Messages inbox (`/app/mesajlar`)

Status: design spec, ready to implement. Date: 2026-10-15. No app code has been changed.
Binding inputs: `design/DESIGN_SYSTEM.md` (DS) and `design/tokens.md`. Milestone: **M8** (DS §7.2), behind the surface flag `messages` (DS §7.1.5).
Code read for this spec, at `92087ba` in `kx-ux-phase0`: `pages/app/mesajlar.tsx` (949 lines), `pages/api/messages/index.ts`, `pages/api/wix/messages.ts`, `types/messages.ts`, `lib/integrations/wixClient.ts` (Inbox + Contacts), `lib/integrations/trendyolApiClient.ts` (Q&A), `lib/stores/useMessageCountStore.ts`, `components/AppLayout.js`, `components/MobileTabBar.tsx`, `prisma/schema.prisma` (`Order`, `OrderItem`, `TrendyolProduct`, `WixSite`, `Notification`), `pages/api/ai/trendyol.ts` (Gemini pattern), `messages/en.json → messages.*`.

---

## 0. What is wrong today (verified in code, not only on screen)

The production audit (finding #30) says the inbox has "no message preview, no unread state, every row 1m, generic avatar, empty right pane, unlabeled filters". The UI code does render a preview, an unread dot and a relative time. The real cause is the **data the API returns for Wix**:

| # | Symptom | Root cause (file:line) | Fix in this spec |
|---|---|---|---|
| D1 | No preview on Wix rows | `wixClient.listConversations` lists CRM **contacts** and calls `getOrCreateConversation` per contact (`wixClient.ts:394-430`). That response has no `latestMessage`, so `normalizeWixConversation` gets `lastMessageText = ''` (`api/messages/index.ts:62-75`) | The list fetches the newest message for each Wix conversation and caches it in `InboxThread` (§6.2) |
| D2 | Every row says "1m" | `lastMessageDate` falls back to `contact.lastActivity` (any CRM activity, not a message) and then to `new Date().toISOString()` (`index.ts:73`, and again for Trendyol at `:19,:43`) | No "now" fallbacks. An unknown time is `null`, renders `—` with the tooltip "Time unknown", and sorts last (P6) |
| D3 | No unread state on Wix | "Unanswered" is computed from `latestMessage.direction`, which is always missing (D1), so every Wix row is "answered". The nav badge counts Wix the same way, so it is always 0 for Wix (`index.ts:150-160`) | `needsReply` comes from the cached newest-message direction. `unread` comes from a per-user `lastSeenAt` (§6.1) |
| D4 | Contacts with no conversation listed as empty threads | `getOrCreateConversation` **creates** an Inbox conversation for every recent contact. A contact who never wrote shows up as a conversation | Conversations with zero messages are hidden from the list. The create side effect cannot be avoided (Wix has no list endpoint), so the call is limited to contacts whose `lastActivity` is newer than the cache (§6.2) |
| D5 | Generic avatar | Wix rows always render a `User` glyph; the platform is a colored text chip with hard-coded hexes (`mesajlar.tsx:22-30`) | `Avatar` with initials plus a `LogoTile` brand badge (DS §4.4) |
| D6 | Unlabeled filters | MUI `Select`s whose floating label equals the selected value ("All Platforms", "All") (`mesajlar.tsx:812-838`) | Toolbar with `SavedViews` (Needs reply · Unread · All) and a `FilterButton` "Store: All ▾" (DS §3.3) |
| D7 | Empty right pane | Nothing is opened by default | The newest "Needs reply" conversation opens on desktop (DS finding #30) |
| D8 | Wix order money and status are pre-formatted strings | `orderContext` returns `formattedAmount` strings and raw `FULFILLED`/`PAID` statuses, colored with inline hexes (`index.ts:350-366`, `mesajlar.tsx:650-660`) | Numeric `amount` plus `currency` into `Money`. Raw status mapped by `orderStatus(raw, 'wix')` into a `StatusPill` |
| D9 | Order context errors look like "no orders" | `orderContext` catches every error and returns `{ orders: [] }` (`index.ts:368-371`) | It returns `502 { code }`, and the rail shows an inline `ErrorState` (P6: never pretend) |
| D10 | Saved replies live only in one browser | `localStorage` key `kx.messages.savedReplies.{userId}` (`mesajlar.tsx:108-111`). The DS forbids browser storage for state that must persist | `SavedReply` table and API, with a one-time import of the localStorage list (§6.4) |
| D11 | Trendyol answer states collapsed | Only `ANSWERED` counts as answered (`index.ts:13`). An answer waiting for approval or a rejected answer reads as "unanswered", which invites a second answer that Trendyol refuses | Map every Trendyol status (§5.2). **Verify the enum names against one live response before coding** |
| D12 | Enter sends | `Enter` without Shift sends (`mesajlar.tsx:747-751`). For Trendyol the answer is public and final | `Enter` is a newline, `⌘/Ctrl+Enter` sends (DS P3) |
| D13 | Dead route | `pages/api/wix/messages.ts` has no caller (`grep -rn "api/wix/messages"` returns nothing) | Delete it (§9) |
| D14 | No AI help | Nothing exists | "Draft with AI" grounded in thread + order/product facts the server collects (§6.3) |

**Marketplaces in scope.** Only **Wix Inbox** and **Trendyol product questions** have a readable API today. Etsy Open API v3 has no conversations endpoint. Amazon's Messaging API only sends templated messages and cannot read a buyer inbox. eBay messages are not integrated. So the Store filter offers Wix and Trendyol only, and no other marketplace logo is shown as if it worked. (The Overview wireframe in DS §6.5 shows "Etsy 2 · Wix 1" under Needs reply. That example is wrong and should read "Trendyol 2 · Wix 1". See §11.)

---

## 1. Information architecture

```
Messages (route /app/mesajlar, Page width "list")
├─ PageHeader: "Messages" [count = needs-reply total] · meta SyncMeta · overflow ⋯ (Manage saved replies)
├─ Toolbar: SearchField · FilterButton Store · SavedViews (Needs reply · Unread · All) · result count
└─ Inbox (3 regions, one view)
   ├─ ConversationList   (left, 360)  rows: Avatar+brand · name · time · 1-line preview · pill · product/order chip
   ├─ ThreadPane         (center, flex) header · message history · Composer (Saved replies, Draft with AI, Send)
   └─ ContextRail        (right, 320)  Customer · Orders (Wix) · Product (Trendyol) · Other questions
Overlays: SavedRepliesPanel (SidePanel sm) · SaveReplyModal (Modal sm) · ConfirmDialog (discard draft, delete reply)
```

**One primary per view (P1).** The view's primary is the composer's **Send reply** (Wix) or **Send answer** (Trendyol). The PageHeader has no primary. "Draft with AI" and "Saved replies" are ghost buttons. "Manage saved replies" sits in the PageHeader `⋯`. There is no destructive action on the page. When a thread cannot be answered (Trendyol answered or in review) there is no primary and no disabled Send: the composer is replaced by a status note (P1: a button that cannot do anything is not rendered).

**Why a persistent 3-region layout instead of the DS overlay `SidePanel`.** DS §3.5 makes a row open an overlay panel. An inbox is the one surface where the record *is* the work: the seller reads and answers one conversation after another, and the list must stay visible next to the thread to see what is next. DS §4.7 already names `ConversationList` + `ThreadPane` as a domain composition, and DS finding #30 says "the newest Needs reply opens automatically on desktop", which requires a visible thread region. The ContextRail reuses the right-rail pattern of the listing editor (DS §6.3). Below 900px the thread becomes the DS full-height sheet, so the mobile behavior is unchanged from DS. This is recorded as a DS addition in §11.

**Selection.** There is no row selection or BulkActionBar in v1, because there is no bulk action that makes sense for replies (answers are per thread; "Mark all as read" is not worth a mode). `x` is therefore not bound on this page. Everything else in P3 applies.

---

## 2. Desktop wireframes (1440)

### 2.1 Default: "Needs reply" view, newest opened

Content width at 1440: 1440 − 240 sidebar − 2×24 gutter = 1152. Regions: list 360 · thread 472 (min 440) · rail 320. At content width < 1180 (sidebar rail mode, 900–1199 viewport) the rail collapses into the thread header button "Customer & orders" which opens it as `SidePanel sm` (440) over the thread.

```
┌──────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Messages                                                      [⌘K Search or jump…]          (bell) (TS)   │ TopBar 52 (breadcrumb only)
│          ├───────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Messages3│ Messages [3]                                                                                           ⋯  │ PageHeader 56; ⋯ = Manage saved replies
│          │ Refreshed 1 min ago ⟳ · Wix, Trendyol                                                                     │ SyncMeta
│          │ [⌕ Search name, message or product  /] [Store: All ▾]                 View: [Needs reply ▾]   3 conversations │ Toolbar 32px controls
│          │ ┌──────────────────────────────────┬──────────────────────────────────────────┬──────────────────────────┐   │
│          │ │ (W)Ayşe Kaya             4 min ● │ [Av] Ayşe Kaya  [W] Wix      ● Needs reply│ Customer & orders        │   │
│          │ │  Siparişim ne zaman kargoya…     │      Last message 4 min ago      ‹ › ⋯    │ ──────────────────────── │   │
│          │ │  ● Needs reply   #10482          │ ──────────────────────────────────────── │ Customer                 │   │
│          │ │──────────────────────────────────│                  Mon 13 Oct              │ Ayşe Kaya                │   │
│          │ │ (T)Mehmet Y.            2 h      │ ┌──────────────────────────────┐         │ ayse@… ⧉                 │   │
│          │ │  Bu kutu 2 yaşa uygun mu?        │ │ Merhaba, isimli kutu sipariş │         │ Wix · Customer since Mar │   │
│          │ │  ● Needs reply  [▪] Ahşap anı k… │ │ ettim. Ne zaman kargolanır?  │         │ ──────────────────────── │   │
│          │ │──────────────────────────────────│ │ Customer · 10:12             │         │ Orders (2)               │   │
│          │ │ (W)Selin A.              Yest.   │ └──────────────────────────────┘         │ #10482     ● To ship     │   │
│          │ │  Thank you so much!              │              ┌──────────────────────────┐│ [▪][▪] Name box +1       │   │
│          │ │  ● Needs reply                   │              │ Merhaba Ayşe Hanım, …    ││ ₺1.109,30 · 12 Oct       │   │
│          │ │                                  │              │ You · 10:40              ││ Ship by tomorrow         │   │
│          │ │                                  │              └──────────────────────────┘│ [Open order]             │   │
│          │ │                                  │ ┌──────────────────────────────┐         │ ──────                   │   │
│          │ │                                  │ │ Tamam, adres değişikliği     │         │ #10311     ● Delivered   │   │
│          │ │                                  │ │ yapabilir miyim?             │         │ [▪] Baby blanket         │   │
│          │ │                                  │ │ Customer · 4 min ago         │         │ $69.99 · 2 Sep           │   │
│          │ │                                  │ └──────────────────────────────┘         │ Tracking 1Z999AA1… ⧉     │   │
│          │ │                                  │ ──────────────────────────────────────── │                          │   │
│          │ │                                  │ Reply                                    │                          │   │
│          │ │                                  │ ┌──────────────────────────────────────┐ │                          │   │
│          │ │                                  │ │ Write a reply to Ayşe                │ │                          │   │
│          │ │                                  │ │ (auto-grow 3→10 rows)                │ │                          │   │
│          │ │                                  │ └──────────────────────────────────────┘ │                          │   │
│          │ │ [ Load more ]                    │ [Saved replies ▾] [✦ Draft with AI]      │                          │   │
│          │ │                                  │                ⌘↵ to send  [Send reply]  │                          │   │
│          │ └──────────────────────────────────┴──────────────────────────────────────────┴──────────────────────────┘   │
└──────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
(W) / (T) = Avatar 32 with initials and a 16px LogoTile badge (Wix / Trendyol).  [▪] = Thumb 32.  ● = StatusPill dot.
```

The inbox block fills the viewport: height `calc(100dvh - topbar - pageheader - toolbar - 24px)`. Each region scrolls on its own (list, history, rail). The page itself does not scroll. Regions are separated by 1px `neutral-200` borders inside one bordered, radius-8 surface (one surface, not three cards).

### 2.2 Trendyol question thread (center + rail only)

```
┌──────────────────────────────────────────┬──────────────────────────┐
│ [▪] Mehmet Y.  [T] Trendyol  ● Needs reply│ Product                  │
│     Asked 2 h ago · public question  ‹ › ⋯│ [ img 64 ]               │
│ ──────────────────────────────────────── │ Ahşap anı kutusu, isimli │
│ ┌──────────────────────────────┐         │ Price      ₺449,90       │
│ │ Bu kutu 2 yaşa uygun mu?     │         │ In stock   12            │
│ │ Boyutları nedir?             │         │ Barcode    KX-AK-001 ⧉   │
│ │ Customer · 08:51             │         │ [Open listing]           │
│ └──────────────────────────────┘         │ View on Trendyol ↗       │
│ ──────────────────────────────────────── │ ──────────────────────── │
│ ⓘ Trendyol shows answers publicly on the │ 2 other questions about  │
│   product page. You can answer once.     │ this product → (filters) │
│ Answer                         142 / 2000│                          │
│ ┌──────────────────────────────────────┐ │                          │
│ │ Merhaba, kutumuz 25×18×10 cm …       │ │                          │
│ └──────────────────────────────────────┘ │                          │
│ AI draft · check facts before sending    │                          │
│ AI didn't have: delivery date            │                          │
│ [Saved replies ▾] [✦ Try another draft]  │                          │
│                 ⌘↵ to send [Send answer] │                          │
└──────────────────────────────────────────┴──────────────────────────┘
```
- The info line is a `Banner tone="info"` (one line, not dismissible while the composer has text, dismissible otherwise with `dismissKey="msg.trendyol.public"`).
- The char counter uses `FormField counter` (warning at 90%, danger above max). The min/max constants are `TRENDYOL_ANSWER_MIN` / `TRENDYOL_ANSWER_MAX` in `lib/messages/limits.ts`. **Verify both values against Trendyol's Q&A documentation or a rejected test answer before shipping**; until verified, use no min and max 2000.

### 2.3 Trendyol thread after answering / in review / rejected (composer region only)

```
Answered:   ✓ Answered 14 Oct 10:40. Trendyol allows one answer per question.        (caption, neutral; no composer, no primary)
In review:  ● Answer in review  Your answer is waiting for Trendyol's approval.     (StatusPill message/in_review + caption)
Rejected:   [Banner danger] Trendyol rejected your answer: "contains contact info". You can answer again.
            → composer shown again, prefilled with the rejected text, primary [Send answer]
```

### 2.4 Saved replies picker (popover from the composer, z 1600)

```
┌ Saved replies ─────────────────────────────┐
│ [⌕ Search saved replies          ]         │ Combobox (searchable)
│ Shipping time            Used 41 times     │
│ "Merhaba {customer}, siparişiniz 1–3 iş…"  │ 1-line preview, caption
│ Size question · Trendyol                   │
│ "Ürünümüz {product} 25×18×10 cm …"         │
│ ─────────────────────────────────────────  │
│ + Save current text as a saved reply       │ (only when the composer has text)
│ Manage saved replies                       │ opens SavedRepliesPanel
└────────────────────────────────────────────┘
```
Selecting inserts the body at the caret (or appends on a new line) with variables filled: `{customer}` → first name, `{product}` → product title (Trendyol) or the first item of the newest order (Wix), `{order}` → newest order number (Wix). A variable without data stays as the literal token and the field shows an error on send: "Replace {order} before sending" (send is blocked only by that check, P6).

### 2.5 SavedRepliesPanel (SidePanel sm 440) and SaveReplyModal (Modal sm)

```
┌ Saved replies ───────────────────────────── ✕ ┐       ┌ Save as saved reply ─────────────── ✕ ┐
│ [⌕ Search]                     [New reply]     │       │ Name                                   │
│ Shipping time · All stores           ⋯         │       │ [Shipping time                      ]  │
│ Size question · Trendyol             ⋯         │       │ Use for                                │
│ Thank you · Wix                      ⋯         │       │ [All stores ▾]                         │
│ ─────────────────────────────────────────────  │       │ Text (from your reply)      186 / 1000 │
│ Edit: Shipping time                            │       │ [Merhaba {customer}, …              ]  │
│ Name      [Shipping time              ]        │       │ Insert: [Customer name] [Product]      │
│ Use for   [All stores ▾]                       │       │         [Order number]                 │
│ Text      [auto-grow …            ] 186 / 1000 │       │                     [Cancel] [Save]    │
│ Insert: [Customer name] [Product] [Order no.]  │       └────────────────────────────────────────┘
├────────────────────────────────────────────────┤
│ ⋯ (Delete saved reply…)        Saved  [Save]   │
└────────────────────────────────────────────────┘
```
3 fields, so the quick save is a Modal (DS §3.6: ≤ 4 fields). Managing the list is a SidePanel (list + edit). Delete is in the row `⋯` and in the panel footer `⋯` as `danger-ghost`, confirmed by `ConfirmDialog` "Delete saved reply 'Shipping time'?". The "Insert" variable chips are ghost `sm` buttons that insert the token at the caret.

---

## 3. Mobile wireframes (390)

### 3.1 List

```
┌──────────────────────────────────┐
│ Messages                  ⌕   ⋯  │ TopBar 48 (title shown on mobile only); ⋯ = Manage saved replies
├──────────────────────────────────┤
│ Refreshed 1 min ago ⟳            │ SyncMeta
│ [Needs reply 3][Unread 1][All] → │ SavedViews as chips (scrollable strip)
│ [⌕ Search messages   ] [Store ▾] │ 44px controls, 16px input text
│ 3 conversations                  │
│ ┌──────────────────────────────┐ │
│ │(W) Ayşe Kaya         4 min ● │ │ 72px row, whole row is the target
│ │    Tamam, adres değişikliği… │ │
│ │    ● Needs reply · #10482    │ │
│ ├──────────────────────────────┤ │
│ │(T) Mehmet Y.           2 h   │ │
│ │    Bu kutu 2 yaşa uygun mu?  │ │
│ │    ● Needs reply · Ahşap an… │ │
│ └──────────────────────────────┘ │
│ [ Load more ]                    │
├──────────────────────────────────┤
│ Overview Orders Listings Msgs More│ tab bar 56 (Msgs shows needs-reply count)
└──────────────────────────────────┘
```
Rows are a list inside one bordered surface (not separate cards): conversations are read top-to-bottom like a mail list, and 8px card gaps waste a third of the screen. This is the DS card form with `gap: 0` and row dividers; noted in §11. No auto-open on mobile.

### 3.2 Thread sheet (full height, DS SidePanel below 600)

```
┌──────────────────────────────────┐
│ ✕  Ayşe Kaya  [W]           ⋯    │ sticky header 56 (close = Esc / swipe-down handle; sheets close with ✕, only drill-in pages use ‹, as in orders.md §3.3; CRITIQUE C16)
│    ● Needs reply · 4 min ago     │
├──────────────────────────────────┤
│ [▪] 2 orders · #10482 To ship  › │ context summary row 48 → BottomSheet "Customer & orders"
├──────────────────────────────────┤
│ ┌──────────────────────────┐     │
│ │ Merhaba, isimli kutu …   │     │ bubbles max 85% width
│ │ Customer · 10:12         │     │
│ └──────────────────────────┘     │
│        ┌─────────────────────────┐│
│        │ Merhaba Ayşe Hanım, …   ││
│        │ You · 10:40             ││
│        └─────────────────────────┘│
│ ┌──────────────────────────┐     │
│ │ Tamam, adres değişikliği │     │
│ └──────────────────────────┘     │
├──────────────────────────────────┤
│ [Write a reply to Ayşe        ]  │ sticky composer; TextArea 16px, 1→5 rows
│ (≡) (✦)           [ Send reply ] │ IconButton 44 Saved replies · IconButton 44 Draft with AI · primary 48
└──────────────────────────────────┘
```
- The sheet covers the tab bar (z 1200 > 1050), so the composer is never hidden behind it.
- The composer follows the on-screen keyboard: the sheet uses `height: 100dvh` and a `visualViewport` resize listener sets `--kx-kb-inset` as bottom padding (iOS Safari does not resize `dvh` for the keyboard).
- The composer footer is not the DS 50/50 sheet footer. It is a form field plus one primary at 48px, with two labeled 44px icon buttons. Recorded in §11.
- `⋯` holds: Mark as unread, View on Trendyol / Open order, Manage saved replies.

### 3.3 Context bottom sheet

```
┌──────────────────────────────────┐
│ ───  (drag handle)               │
│ Customer & orders             ✕  │
│ Ayşe Kaya · ayse@… ⧉             │
│ #10482            ● To ship      │
│ [▪][▪] Name box +1 · ₺1.109,30   │
│ Ship by tomorrow                 │
│ [        Open order            ] │ 44px
│ #10311            ● Delivered    │
│ Tracking 1Z999AA1… ⧉             │
└──────────────────────────────────┘
```

---

## 4. Components (DS only) and element-by-element data map

All UI imports come from `components/ds/*` and `lucide-react` via `lib/ds/icons.ts` (`message` = `MessageSquare`, `AI` = `Sparkles`, `push` = `Send`, `pull` = `RefreshCw`, `more` = `MoreHorizontal`). Domain compositions live in `components/domain/messages/*`.

| Element | DS component | Data (source → field) | Today / addition |
|---|---|---|---|
| Page title + count | `PageHeader title count` | `GET /api/messages?action=counts` → `total` (needs-reply) | Exists; Wix part fixed by D3 |
| Freshness | `SyncMeta source="all" lastPulledAt state onPull` | client time of last successful `list` response; `state='failed'` when the last refresh failed but data is kept | Client only |
| Search | `SearchField shortcut="/" debounceMs=250` | filters loaded rows on `customerName`, `lastMessageText`, `productInfo.title`, `orderRef` | Client only. Caption under the count when rows were not all loaded: "Searching 50 loaded conversations · Load more to search older" (honest; neither API offers text search) |
| Store filter | `FilterButton label="Store"` options All · Wix (LogoTile) · Trendyol (LogoTile) | `list` → `enabledPlatforms` (only connected stores appear) | Exists |
| Views | `SavedViews` built-in: `needs_reply` (default), `unread`, `all` with counts | `list?view=` | **Change:** `status=unanswered|answered|all` → `view=needs_reply|unread|all` (server maps `needs_reply` → Trendyol `WAITING_FOR_ANSWER` + rejected; Wix `needsReply`) |
| Result count | Toolbar `resultCount` | rows after search | Client |
| Row avatar | `Avatar name src? size=32 brand` | `customerName` initials; brand = `platform` | Exists |
| Row name | `dense` 13/600 when unread, 13/500 otherwise | `customerName` (fallback i18n "Customer") | Exists |
| Row time | `DateText mode="relative"` (absolute in tooltip); `—` when null | `lastMessageAt` | **Change:** `lastMessageDate: string` → `lastMessageAt: string | null` (D2) |
| Unread dot | 8px `info-solid` dot + bold name, `aria-label` "Unread" | `unread` | **New field** (server, §6.1) |
| Row preview | 1 line, `dense neutral-600`, "You: " prefix when the newest message is from the seller | `lastMessageText`, `lastFromCustomer` | Wix text **new** (D1); `lastFromCustomer` **new** |
| Row pill | `StatusPill domain="message"` — at most one: `needs_reply`, `in_review` or `answer_rejected` | `messageStatus(conv)` in `lib/ds/status/messages.ts` | `in_review` / `answer_rejected` are **DS additions** (§11) |
| Row chip | mono caption `#10482` (Wix newest order number) or `Thumb 16` + truncated product title (Trendyol) | Wix `orderRef` from `InboxThread.lastOrderNumber` (filled when the rail loads orders); Trendyol `productInfo` | `orderRef` **new, optional** (absent until the first context load) |
| Load more | DataTable cursor pagination style button | `list` → `nextCursor` | **New** cursor (§6.1) |
| Thread header | `Avatar 40` (Wix) or `Thumb 40` (Trendyol) · name `title-md` · `LogoTile 16 withName` · `StatusPill` · caption "Last message 4 min ago" / "Asked 2 h ago · public question" · `IconButton` ‹ › (label + `j`/`k`) · `OverflowMenu` | conversation row | Exists |
| History | `MessageBubble` (domain, §11) list grouped by day with a centered `caption` day divider (`DateText mode="date"`) | `thread` → `messages[] { id, sender, text, date }` | Wix exists; Trendyol uses the list payload (no extra call) |
| Bubble time | `DateText mode="time"`, relative for < 1 h | `message.date` | **Change:** server sends `null` instead of "now" when missing |
| Public-answer note | `Banner tone="info"` | `platform === 'trendyol'` | Copy only |
| Composer field | `FormField label="Reply|Answer" counter? error?` + `TextArea minRows=3 maxRows=10` | local state, per-thread unsent draft in `sessionStorage` key `kx.msg.draft.{platform}:{id}` (per-viewer convenience, try/catch) | **Change:** drafts survive switching threads |
| Saved replies | `Button variant="ghost" size="sm" icon trailingIcon=▾` → `Combobox` in a `Popover` (z 1600) | `GET /api/messages/saved-replies` | **New** API (§6.4) |
| Draft with AI | `Button variant="ghost" size="sm" icon={Sparkles}` · loading "Drafting…" | `POST /api/messages/draft-reply` | **New** API (§6.3) |
| AI note | `caption neutral-500` + optional "AI didn't have: …" | `draft-reply` → `missing[]` | New |
| Send | `Button variant="primary" size="md"` (`xl` 48 on mobile) · loading "Sending…" · `⌘↵` | `POST /api/messages?action=reply` | Exists |
| Answered / in review note | caption + `StatusPill` | `platformStatus`, `answeredAt` | `answeredAt` **new** (from `q.answer.creationDate`) |
| Rejected banner | `Banner tone="danger"` | `platformStatus='REJECTED'`, `rejectReason` | **New** fields (verify Trendyol field name, e.g. `rejectedAnswer.reason`) |
| Rail: Customer | `SidePanelSection title="Customer"` + `KeyValueList` (name, email `CopyText`) | Wix `_contactEmail` (already fetched, currently dropped) → **new** `customerEmail`; Trendyol shows name only | New field |
| Rail: Orders (Wix) | `SidePanelSection title="Orders" (n)`; per order: mono number, `StatusPill domain="order"`, `Thumb 32`×3 +N, `Money`, `DateText`, `ShipBy` (when to ship), tracking `CopyText mono`, `Button secondary sm` "Open order" | `GET ?action=orderContext&contactId=` → **changed shape** (§6.1): numeric `totalAmount`, `currency`, raw `status`, `items[].amount`, plus local join `kxOrderId`, `trackingNumber`, `shipByDate` from `Order`/`OrderItem` | Changed |
| Rail: Product (Trendyol) | `SidePanelSection title="Product"`; `Thumb 64`, title, `KeyValueList` Price (`Money`), In stock (`Num`), Barcode (`CopyText mono`); `Button secondary sm` "Open listing"; link "View on Trendyol ↗" | Q&A payload `productInfo` + **new** `GET ?action=productContext&productMainId=` → `TrendyolProduct` (`salePrice`, `currencyType`, `quantity`, `barcode`, `thumbnailUrl`, `onSale`) | New action; local DB only, no Trendyol call |
| Rail: Other questions | caption link "2 other questions about this product" → sets search to the product title | loaded rows with the same `productInfo.id` | Client |
| Nav badge | SideNav `count`, MobileTabBar badge | `useMessageCountStore` → `counts.total` (needs-reply) | Exists; fixed by D3 |

"Open order" goes to `/app/labels?open={kxOrderId}` (OrderPanel, DS §4.7; the URL `open` param is DS P3). It is only rendered when `kxOrderId` exists. "Open listing" goes to `/app/trendyol-urunler?open={barcode}` and is only rendered when the `TrendyolProduct` row exists.

---

## 5. States, statuses and behavior

### 5.1 Every state

| Region | Loading | Empty | Error | Partial |
|---|---|---|---|---|
| Page (no store connected) | — | `EmptyState kind="first-use" icon=MessageSquare` "Answer Wix and Trendyol customers in one place" · body · [Connect a store] → `/ayarlar?tab=connections`. Replaces the whole body (no toolbar). Shown when `useConnections` says neither is connected **and** `list.enabledPlatforms` is empty (today's rule, kept) | — | — |
| List | `CardListSkeleton` rows (avatar + 2 lines) after 200ms; `useAsyncState` → at 15s "Still loading… [Retry]", at 30s `ErrorState page`. Wix lists take 3–5 s today, so the 15s step matters | View `needs_reply` with 0 rows: `EmptyState kind="done"` "Every message has a reply" · "New messages show up here within 2 minutes." · no action. View `unread`/`all` with 0: `EmptyState kind="first-use"`-style "No messages yet" without action. Search/filter with 0: `kind="no-results"` "No conversations match" · [Clear filters] | All platforms failed and nothing cached: `ErrorState page` "Couldn't load messages" · cause from the codes · [Try again] · Copy error ID | One platform failed: `Banner tone="warning"` above the list per platform, one action each (table below). Rows from the healthy platform stay. On refresh, a failed platform keeps its previous rows (today's merge logic, kept) |
| Refresh (poll/⟳) | `SyncMeta state="pulling"` (no skeleton swap) | — | `SyncMeta state="failed"` + `ErrorState variant="stale"` line "Showing messages from 10:42 · Retry" | — |
| Thread | `PanelSkeleton` bubbles (Wix only; Trendyol renders instantly from the list payload) | "No messages yet" + "This customer hasn't written to you." (Wix contact with an empty conversation that slipped through) — composer still shown for Wix | `ErrorState inline` "Couldn't load this conversation" · [Try again] | — |
| Composer | Send `loading` "Sending…" (width kept, textarea read-only) | — | Inline below the field, `danger-fg`: mapped cause ("Trendyol didn't accept the answer: too short", "Wix connection expired · Reconnect Wix") · text kept · **no toast for the error** (the error is visible) | — |
| AI draft | Button `loading` "Drafting…"; the textarea stays editable | — | Inline caption "Couldn't draft a reply. Try again." | `missing[]` non-empty → caption "AI didn't have: tracking number" |
| Rail | `PanelSkeleton` per section | Orders: "No orders from this customer" (quiet, no action). Product not in DB: one caption "This product isn't in KolayXport yet. Refresh Trendyol products to see price and stock." + the Q&A payload fields still shown | `ErrorState inline` "Couldn't load Wix orders" · [Try again] (D9) | Orders loaded but no local match → no "Open order" / tracking for that order |

Platform warning banners (replace today's chips; the `code` contract is unchanged):

| `code` | Banner (tone) | Action |
|---|---|---|
| `permission` (Wix 403) | "Wix inbox access is missing. Reconnect Wix to allow messages." (warning) | [Reconnect Wix] → `/ayarlar?tab=connections` |
| `auth` | "{name} connection expired." (warning) | [Reconnect {name}] → `connections` (Wix) / `apiKeys` (Trendyol) |
| `credentials` | "{name} setup is incomplete." (warning) | [Finish setup] → same targets |
| `rateLimited` | "{name} is busy right now. Showing earlier messages." (info) | [Try again] |
| `unavailable` | "Couldn't load {name} messages." (warning) | [Try again] |

### 5.2 Status mapping (`lib/ds/status/messages.ts`, pure, unit-tested)

```ts
type MessageStatusKey = 'unread' | 'needs_reply' | 'in_review' | 'answer_rejected' | null;
export function messageStatus(c: Pick<UnifiedConversation,'platform'|'needsReply'|'unread'|'platformStatus'>): MessageStatusKey
```
| Platform | Raw | `needsReply` | Pill | Composer |
|---|---|---|---|---|
| Trendyol | `WAITING_FOR_ANSWER` | true | `needs_reply` | Send answer |
| Trendyol | `WAITING_FOR_APPROVE` (verify name) | false | `in_review` | note, no composer |
| Trendyol | `ANSWERED` | false | none | answered note |
| Trendyol | `REJECTED` (verify name) | true | `answer_rejected` | banner + composer, prefilled with the rejected text |
| Trendyol | `REPORTED` / unknown | false | none, raw in tooltip | note "This question can't be answered here" + View on Trendyol |
| Wix | newest message from customer | true | `needs_reply` | Send reply |
| Wix | newest from business / none | false | none | Send reply (Wix allows follow-ups) |

`unread` (any platform) = `needsReply && lastMessageAt > lastSeenAt` (or `lastSeenAt` null). Unread is shown as the dot + bold name, not as a second pill (DS: at most one pill per row).

### 5.3 Interactions

- **Open:** desktop opens the newest `needs_reply` row on first load when `?open=` is absent (D7); `?open=wix:abc` / `trendyol:123` restores a thread on reload. Opening calls `POST ?action=markSeen` (fire-and-forget) and clears the dot optimistically.
- **Keyboard** (`useShortcuts`, key-based, input-aware): `/` search · `j`/`k` next/previous conversation (also ‹ › in the header) · `Enter` focuses the composer of the open thread · `Esc` leaves the composer, then clears search, then (mobile) closes the sheet · `⌘/Ctrl+Enter` sends · `⌘K` palette. `usePageActions` registers "Manage saved replies" and "Go to next message needing reply". No `x`, no `e`.
- **Dirty guard:** switching threads keeps the unsent text in `sessionStorage` (no prompt, it is not lost). Closing the mobile sheet with text also keeps it. Only leaving the page with unsent text opens `ConfirmDialog` "Discard your unsent reply?" (Keep editing / Discard), via `routeChangeStart` + `beforeunload`.
- **Send:** validates (non-empty, Trendyol min/max, no unfilled `{tokens}`), then POSTs. On success: append the bubble locally, set the row to answered (today's `locallyAnswered` map is kept so a poll cannot re-enable a Trendyol one-shot answer), decrement the badge, and re-fetch counts after 4s (kept). **No success toast** (the bubble is the result, DS §3.14). In the `needs_reply` view the answered row stays in the list, muted, until the next refresh, so the list does not jump under the cursor; a ghost button "Next: Mehmet Y. ›" appears under the bubble (`j` does the same).
- **AI draft:** if the composer is empty, the draft fills it. If it has text, a nested `ConfirmDialog` asks "Replace your text with the AI draft?". The draft is never sent automatically and is never marked as "not sent" with the attention tone (attention means staged marketplace changes only).
- **Polling:** background refresh every 120s while the tab is visible (kept) plus on `visibilitychange` to visible. Never swaps in skeletons.
- **Mark as unread:** `⋯` → `POST ?action=markSeen { seen:false }`.

---

## 6. API: contracts and minimal additions

All existing actions stay at `/api/messages` with the same auth. New UI calls only the endpoints below. Types go in `types/messages.ts`.

### 6.1 Changed `types/messages.ts` and `/api/messages` actions

```ts
export type MessagePlatform = 'wix' | 'trendyol';
export interface UnifiedConversation {
  id: string; platform: MessagePlatform;
  status: 'unanswered' | 'answered';          // kept for the legacy page during the flag period
  needsReply: boolean;                        // NEW
  unread: boolean;                            // NEW (InboxThread.lastSeenAt)
  platformStatus?: string;                    // NEW raw (Trendyol status, Wix 'open')
  answeredAt?: string | null;                 // NEW (Trendyol answer.creationDate)
  rejectReason?: string | null;               // NEW (verify Trendyol field)
  customerName: string; customerEmail?: string; // customerEmail NEW (Wix _contactEmail)
  subject: string;
  lastMessageText: string;
  lastMessageAt: string | null;               // NEW, replaces the "now" fallback
  lastMessageDate: string;                    // kept for legacy; = lastMessageAt ?? ''
  lastFromCustomer: boolean | null;           // NEW
  orderRef?: string;                          // NEW, Wix newest order number when known
  productInfo?: { id: string; title: string; imageUrl?: string; webUrl?: string };
  contactId?: string; unreadCount: number; messages: UnifiedMessage[];
}
export interface UnifiedMessage { id: string; sender: 'customer' | 'seller'; text: string; date: string | null }
export interface InboxListResponse extends MessagesListResponse {
  nextCursor: string | null; enabledPlatforms: MessagePlatform[];
  platformErrors: { platform: MessagePlatform; code: 'permission'|'auth'|'credentials'|'rateLimited'|'unavailable'; detail: string }[];
  fetchedAt: string;
}
export interface OrderContext {
  orderNumber: string; status: string /* raw */; createdDate: string | null;
  totalAmount: number | null; currency: string;            // NEW numeric (was formatted string `total`)
  items: { name: string; imageUrl?: string; quantity: number; amount: number | null }[];
  kxOrderId?: string; trackingNumber?: string | null; shipByDate?: string | null; // NEW local join
}
export interface ProductContext {                           // NEW
  productMainId: string; inCatalog: boolean;
  title?: string; barcode?: string; salePrice?: number | null; currency?: string;
  quantity?: number | null; onSale?: boolean; thumbnailUrl?: string | null;
}
```

| Action | Change |
|---|---|
| `GET list` | Params `platform=all|wix|trendyol`, `view=needs_reply|unread|all` (legacy `status=` still accepted), `size` (default 30, max 50), `cursor`. `cursor` is base64 JSON `{ t: trendyolPage|null, w: wixContactsCursor|null }`; `nextCursor` is null when both sources are exhausted. Merge-sort by `lastMessageAt` desc, nulls last. Wix enrichment per §6.2. Trendyol normalizer stops inventing dates and maps statuses per §5.2. Response adds `nextCursor`, `fetchedAt`, new fields |
| `GET thread` | Wix unchanged except `date: null` when missing and dropping the `limit` that `getConversationMessages` ignores. Trendyol unchanged |
| `POST reply` | Unchanged request. On success also upserts `InboxThread` (`needsReply=false`, `lastFromCustomer=false`, `lastMessageAt=now`, `lastSeenAt=now`). Error responses gain `code` (`tooShort`, `tooLong`, `alreadyAnswered`, `auth`, `permission`, `unavailable`) so the UI can map them without parsing text |
| `GET counts` | Wix count reads `InboxThread` where `needsReply` (no Wix calls on every badge poll). Trendyol unchanged |
| `GET orderContext` | New shape above. Joins local `Order` by `(userId, marketplace='Wix', orderNumber)` to add `kxOrderId`, `trackingNumber`, earliest `OrderItem.shipBy`. **Verify** that Wix `order.number` equals our stored `Order.orderNumber` (check 3 real rows) before relying on the join. Errors return `502 { code }` instead of `200 { orders: [] }` (D9). Stores the newest order number in `InboxThread.lastOrderNumber` |
| `POST markSeen` **new** | Body `{ platform, id, seen?: boolean = true }` → upsert `InboxThread.lastSeenAt = seen ? now : null`. 204 |
| `GET productContext` **new** | `?productMainId=` → `TrendyolProduct.findFirst({ where: { userId, productMainId } })`. Local DB only. `{ inCatalog:false }` when absent |

### 6.2 New table `InboxThread` (cache + read state)

```prisma
model InboxThread {
  id                String    @id @default(cuid())
  userId            String
  platform          String    // 'wix' | 'trendyol'
  externalId        String    // Wix conversationId | Trendyol questionId
  contactId         String?
  customerName      String?
  lastMessageAt     DateTime?
  lastMessageText   String?   @db.Text   // first 280 chars
  lastFromCustomer  Boolean?
  needsReply        Boolean   @default(false)
  messageCount      Int?      // Wix: 0 => hidden from the list (D4)
  contactActivityAt DateTime? // Wix contact.lastActivity when the cache row was refreshed
  lastOrderNumber   String?
  lastSeenAt        DateTime?
  updatedAt         DateTime  @updatedAt
  createdAt         DateTime  @default(now())
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, platform, externalId])
  @@index([userId, needsReply, lastMessageAt])
}
```
Wix enrichment inside `list` (in `lib/messages/inboxCache.ts`): for each contact from `queryContacts`, if a cache row exists with `contactActivityAt >= contact.lastActivity.activityDate`, use it (no Inbox call). Otherwise call `getOrCreateConversation` + the first page of `getConversationMessages`, take the newest message (the API returns newest first; today's code reverses it for display), and upsert the row. Calls are limited to 5 in parallel with the client's existing 200ms spacing. Rows with `messageCount = 0` are not returned. Trendyol rows are upserted from the Q&A payload only to hold `lastSeenAt` (no extra calls). Migration name: `2026xxxx_inbox_thread_saved_reply`.

### 6.3 New `POST /api/messages/draft-reply` (separate file, so it is disjoint from `index.ts`)

Request `{ platform, id }`. The server builds the context itself (never trusts client text):
- the thread (Wix `getConversationMessages`, Trendyol question text),
- Wix: up to 3 recent orders from `orderContext` logic incl. local `trackingNumber`, `shippedAt`, `labelStatus`, ship-by; Trendyol: `TrendyolProduct` title, `description` (first 1,500 chars, entities decoded), `attributes`, `salePrice`, `quantity`,
- the seller's 5 most-used saved replies as tone examples, and the shop name.

Model: Gemini 2.5 Flash with `responseMimeType: 'application/json'` (same pattern as `pages/api/ai/trendyol.ts`). Prompt rules: answer in the **customer's language** (Trendyol: Turkish), use only the provided facts, never invent tracking numbers, dates, sizes or policies, no contact details or links (Trendyol rejects them), ≤ 600 characters (≤ `TRENDYOL_ANSWER_MAX`). Response `{ reply: string, missing: ('tracking'|'order'|'stock'|'delivery'|'size'|'policy')[] }`. Validation (memory rule on Gemini output): must be an object with a string `reply`; arrays, empty strings, strings > max length, or text containing `http`, `@` or a phone pattern on Trendyol → `422 { code: 'badDraft' }` and the UI shows "Couldn't draft a reply". `missing` values outside the enum are dropped. Rate limit 20/min per user. Logs never include message text (PII). No marketplace write.

### 6.4 New `SavedReply` table and `/api/messages/saved-replies`

```prisma
model SavedReply {
  id         String   @id @default(cuid())
  userId     String
  title      String   // ≤ 60
  body       String   @db.Text // ≤ 1000
  platform   String?  // null = all stores
  usageCount Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, title])
  @@index([userId, usageCount])
}
```
Routes in `pages/api/messages/saved-replies.ts`: `GET` (sorted by `usageCount` desc, then title) · `POST { title, body, platform? }` · `PATCH ?id= { … }` · `DELETE ?id=` · `POST ?action=import { items: string[] }` (only when the user has 0 rows; titles = first 40 chars, de-duplicated) · `POST ?action=used&id=` (increments `usageCount` when a reply is inserted). Limit 50 per user (today 20). Variables `{customer}`, `{product}`, `{order}` are stored literally and filled client-side by `lib/messages/fillVariables.ts`.

One-time import: on first load, if the API returns 0 rows and `localStorage['kx.messages.savedReplies.{userId}']` parses to a non-empty list, call `import`, then delete the key and show one toast "3 saved replies moved to your account".

---

## 7. i18n keys (namespace `messages`, replaces the current one; plus `status.message`)

Sentence case, real Turkish characters, glossary wording. Implementers do **not** edit `messages/en.json` / `tr.json`: each group writes `messages/fragments/messages.<group>.{en,tr}.json` and the integrator merges (same rule as `settings_spec.md` §8).

| Key | EN | TR |
|---|---|---|
| `messages.title` | Messages | Mesajlar |
| `messages.overflow.manageSaved` | Manage saved replies | Hazır yanıtları yönet |
| `messages.cmd.nextNeedsReply` | Go to next message needing reply | Yanıt bekleyen sonraki mesaja git |
| `messages.views.needsReply` | Needs reply | Yanıt bekleyenler |
| `messages.views.unread` | Unread | Okunmamış |
| `messages.views.all` | All | Tümü |
| `messages.filters.store` | Store | Mağaza |
| `messages.filters.storeAll` | All | Tümü |
| `messages.search.placeholder` | Search name, message or product | İsim, mesaj veya ürün ara |
| `messages.search.loadedOnly` | Searching {count} loaded conversations · Load more to search older | Yüklenen {count} konuşmada aranıyor · Eskileri aramak için daha fazla yükleyin |
| `messages.list.count` | {count, plural, one {# conversation} other {# conversations}} | {count} konuşma |
| `messages.list.loadMore` | Load more | Daha fazla yükle |
| `messages.list.customerFallback` | Customer | Müşteri |
| `messages.list.youPrefix` | You: | Siz: |
| `messages.list.noText` | No message text | Mesaj metni yok |
| `messages.list.timeUnknown` | Time unknown | Zaman bilinmiyor |
| `messages.list.unreadLabel` | Unread | Okunmadı |
| `messages.thread.lastMessage` | Last message {time} | Son mesaj {time} |
| `messages.thread.asked` | Asked {time} · public question | {time} soruldu · herkese açık soru |
| `messages.thread.prev` | Previous conversation | Önceki konuşma |
| `messages.thread.next` | Next conversation | Sonraki konuşma |
| `messages.thread.nextUp` | Next: {name} | Sıradaki: {name} |
| `messages.thread.customer` | Customer | Müşteri |
| `messages.thread.you` | You | Siz |
| `messages.thread.markUnread` | Mark as unread | Okunmadı olarak işaretle |
| `messages.thread.viewOnTrendyol` | View on Trendyol | Trendyol'da görüntüle |
| `messages.thread.empty.title` | No messages yet | Henüz mesaj yok |
| `messages.thread.empty.body` | This customer hasn't written to you. | Bu müşteri size henüz yazmadı. |
| `messages.thread.error.title` | Couldn't load this conversation | Bu konuşma yüklenemedi |
| `messages.thread.publicNote` | Trendyol shows answers publicly on the product page. You can answer once. | Trendyol yanıtları ürün sayfasında herkese açık gösterir. Yalnızca bir kez yanıt verebilirsiniz. |
| `messages.thread.answered` | Answered {date}. Trendyol allows one answer per question. | {date} tarihinde yanıtlandı. Trendyol her soruya tek yanıt verilmesine izin verir. |
| `messages.thread.inReview` | Your answer is waiting for Trendyol's approval. | Yanıtınız Trendyol onayını bekliyor. |
| `messages.thread.rejected` | Trendyol rejected your answer: {reason}. You can answer again. | Trendyol yanıtınızı reddetti: {reason}. Yeniden yanıt verebilirsiniz. |
| `messages.thread.cannotAnswer` | This question can't be answered here. | Bu soru buradan yanıtlanamaz. |
| `messages.composer.labelReply` | Reply | Yanıt |
| `messages.composer.labelAnswer` | Answer | Cevap |
| `messages.composer.placeholderWix` | Write a reply to {name} | {name} için bir yanıt yazın |
| `messages.composer.placeholderTrendyol` | Write your answer | Cevabınızı yazın |
| `messages.composer.sendReply` | Send reply | Yanıtı gönder |
| `messages.composer.sendAnswer` | Send answer | Cevabı gönder |
| `messages.composer.sending` | Sending… | Gönderiliyor… |
| `messages.composer.shortcut` | {keys} to send | Göndermek için {keys} |
| `messages.composer.errors.empty` | Write a reply first | Önce bir yanıt yazın |
| `messages.composer.errors.tooShort` | Answers need at least {min} characters | Cevap en az {min} karakter olmalı |
| `messages.composer.errors.tooLong` | Answers can have at most {max} characters | Cevap en fazla {max} karakter olabilir |
| `messages.composer.errors.unfilled` | Replace {tokens} before sending | Göndermeden önce {tokens} alanını doldurun |
| `messages.composer.errors.alreadyAnswered` | This question already has an answer on Trendyol | Bu soru Trendyol'da zaten yanıtlanmış |
| `messages.composer.errors.auth` | {name} connection expired. Your text is kept. | {name} bağlantısının süresi doldu. Metniniz korundu. |
| `messages.composer.errors.generic` | Couldn't send. Your text is kept. | Gönderilemedi. Metniniz korundu. |
| `messages.composer.discard.title` | Discard your unsent reply? | Gönderilmemiş yanıtınız silinsin mi? |
| `messages.composer.discard.confirm` | Discard | Sil |
| `messages.composer.discard.keep` | Keep editing | Düzenlemeye devam et |
| `messages.ai.draft` | Draft with AI | AI ile taslak yaz |
| `messages.ai.redo` | Try another draft | Başka bir taslak dene |
| `messages.ai.drafting` | Drafting… | Taslak yazılıyor… |
| `messages.ai.note` | AI draft · check facts before sending | AI taslağı · göndermeden önce bilgileri kontrol edin |
| `messages.ai.missing` | AI didn't have: {items} | AI'da olmayan bilgi: {items} |
| `messages.ai.missingItem.tracking` | tracking number | takip numarası |
| `messages.ai.missingItem.order` | order details | sipariş bilgisi |
| `messages.ai.missingItem.stock` | stock level | stok durumu |
| `messages.ai.missingItem.delivery` | delivery date | teslim tarihi |
| `messages.ai.missingItem.size` | product size | ürün ölçüsü |
| `messages.ai.missingItem.policy` | shop policy | mağaza politikası |
| `messages.ai.failed` | Couldn't draft a reply. Try again. | Yanıt taslağı oluşturulamadı. Tekrar deneyin. |
| `messages.ai.replace.title` | Replace your text with the AI draft? | Metniniz AI taslağıyla değiştirilsin mi? |
| `messages.ai.replace.confirm` | Replace | Değiştir |
| `messages.saved.button` | Saved replies | Hazır yanıtlar |
| `messages.saved.search` | Search saved replies | Hazır yanıtlarda ara |
| `messages.saved.empty` | No saved replies yet | Henüz hazır yanıt yok |
| `messages.saved.used` | {count, plural, one {Used once} other {Used # times}} | {count} kez kullanıldı |
| `messages.saved.saveCurrent` | Save current text as a saved reply | Bu metni hazır yanıt olarak kaydet |
| `messages.saved.manage` | Manage saved replies | Hazır yanıtları yönet |
| `messages.saved.panelTitle` | Saved replies | Hazır yanıtlar |
| `messages.saved.new` | New reply | Yeni yanıt |
| `messages.saved.modalTitle` | Save as saved reply | Hazır yanıt olarak kaydet |
| `messages.saved.fields.title` | Name | Ad |
| `messages.saved.fields.body` | Text | Metin |
| `messages.saved.fields.platform` | Use for | Kullanım yeri |
| `messages.saved.fields.allStores` | All stores | Tüm mağazalar |
| `messages.saved.insert` | Insert: | Ekle: |
| `messages.saved.var.customer` | Customer name | Müşteri adı |
| `messages.saved.var.product` | Product | Ürün |
| `messages.saved.var.order` | Order number | Sipariş numarası |
| `messages.saved.save` | Save | Kaydet |
| `messages.saved.saved` | Saved | Kaydedildi |
| `messages.saved.delete` | Delete saved reply… | Hazır yanıtı sil… |
| `messages.saved.deleteTitle` | Delete saved reply "{name}"? | "{name}" hazır yanıtı silinsin mi? |
| `messages.saved.errors.duplicate` | A saved reply with this name already exists | Bu adla bir hazır yanıt zaten var |
| `messages.saved.errors.limit` | You can keep up to {max} saved replies | En fazla {max} hazır yanıt saklayabilirsiniz |
| `messages.saved.errors.tooLong` | Text can have at most {max} characters | Metin en fazla {max} karakter olabilir |
| `messages.saved.imported` | {count, plural, one {# saved reply moved to your account} other {# saved replies moved to your account}} | {count} hazır yanıt hesabınıza taşındı |
| `messages.context.title` | Customer & orders | Müşteri ve siparişler |
| `messages.context.customer` | Customer | Müşteri |
| `messages.context.email` | Email | E-posta |
| `messages.context.orders` | Orders | Siparişler |
| `messages.context.summary` | {count, plural, one {# order} other {# orders}} · {latest} | {count} sipariş · {latest} |
| `messages.context.noOrders` | No orders from this customer | Bu müşteriden sipariş yok |
| `messages.context.ordersError` | Couldn't load Wix orders | Wix siparişleri yüklenemedi |
| `messages.context.openOrder` | Open order | Siparişi aç |
| `messages.context.tracking` | Tracking | Takip numarası |
| `messages.context.moreItems` | +{count} more | +{count} ürün daha |
| `messages.context.product` | Product | Ürün |
| `messages.context.price` | Price | Fiyat |
| `messages.context.stock` | In stock | Stok |
| `messages.context.barcode` | Barcode | Barkod |
| `messages.context.openListing` | Open listing | İlanı aç |
| `messages.context.notInCatalog` | This product isn't in KolayXport yet. Refresh Trendyol products to see price and stock. | Bu ürün henüz KolayXport'ta yok. Fiyat ve stok için Trendyol ürünlerini yenileyin. |
| `messages.context.otherQuestions` | {count, plural, one {# other question about this product} other {# other questions about this product}} | Bu ürünle ilgili {count} soru daha |
| `messages.empty.connect.title` | Answer Wix and Trendyol customers in one place | Wix ve Trendyol müşterilerinizi tek yerden yanıtlayın |
| `messages.empty.connect.body` | Connect a store to see messages and product questions here. | Mesajları ve ürün sorularını burada görmek için bir mağaza bağlayın. |
| `messages.empty.connect.action` | Connect a store | Mağaza bağla |
| `messages.empty.done.title` | Every message has a reply | Tüm mesajlar yanıtlandı |
| `messages.empty.done.body` | New messages show up here within 2 minutes. | Yeni mesajlar 2 dakika içinde burada görünür. |
| `messages.empty.none.title` | No messages yet | Henüz mesaj yok |
| `messages.empty.noResults.title` | No conversations match | Eşleşen konuşma yok |
| `messages.empty.noResults.action` | Clear filters | Filtreleri temizle |
| `messages.error.list.title` | Couldn't load messages | Mesajlar yüklenemedi |
| `messages.platformErrors.permission` | Wix inbox access is missing. Reconnect Wix to allow messages. | Wix gelen kutusu erişimi eksik. Mesajlara izin vermek için Wix'i yeniden bağlayın. |
| `messages.platformErrors.auth` | {name} connection expired. | {name} bağlantısının süresi doldu. |
| `messages.platformErrors.credentials` | {name} setup is incomplete. | {name} kurulumu eksik. |
| `messages.platformErrors.rateLimited` | {name} is busy right now. Showing earlier messages. | {name} şu an yoğun. Önceki mesajlar gösteriliyor. |
| `messages.platformErrors.unavailable` | Couldn't load {name} messages. | {name} mesajları yüklenemedi. |
| `messages.platformErrors.reconnect` | Reconnect {name} | {name} hesabını yeniden bağla |
| `messages.platformErrors.finishSetup` | Finish setup | Kurulumu tamamla |
| `messages.platformErrors.retry` | Try again | Tekrar dene |
| `status.message.in_review` (DS addition) | Answer in review | Yanıt onayda |
| `status.message.answer_rejected` (DS addition) | Answer rejected | Yanıt reddedildi |

`status.message.unread` / `needs_reply`, SyncMeta, ConfirmDialog, ErrorState ("Copy error ID") and Retry strings come from the DS `status.*` and `ds.*` namespaces and are not repeated here.

**Keys to delete** once the legacy page is removed: `messages.allPlatforms`, `all`, `unanswered`, `answered`, `noMessages`, `noCredentials`, `reply`, `replyPlaceholder`, `sendReply`, `replySent`, `replyFailed`, `from`, `product`, `loadingMessages`, `markAsRead`, `selectConversation`, `trendyolAnswered`, `customer`, `you`, `newMessages`, `viewAll`, `productContext`, `viewProduct`, `recentOrders`, `noOrders`, `orderNumber`, `orderDate`, `items`, `loadingOrders`, `showContext`, `hideContext`, `templates.*`, `fetchFailed`, `refresh`, `connectedPlatforms`, `connectEitherDescription`, `time.*`. First grep each one; `newMessages` / `viewAll` may be used by the AppLayout notification popover (`AppLayout.js:830`).

---

## 8. Implementation split (disjoint file groups for parallel agents)

Prerequisites: DS M1 primitives (Avatar, LogoTile, StatusPill, DateText, Money, Thumb, Toolbar family, SavedViews, FilterButton, TextArea/FormField, Combobox, SidePanel, Modal, ConfirmDialog, Banner, EmptyState, ErrorState, Skeletons, useAsyncState, useShortcuts, useUrlState) and M2 shell (Page, PageHeader, SyncMeta, usePageActions). The contracts in §6 are the interface between groups, so G4–G6 build against fixtures while G1–G3 build the APIs. Each group writes its own i18n fragment, runs `npx next build --webpack`, and adds Vitest tests for its files.

| Group | Owns (create/edit only these) | Delivers |
|---|---|---|
| **G1 Inbox data** | `prisma/schema.prisma` (+ `InboxThread`, `SavedReply`, `User` relations), `prisma/migrations/2026xxxx_inbox_thread_saved_reply/`, `types/messages.ts`, `lib/messages/normalize.ts` (normalizers moved out of the route; no "now" fallbacks; Trendyol status map), `lib/messages/inboxCache.ts` (Wix enrichment §6.2), `lib/messages/cursor.ts`, `lib/messages/limits.ts`, `pages/api/messages/index.ts` (list cursor/view, thread, reply codes, counts, orderContext join + 502, markSeen, productContext), `__tests__/messages/normalize.test.ts`, `__tests__/messages/cursor.test.ts` | §6.1–6.2. Fixture JSON for G4–G6 in `__tests__/fixtures/messages/*.json` |
| **G2 AI draft** | `pages/api/messages/draft-reply.ts`, `lib/messages/draftReply.ts` (context builder, prompt, validation), `__tests__/messages/draftReply.test.ts` | §6.3. Reads Prisma models and `wixClient`/Trendyol client; does not edit `index.ts` (shares helpers only through G1's `lib/messages/normalize.ts`, imported read-only) |
| **G3 Saved replies** | `pages/api/messages/saved-replies.ts`, `lib/messages/fillVariables.ts`, `lib/hooks/useSavedReplies.ts` (SWR + import of localStorage), `components/domain/messages/SavedRepliesPicker.tsx`, `SavedRepliesPanel.tsx`, `SaveReplyModal.tsx`, tests | §2.4–2.5, §6.4 |
| **G4 Status map** | `lib/ds/status/messages.ts`, `__tests__/ds/status/messages.test.ts`, and the two new rows in the DS StatusPill vocabulary (`lib/ds/status/vocabulary.ts` or wherever M1 put it) | §5.2. If M1 already created `messages.ts`, G4 extends it |
| **G5 List + page** | `pages/app/mesajlar.tsx` (flag switch), `components/domain/messages/MessagesPage.tsx`, `ConversationList.tsx`, `ConversationRow.tsx`, `useInbox.ts` (SWR infinite, merge/keep-on-failure, polling, `locallyAnswered`), `useInboxUrlState.ts`, `PlatformBanners.tsx`, `lib/stores/useMessageCountStore.ts` (types only if needed), move the legacy page to `components/legacy/MessagesPageLegacy.tsx` (verbatim) | §1, §2.1 list, §3.1, §5.1 list/page rows, keyboard and auto-open |
| **G6 Thread + rail** | `components/domain/messages/ThreadPane.tsx`, `ThreadHeader.tsx`, `MessageBubble.tsx`, `Composer.tsx`, `useThread.ts` (thread fetch, send, markSeen, sessionStorage drafts, AI insert), `ContextRail.tsx`, `OrderContextList.tsx`, `ProductContextCard.tsx`, `ContextSheet.tsx` (mobile BottomSheet), `useKeyboardInset.ts` | §2.1–2.3, §3.2–3.3, §5.1 thread/composer/rail rows, §5.3. Consumes G3's `SavedRepliesPicker` by import (G3 publishes its props first: `{ platform; context: FillContext; onInsert(text) ; currentText }`) |
| **Integrator** (after all) | `messages/en.json`, `messages/tr.json` (merge fragments, delete keys §7), `design/migrated-paths.json` (+ `pages/app/mesajlar.tsx`, `components/domain/messages/**`), `pages/api/wix/messages.ts` (delete), DS doc additions (§11), Overview example fix | DoD §10 |

---

## 9. Code to delete

- In `pages/app/mesajlar.tsx` (moved verbatim to `components/legacy/MessagesPageLegacy.tsx` for one release behind the flag, then deleted): `PLATFORM_COLORS`, `PLATFORM_NAMES` (→ `lib/ds/marketplaces.ts`), the inline `ConversationCard` component, `platformErrorChips` (hex-colored Chips), `templateRow`, the localStorage saved-reply code (`parseTemplates`, `persistTemplates`, `templatesKey`, `MAX_TEMPLATES = 20`), `formatDate`/`formatTime` (→ `DateText`), the MUI `Select`/`FormControl` filter bar, `SwipeableDrawer` (→ DS sheet), `CircularProgress`/`Skeleton` usages, the Enter-to-send handler, the hard-coded `#e2e8f0`/`rgb(...)` styles, the "Select a conversation" empty pane, `AppLayout title` (→ `Page`/`PageHeader`).
- `pages/api/wix/messages.ts`: no caller (verified by grep). Delete.
- In `pages/api/messages/index.ts`: the in-file normalizers (moved to `lib/messages/normalize.ts`), every `new Date().toISOString()` fallback, the `catch → { orders: [] }` in `orderContext`, the `limit: 100` argument that `getConversationMessages` ignores, the Wix `counts` branch that lists 50 conversations on every badge poll.
- `components/ui/ConnectEmptyState` usage on this page (→ DS `EmptyState first-use`).
- i18n keys listed at the end of §7.

---

## 10. Definition of done (DS §8, plus surface checks)

- [ ] DS §8 checklist, with 1440 / 1024 / 390 screenshots in EN and TR, for: needs-reply default, Trendyol thread, answered/in-review/rejected, done-empty, no-store, one-platform-failed, AI draft with "AI didn't have".
- [ ] Production data check: on the founder's account no Wix row shows "1m" unless the newest message really is under a minute old; every Wix row has preview text or the "No message text" caption; a Wix message from a customer makes the row bold with a dot and the nav badge counts it within one poll.
- [ ] No empty Wix conversations listed (`messageCount = 0` hidden).
- [ ] A Trendyol answer cannot be sent twice from two tabs (second attempt shows "already has an answer"); `Enter` inserts a newline; `⌘/Ctrl+Enter` sends.
- [ ] AI draft: 10 real threads tried, 0 invented tracking numbers or dates, Turkish answers for Trendyol, English for an English Wix customer; malformed Gemini output shows the inline failure, never raw text in a toast.
- [ ] Saved replies created on desktop appear on the phone; the old localStorage list is imported once and the key removed.
- [ ] "Open order" lands on the right OrderPanel for 3 Wix orders (join verified).
- [ ] The two Trendyol status names (`WAITING_FOR_APPROVE`, `REJECTED`) and the answer length limits are confirmed from a live response or docs, and recorded in `lib/messages/limits.ts` with the source.
- [ ] Committed and pushed; deploy verified by SHA before the founder tests on the `messages` flag.

---

## 11. Additions to the design system (justified; to merge into DESIGN_SYSTEM.md)

1. **StatusPill `message` domain:** add `in_review` "Answer in review / Yanıt onayda" (info) and `answer_rejected` "Answer rejected / Yanıt reddedildi" (danger). Needed because Trendyol answers are moderated; without them the UI invites a second answer that Trendyol refuses (D11).
2. **Inbox layout exception (DS §3.5):** Messages uses a persistent list | thread | context-rail layout on desktop instead of an overlay SidePanel. Reason in §1. Below 900px it is the standard full-height sheet. No other surface may use it.
3. **`MessageBubble` (domain, `components/domain/messages/`):** customer bubble `neutral-0` with a 1px `neutral-200` border, left-aligned; seller bubble `neutral-100` with no border, right-aligned; radius 8 (`radius-md`), padding 8/12, max width 80% (85% mobile), `body` text, `caption` meta line. No accent fill, so no color gains a new meaning (accent-50 stays "selected row"; solid accent stays "the primary button").
4. **Composer footer on mobile:** a field plus one 48px primary and two labeled 44px `IconButton`s, in place of the 50/50 sheet footer. Reason: the primary is "send this text", and the field must sit next to it.
5. **Dense list form on mobile:** conversation rows sit in one bordered surface with 1px dividers (gap 0) instead of separate cards, so 5–6 conversations fit on a 390px screen.
6. **Glossary (§3.19):** "Draft with AI / AI ile taslak yaz" and "Saved replies / Hazır yanıtlar" (never "Templates", "Şablon").
7. **Overview example fix (DS §6.5):** the Needs-reply KPI example should read "Trendyol 2 · Wix 1"; Etsy has no messages API.
