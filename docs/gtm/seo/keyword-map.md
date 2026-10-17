# KolayXport keyword map (TR primary)

- **Date:** 2026-10-17
- **Inputs:** [positioning.md](../positioning.md) (decision A+C), [pain-points.md](../pain-points.md) §(2) keyword lists, [feature-inventory.md](../feature-inventory.md), [competitors.md](../competitors.md), [site-audit.md](../site-audit.md).
- **Rule:** one primary keyword per URL. A keyword that appears as *primary* on one page must not be primary or the H1 topic of another. Secondaries may overlap only where noted, and then only as a supporting phrase with a link to the owning page.

## How demand was checked (and what was not)

- **No numeric search volumes are given anywhere in this file.** We had no access to Google Ads Keyword Planner, Ahrefs or Semrush. Every volume is **unverified**.
- **Google Trends** pages are JS-rendered and were not readable with the tools used, so no Trends comparison was made. Recommended next step: compare the primary keywords of the six `/cozumler/*` pages in Trends (Türkiye, 12 months) before the ad budget is split.
- **Google autocomplete** (suggestqueries.google.com, `hl=tr`, `gl=tr`, queried 2026-10-17) was used as a weak, public signal that a phrasing is searched at all. It is *not* a volume measure. In the table:
  - **AC✓** = the exact phrase (or a near-identical one) appeared as an autocomplete suggestion.
  - **AC✗** = the phrase did not appear for its own prefix. Treat as low or unknown demand. It can still be worth targeting if it matches seller language from pain-points.md.
  - **—** = not checked.
- Autocomplete observations worth knowing:
  - "etsy satış gelmiyor" and "etsy satış yok" return **no suggestions**; "etsy görüntülenme alamıyorum / arttırma / sorunu" do. Sellers describe the problem as *visibility*, so the pain post leads with the forum phrasing but carries "görüntülenme" as a secondary.
  - "etsy kar hesaplama" has many variants (2026, aracı, excel, kar marjı, dijital ürün), and "etsy komisyon hesaplama / oranları 2026" also appear. Fee/profit intent is clearly searched.
  - "mikro ihracat sınırı 2026", "mikro ihracat faturası nasıl kesilir (e arşiv)", "mikro ihracat kdv iadesi", "etgb nedir", "etgb limitleri" all appear.
  - "trendyol e ihracat nasıl yapılır" appears under "e-ihracat nasıl yapılır". "trendyol dan ebay" and "trendyol'dan alıp ebay'de satmak" do **not** appear; "trendyol dan ürün alıp satmak" does.
  - "ebay ürün araştırması nasıl yapılır" and "ebay ürün araştırma yazılımı" appear; "etsy ürün araştırma programı", "etsy pazar araştırması", "etsy kelime araştırma" appear.
  - Competitor brand + "alternatifi" (sentos/entegra/prapazar) returns **nothing** in TR. "erank alternative / erank alternatives / erank free alternative" appear (EN), and TR has "erank nasıl kullanılır", "erank ücretli mi", "erank fiyat".
  - "kolayxport" returns no brand suggestions yet (suggests "kolay ekspres"). Brand demand is effectively zero, so non-brand pages carry acquisition.

## Intent legend

- **Problem**: the searcher has a pain and no solution in mind.
- **Info**: wants to learn how something works (rules, fees, how-to).
- **Commercial**: comparing tools or looking for software.
- **Transactional**: ready to sign up or buy.
- **Navigational**: looking for a specific brand or page.

## 1. Core pages

| URL | Primary keyword | Secondary (3–5) | Intent | Why this page / notes |
|---|---|---|---|---|
| `/` | e-ihracat yönetim paneli (AC✗, unverified) | yurtdışına satış yapmak (AC✓); etsy ebay amazon tek panel (—); yurtdışına satış nasıl yapılır (AC✓); e-ihracat programı (—) | Commercial | Matches the brand line "Yurt dışına satışın tek paneli". Head terms like "yurtdışına satış" are mixed-intent (many results are guides and marketplaces), so the home page targets the tool phrasing and links out to the six `/cozumler/*` pages. Do **not** put "pazaryeri entegrasyonu" here (Option B, rejected). |
| `/fiyatlandirma` | kolayxport fiyatları (navigational; brand demand ≈ 0 today) | e-ihracat yazılımı fiyat (—); etsy entegrasyon fiyatları (—); pazaryeri entegrasyonu fiyatları (—) | Transactional | Price pages rank mainly for brand terms. The secondaries exist to catch "how much does an Etsy integrator cost" searches; the page must not promise anything from feature-inventory §4 (e.g. N-10 AI credits as enforced limits, N-11 trial length). |

## 2. Use-case pages (`/cozumler/*`)

| URL | Primary keyword | Secondary (3–5) | Intent | Why / notes |
|---|---|---|---|---|
| `/cozumler/etsy-satici` | etsy mağaza yönetimi (—, unverified) | etsy toplu fiyat güncelleme (AC✓); etsy toplu ürün yükleme (AC✓); etsy satış paneli (AC✓, ambiguous: may mean Etsy's own Shop Manager); etsy ilan oluşturma (AC✓) | Commercial | Core ICP page (Option A). Proof: `etsy-listing-editor`, `etsy-bulk-editor`, `staged-drafts-send`, `etsy-copy-to-shop`, `order-sync-etsy`. "etsy toplu …" phrasings are AC✓ and tool-intent, so they sit here as secondaries; a how-to guide can own the long-tail version (see §5). |
| `/cozumler/ebay-satici` | ebay satış yapmak (AC✓) | ebay satış yapmak için ne gerekli (AC✓); ebay ilan oluşturma (—); etsy ebay ilan kopyalama (—); ebay toplu ilan düzenleme (—) | Commercial / Info | AC shows both "ebay satış yapmak" and "… için ne gerekli": mixed intent, so the page needs a short "what you need" block above the product pitch. Proof: `ebay-listing-create`, `ebay-bulk-editor`, `crosslist-etsy-ebay`, `order-sync-ebay`, `tracking-push-ebay`. Must state N-8 (Seller Hub "legacy" listings cannot be edited). |
| `/cozumler/trendyoldan-dunyaya` | trendyol e ihracat nasıl yapılır (AC✓) | trendyol ürünlerini yurtdışında satmak (—); trendyol dan ürün alıp satmak (AC✓, see caution); trendyol etsy (—); e-ihracat nasıl yapılır (AC✓) | Info → Commercial | Option C track. Proof: `trendyol-products`, `stock-sync` (beta), `crosslist-etsy-ebay`, `arbitrage-price-gap` (beta, Pro). **Caution:** "trendyol dan ürün alıp satmak" implies retail arbitrage, which eBay's drop-shipping policy forbids; the page must answer it honestly (own catalog / wholesale), not promise it. Confirm `MARKETPLACE_TRENDYOL` before ads (H-16). |
| `/cozumler/mikro-ihracat-kargo-etgb` | mikro ihracat kargo (—, unverified) | fedex etiket oluşturma (—; "fedex etiket" AC✓); ups etiket oluşturma (—); elektronik ticari fatura fedex ups (—); yurtdışı kargo gönderme (AC✓) | Commercial | Proof: `label-fedex`, `label-ups`, `customs-commercial-invoice`, `labels-bulk`. **Blocked for ETGB claims** until the hard-coded exporter is fixed (N-3, H-10). Until then, keep "ETGB" out of the H1/title and lead with labels + paperless commercial invoice. Informational ETGB terms ("etgb nedir", "mikro ihracat sınırı 2026") belong to the blog, not here (see conflicts). |
| `/cozumler/ai-ilan-optimizasyonu` | etsy seo yapay zeka (AC✓) | etsy başlık oluşturma (AC✓); etsy etiket bulma (AC✓); etsy ürün fotoğrafı yapay zeka (—); ebay ilan yapay zeka (—) | Commercial | Proof: `ai-listing-copy`, `ai-bulk-optimize`, `ai-image-gen`, `ai-alt-text`, `research-listing-doctor`. Must not claim AI for Wix/Shopify (N-20). Note: "etsy etiket bulma" is also a natural fit for the research page; it lives **here** because the page writes tags, the research page finds keywords. |
| `/cozumler/urun-arastirma-arbitraj` | etsy ürün araştırma (AC✓) | etsy ürün araştırma programı (AC✓); ebay ürün araştırma yazılımı (AC✓); etsy anahtar kelime bulma (AC✓); etsy rakip analizi (AC✓) | Commercial | Proof: `research-product-finder`, `research-keywords`, `research-listing-doctor`, `research-shop-tracker` (partial), `arbitrage-price-gap` (beta, Pro). Must not claim Amazon product research (N-17). |

## 3. Integration pages (`/entegrasyonlar/*`)

| URL | Primary keyword | Secondary (3–5) | Intent | Why / notes |
|---|---|---|---|---|
| `/entegrasyonlar` | e-ihracat entegrasyonları (—) | etsy ebay amazon entegrasyonu (—); kargo entegrasyonu fedex ups (—); pazaryeri ve kargo entegrasyonları (—) | Commercial / Navigational | Hub page. Deliberately avoids "pazaryeri entegrasyonu" as primary: that query is dominated by domestic integrators (AC shows "ücretsiz pazaryeri entegrasyonu", ticimax/ikas variants) and we lack Hepsiburada/N11/Çiçeksepeti (N-1). |
| `/entegrasyonlar/etsy` | etsy entegrasyon (AC✓) | etsy entegratör (AC✓); etsy sipariş yönetimi (—); etsy stok senkronizasyonu (—); shopify etsy entegrasyonu (AC✓) | Commercial | Proof: `order-sync-etsy`, `etsy-listing-editor`, `stock-sync` (beta). Do **not** target "etsy fatura entegrasyonu" (AC✓): our only invoice path is Paraşüt via the ETGB flow (N-4). Address and tracking need the extension (N-6, H-7): say so. |
| `/entegrasyonlar/ebay` | ebay entegrasyon (AC✓, few variants) | ebay sipariş yönetimi (—); ebay ilan yönetimi (—); ebay stok senkronizasyonu (—) | Commercial | Proof: `order-sync-ebay`, `ebay-listing-editor` (partial, N-8), `tracking-push-ebay`. |
| `/entegrasyonlar/amazon` | amazon sipariş entegrasyonu (—) | amazon sp-api entegrasyonu (—); amazon takip numarası yükleme (—); amazon yorum isteği (—) | Commercial | **Do not** target the head term "amazon entegrasyon" (AC✓): most searchers want listing/stock sync, which we don't have (N-5). Proof: `order-sync-amazon`, `tracking-push-amazon`, `msg-amazon-buyer`. |
| `/entegrasyonlar/trendyol` | trendyol entegrasyon (AC✓, highly competitive) | trendyol ürün yükleme (—); trendyol toplu fiyat güncelleme (—); trendyol yapay zeka ürün açıklaması (—); trendyol müşteri soruları yapay zeka (—) | Commercial | Proof: `trendyol-products`, `ai-listing-copy` (TR output), `inbox-unified` (beta). Order sync is beta/env-flagged (`order-sync-trendyol`, H-16), and tracking push is not wired (N-7): the page must say so. Realistically this page ranks for long-tail, not the head term. |
| `/entegrasyonlar/shopify` | shopify entegrasyon (AC✓) | shopify etsy entegrasyonu (AC✓; shared with /etsy as secondary, see conflicts); shopify trendyol entegrasyon (AC✓); shopify kargo entegrasyonu (AC✓) | Commercial | Proof: `order-sync-shopify`, `shopify-products` (partial), `stock-sync`, `shopify-free`. No AI (N-20), no tracking push (N-7). |
| `/entegrasyonlar/wix` | wix entegrasyon (AC✓) | wix kargo entegrasyonu (AC✓); wix pazaryeri entegrasyonu (AC✓); wix trendyol entegrasyon (AC✓) | Commercial | Proof: `order-sync-wix` (beta), `wix-products` (partial), `tracking-push-wix` (beta), `inbox-unified`. Mark beta on the page until flags are confirmed. |
| `/entegrasyonlar/fedex` | fedex etiket oluşturma (— ; "fedex etiket" AC✓) | fedex api entegrasyonu (—); fedex ticari fatura (—); fedex uluslararası gönderi etiketi (—) | Commercial | Proof: `label-fedex` (partial: international only, BYO account, manual void), `customs-commercial-invoice`. Never "yurt içi FedEx" (N-13) or "FedEx takip" (N-14). Conflict: the mikro-ihracat case page carries "fedex etiket oluşturma" as a secondary only. |
| `/entegrasyonlar/ups` | ups etiket oluşturma (—) | ups e-ihracat (AC✗); ups ticari fatura (—); ups ioss (—) | Commercial | Proof: `label-ups` (partial), `customs-commercial-invoice` (IOSS/VAT validation on the commercial invoice — not IOSS registration). |
| `/entegrasyonlar/dhl-ecommerce` | dhl ecommerce entegrasyon (— ; brand "dhl ecommerce" AC✓ but navigational for the carrier) | mng kargo entegrasyonu (—); kapıda ödeme kargo entegrasyonu (—); dhl ecommerce kargo etiketi (—) | Commercial | Proof: `label-dhl-ecommerce` (production, domestic only, COD, tracking, cancel). Most "dhl ecommerce …" AC suggestions are tracking/branch lookups (navigational for the carrier): we will not win those and should not try. |
| `/entegrasyonlar/parasut` | paraşüt entegrasyonu (—) | paraşüt etsy (AC✓, single suggestion); mikro ihracat e-arşiv paraşüt (—); paraşüt e-ihracat faturası (—) | Commercial | **Weak page until N-4 is fixed:** Paraşüt invoicing only runs inside the ETGB flow, has no UI and swallows errors. Copy must say "ETGB akışında" and not "otomatik e-Fatura". Consider `draft: true` until the ETGB exporter fix ships. |

## 4. Comparison pages (`/karsilastirma/*`)

| URL | Primary keyword | Secondary (3–5) | Intent | Why / notes |
|---|---|---|---|---|
| `/karsilastirma` (hub, optional) | entegratör karşılaştırma (pain-points B, —) | en iyi entegrasyon firması 2026 (pain-points, —); etsy entegratör karşılaştırma (—) | Commercial | Hub listing the four pages below. Never "en iyi" in our own copy; the phrase is a target query only. |
| `/karsilastirma/kolayxport-vs-sentos` | sentos alternatifi (AC✗) | sentos etsy entegrasyonu (—); sentos fiyat (—); sentos entegrasyon (AC✓) | Commercial (switching) | Sentos complaint volume on Şikayetvar (pain-points B1/B2) suggests switch-intent searches, even if autocomplete doesn't show "alternatifi". Facts: competitors.md §5. |
| `/karsilastirma/kolayxport-vs-entegra` | entegra alternatifi (AC✗) | entegra e-ihracat paketi (—); entegra etsy (—); entegra bilişim fiyat (—) | Commercial (switching) | "entegra" alone is ambiguous (AC returns "entegrasyon ne demek"); keep the brand + qualifier. |
| `/karsilastirma/kolayxport-vs-prapazar` | prapazar alternatifi (AC✗) | prapazar etsy entegrasyonu (—); prapazar fiyat (AC✓); prapazar entegrasyon (AC✓) | Commercial (switching) | Closest functional overlap (Etsy + eBay + FedEx/UPS/DHL). |
| `/karsilastirma/kolayxport-vs-erank` | erank alternatifi (EN "erank alternative" AC✓; TR —) | erank türkçe (AC✗); erank ücretli mi (AC✓); erank nasıl kullanılır (AC✓) | Commercial / Info | TR sellers search eRank by name. The "nasıl kullanılır" intent is informational; answer it briefly on the page rather than in a separate post, to avoid splitting. |

Not built now (facts exist in competitors.md §5, add later if needed): `kolayxport-vs-birfatura`, `kolayxport-vs-yengec`, `kolayxport-vs-dopigo`, `kolayxport-vs-vela`.

## 5. How-to guides (`/nasil-kullanirim/*`)

Guides own long-tail "how do I do X in the tool" phrasing. They must not take the head term of a case page.

| URL | Primary keyword | Secondary | Intent | Notes |
|---|---|---|---|---|
| `/nasil-kullanirim/etsy-magazasi-baglama` | etsy mağazası bağlama (—) | etsy api bağlantısı (—); etsy oauth (—) | Navigational / How-to | `settings-connections`. |
| `/nasil-kullanirim/etsy-toplu-fiyat-guncelleme` | etsy toplu fiyat güncelleme nasıl yapılır (— ; head "etsy toplu fiyat güncelleme" AC✓ is secondary on /cozumler/etsy-satici) | etsy toplu fiyat değiştirme (AC✓); etsy toplu düzenleme (—) | How-to | `etsy-bulk-editor`, `staged-drafts-send`. Guide owns the "nasıl yapılır" variant only. |
| `/nasil-kullanirim/etsy-ilanini-ebaye-kopyalama` | etsy ilanını ebay'e kopyalama (—) | etsy ebay çapraz listeleme (—) | How-to | `crosslist-etsy-ebay`. |
| `/nasil-kullanirim/ilan-doktoru` | etsy ilan analizi (— ; "etsy listing analyzer" AC✓ in EN) | etsy seo puanı (—) | How-to | `research-listing-doctor`. |
| `/nasil-kullanirim/fedex-etiket-olusturma` | fedex hesabı bağlama ve etiket (—) | fedex ticari fatura nasıl eklenir (—) | How-to | `label-fedex`, `customs-commercial-invoice`. Must not take "fedex etiket oluşturma" (owned by /entegrasyonlar/fedex). |
| `/nasil-kullanirim/ups-etiket-olusturma` | ups hesabı bağlama ve etiket (—) | ups hs kodu (—) | How-to | `label-ups`. |
| `/nasil-kullanirim/dhl-ecommerce-kapida-odeme` | dhl ecommerce kapıda ödeme etiketi (—) | mng kapıda ödeme (—) | How-to | `label-dhl-ecommerce`. |
| `/nasil-kullanirim/stok-senkronu-kurulumu` | stok senkronizasyonu kurulumu (— ; head "stok senkronizasyonu" from pain-points B1) | sku eşleştirme (—); fazla satış önleme (pain-points) | How-to | `stock-sync` (beta), `stock-sku-matching`. Don't take "stok senkronizasyonu" head term on any case page (domestic intent, and we lack HB). |
| `/nasil-kullanirim/zamanlanmis-gonderim` | ilan güncelleme zamanlama (—) | — | How-to | `scheduled-send`. |
| `/nasil-kullanirim/kar-raporu` | pazaryeri kar raporu (—) | ürün maliyeti girme (—) | How-to | `reports-profit` (beta, Pro). |

## 6. Blog (`/blog/*`)

Launch posts (written 2026-10-17, see `content/tr/blog/`) and the calendar posts in [content-calendar.md](content-calendar.md). Only the launch posts are listed here; the calendar assigns one primary keyword per post and was checked against this table.

| URL | Primary keyword | Secondary (3–5) | Intent | Links to |
|---|---|---|---|---|
| `/blog/etsy-satis-yok-10-kontrol` | etsy satış gelmiyor (AC✗; seller phrasing from pain-points A4) | etsy görüntülenme alamıyorum (AC✓); etsy seo nasıl yapılır (AC✓); etsy başlık nasıl olmalı (AC✓); etsy etiket bulma (AC✓, secondary only — primary on /cozumler/ai-ilan-optimizasyonu) | Problem / Info | /cozumler/ai-ilan-optimizasyonu, /cozumler/etsy-satici |
| `/blog/mikro-ihracat-rehberi-2026` | mikro ihracat sınırı 2026 (AC✓) | mikro ihracat faturası nasıl kesilir (AC✓); etgb nedir (AC✓); abd gümrük vergisi türkiye (AC✓); ab 3 euro gümrük (AC✗) | Info (news) | /cozumler/mikro-ihracat-kargo-etgb, /entegrasyonlar/fedex, /entegrasyonlar/ups |
| `/blog/trendyoldan-ebaye-urun-arastirmasi` | ebay ürün araştırması nasıl yapılır (AC✓) | ebay de ne satılır (AC✓); trendyol e ihracat nasıl yapılır (AC✓, secondary only — primary on /cozumler/trendyoldan-dunyaya); ebay komisyon oranları (AC✓) | Info | /cozumler/trendyoldan-dunyaya, /cozumler/urun-arastirma-arbitraj |
| `/blog/etsy-kar-hesaplama` | etsy kar hesaplama (AC✓) | etsy komisyon oranları 2026 (AC✓); etsy komisyon hesaplama (AC✓); etsy offsite ads (AC✓); etsy kar marjı hesaplama (AC✓) | Info / Tool | /fiyatlandirma, /cozumler/etsy-satici |

Existing legacy posts (`pages/blog.js`, 8 posts, newest 2025-01-15) should be redirected or rewritten, not kept beside the new ones:
- "Black Friday'e Hazırlık…" overlaps calendar post #3 (Black Friday). 301 it to the new post.
- "FedEx vs UPS: Hangi Kargo Şirketi…" overlaps `/entegrasyonlar/fedex` and `/entegrasyonlar/ups`. Rewrite or 301 to `/cozumler/mikro-ihracat-kargo-etgb`.
- "Kargo Maliyetlerini %30 Azaltmanın 7 Yolu" has unsourced numbers and a feature that doesn't exist (site-audit). Unpublish (410) or rewrite.
- "Trendyol Entegrasyonu: Adım Adım Kurulum Rehberi" competes with `/entegrasyonlar/trendyol`. 301.
- "Hepsiburada ve Amazon Sipariş Optimizasyonu" implies Hepsiburada support (N-1). Unpublish.
- "Multi-Channel Envanter Yönetimi" → 301 to `/nasil-kullanirim/stok-senkronu-kurulumu`.
- "E-Ticaret Otomasyon Rehberi 2025" and "API Entegrasyonlarında… 10 Hata" → unpublish or noindex (off-positioning).

## 7. Cannibalization check (flagged conflicts and how they are resolved)

| # | Keyword | Competing URLs | Resolution |
|---|---|---|---|
| C-1 | etgb nedir / mikro ihracat sınırı | `/blog/mikro-ihracat-rehberi-2026` vs `/cozumler/mikro-ihracat-kargo-etgb` | Blog owns informational ETGB/limit terms. Case page avoids "ETGB" in title/H1 until N-3 is fixed and then targets "mikro ihracat kargo" only. Case page links to the blog for rules. |
| C-2 | trendyol e ihracat nasıl yapılır | `/cozumler/trendyoldan-dunyaya` vs `/blog/trendyoldan-ebaye-urun-arastirmasi` | Case page owns it (primary). Blog uses it only as a secondary in body copy and links to the case page with that anchor text. |
| C-3 | etsy etiket bulma / etsy anahtar kelime bulma | `/cozumler/ai-ilan-optimizasyonu` vs `/cozumler/urun-arastirma-arbitraj` vs `/blog/etsy-satis-yok-10-kontrol` | "etiket bulma" → AI page (writes tags). "anahtar kelime bulma" → research page (finds keywords). Blog uses neither as primary. Planned calendar post on tags uses "etsy etiket nasıl yazılır" (different intent: how-to). |
| C-4 | fedex etiket oluşturma | `/entegrasyonlar/fedex` vs `/cozumler/mikro-ihracat-kargo-etgb` vs `/nasil-kullanirim/fedex-etiket-olusturma` | Integration page owns it. Case page secondary only. Guide targets the "hesap bağlama" variant. Consider merging the guide into the integration page if both stay thin. |
| C-5 | etsy toplu fiyat güncelleme | `/cozumler/etsy-satici` vs `/nasil-kullanirim/etsy-toplu-fiyat-guncelleme` | Case page: head term as secondary. Guide: "…nasıl yapılır". If the guide outranks the case page after 3 months, swap and make the guide canonical for the term. |
| C-6 | shopify etsy entegrasyonu | `/entegrasyonlar/etsy` vs `/entegrasyonlar/shopify` | Kept as a secondary on **both** on purpose; it's a two-sided query. The Etsy page carries the full section; the Shopify page links to it. Watch in Search Console; if both rank on page 2, consolidate into the Etsy page. |
| C-7 | etsy komisyon oranları 2026 | `/blog/etsy-kar-hesaplama` vs calendar post on Etsy fee changes (if any) | Only the profit post targets it. Calendar does not schedule a separate fee post; fee updates go into this post (refresh `updated:`). |
| C-8 | abd gümrük vergisi / de minimis | `/blog/mikro-ihracat-rehberi-2026` vs calendar post "ABD'ye gönderide DDP mi DDU mu" | Rehber owns "abd gümrük vergisi türkiye". Calendar DDP post targets "ddp gönderim" (pain-points A7), a distinct decision query, and links back. |
| C-9 | etsy satış yok / görüntülenme | `/blog/etsy-satis-yok-10-kontrol` vs `/cozumler/etsy-satici` | Blog owns the problem phrasing. Case page targets tool phrasing ("etsy mağaza yönetimi") and quotes the pain only as a hook with a link to the blog. |
| C-10 | pazaryeri entegrasyonu | `/entegrasyonlar` vs legacy blog "Trendyol Entegrasyonu…" | Neither targets it as primary (domestic intent, N-1 gap). Legacy post gets 301. |
| C-11 | erank nasıl kullanılır | `/karsilastirma/kolayxport-vs-erank` vs any future eRank tutorial | No separate tutorial is planned; answer on the comparison page. |

## 8. What to verify next

1. Real volumes for every primary keyword in Keyword Planner (TR, Turkish). Replace "unverified" only with that data and the date.
2. Google Trends comparison of: "etsy seo", "mikro ihracat", "e-ihracat", "etsy kar hesaplama", "ebay satış" (12 months, TR), to set the ad split between Etsy and the Trendyol track.
3. Search Console after the blog SSR fix (site-audit P1-8): no page ranks today because the blog body isn't server-rendered.
4. Before publishing `/cozumler/trendyoldan-dunyaya` and `/entegrasyonlar/trendyol`: confirm `MARKETPLACE_TRENDYOL` on the VPS (H-16).
5. Before publishing `/cozumler/mikro-ihracat-kargo-etgb` with ETGB copy and `/entegrasyonlar/parasut`: the per-user exporter fix (N-3/N-4).
