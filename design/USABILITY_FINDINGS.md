# Usability findings — founder + task walkthrough on production (2026-10-15)

Founder's bar: **"easier and more comfortable than before" on real daily tasks.** Not spec-compliance. If a seller
feels lost, waits, or has to think, it's broken. Turkish is the primary language; TL is the primary currency.

## Founder reports (verbatim intent)
1. Orders (labels) page: **default view must be All orders**, not To ship.
2. Order side panel looks very bad: **raw translation keys** (orders.panel.*, orders.actions.copyAddress — hotfix
   in progress) and **too much whitespace** (huge vertical gaps between sections, tiny content).
3. Home: **defaults to USD — must default to TL (TRY)**. Switching currency must be **one tap on the page**, not inside
   the Filters drawer (mobile hides it in the drawer today).
4. Profit page (Kâr ve zarar card): looks bad — amounts in USD, mini bars almost invisible, % column pushed far right,
   unclear hierarchy, wasted width.
5. **Orders page takes forever to load.**
6. **Mobile: far too much whitespace everywhere.**
7. **Edit listing pages make me feel lost.**
8. Overall: "what is live doesn't give good vibes". Everything must be very easy to understand.

## Walkthrough findings (desktop 1332px, real data)
### Ship an order
- Order panel: item price/qty/subtotal/total don't render (keys missing → values hidden). Trendyol pre-assigned cargo
  code shows unlabeled ("orders.row.trendyolCargo"); it should read "Trendyol kargo kodu" with copy.
- Currency select in panel renders tall/broken (chevron on its own line). Same bug in Create-label phone country-code
  select. → MUI Select inside DS field height bug; fix globally.
- Default list sorted by most overdue first (70-day-old orders on top) — confusing; with All orders default, sort
  newest first; "To ship" view keeps ship-by sort.
- Create label: whole recipient form expanded by default (long scroll). Should show a compact ship-to summary with
  "Edit"; only expand on edit or when something is missing (then highlight the missing field).
- Domestic TR order lists UPS international services; DHL eCommerce (MNG) should be default/preselected for TR→TR,
  carriers not applicable hidden or collapsed under "Other carriers"; show price when known.
- Label options (paid by, delivery type, SMS toggles, contents) all expanded — collapse into "Options" with sensible
  remembered defaults.
### Home / reports
- Page title says "Reports" while nav says Home — confusing. Home should say Home (Ana sayfa) with the period summary.
- USD default; ≈ approximations everywhere; currency select exists on desktop but not obvious; make it a compact
  segmented TL / $ / € control in the header row, default TRY, remember choice.
### Edit a listing
- Title is a single-line input that truncates a 129-char title — must be a 2–3 line auto-growing textarea.
- Description is still a fixed-height inner-scrolling box (founder complained about exactly this) — must auto-grow.
- Health rail: wall of 7 bordered buttons + numbers ("+9", "+8") — overwhelming. Show the top 3 fixes, plain
  language, one "Fix" link each; rest behind "Show all".
- Large empty gaps between sections; section headers + chips duplicated (chip bar and section title).
- Footer "Up to date with Etsy" is good; when there are changes the primary must be obvious.

### Mobile walkthrough (500px, TR, real data)
- Orders: every card carries a full-width outlined "Etiket oluştur" button → each card ≈ half a screen, 2 orders
  visible. Make the card tap-to-open with a compact trailing icon/text action; 4–5 orders per screen. Lone "Seç" link
  and lone "25 sonuç" line waste two rows — merge into one compact row. Default chip is Gönderilecek (should be Tümü).
- Listings grid mobile: same pattern — full-width "Düzenle" per card, lone "Seç", big gaps. Whole card opens editor.
- Create label mobile: full recipient form expanded, phone country-code select tall/broken, Country empty for masked
  Trendyol order (*** values) — show "Trendyol hides the address until shipment; label uses Trendyol cargo code".
- Editor mobile: big empty gaps between sections; description inner-scroll box; photo action buttons wrap in 2 rows.
- Home mobile: titled "Raporlar"; USD; each KPI card repeats a "0:19 itibarıyla · Siparişler · 4 mağaza" footer
  (noise — state freshness once in the header); comparison text "18 Ağu – 16 Eyl 2026 dönemine göre" wraps badly.
- Messages: avatar initials clipped under the marketplace badge ("KD" cut).

## Principles for the fix wave
- Density: tighten vertical rhythm (section gap ≤ 24px desktop / 16px mobile, panel padding 16px, no empty filler).
- Turkish-first copy; TRY default; Intl formatting tr-TR.
- Fast: list pages render rows from cache instantly (SWR keepPreviousData), no blocking full-page loaders, paginate
  50, measure API timing for /api/orders and fix slow queries.
- Every screen passes a **task test**: the agent states the task, counts taps/clicks before/after, and must reduce them.

## Measured on production (2026-10-15, real account)
- GET /api/orders?view=to_ship&include=counts → **5.7 s** (162 KB). The view-counts SQL computes
  EFFECTIVE_SHIP_BY_SQL per row (OrderItem subquery + rawData regex casts + jsonb_array_elements over
  transactions) for every open order. Fix: read the stored `Order.shipByAt` column first (backend migration
  order_lifecycle added it; ask backend to backfill if null) and only fall back to rawData for rows without it;
  compute counts in a separate request so the list never waits for counts; add/verify indexes; cache counts 30 s.
- GET /api/orders?view=all → 0.3 s but **325 KB per 50 rows** — strip rawData and unused fields from the list
  payload (load full detail only when the panel opens).
