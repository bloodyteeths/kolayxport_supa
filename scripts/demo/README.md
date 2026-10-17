# Demo account + marketing screenshots

Synthetic data only. Every customer name, address, order number, tracking number, tax id and token is made up.
The seed refuses to run unless `DATABASE_URL` points at `localhost` / `127.0.0.1`.

## Run

```bash
# 1. Local throwaway DB only (default if DATABASE_URL is unset):
export DATABASE_URL=postgresql://postgres@localhost:5544/kx_gtm_preview

# 2. Seed (idempotent: wipes and recreates the demo user's rows every run).
#    Also (re)generates the flat product photos in public/demo/*.jpg.
npx tsx scripts/demo/seed-demo-account.ts
npx tsx scripts/demo/seed-demo-account.ts --images   # only regenerate public/demo/*.jpg

# 3. Dev server on :3100 (kx-gtm/.env.local), then capture:
npx tsx scripts/gtm/capture-screens.ts                       # all screens, TR then EN (~10 min)
npx tsx scripts/gtm/capture-screens.ts orders profit --locale=en --preview=/tmp/prev
```

Re-run the seed right before capturing. Several "freshness" values are relative to seed time: the Etsy
auto-pull kicks in after 12 h, the finance auto-sync after 3 h, and the "Etsy live" chip after 24 h. When
they go stale, the app tries to call the marketplaces with the fake tokens.

Output: `public/marketing/screens/<id>.webp` (TR) and `public/marketing/screens/en/<id>.webp` (EN).
Desktop shots are 1440x900 at 2x DPR, cropped to `<main id="kx-main">` (no sidebar). The exception is
`labels`, which is the full viewport because the panel overlays the page. Mobile shots are 390x844 at 3x.

## Demo login

| | |
|---|---|
| URL | http://localhost:3100/login |
| Email | `demo@kolayxport.test` |
| Password | `KolayDemo!2026` (local test value; override with `DEMO_PASSWORD` for both scripts) |

Plan: Pro, active (Stripe). Usage counters read 214 labels and 1,386 orders.

## What the seed creates

| Area | What gets seeded |
|---|---|
| User | Email verified, Pro plan active. `ShipperProfile` "Demo Atölye Ltd." (Istanbul, fake VKN `0000000000`). Package presets. |
| Connections | All presence-only fake tokens, so nothing here can authenticate anywhere: Etsy (`EtsyShop` "DemoAtolyeStudio" + Credential), eBay, Amazon, Trendyol, Wix (`WixSite`), FedEx, UPS, DHL eCommerce (MNG). |
| Orders | 40 orders from the last 30 days: Etsy 16, eBay 9, Amazon 8, Trendyol 7. International buyers (US, GB, DE, FR, NL, IT, SE, CA, AU) plus Turkish ones for Trendyol. Six are open (one overdue); the rest are shipped with fake FedEx / UPS / DHL eCommerce tracking numbers, `Shipment` rows, and Etsy `TrackingSubmission`s. |
| Etsy | 25 listings with tags, materials, prices, views and favourites, health scores (47–98) and fail checks, shop sections, SKU offerings, and 30 days of daily stats. One staged title draft ("1 change not sent"). |
| eBay / Trendyol | 12 `EbayListing` rows and 13 `TrendyolProduct` rows, all with images and health scores. |
| Finance | About 870 `FinancialTransaction` rows over 62 days. Etsy (USD): Sale, EtsyFee, shipping_label, Etsy Ads, offsite ads, refunds, disbursements. eBay (USD) and Trendyol (TRY) are lighter. Also `ProductCost` per SKU per marketplace and `FinancialSyncCursor` (synced now). |
| Stock sync | Live (not dry run): 14 `StockItem` with 36 active `StockLink` (Etsy/eBay/Trendyol), ledger entries and applied pushes. |
| Research | Shared `ResearchCache` rows for the keyword explorer: seed "turkish towel", 16 keywords with metrics, valid for 30 days. Price gap: 10 Trendyol "Havlu" products, each with 8 matched US eBay items (`TrendyolProductIndex`, `EbayProductIndex`, `ArbitrageMatch`), plus `ArbitrageResultRecord` translations and Etsy search cache rows for the Etsy median column. |
| Inbox | 5 `InboxThread` rows (Wix + Trendyol) and 3 `SavedReply` rows. |
| Images | 20 flat studio-style product renders in `public/demo/*.jpg`: Iznik bowls and plates, mugs, telkari jewellery, peshtemals, leather goods, an evil eye hanging, a cezve and a mosaic lamp. |

## Screens

"Mocked" means the capture script answers the browser's call to our own API route with a synthetic
fixture (`page.route`). Those routes otherwise call Etsy, Wix, Trendyol or Gemini live, and the fake
tokens cannot work there. Every other screen renders straight from the seeded DB.

| id | Route | What it shows | Data source | Looked good? |
|---|---|---|---|---|
| `orders` | `/app/labels` | Unified orders table: Etsy/eBay/Amazon/Trendyol logos, thumbnails, To ship / Overdue / Shipped, "Tracking sent ✓" | DB | Yes |
| `labels` | `/app/labels` + row "Create label" | Create-label panel for an Etsy order to Portland, US: sender, recipient, package, FedEx/UPS services | DB | Yes. Full viewport with the sidebar, since the panel overlays the page. |
| `etsy-listings` | `/app/etsy-listings` | Etsy listings with health bars, SKUs, sections, "Etsy live" chip, "Send 1 change to Etsy" | DB (shop sections mocked) | Yes |
| `listing-editor` | `/app/etsy-listings/1790001234?shop=48291736` | Single listing editor: 10 photos, health rail 82/100, AI "Suggest a title" result card, staged-change bar | Mocked: `/api/clawd/etsy` (the listing loads live from Etsy) and `/api/ai/etsy` (canned suggestion) | Yes. Scrolled so the AI card clears the save bar, which pushes the page title partly off the top. |
| `bulk-editor` | `/app/etsy-listings/bulk` | Bulk grid with 3 rows selected and the action bar (Change price, Add tags, Improve with AI, Edit photos) | DB | Yes. The grid's active-cell focus ring stays on the first thumbnail. |
| `research` | `/app/research/keywords?q=turkish%20towel&mkt=etsy` | Keyword explorer: demand dots, competition, top-48 use, price band, "in my shop" | DB cache | Yes |
| `arbitrage` | `/app/research/products?source=trendyol&from=category&cat=havlu-x-c839` | Trendyol to eBay/Etsy price gap: TR price, eBay US median, Etsy median, confidence, landed cost, margin | DB, plus a live public FX rate (exchangerate-api.com) | Yes. Margins move with that day's TRY rate. Images use a fake https host that only the capture script serves. |
| `profit` | `/app/reports/profit?mp=etsy` | Profit report: KPI cards, P&L breakdown, daily net sales vs net profit chart | DB | Yes. The page header reads "Home" / "Ana sayfa" because the profit report lives under Home in the nav. |
| `inbox` | `/app/mesajlar?open=wix:demo-conv-1` | Unified inbox (Wix + Trendyol), open thread, AI reply draft in the composer, customer/order rail | Mocked: `/api/messages` and `/api/messages/draft-reply` (the conversation list and AI draft are live-only) | Yes |
| `stock-sync` | `/app/stok-senkron` | Stock sync "Live" with counters, settings, product list with channel chips | DB | OK. The settings card takes the top half; the product table shows about 3 rows. |
| `orders-mobile` | `/app/labels` @ 390x844 | Mobile order cards, "Create N labels" bar, bottom tab bar | DB | Yes |
| `etsy-listings-mobile` | `/app/etsy-listings` @ 390x844 | Mobile listing cards with health and stock | DB | Yes |
| `extension` | n/a | Chrome extension | Not capturable: it is a separate Chrome extension UI running against etsy.com, not an app route | Skipped. Use a manual capture of the extension popup on a test profile. |

## Safety notes

- The seed writes only the demo user's rows, plus `__public__` research cache and index rows that use
  fictional ids. It deletes and recreates its own rows on every run.
- The marketplace tokens are strings like `demo-etsy-access`, and Etsy's `tokenExpiresAt` is a year out so
  no token refresh is attempted. Live pulls only run on an explicit click, and the capture script also
  stubs `/api/orders/sync`, `/api/finance/settlements` POST and `/api/research/price-gap/refresh`.
- If you click around the app by hand with this account, some buttons (Refresh, Send to Etsy, Reply)
  will try the real APIs and fail with auth errors. That can raise "reconnect" flags; re-run the seed to
  clear them.
