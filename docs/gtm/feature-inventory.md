# KolayXport feature inventory (GTM source of truth)

- **Date:** 2026-10-17
- **Code base:** branch `gtm/overhaul` (identical to `main`, HEAD `ea30979`)
- **Rule:** every public claim (site, ads, App Store listings, sales decks) must map to a row ID in this file. If no row exists, or the row is not `production`, do not make the claim without the stated limits.

## How maturity was judged

Each row was traced through the code: UI component → API route → library/integration client → the external API call. A feature is `production` only when that whole path exists and is reachable from the app's navigation.

What was **not** verified:
- Production env flags on the Hetzner VPS (`MARKETPLACE_TRENDYOL`, `MARKETPLACE_WIX`, `STOCK_WIX_WRITE_VERIFIED`, `DISABLE_CRON_SYNC`, etc.).
- The crontab.
- Real usage numbers.

Reading the production server was out of scope. Anything that depends on those flags is marked `beta` until the owner confirms the flag values on the VPS.

**Legend**
- **production:** complete, wired end to end, reachable from the navigation.
- **beta:** works, but is env-flagged, user-allowlisted, or limited in a way a customer will notice.
- **partial:** some sub-capabilities are missing. The Notes column says which ones.
- **stub:** UI, data model or placeholder only. Nothing reaches the marketplace or carrier.
- **none:** not present in code.

**Plan tier column**
- **all:** ungated. Every plan, including trial, can use it.
- **Pro:** a `lib/billing/featureMap.ts` feature (`arbitrage`, `financials`, `bulkPhotoStudio`). These are ON for trial, pro and enterprise, and OFF for starter, growth and shopify_free. Pro cannot currently be bought; see H-1.
- **metered:** counted by `lib/middleware/withUsageLimiter.ts` (`orderSync` or `label`). Limits per plan:

| Plan | Order syncs | Labels | Period |
|---|---|---|---|
| Trial | 50 | 10 | whole trial |
| Starter | 200 | 100 | per month |
| Growth | 2000 | 500 | per month |
| Enterprise, shopify_free | unlimited | unlimited | |

---

## 1. Feature table

### Orders & fulfillment

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `orders-unified-list` | Birleşik sipariş listesi | Unified order list | Etsy, eBay, Amazon, Shopify, Trendyol*, Wix*, Veeqo, Shippo, manual | production | all | `/app/labels`, nav "Siparişler / Orders" (`g o`, badge = orders to ship) | `components/domain/orders/OrdersPage.tsx`, `pages/api/orders/index.ts`, `lib/orders/views.ts` | Built-in views: all, to ship, overdue, label created, shipped, problems. Also saved views, search across 9 fields, date presets, page sizes 50/100/250. *Trendyol and Wix are env-gated (see `order-sync-*`). |
| `order-sync-etsy` | Etsy sipariş senkronu | Etsy order sync (direct API) | Etsy | production | metered (orderSync) | Orders › Refresh; cron | `lib/integrations/etsyOrderSync.ts`, `lib/orders/etsyLifecycle.ts`, `lib/orderSync.ts`, `pages/api/integrations/etsy/orders.ts` | Etsy's API withholds buyer address and email. Full addresses come from the Chrome extension (`ext-etsy-address`). Full sync covers 30 days / 50 pages. |
| `order-sync-ebay` | eBay sipariş senkronu | eBay order sync (direct) | eBay | production | metered | Orders › Refresh; cron | `lib/integrations/ebayOrderSync.ts`, `lib/orderSync.ts` | Fetch errors are swallowed and return an empty list (silent failure risk). |
| `order-sync-amazon` | Amazon sipariş senkronu | Amazon order sync (SP-API) | Amazon | production | metered | Orders | `lib/orderSync.ts`, `lib/integrations/amazonReports.ts`, `lib/integrations/amazonShipBy.ts` | Uses SP-API reports. Veeqo-sourced Amazon duplicates are filtered out. Images and buyer PII are limited by missing SP-API roles. |
| `order-sync-shopify` | Shopify sipariş senkronu | Shopify order sync | Shopify | production | metered | Orders | `lib/sync/shopify.ts`, `pages/api/cron/sync-orders.ts`, `lib/config.ts` | On by default (`MARKETPLACE_SHOPIFY!=='false'`). |
| `order-sync-trendyol` | Trendyol sipariş senkronu | Trendyol order sync | Trendyol | beta | metered | Orders | `lib/sync/trendyol.ts`, `lib/config.ts` (`MARKETPLACE_TRENDYOL`, `ALLOW_TRENDYOL_USERS`), `pages/api/cron/sync-orders.ts` | Off unless `MARKETPLACE_TRENDYOL=true`, with an optional user allowlist. The UI refresh path calls the legacy `scripts/auto-sync-all-users.js` and returns zeroed counts. |
| `order-sync-wix` | Wix sipariş senkronu | Wix order sync | Wix | beta | metered | Orders | `lib/sync/wix.ts`, `lib/config.ts` (`MARKETPLACE_WIX`) | Off unless `MARKETPLACE_WIX=true`, with an optional allowlist. |
| `order-sync-veeqo-shippo` | Veeqo / Shippo sipariş aktarımı | Veeqo / Shippo order import | Veeqo, Shippo | production (import only) | metered | Settings › Connections (API key) | `lib/integrations/veeqo.ts`, `lib/integrations/shippo.ts`, `lib/settings/integrations.ts` | Import only. No labels are bought through either. HTTP errors are swallowed. |
| `orders-auto-sync-cron` | Otomatik sipariş senkronu | Background order sync | all synced sources | partial | not metered | none (background) | `pages/api/cron/sync-orders.ts`, `lib/orderSync.ts` | Exists. Can be switched off with `DISABLE_CRON_SYNC=true`. The schedule on the VPS was not verified. |
| `orders-manual` | Manuel sipariş | Manual orders | n/a | production | all | Orders › New manual order | `components/domain/orders/ManualOrderPanel.tsx`, `pages/api/orders/manual.ts`, `lib/orders/manualOrder.ts` | |
| `orders-detail-panel` | Sipariş detay paneli | Order detail panel | all | production | all | Orders › click an order | `components/domain/orders/panel/*` | Notes, items, costs, history, ship-to edit, add tracking, message buyer (Amazon only, see `msg-amazon-buyer`). |
| `orders-bulk-actions` | Toplu sipariş işlemleri | Bulk order actions | all | production | all (labels metered) | Orders › select rows | `components/domain/orders/OrdersBulkActions.tsx` | Bulk labels, print labels (max 20 per click), packing slips, pick list, send ETGB, copy addresses as TSV, export. |
| `orders-export` | Sipariş dışa aktarma | Order export (CSV/XLSX/PDF) | all | production | all | Orders › Export | `components/domain/orders/OrdersExportMenu.tsx`, `pages/api/orders/export.ts` | |
| `orders-pick-packing` | Toplama listesi & paketleme fişi | Pick list & packing slips | all | production | all | Orders › bulk › Print (`/app/print/pick-list`, `/app/print/packing-slips`) | `pages/app/print/pick-list.tsx`, `pages/app/print/packing-slips.tsx`, `pages/api/orders/print-data.ts` | Max 200 orders. |
| `tracking-push-ebay` | eBay'e takip no gönderimi | Push tracking to eBay | eBay | production | all | Label flow / order › Add tracking | `pages/api/orders/[orderId]/submit-tracking.ts`, `lib/shipping/trackingCarriers.ts` | Carrier map covers UPS, FedEx, USPS, DHL and Royal Mail. Every other carrier is sent as `OTHER`. |
| `tracking-push-amazon` | Amazon'a takip no gönderimi | Push tracking to Amazon | Amazon | production | all | same | `pages/api/orders/[orderId]/submit-tracking.ts` | Asynchronous SP-API fulfillment feed. |
| `tracking-push-wix` | Wix'e takip no gönderimi | Push tracking to Wix | Wix | beta | all | same | `pages/api/orders/[orderId]/submit-tracking.ts` | Follows the Wix flag. |
| `tracking-push-veeqo` | Veeqo üzerinden takip gönderimi | Push tracking via Veeqo | Veeqo-sourced orders | production | all | same | `pages/api/orders/[orderId]/submit-tracking.ts` | With no Veeqo key, the number is saved locally only. |
| `tracking-push-etsy` | Etsy'ye takip no gönderimi | Push tracking to Etsy | Etsy | partial | all | same, plus the Chrome extension | `pages/api/orders/[orderId]/submit-tracking.ts` (L106–138), `pages/api/integrations/etsy/tracking-pending.ts`, `chrome-extension/src/background-simple.js` | The server only queues the number. The push happens only if the user has the Chrome extension running, which fills in Etsy's form through DOM automation. See `ext-etsy-tracking`. |
| `tracking-push-other` | Trendyol/Shopify/Hepsiburada takip gönderimi | Tracking push for Trendyol/Shopify/Hepsiburada | Trendyol, Shopify, Hepsiburada | none | n/a | "Add tracking" is still offered but only saves locally | `lib/shipping/labelDraft.ts` (`NO_TRACKING_PUSH`), `lib/integrations/shopifyClient.ts` (`createFulfillment` unwired) | The client methods exist but are not wired to this flow. See H-9. |

### Shipping labels & customs

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `label-fedex` | FedEx etiket | FedEx label | FedEx | partial | metered (label) | Orders › Create label; credentials at Settings › Connections › FedEx | `pages/api/orders/[orderId]/generate-label.ts`, `lib/shipping/submit/fedex.ts`, `lib/fedex/fedex.service.ts`, `lib/shipping/carriers.ts` | International only (International Priority / Economy). Uses the user's own FedEx account (BYO API key and account). No tracking API. Void is manual. |
| `label-ups` | UPS etiket | UPS label | UPS | partial | metered (label) | same, UPS tile | `pages/api/labels/ups.ts`, `lib/ups/createUpsShipment.ts`, `lib/shipping/submit/ups.ts` | International services only (65/07/54/08/11). BYO UPS account. Description capped at 35 characters. No tracking API. Void is manual. The label PDF is kept in an in-memory cache. |
| `label-dhl-ecommerce` | DHL eCommerce (MNG Kargo) yurt içi etiket | DHL eCommerce (MNG) domestic label | DHL eCommerce / MNG | production | metered (label) | same, "DHL eCommerce" tile | `pages/api/labels/mng.ts`, `lib/mng/mng.service.ts`, `lib/mng/mng.credentials.ts`, `pages/api/shipments/[shipmentId]/void.ts` | Turkey→Turkey only. Standard, Express and Same-day services. Cash on delivery (COD) and SMS options. Tracking and cancel work through the API. Needs the user's MNG customer number and password; app keys are platform env vars. |
| `labels-bulk` | Toplu etiket oluşturma | Bulk label creation | FedEx, UPS, DHL eCommerce | production | metered | Orders › select › Create labels | `components/domain/shipping/BulkCreateLabelsPanel.tsx`, `lib/shipping/carriers.ts` (`runLabelQueue`) | Runs orders one at a time with stop and retry. Orders are routed by carrier: all-domestic orders go to DHL eCommerce. Warns when the order was cancelled on Etsy. |
| `customs-commercial-invoice` | Elektronik ticari fatura (ETD) | Electronic commercial invoice (paperless) | FedEx, UPS | production | metered (with label) | Create label › Customs section | `components/domain/shipping/CustomsSection.tsx`, `pages/api/orders/[orderId]/generate-label.ts` (L440–470), `lib/ups/createUpsShipment.ts` (L327–500) | FedEx: ETD commercial invoice. UPS: EDI InternationalForms with IOSS/VAT validation. Needs HS code and description per item. |
| `label-void` | Etiket iptali | Label void | DHL eCommerce (API); FedEx/UPS (manual) | partial | all | Order › label › Void | `pages/api/shipments/[shipmentId]/void.ts` | FedEx and UPS return `MANUAL_VOID_REQUIRED` plus a link to the carrier portal. |
| `label-tracking-status` | Kargo takip durumu | Carrier tracking status | DHL eCommerce | partial | all | Order panel | `pages/api/labels/mng.ts` (GET `trackMngShipment`) | Only MNG tracking is fetched from a carrier. FedEx and UPS numbers are stored but not tracked. |
| `sender-profile` | Gönderici profili | Sender (shipper) profile | all carriers | production | all | `/ayarlar?tab=senderProfile` | `components/domain/settings/sender/SenderForm.tsx`, `components/domain/settings/sender/LabelPreview.tsx` | Required before any label. Includes a label preview. |

### Micro-export / ETGB / e-invoice

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `etgb-excel-email` | ETGB Excel hazırlama ve e-posta | ETGB spreadsheet + email to broker | international orders | production (file only) | all (not metered) | Orders › bulk › "Send ETGB"; after-label checkbox when `etgbEnabled` | `lib/services/etgbExcelService.ts` (L228–247), `lib/services/etgbMailerService.ts`, `pages/api/etgb/process.ts`, `components/domain/orders/OrdersBulkActions.tsx` | Builds an XLSX and emails it over SMTP to the recipient set in Settings. It is **not** a customs filing. The exporter name (`TAMSAR TEKSTİL`), its tax number, the default HS code `6204439506` and the "Textile Product" fallback are **hardcoded**, so it is wrong for any other company. Max 100 orders. |
| `parasut-einvoice` | Paraşüt e-Fatura / e-Arşiv | Paraşüt e-invoice / e-archive | Paraşüt | partial | all | Settings › Connections › Paraşüt (credentials only) | `lib/integrations/parasutClient.ts`, `lib/services/invoiceService.ts`, `lib/services/etgbService.ts` (L96–105) | Real client: creates contacts, sales invoices and e-Fatura/e-Arşiv, then fetches PDFs. Its **only** trigger is the ETGB flow. There is no "create invoice" button and no invoice list. Errors are swallowed and the ETGB email is sent anyway. |

### Listing management per marketplace

All five editable marketplaces share one editor and one grid, and all edits are **staged drafts**. Nothing reaches the marketplace until the seller presses "Send", or until a scheduled send fires (cron every 5 min, `pages/api/cron/send-scheduled-drafts.ts`).

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `listings-grid` | İlan listesi (CSV, bul-değiştir, kopyalar) | Listings grid (CSV import/export, find & replace, duplicates) | Etsy, eBay, Trendyol, Shopify, Wix | production | all | nav group "İlanlar / Listings", one row per connected store | `components/domain/listings/ListingsPage.tsx`, `components/domain/listings/config/*.ts`, `lib/nav/navConfig.ts` | A row only appears once that store is connected. There is no Amazon row. |
| `staged-drafts-send` | Taslakta düzenle, tek tıkla gönder | Stage edits as drafts, send when ready | Etsy, eBay, Trendyol, Shopify, Wix | production | all | Any listings page › "Send" | `components/domain/listings/useStagedChanges.ts`, `lib/etsy/draftService.ts`, `lib/ebay/draftService.ts`, `lib/catalogDrafts/service.ts` | Conflict protection: the send is blocked if the listing was changed on the marketplace after the draft was made. "Send all" skips conflicts, deletes and creates. Deletes need a type-to-confirm. |
| `scheduled-send` | Zamanlanmış gönderim | Scheduled send | Etsy, eBay, Trendyol, Shopify, Wix | production | all | Listings › Scheduled | `lib/drafts/scheduledSend.ts`, `pages/api/cron/send-scheduled-drafts.ts` | Never forces a conflicted draft or a queued delete. Depends on the VPS cron (documented in `scripts/deploy/README.md`). |
| `etsy-listing-editor` | Etsy ilan düzenleyici | Etsy listing editor | Etsy | production | all | `/app/etsy-listings/[id]` | `components/domain/listing-editor/ListingEditor.tsx`, `lib/etsy/draftService.ts`, `pages/api/etsy-drafts/[id]/sync.ts` | Covers title, description, tags, price, category attributes, personalization, variations and inventory, variation images, photos (upload/reorder/alt text/delete), video, sections, shipping and return policies, and renew/deactivate/publish/copy/delete. |
| `etsy-listing-create` | Etsy yeni ilan oluşturma | Etsy listing creation | Etsy | production | all | `/app/etsy-listings/new` | `pages/app/etsy-listings/new.tsx`, `lib/etsy/draftService.ts` (`create_listing`) | Creates the listing on Etsy through API v3. |
| `etsy-bulk-editor` | Etsy toplu düzenleme | Etsy bulk editor | Etsy | production | all | `/app/etsy-listings/bulk` | `components/domain/bulk/BulkEditPage.tsx`, `components/domain/bulk/useBulkStaging.ts` | Grid editing of title, price, quantity, section and tags. Bulk renew/activate/deactivate. |
| `etsy-copy-to-shop` | Başka Etsy mağazasına kopyalama | Copy listings to another Etsy shop | Etsy (multi-shop) | production | all | Etsy grid › bulk › Copy to another shop | `CopyToShopModal` (components/domain/listings), `lib/etsy/draftService.ts` | Copies inventory, personalization, images, variation images and video. |
| `etsy-version-history` | İlan sürüm geçmişi ve geri yükleme | Listing version history & restore | Etsy | production | all | Editor › History; `/app/etsy-aktivite` | `pages/api/etsy/listings/[listingId]/versions/[versionId]/restore.ts`, `pages/api/etsy-drafts/history.ts` | The Etsy activity page is reached from ⌘K or breadcrumbs; it is not a sidebar row. |
| `bulk-photo-studio` | Toplu fotoğraf stüdyosu | Bulk photo studio | Etsy | beta (Pro-gated) | Pro | `/app/etsy-listings/photos` (from the bulk editor) | `components/domain/photo-studio/PhotoStudioPage.tsx`, `pages/api/etsy-drafts/batch-media.ts`, `lib/billing/featureMap.ts` | Bulk add/replace/reorder/delete by photo position, plus AI generate and AI alt text. The server enforces the gate with a 402. Etsy only. Hidden under 900px width. Starter/Growth cannot use it, and Pro cannot be bought (H-1). |
| `ebay-listing-editor` | eBay ilan düzenleyici | eBay listing editor | eBay | partial | all | `/app/ebay-listings/[sku]` | `lib/ebay/draftService.ts`, `lib/ebay/draftPlan.ts`, `components/domain/listing-editor/adapters/ebay.ts` | Uses the Inventory API: item, offer, publish, withdraw, delete, variation groups. **Listings created in eBay Seller Hub ("legacy", `legacy-<itemId>`) cannot be edited**; they can only be copied to a new listing (`lib/ebay/legacy.ts`). |
| `ebay-listing-create` | eBay ilan oluşturma stüdyosu | eBay listing studio (create) | eBay | production | all | `/app/ebay-listings/new` | `pages/app/ebay-listings/new.tsx`, `lib/ebay/draftService.ts`, `pages/api/clawd/ebay-ai.ts` | Publishes, or saves as unpublished on eBay. Includes AI autofill. |
| `ebay-bulk-editor` | eBay toplu düzenleme | eBay bulk editor | eBay | production | all | `/app/ebay-listings/bulk` | `components/domain/bulk/BulkEditPage.tsx` | Title, price and quantity only. Also eBay CSV create from the grid. |
| `trendyol-products` | Trendyol ürün yönetimi | Trendyol product management | Trendyol | production | all | `/app/trendyol-urunler`, `/[id]`, `/new`, `/bulk` | `lib/catalogDrafts/executors/trendyol.ts`, `pages/api/catalog-drafts/send.ts`, `components/domain/listing-editor/sections/Trendyol*` | Create, edit, price/stock and archive all reach Trendyol (async batches finished by cron). Create needs brand, category, barcode, cargo and addresses. The `MARKETPLACE_TRENDYOL` flag does **not** gate listings. Bulk: title, price, quantity. |
| `shopify-products` | Shopify ürün yönetimi | Shopify product management | Shopify | partial | all | `/app/shopify-urunler`, `/[id]`, `/new`, `/bulk` | `lib/catalogDrafts/executors/shopify.ts`, `components/domain/listing-editor/sections/ShopifyVariantsSection.tsx`, `ShopifySeoSection.tsx` | Create (as Draft or Active), product fields, single-variant price/SKU/stock, images and SEO. Price/stock edits are refused for multi-variant products and for stock spread across several locations. No AI in the editor. |
| `wix-products` | Wix ürün yönetimi | Wix product management | Wix | partial | all | `/app/wix-urunler`, `/[id]`, `/new`, `/bulk` | `lib/catalogDrafts/executors/wix.ts`, `components/domain/listing-editor/sections/Wix*` | Create, edit and delete products, collections, media and inventory. Refused: products with variants, discounted products, and toggling stock tracking. No AI in the editor. |
| `crosslist-etsy-ebay` | Etsy ↔ eBay ilan kopyalama | Cross-list Etsy ↔ eBay | Etsy, eBay | production | all | Grid row action "Copy to eBay" / "Copy to Etsy" | `components/domain/listings/config/etsy.ts`, `components/domain/listings/config/ebay.ts`, `crosslistEbayToEtsy.ts` | Lands as a draft. The price is cleared when currencies differ. |
| `crosslist-to-trendyol` | Etsy/eBay'den Trendyol'a kopyalama | Copy Etsy/eBay listing to Trendyol | Trendyol | partial | all | Trendyol › New › copy picker | `CatalogCopyPicker.tsx` | No row action. Cross-listing into Shopify/Wix works only by URL parameter; there is no UI entry point. |
| `listing-preview` | Pazaryeri önizleme | Marketplace page/search preview | Etsy, eBay | production | all | Editor › Preview | `components/domain/preview/`, `components/domain/MarketplacePreview.tsx` | Etsy and eBay only. |
| `amazon-listings` | Amazon ilan yönetimi | Amazon listing management | Amazon | none | n/a | none | `pages/api/integrations/amazon/*` (connect/status/messages only) | |
| `hb-n11-cs-listings` | Hepsiburada/N11/Çiçeksepeti ilanları | Hepsiburada/N11/Çiçeksepeti listings | Hepsiburada, N11, Çiçeksepeti | none | n/a | none | `lib/marketplaces/canonical.ts` (N11 only as a key) | |

### AI tools (Gemini)

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `ai-listing-copy` | Yapay zekâ ile başlık, açıklama, etiket | AI title / description / tags | Etsy, eBay, Trendyol | production | all | Listing editor AI buttons | `components/domain/listing-editor/useListingAI.ts`, `pages/api/ai/etsy.ts`, `pages/api/ai/trendyol.ts`, `pages/api/clawd/ebay-ai.ts` | Trendyol output is Turkish; Etsy keywords stay English. eBay also gets aspects, price and product identification. Not available for Wix or Shopify. |
| `ai-bulk-optimize` | Toplu AI optimizasyon | Bulk AI optimize | Etsy, eBay, Trendyol | production | all | Bulk editor › AI optimize | `components/domain/bulk/useBulkAi.ts`, `pages/api/ai/etsy.ts` (`bulk_optimize`) | |
| `ai-image-gen` | AI ürün görseli üretimi | AI product image generation | Etsy, eBay | production | all | Editor image manager; Photo studio | `pages/api/ai/generate-image.ts`, `components/domain/photo-studio/PhotoStudioPage.tsx` | Gemini image model, 2K. Not gated by plan in the editor. |
| `ai-alt-text` | AI alt metin | AI photo alt text | Etsy | production | all (bulk via Pro studio) | Editor photos; Photo studio | `pages/api/ai/etsy.ts` (`generate_alt_text`) | |
| `ai-message-draft` | AI ile yanıt taslağı | AI reply drafts | Wix, Trendyol | production | all | Messages › Draft with AI | `pages/api/messages/draft-reply.ts` | |
| `ai-research-explain` | AI ile araştırma açıklaması | AI research explain | Etsy, eBay | production | all | Research › Explain | `pages/api/research/explain.ts` | The UI says "1 credit", but credits are **not metered** (H-4). |
| `ai-amazon` | Amazon AI araçları | Amazon AI actions | Amazon | stub | n/a | none (no UI caller) | `pages/api/ai/amazon.ts` | Orphaned endpoint. |
| `ai-connector-mcp` | Kendi yapay zekânızı bağlayın (Claude, ChatGPT) | Connect your own AI (MCP connector for Claude and ChatGPT) | Etsy, eBay, Amazon, Trendyol, Hepsiburada, Wix, Shopify | production | all | Settings › AI; https://kolayxport.com/api/mcp | `pages/api/mcp/index.ts`, `lib/mcp/tools.ts`, `lib/mcp/listingTools.ts`, `lib/mcp/financeTools.ts`, `lib/mcp/orderData.ts`, `lib/mcp/tokens.ts`, `pages/oauth/authorize.tsx` | OAuth 2.1 or a personal key. Read tools for orders, listings, sales and finance; writes only stage drafts. Buyer names and addresses only with the opt-in, never Amazon, never e-mail or phone. finance_summary follows the Financials plan check. The AI image tool is off. |
| `ai-assistant` | Türkçe AI asistan | AI chat assistant | n/a | none | n/a | none | | Planned in navigation docs; not built. |

### Research & arbitrage

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `research-product-finder` | Ürün bulucu | Product finder | Etsy, eBay, Trendyol | production | all | `/app/research/products`, nav "Pazar araştırması / Research" (`g r`) | `components/domain/research/ResearchLayout.tsx`, `pages/app/research/products.tsx` | The Amazon tab is visible but disabled ("no source in v1"). |
| `research-keywords` | Anahtar kelime gezgini | Keyword explorer | Etsy, eBay | production | all | `/app/research/keywords` | `pages/app/research/keywords.tsx`, `components/domain/research` | Etsy calls share a daily Etsy API budget. |
| `research-listing-doctor` | İlan doktoru (SEO notu) | Listing doctor (SEO grader) | Etsy, eBay | production | all | `/app/research/listings` | `components/domain/research/listings/ListingDoctor.tsx`, `lib/research/hooks/useDoctor.ts` | Scores, peer checks and one-click staged fixes with AI titles. "Add tags in bulk" is disabled ("coming with keyword explorer"). |
| `research-shop-tracker` | Rakip mağaza takibi | Competitor shop tracker | Etsy, eBay | partial | all | `/app/research/shops` | `lib/research/watchAdapter.ts`, `pages/api/cron/research-snapshots.ts`, `components/domain/research/shops/AlertSwitches.tsx` | Watches and daily snapshots. Alert toggles may show "notifications start soon" (`alertsPending`). Watch limits are hardcoded (`RESEARCH_WATCH_LIMITS`). |
| `arbitrage-price-gap` | Trendyol→eBay fiyat farkı (arbitraj) | Trendyol→eBay price gap (arbitrage) | Trendyol, eBay | beta (Pro-gated) | Pro | Research › Products › "From Trendyol" | `components/domain/research/products/PriceGapTable.tsx`, `pages/api/research/price-gap.ts`, `lib/arbitrage/indexRefresh.ts` | The server enforces `requireFeature('arbitrage')`. Index refreshes every 6h with Gemini matching. Pro cannot be bought (H-1). The legacy full scanner is internal only (`pages/api/clawd/arbitrage.ts`). |
| `ext-research-overlay` | Tarayıcıda araştırma katmanı | In-browser research overlay | Etsy, eBay, Amazon | partial | all | Chrome extension | see Chrome extension section | |

### Stock sync

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `stock-sync` | Çok kanallı stok senkronu | Multi-channel stock sync | Etsy, eBay, Trendyol, Shopify write; Wix read-only by default | beta | all | `/app/stok-senkron`, nav "Stok senkronu / Stock sync" (shown with 2+ stores) | `lib/stock/engine.ts`, `lib/stock/adapters/index.ts`, `lib/stock/matching.ts`, `lib/stock/pushWorker.ts` | Off until the user runs the wizard, checks a dry run and goes live. Etsy updates come from webhooks (~1 min); Trendyol is polled about every 3 min, the others about every 15 min. Wix writes need `STOCK_WIX_WRITE_VERIFIED=1`. Amazon and Hepsiburada are "coming soon" stubs (their orders still reduce the stock pool). eBay legacy listings are excluded. Trendyol and eBay have no compare-and-set, so race risk remains. Global kill switch `STOCK_SYNC_GLOBAL_DISABLE`. Marked beta because it is new (migration dated 2026-10-15) and its safety depends on flags. |
| `stock-sku-matching` | SKU eşleştirme | SKU matching & generation | same | production (inside stock sync) | all | Stock sync wizard | `lib/stock/matching.ts`, `lib/stock/skuGen.ts`, `pages/api/stock/generate-skus.ts` | Exact matches link automatically. Loose and title matches are suggestions only. Generated Etsy SKUs are staged as drafts. |

### Finance & reports

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `reports-sales` | Satış raporu (ana sayfa) | Sales report (Home) | all order sources | production | all | `/app/analytics`, nav "Ana sayfa / Home" | `pages/app/analytics.tsx`, `components/domain/reports/sales/SalesReport.tsx`, `lib/reports/useSalesReport.ts` | Based on orders, so it includes Shopify, Wix and Hepsiburada orders. |
| `reports-profit` | Kâr raporu (net kâr, COGS, reklam) | Profit report (net profit, COGS, ad spend) | Etsy, eBay, Amazon, Trendyol | beta (Pro-gated) | Pro | `/app/reports/profit` (Home tabs, ⌘K) | `pages/api/finance/dashboard.ts`, `pages/api/finance/product-costs.ts`, `lib/finance/financialAutoSync.ts`, `components/domain/reports/ReportsPage.tsx` | Revenue minus commission, shipping, returns, discounts, ad spend, fees and COGS. COGS is entered manually. FX conversion included. Ad spend: Etsy, eBay, Amazon (not Trendyol). No Shopify/Wix finance. The gate is **UI-only** (H-5). |
| `reports-payouts` | Ödemeler raporu | Payouts report | Etsy, eBay, Amazon, Trendyol | beta (Pro-gated) | Pro | `/app/reports/payouts` | `components/domain/reports/payouts/PayoutsReport.tsx`, `pages/api/finance/settlements.ts` | Same gating caveat. |
| `reports-transactions` | İşlemler raporu | Transactions report | Etsy, eBay, Amazon, Trendyol | beta (Pro-gated) | Pro | `/app/reports/transactions` | `components/domain/reports/transactions/TransactionsReport.tsx`, `pages/api/finance/settlements.ts` | |
| `finance-auto-sync` | Otomatik finans senkronu | Automatic finance sync | Etsy, eBay, Amazon, Trendyol | production | (data for Pro tabs) | background | `pages/api/cron/sync-financials.ts`, `lib/finance/financialAutoSync.ts` | Every 6h over a 35-day window, plus a refresh when data is stale on load. |

### Messaging

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `inbox-unified` | Birleşik mesaj kutusu | Unified inbox | Wix (chat), Trendyol (customer Q&A) | beta | all | `/app/mesajlar`, nav "Mesajlar / Messages" (shown only if Wix or Trendyol is connected) | `components/domain/messages/MessagesPage.tsx`, `pages/api/messages/index.ts`, `pages/api/wix/messages.ts`, `types/messages.ts` | Users can reply. Shows product and order context. Saved replies and AI drafts. Rejected Trendyol answers come back to "needs reply". Beta because both sources follow the Wix/Trendyol env flags. **No Etsy, eBay or Amazon conversations.** |
| `msg-amazon-buyer` | Amazon alıcıya mesaj / yorum isteği | Amazon buyer message & review request | Amazon | production | all | Order panel › Message buyer | `pages/api/integrations/amazon/messages.ts`, `components/domain/orders/panel/MessageBuyerModal.tsx` | Outbound SP-API templates only. Cannot read replies. |

### Notifications

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `notification-center` | Bildirim merkezi | Notification center | all | production | all | `/app/bildirimler`, nav "Bildirimler", bell icon | `components/notification-center/NotificationCenterPage.tsx`, `lib/notificationCenter/registry.ts`, `lib/notificationCenter/channels/inApp.ts` | Events: new/cancelled orders, dispatch overdue/due, listing deactivated/expired/changed, draft conflicts, stock out/drift, research alerts, reauth needed, usage limits. Presets and per-type preferences. |
| `notify-email` | E-posta bildirimleri ve günlük özet | Email alerts & daily digest | all | production | all | Notifications › Preferences | `lib/notificationCenter/channels/email.ts` | Postmark. Instant sends or a daily digest, with quiet hours. |
| `notify-telegram` | Telegram bildirimleri | Telegram alerts | all | stub (UI) | n/a | Preferences shows "Yakında / Coming soon" | `components/notification-center/NotificationPreferencesPanel.tsx` (L411–426), `lib/notificationCenter/channels/telegram.ts` | A channel module exists, but the UI is inert. |

### Chrome extension

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `ext-etsy-research` | Etsy araştırma eklentisi | Etsy research overlay | Etsy | partial (distribution) | all | Chrome extension (no install path, H-7) | `chrome-extension/manifest.json` (v9.6.2), `chrome-extension/src/content-search.js`, `content-listing.js`, `content-shop.js`, `pages/api/ext/research.ts` | Overlays on search, listing and shop pages. The code works, but users cannot install it from the app (no Web Store link, stale zips). |
| `ext-ebay-amazon-research` | eBay/Amazon araştırma eklentisi | eBay/Amazon research overlay | eBay (7 domains), Amazon (.com, .com.tr, .de, .co.uk) | partial | all | same | `chrome-extension/manifest.json`, `pages/api/clawd/ebay-research.ts` | Amazon figures are DOM-only estimates (sales, BSR, competition). |
| `ext-etsy-address` | Etsy alıcı adresi aktarımı | Etsy buyer address capture | Etsy | partial (distribution) | metered (orderSync) | same | `chrome-extension/src/content.js`, `pages/api/integrations/etsy/addresses.ts` | Required for full Etsy shipping addresses, because the API withholds them. |
| `ext-etsy-tracking` | Etsy'ye takip no aktarımı | Etsy tracking push via extension | Etsy | partial | all | same | `chrome-extension/src/background-simple.js` (L220–232), `pages/api/integrations/etsy/tracking-confirm.ts` | |

### Billing / plans

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `billing-checkout` | Stripe ile abonelik | Stripe subscription checkout | n/a | production | n/a | `/fiyatlandirma`, `/ayarlar?tab=billing` | `pages/api/stripe/create-checkout-session.ts`, `components/domain/pricing/useCheckout.ts`, `lib/stripePrices.ts` | Only Starter and Growth can be bought. Pro is rejected (H-1). Currency and founding-offer fields from the UI are ignored by the server. |
| `billing-portal-invoices` | Fatura geçmişi ve abonelik yönetimi | Billing portal & invoice history | n/a | production | paid | `/ayarlar?tab=billing`, `/faturalar` | `pages/api/stripe/create-portal-session.ts`, `pages/api/stripe/billing-history.ts`, `components/domain/billing/BillingPanel.tsx` | Hidden for Shopify-free accounts. |
| `usage-meters` | Kullanım sayaçları | Usage meters & limit alerts | n/a | production | all | Sidebar footer; Billing › Usage | `lib/middleware/withUsageLimiter.ts`, `lib/billing/planLimits.ts`, `components/domain/billing/UsageCard.tsx` | Meters order syncs and labels only. Near-limit and limit-reached notifications. |
| `shopify-free` | Shopify mağazaları için ücretsiz | Free for Shopify App Store installs | Shopify | production | shopify_free | Shopify App Store install | `pages/api/integrations/shopify/callback.ts`, `lib/billing/requireFeature.ts` | Unlimited meters. Pro features OFF. Pricing and upsell hidden (App Store rule 1.2.1). |

### Onboarding & help

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `help-getting-started` | Nasıl kullanırım (8 adım) | Getting-started guide | n/a | production | all | `/app/nasil-kullanirim`, nav "Yardım / Help" | `pages/app/nasil-kullanirim.tsx` | Eight linked steps. No per-integration guides (H-8). |
| `onboarding-checklist` | Kurulum kontrol listesi | Setup checklist / Overview | n/a | stub (hidden) | all | Only at `/app?ui=overview`; `/app` redirects to `/app/analytics` | `components/domain/overview/SetupChecklist.tsx`, `pages/app/index.js`, `next.config.js` (L114–122) | Built but not reachable from the navigation (H-6). |
| `command-palette` | ⌘K komut paleti ve kısayollar | ⌘K command palette & `g` shortcuts | n/a | production | all | ⌘K / `?` anywhere | `components/ds/shell/CommandPalette.tsx`, `components/ds/shell/ShortcutSheet.tsx`, `lib/nav/navConfig.ts` | |
| `mobile-shell` | Mobil uyumlu arayüz | Mobile app shell (tab bar, pull-to-refresh) | n/a | production | all | any page on a phone | `components/ds/shell/MobileTabBar.tsx`, `components/ds/shell/usePullToRefresh.ts` | Photo studio is excluded on mobile (<900px). |

### Account / settings

| ID | Name (TR) | Name (EN) | Marketplaces/carriers | Maturity | Plan tier | Where users find it | Proof | Notes/limits |
|---|---|---|---|---|---|---|---|---|
| `settings-connections` | Mağaza ve kargo bağlantıları | Store & carrier connections | all | production | all | `/ayarlar?tab=connections` | `lib/settings/integrations.ts`, `lib/integrations/connectionStatus.ts`, `components/domain/settings/connections/*` | OAuth: Etsy (multi-shop), eBay, Amazon (marketplace picker), Shopify. Wix is an app install. API keys: Trendyol, Veeqo, Shippo, FedEx, UPS, DHL eCommerce, Paraşüt. Hepsiburada is "set up by support". Shows a reauth badge. |
| `settings-sync-health` | Senkron geçmişi ve hatalar | Sync history & errors | all | production | all | `/ayarlar?tab=syncAdvanced` | `components/domain/settings/refresh/RefreshOverview.tsx`, `SyncErrorsPanel.tsx` | |
| `settings-preferences` | Dil ve saat dilimi | Language (TR/EN) & timezone | n/a | production | all | `/ayarlar?tab=preferences` | `components/domain/settings/PreferencesPanel.tsx` | Full EN/TR i18n. |
| `auth` | Kayıt, Google ile giriş, e-posta doğrulama, şifre sıfırlama | Sign-up, Google login, email verification, password reset | n/a | production | all | `/login`, `/auth/*` | `lib/auth.ts`, `pages/api/auth/signup.ts`, `pages/api/auth/verify-email.ts`, `pages/api/auth/request-reset.ts` | |

Internal/admin (not for marketing): `pages/admin/*` (dashboard, monitoring) and the `pages/api/clawd/*` agent API (key-authenticated). Some `clawd` endpoints are still called by UI components (eBay AI, variation editors), which is an internal-auth inconsistency.

---

## 2. Per-marketplace capability matrix

| Marketplace | Connect method | Order sync | Listing create/edit | Bulk edit | Stock sync | Tracking push | Labels | Finance | Messages | Research | Extension overlay |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Etsy** | OAuth, multi-shop | ✓ (address needs extension) | ✓ full | ✓ (+ Pro photo studio) | ✓ (webhook-driven) | partial (Chrome extension only) | ✓ via FedEx/UPS/DHL eC | ✓ (incl. ad spend) | ✗ | ✓ all tools | ✓ |
| **eBay** | OAuth | ✓ | partial (Seller Hub "legacy" listings not editable) | ✓ (title/price/qty) | ✓ (not legacy) | ✓ | ✓ | ✓ (incl. ad spend) | ✗ | ✓ all tools | ✓ |
| **Amazon** | OAuth (SP-API, marketplace picker) | ✓ | ✗ | ✗ | ✗ (stub; orders still decrement pool) | ✓ (feed) | ✓ | ✓ (incl. ads) | partial (outbound templates + review request only) | ✗ (tab disabled) | partial (DOM estimates) |
| **Trendyol** | API key + supplier ID | partial (env flag `MARKETPLACE_TRENDYOL` + allowlist) | ✓ (create/edit/archive) | ✓ (title/price/qty) | ✓ (no CAS) | ✗ | ✓ (DHL eC domestic) | ✓ (no ad spend) | partial (customer Q&A; env-flagged) | partial (home + products, arbitrage source) | ✗ |
| **Shopify** | OAuth (App Store) | ✓ | partial (multi-variant/multi-location price & stock refused; no AI) | ✓ (title/price/qty/tags) | ✓ | ✗ (client exists, unwired) | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Wix** | App install | partial (env flag `MARKETPLACE_WIX`) | partial (no variant/discounted products; no AI) | ✓ (title/price/qty) | partial (read-only unless `STOCK_WIX_WRITE_VERIFIED`) | ✓ (follows the Wix flag) | ✓ | ✗ | partial (chat; env-flagged) | ✗ | ✗ |
| **Hepsiburada** | "Set up by support" (no self-serve) | ✗ (no sync code) | ✗ | ✗ | ✗ (coming-soon stub) | ✗ | n/a | ✗ | ✗ | ✗ | ✗ |
| **N11** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Çiçeksepeti** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Veeqo** | API key | ✓ (import) | ✗ | ✗ | ✗ | ✓ (for Veeqo-sourced orders) | ✗ (no Veeqo labels) | ✗ | ✗ | ✗ | ✗ |
| **Shippo** | API token | ✓ (import) | ✗ | ✗ | ✗ | ✗ | ✗ (no Shippo labels) | ✗ | ✗ | ✗ | ✗ |

"Labels ✓" means orders from that marketplace can get a FedEx, UPS or DHL eCommerce label inside KolayXport. It does not mean marketplace-purchased labels (for example, Etsy postage is not supported).

## 3. Carrier matrix

| Carrier | Label create | Customs docs | Tracking | Cancel/void | Domestic / international |
|---|---|---|---|---|---|
| **FedEx** | ✓ (user's own FedEx account; International Priority/Economy) | ✓ ETD electronic commercial invoice | number stored and pushed to the marketplace; no status tracking | manual (portal link) | international only |
| **UPS** | ✓ (user's own UPS account; services 65/07/54/08/11) | ✓ EDI commercial invoice, IOSS/VAT checks | number stored and pushed; no status tracking | manual (portal link) | international only |
| **DHL eCommerce (MNG Kargo)** | ✓ (Standard/Express/Same-day, cash on delivery, SMS) | n/a | ✓ via API | ✓ via API | Turkey domestic only |
| **Yurtiçi Kargo** | ✗ | ✗ | name only, for manual tracking entry | ✗ | n/a |
| **Aras Kargo** | ✗ | ✗ | name only | ✗ | n/a |
| **Sürat Kargo** | ✗ | ✗ | name only | ✗ | n/a |
| **Trendyol Express** | ✗ | ✗ | name only | ✗ | n/a |
| **PTT** | ✗ | ✗ | ✗ (not even listed) | ✗ | n/a |
| **DHL Express, USPS, Royal Mail, DPD** | ✗ | ✗ | name only (manual entry, mapped for eBay) | ✗ | n/a |
| **Shippo / Veeqo (as label brokers)** | ✗ | ✗ | ✗ | ✗ | n/a |

Proof: `lib/shipping/carriers.ts`, `lib/shipping/trackingCarriers.ts`, `pages/api/shipments/[shipmentId]/void.ts`, `pages/api/labels/mng.ts`.

---

## 4. Do NOT claim publicly

| # | Claim to avoid | Why | Paths |
|---|---|---|---|
| N-1 | "Hepsiburada / N11 / Çiçeksepeti entegrasyonu" | Hepsiburada has no order, listing or stock code (stock is a coming-soon stub). N11 is only a logo key. Çiçeksepeti does not exist. | `lib/settings/integrations.ts` (readonly HB), `lib/stock/adapters/hepsiburada.ts`, `lib/marketplaces/canonical.ts` |
| N-2 | "Yurtiçi, Aras, Sürat, PTT ile etiket" / "tüm Türk kargo firmaları" | They exist only as names in the manual-tracking dropdown. The only domestic label carrier is DHL eCommerce (MNG). | `lib/shipping/trackingCarriers.ts` |
| N-3 | "ETGB'yi otomatik beyan ediyoruz" / "gümrük beyannamesi" | It is an Excel file emailed to a broker. The exporter name, tax number and default HS code are hardcoded to one company (TAMSAR TEKSTİL), so it is wrong for every other customer until that is fixed. | `lib/services/etgbExcelService.ts` (L228–247) |
| N-4 | "Otomatik e-Fatura / e-Arşiv kesimi" | Paraşüt invoicing runs only as a side effect of ETGB, has no UI, and swallows errors. | `lib/services/etgbService.ts` (L96–105), `lib/services/invoiceService.ts` |
| N-5 | "Amazon ilanlarını yönetin" / "Amazon stok senkronu" | No listing editing. The stock adapter is a stub. | `lib/stock/adapters/amazon.ts`, `pages/api/integrations/amazon/*` |
| N-6 | "Etsy'ye takip numarası otomatik gider" (without a caveat) | It needs the Chrome extension, which has no public install path. | `pages/api/orders/[orderId]/submit-tracking.ts`, `chrome-extension/README` |
| N-7 | "Takip numarası Trendyol/Shopify'a otomatik yüklenir" | Not wired. Numbers are saved locally only. | `lib/shipping/labelDraft.ts` (L291) |
| N-8 | "Tüm eBay ilanlarınızı düzenleyin" | Seller Hub-created (legacy) listings are refused. | `lib/ebay/legacy.ts`, `lib/ebay/draftService.ts` |
| N-9 | "Etsy, eBay, Amazon mesajları tek kutuda" | The inbox is Wix + Trendyol Q&A only. | `types/messages.ts`, `pages/api/messages/index.ts` |
| N-10 | "AI kredisi", "X AI kredisi dahil", "N mağaza bağlayın" as enforced plan limits | AI credits and store counts are not metered. They are decided values only. | `lib/billing/planLimits.ts` (`DECIDED_PLAN_LIMITS`, `ENFORCEMENT_GAP`) |
| N-11 | "Pro plan" as purchasable, or "14 gün ücretsiz deneme" | Pro checkout is rejected. Stripe sign-up and checkout trials are 30 days (Shopify installs get 14). | `pages/api/stripe/create-checkout-session.ts` (L35–47, L218), `pages/api/auth/signup.ts` (L49) |
| N-12 | "Chrome Web Mağazası'ndan yükleyin" | Not published. The README says "coming soon". The repo zips are v5.x while the manifest is v9.6.2. | `chrome-extension/manifest.json`, `messages/tr.json` (`integrations.chromeStoreComing`) |
| N-13 | "Yurt içi FedEx/UPS" | Both are international only in code. | `lib/shipping/carriers.ts` (L34–40) |
| N-14 | "Kargo takibi (FedEx/UPS durum güncellemeleri)" | Only MNG status is fetched from a carrier. | `pages/api/labels/mng.ts` |
| N-15 | "Shippo/Veeqo üzerinden indirimli etiket" | No label purchase through them. | `lib/integrations/shippo.ts`, `lib/integrations/veeqo.ts` |
| N-16 | "Shopify/Wix finans/kâr raporu" | Finance sync covers Etsy, eBay, Amazon and Trendyol only. | `lib/finance/financialAutoSync.ts` |
| N-17 | "Amazon ürün araştırması" | The Research Amazon tab is disabled. Only the extension gives DOM estimates. | `components/domain/research/ResearchLayout.tsx` |
| N-18 | "AI asistan / sohbet" | Not built. | none |
| N-19 | "Telegram bildirimleri" | The UI says "Yakında". | `components/notification-center/NotificationPreferencesPanel.tsx` |
| N-20 | "Wix/Shopify için AI ilan yazımı" | The editor has no AI for them (v1). | `components/domain/listing-editor/useListingAI.ts` (header) |

## 5. Under-marketed strengths

Production features that make a strong case for Turkish cross-border sellers:

1. **Staged drafts + conflict protection** (`staged-drafts-send`): "Değişiklikleriniz önce taslakta kalır; siz 'Gönder' demeden pazaryerine hiçbir şey gitmez, başkası ilanı değiştirdiyse sizi uyarırız."
2. **Scheduled sends across five marketplaces** (`scheduled-send`): "İlan güncellemelerinizi istediğiniz saate planlayın; Etsy, eBay, Trendyol, Shopify ve Wix'e kendiliğinden gitsin."
3. **Etsy ↔ eBay cross-listing in one click** (`crosslist-etsy-ebay`): "Etsy ilanınızı tek tıkla eBay'e (ya da tersine) kopyalayın, fotoğraf ve varyasyonlarıyla."
4. **Copy listings between your own Etsy shops** (`etsy-copy-to-shop`): "İkinci Etsy mağazanızı dakikalar içinde doldurun: ilanları varyasyon, fotoğraf ve videosuyla kopyalayın."
5. **Listing version history and restore** (`etsy-version-history`): "Yanlış bir düzenleme mi yaptınız? İlanın önceki sürümüne tek tıkla dönün."
6. **Paperless commercial invoice with FedEx/UPS** (`customs-commercial-invoice`): "Yurt dışı gönderilerde ticari fatura etiketle birlikte elektronik gider; çıktı ve zarf derdi yok."
7. **DHL eCommerce domestic labels with cash on delivery, same-day delivery and tracking/cancel** (`label-dhl-ecommerce`): "Yurt içi siparişlerinize DHL eCommerce (MNG) etiketini kapıda ödeme seçeneğiyle panelden basın, iptal edin, takip edin."
8. **Bulk labels with automatic carrier routing** (`labels-bulk`): "Yüzlerce siparişi seçin; yurt içi olanlar DHL eCommerce'e, yurt dışı olanlar FedEx/UPS'e otomatik ayrılsın."
9. **Pick list + packing slips** (`orders-pick-packing`): "Toplama listesi ve paketleme fişlerini tek tıkla yazdırın, depoda hata yapmayın."
10. **Trendyol listing management with Turkish AI** (`trendyol-products`, `ai-listing-copy`): "Trendyol ürünlerinizi Türkçe yapay zekâ ile oluşturun ve güncelleyin."
11. **Listing doctor** (`research-listing-doctor`): "İlanınıza SEO notu verelim, eksikleri rakiplerle karşılaştırıp tek tıkla düzeltelim."
12. **Real net profit across Etsy/eBay/Amazon/Trendyol, including ad spend** (`reports-profit`): "Komisyon, kargo, reklam ve ürün maliyeti düşülmüş gerçek kârınızı pazaryeri bazında görün." (Pro; see H-1.)
13. **Overdue-dispatch and stock alerts by email digest** (`notification-center`, `notify-email`): "Geciken kargo, tükenen stok ve kapanan ilanlar için günlük e-posta özeti alın."
14. **Amazon review request from the order** (`msg-amazon-buyer`): "Amazon siparişinden tek tıkla yorum isteği gönderin."
15. **⌘K + mobile shell** (`command-palette`, `mobile-shell`): "Telefondan da tam kullanım; klavyeyle her sayfaya saniyede ulaşın."
16. **Free for Shopify App Store installs** (`shopify-free`): "Shopify mağazanız için sipariş ve etiket limitleri olmadan ücretsiz."

## 6. Half-built / inconsistent

| # | Issue | Detail | Paths |
|---|---|---|---|
| H-1 | **Pro is shown but not purchasable** | The pricing page renders a Pro card with a checkout CTA, and `seePlansHref` sends locked features to `?plan=pro`. The server only accepts `starter`/`growth` (`STRIPE_PRICES` has no pro), so Pro checkout fails with "Invalid plan". The middleware also has no `pro` plan: an active Pro user would get `invalidPlan`, which blocks all syncs and labels. As a result, arbitrage, profit/payouts/transactions and the bulk photo studio cannot be bought at all; only trial users get them. | `pages/api/stripe/create-checkout-session.ts` (L35–47), `lib/stripePrices.ts`, `lib/middleware/withUsageLimiter.ts` (L17–25), `components/domain/pricing/pricingModel.ts`, `lib/billing/featureMap.ts` |
| H-2 | **Enforced vs decided plan limits** | The pricing page displays the *decided* limits (Starter 500 orders/250 labels, Growth 2000/1000, Pro 6000/3000, plus store and AI credit counts). The server enforces Starter 200 sync **calls**/100 labels, Growth 2000/500, and Trial 50/10. It counts API sync calls, not orders. | `lib/billing/planLimits.ts` (`ENFORCED_*`, `DECIDED_PLAN_LIMITS`, `ENFORCEMENT_GAP`) |
| H-3 | **Trial is 30 vs 14 days** | Sign-up and Google login set 30 days, and Stripe checkout `trial_period_days: 30`. Decided is 14 + 3 grace days. Shopify installs use 14. | `pages/api/auth/signup.ts` (L49), `lib/auth.ts` (L56), `pages/api/stripe/create-checkout-session.ts` (L218), `lib/billing/planLimits.ts` (L179), `pages/api/integrations/shopify/callback.ts` (L55) |
| H-4 | **AI credits and store limits not metered** | The UI mentions credits ("Explain · 1 credit"), and pricing lists AI credits and store counts. Only in-memory per-minute rate limits exist. | `pages/api/ai/etsy.ts` (L15), `pages/api/research/explain.ts`, `components/domain/settings/connections/useStoreAllowance.ts` |
| H-5 | **The `financials` gate is UI-only** | `ReportsPage` locks the tabs, but `pages/api/finance/*` has no `requireFeature`. (Arbitrage and bulk photo studio are enforced on the server.) | `components/domain/reports/ReportsPage.tsx`, `pages/api/finance/dashboard.ts`, `pages/api/finance/settlements.ts` |
| H-6 | **Onboarding checklist is hidden** | The Overview with the setup checklist exists, but `/app` redirects to `/app/analytics`. It is only reachable at `/app?ui=overview`. New users see an empty sales report first. | `next.config.js` (L114–122), `pages/app/index.js`, `components/domain/overview/SetupChecklist.tsx` |
| H-7 | **Chrome extension has no install path** | The Settings "Chrome extension" tile links to `/app/entegrasyonlar-ve-rehberler#etsy-guide`, which redirects to Help. Help's extension step links back to Settings, so the user loops and never reaches a download. Zips are v5.x, the manifest is v9.6.2, and there is no Web Store listing. Etsy addresses and tracking push depend on it. | `lib/settings/integrations.ts` (L180), `pages/app/entegrasyonlar-ve-rehberler.js`, `pages/app/nasil-kullanirim.tsx`, `chrome-extension/manifest.json` |
| H-8 | **"View setup guide" links go nowhere specific** | Every integration's `guideHref` points at the old guides route, which now redirects to the generic 8-step help. There are no per-provider guides; `howToUse.otherGuidesTitle` says "Yakında". | `lib/settings/integrations.ts` (`GUIDE`), `pages/app/entegrasyonlar-ve-rehberler.js` |
| H-9 | **"Add tracking" offered where it can't push** | Trendyol, Shopify and Hepsiburada orders still show "Add tracking", which only saves locally. A failed push returns HTTP 200, and the UI reads the message text to tell success from failure. | `components/domain/orders/panel/OrderPanel.tsx` (L189), `lib/shipping/labelDraft.ts` (L291), `lib/shipping/trackingCarriers.ts` |
| H-10 | **ETGB hardcoded to one exporter** | See N-3. It also has no usage limiter or plan check. | `lib/services/etgbExcelService.ts`, `pages/api/etgb/process.ts` |
| H-11 | **Founding offer and currency are UI-only** | The pricing UI sends `currency` and `expectFounding` and polls `/api/billing/founding-spots`. That endpoint does not exist (the founding line stays hidden), and the server ignores currency (one env price per plan and interval). `/api/billing/entitlement` is also missing; the UI falls back to `/api/user/settings`, so the store meter never shows. | `lib/billing/useFoundingSpots.ts`, `lib/billing/entitlementCore.ts`, `pages/api/stripe/create-checkout-session.ts` |
| H-12 | **Pro feature previews missing** | `PREVIEW_READY` is all false, so locked states show no screenshot. | `lib/billing/featureMap.ts` |
| H-13 | **Unmetered sync paths** | `/api/orders/fullSync` (which also skips Trendyol, Wix and Shopify) and the cron sync bypass the usage limiter. | `pages/api/orders/fullSync.ts`, `pages/api/cron/sync-orders.ts` |
| H-14 | **Duplicate/dead FedEx route** | `pages/api/shipments/index.ts` creates FedEx shipments with a "very minimal payload" TODO and no limiter. No UI calls it. | `pages/api/shipments/index.ts` (L44) |
| H-15 | **Hepsiburada shown as an integration** | It is listed as a store provider in nav gating and Connections ("set up by support"), but nothing works behind it. | `lib/nav/navConfig.ts` (`STORE_PROVIDERS`), `lib/settings/integrations.ts` (L128) |
| H-16 | **Messages and Trendyol/Wix order sync depend on prod env flags** | `MARKETPLACE_TRENDYOL` and `MARKETPLACE_WIX` default to off. Trendyol and Wix listings are *not* flagged, so a seller could edit Trendyol products while Trendyol orders don't sync. The owner must confirm the VPS values before these are marketed as GA. | `lib/config.ts` (L48–85) |
| H-17 | **Shop tracker alerts may say "start soon"** | `alertsPending` copy is shown when alerts aren't available. | `components/domain/research/shops/AlertSwitches.tsx` (L74) |
| H-18 | **Orphan AI endpoints** | `pages/api/ai/amazon.ts` (9 actions) and 6 of the 11 Etsy AI actions (market analysis, niche report, shop spy, audit, review sentiment, price recommendation) have no UI. | `pages/api/ai/amazon.ts`, `pages/api/ai/etsy.ts` |
| H-19 | **Bulk "add tags" disabled** in the listing doctor | Shows "Etiket önerileri Anahtar kelime gezgini ile gelecek". | `components/domain/research/listings/ListingDoctor.tsx` (L330) |
| H-20 | **Legacy `/app/senkron`** | Redirect stub to Orders. Old marketing links to "üretim listesi" are dead. | `pages/app/senkron.js` |
| H-21 | **Billing "detailed usage" placeholder** | `billing.usage.soon` is shown in fallback mode. | `components/domain/billing/UsageCard.tsx` (L137) |


## 7. Changes on branch `gtm/overhaul` (2026-10-17)

These rows changed after the audit above. The fixes are committed and tested locally; they go live with the merge to `main`.

| Item | Before | Now | Commit |
|---|---|---|---|
| H-1 Pro purchasable | Checkout accepted only starter/growth; `pro` was `invalidPlan` in the limiter | Pro checkout (`PRICE_PRO_*`), limiter knows `pro` | d446f0a |
| H-2 Enforced vs decided limits | 50/10, 200/100, 2000/500 | Trial 150/30, Starter 500/250, Growth 2000/1000, Pro 6000/3000 (order meter still counts sync calls) | d446f0a |
| H-3 Trial length | 30 days | 14 days + 3 grace everywhere; Stripe carries over the remaining trial | af08f85 |
| H-5 Financials gate | UI only | `requireFeature('financials')` on `/api/finance/*` | d77f996 |
| `etgb-excel-email` / N-3 | Exporter hardcoded to one company | Exporter name, VKN, default GTIP and origin from each seller's Gönderici profile; refuses when missing. Still an Excel file emailed to the broker, **not** a customs filing | 6cdd6fa |
| Founding-member offer | Pricing UI only, no backend | `/api/billing/founding-spots` + coupon applied at checkout (`STRIPE_FOUNDING_COUPON_ID`) | d446f0a |
| Signup intent | `/login?mode=signup` ignored | Opens the signup form | 20ef38b |
| H-2 / G3 Order meter | +1 per sync call | Counts **new orders** imported by manual and extension syncs (scheduled syncs not metered yet) | fc1040c |
| G10 Promotion codes | No code field at checkout | Stripe promotion-code field whenever the founding coupon doesn't apply | fc1040c |
| Pricing copy | FAQ claimed scheduled imports pause at 110% and AI pauses | Describes only what is enforced (manual imports + labels pause at the limit) | 17fc956 |
| Public pricing page | MUI app page (Lighthouse perf 74) | Server-rendered site page `/fiyatlandirma` + `/en/fiyatlandirma`; signed-in → `/plan` (checkout) | 17fc956 |
