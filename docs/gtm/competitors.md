# KolayXport Competitor Teardown

**Last verified:** 2026-10-17. Prices and features were re-checked on each vendor's own pricing or feature page on that date (some JS-rendered pages were read in a browser). Review data comes from Şikayetvar, Trustpilot and the Shopify App Store on the same date.
**FX used for conversions:** 1 USD ≈ ₺49.2 (TCMB/market range 49.17–49.22, 6–8 Oct 2026, per [Türkgün](https://www.turkgun.com/ekonomi/dolar-bugun-ne-kadar-7-ekim-2026-dolar-euro-kuru-kac-tl/405055)). Conversions are only for comparison. Quote the vendor's own currency on public pages.
**Baseline:** `investor-deck/competitor-notes.md` (2026-08-30). Anything that changed since then is marked **Δ**.

> Rules for using this doc on public "KolayXport vs X" pages: use only section 5 facts, cite the vendor URL, show the "last verified" date, and re-check prices before every publish. Turkish integrators reprice often: four of the eight TR price lists changed between 2026-08-30 and 2026-10-17.

---

## 1. Landscape summary

**Three camps, none of which covers the full Turkish e-export seller workflow:**

1. **Turkish marketplace integrators** (Sentos, Entegra, Dopigo, PraPazar, BirFatura, Yengeç, Sopyo, Zunapro, Pazarus) handle ops plumbing for domestic marketplaces: order pull, stock sync, e-Fatura/e-Arşiv, and Turkish carrier labels. Most sell annual licenses between ₺9.5k and ₺125k. Etsy, eBay and Amazon-global are export add-ons, often locked to the top tier (Sentos Platinum ₺89k/yr, Entegra Paket 5 ₺125k/yr). Their Etsy support is pipe-level: orders, stock and invoices. None offers Etsy listing SEO, staged bulk editing or market research. **Δ AI is no longer absent in this camp.** Dopigo now advertises AI product images, SEO descriptions, AI answers to marketplace questions and category matching. Entegra sells "AI product adding", and Pazarus is built around AI. All of this AI targets Turkish-language domestic listings.
2. **E-commerce site builders with a marketplace module** (ikas, Ticimax). Marketplace integration is bundled into expensive store plans: ikas Scale is ₺83,983/yr, and Ticimax only adds marketplaces from Advance at ₺99,000/yr. Both include AI content tools, but only for the store itself.
3. **Global seller tools** (eRank, Marmalead, EverBee, Alura, Vela, ShipStation) are cheap ($0–$70/mo) and English-only. Each covers one slice: research (eRank/Marmalead/EverBee/Alura), AI bulk editing (Vela) or shipping (ShipStation). None knows about Trendyol, Paraşüt, ETGB or Turkish invoicing.
4. **Cross-border logistics and e-export platforms** (ShipEntegra, ShopiVerse) are adjacent. ShipEntegra gives its shipping software away and earns on discounted carrier rates. That puts it in direct competition with KolayXport's label feature for Etsy/eBay sellers. ShopiVerse is the closest "global integrator", with Amazon/eBay/Etsy/Trendyol coverage, but it costs $140–$500/mo and its AI is limited to content translation.

**Where KolayXport wins**
- **It is the only product that combines Etsy/eBay listing editing (single + staged bulk) with English SEO AI, AI photos, research and Turkish ops (Paraşüt e-Arşiv, ETGB Excel, DHL eCommerce/MNG) in one TR+EN app.** A Turkish Etsy seller today stacks an integrator (₺25k–₺89k/yr) with eRank/Alura ($6–30/mo) and Vela ($30–40/mo).
- **Etsy depth.** Turkish integrators sync Etsy orders and stock. KolayXport edits listings, photos, video, variations and taxonomy, with conflict-protected sync.
- **Price at the export tier.** Etsy access costs ₺89,000/yr on Sentos, ₺125,000/yr on Entegra and ₺83,983/yr on ikas (≈ ₺7k–10.4k/mo). KolayXport Pro is ₺7,999/mo with monthly billing, and Starter is ₺2,499/mo.
- **Monthly billing with a no-card trial.** Most Turkish incumbents push annual prepay, and Şikayetvar complaints repeatedly cite refund refusals.
- **Research and arbitrage** (Etsy/eBay/Amazon/Trendyol, Trendyol→eBay). No Turkish competitor offers this. ShopiVerse sells "Pazar Araştırması" as a consulting service.
- **Chrome extension** (research overlays + Etsy address capture). This exists only among the global tools (eRank/EverBee/Alura), and those are not tied to ops.

**Where KolayXport loses**
- **Domestic marketplace breadth.** There is no Hepsiburada, N11, Çiçeksepeti, Pazarama or Temu. BirFatura lists 32+ marketplaces, Dopigo ~13 plus Temu, PraPazar 24 Turkish ones. A seller whose main channel is Hepsiburada cannot switch.
- **Turkish domestic carriers.** There are no Yurtiçi, Aras or Sürat labels. Every Turkish integrator has them.
- **e-Fatura provider choice.** KolayXport supports only Paraşüt. Others support Sovos, ICE, QNB, EDM, Logo, Mikro and others, or are themselves the provider (BirFatura).
- **Entry price.** BirFatura has a free tier (then ₺790/mo), Yengeç starts at ₺600/mo, Zunapro and Pazarus have free tiers, and Ticimax GO is ₺599/mo. KolayXport's ₺2,499 entry is mid-market.
- **Teams, WhatsApp, warehouse/WMS and ERP are missing.** Mid-size sellers expect sub-users and accounting/ERP integrations.
- **Trust and social proof.** Yengeç claims 10,000+ businesses and 35M+ invoiced orders. Dopigo claims 4,000+ sellers, and ShipEntegra 100k+ customers. KolayXport has no public traction numbers yet.

---

## 2. Per-competitor sections

Legend for "source/date": every price was read on the listed URL on **2026-10-17** unless stated otherwise.

### 2.1 BirFatura (birfatura.com) — the "ücretsiz" integrator
- **Positioning (their words):** "Türkiye'nin Kapsamlı ve Ücretsiz Pazaryeri Entegrasyonu". Homepage: "e-Ticareti Hızlandıran e-Fatura Çözümü".
- **Headline promise:** 32+ marketplaces in one panel, unlimited stores, no per-store or per-integration fee, free setup.
- **Segment:** domestic first, plus micro-export invoicing (e-Arşiv for Etsy/Amazon; heavy content marketing on ETGB and mikro ihracat).
- **Pricing:** "Birlikte Büyüyelim" free tier ₺0 with 20 kontör. Subscription is **₺790/mo or ₺7,100/yr** (25% off ₺9,480). e-kontör is extra: 500 for ₺480 up to 200k for ₺71,000 (₺0.96 down to ₺0.355 each). 14-day free trial. Source: https://birfatura.com/e-fatura-kontor-fiyatlari-e-fatura-fiyatlari/
- **Integrations:** 26+ Turkish marketplaces (Trendyol, Hepsiburada, N11, Çiçeksepeti, Pazarama, Idefix, Modanisa, Boyner…), international Amazon, **Etsy**, Ozon, AliExpress and Temu, and the platforms Shopify, WooCommerce, ikas, Ticimax and Ideasoft. BirFatura is itself the e-Fatura/e-Arşiv/e-İrsaliye provider. Cargo integrations and a credit-cargo product (Navlungo tie-up). No eBay found. Source: https://birfatura.com/pazaryeri-entegrasyonu/ · https://birfatura.com/etsy-entegrasyonu/
- **AI:** none advertised. **Research:** none (blog content only).
- **Label/cargo:** yes (carrier APIs). **Stock sync:** yes (incl. multiple Etsy shops).
- **Praise/hate:** Şikayetvar complaints center on the cargo-credit/Navlungo balance transfer ("Navlungo'ya Aktarılması Beklenen 3519,75 TL Kargo Bakiyesi Hâlâ Gönderilmedi", https://www.sikayetvar.com/birfatura/navlungoya-aktarilmasi-beklenen-351975-tl-kargo-bakiyesi-hala-gonderilmedi) and invoice VAT errors (https://www.sikayetvar.com/birfatura/fatura-entegrasyon-hatasi-kdv-0-gorunmesi-ve-resmi-beyan-talebi).
- **Exploitable weakness:** "Free" means the integration is free; invoicing is paid per kontör. There are no listing tools, no AI and no eBay. BirFatura is a pipe, not a workspace. Position KolayXport as "BirFatura moves your Etsy orders into invoices; KolayXport makes the listings that create those orders." Also consider a Paraşüt-alternative angle: BirFatura is a likely partner or target integration, not just a rival.

### 2.2 Sentos (sentos.com.tr)
- **Positioning:** "Pazaryeri, kargo, muhasebe ve e-ihracat operasyonlarınızı tek ekrandan kontrol".
- **Segment:** domestic SMB to mid-market. E-export only in top tiers.
- **Pricing (annual, 3 installments) Δ, up from Aug:** Basic ₺9,500 (was 7,200) · Pro ₺24,900 (was 19,200) · Plus ₺39,000 (was 30,000) · Premium ₺59,000 (was 45,000) · **Platinum ₺89,000 (was 69,000). E-export (Amazon, Etsy, Zalando, Ozon, Joom, Hepsiglobal) is Platinum+ only.** Prestige is custom. Source: https://www.sentos.com.tr/fiyatlar/
- **Integrations:** ~22 marketplaces, 12 cargo integrations (Plus+), accounting/ERP (Premium+). Etsy is bidirectional: pull or push listings, stock, orders, cargo labels via international carriers, and e-Arşiv/export invoices (https://www.sentos.com.tr/etsy-entegrasyonu/). **No eBay.**
- **AI:** none, apart from a "price robot" (Plus+) and automated pricing (Premium+). **Research:** none.
- **Hate:** recent Şikayetvar titles include "Sentos Yazılım Programının Kullanıcı Dostu Olmaması Ve Destek Ekibinin Yetersizliği" (2026-09-16, https://www.sikayetvar.com/sentos-yazilim-teknolojileri/sentos-yazilim-programinin-kullanici-dostu-olmamasi-ve-destek-ekibinin-yetersizligi), "Sentos'un Hatalı Toplu Fiyat Değişikliği Ve Yetersiz Destek" (https://www.sikayetvar.com/sentos-yazilim-teknolojileri/sentosun-hatali-toplu-fiyat-degisikligi-ve-yetersiz-destek) and "Sentos Entegrasyonunda Sürekli Hatalar, Destek Eksikliği Ve İade Talebi" (https://www.sikayetvar.com/ikas/sentos-entegrasyonunda-surekli-hatalar-destek-eksikligi-ve-iade-talebi). Themes: usability, a bulk-price error, phone reachability, refunds.
- **Praise:** breadth of domestic integrations and depth of accounting.
- **Exploitable weakness:** Etsy costs ₺89k/yr up front. KolayXport Pro at ₺7,999/mo, cancellable monthly, undercuts that on cash flow and adds editing, AI and research. Their bad bulk price change is a good contrast with KolayXport's staged drafts and explicit "Sync to Etsy".

### 2.3 Entegra (entegrabilisim.com)
- **Positioning:** "Sadece e-ticaretinizi değil, tüm ticaretinizi tek panelden yönetin."
- **Segment:** domestic mid-market, plus "e-export package" at the top tier.
- **Pricing (annual, VAT incl., "new" discounted prices) Δ:** Sadece Fatura ₺10,500 · Paket 0 ₺24,750 (3 marketplaces, AI product adding) · Paket 1 ₺39,000 · Paket 2 ₺54,000 · Paket 3 ₺79,500 · Paket 4 ₺98,000 · **Paket 5 ₺125,000 (was ₺150,000). Paket 5 is the only tier that includes the e-export package (Temu, Etsy, Ozon) and Trendyol Europe.** e-Fatura credits are extra (₺0.20–0.60 each). Source: https://www.entegrabilisim.com/paketler
- **Integrations:** domestic marketplaces, shipping APIs (Paket 2+), accounting (Paket 3+), WMS, fulfillment. No eBay.
- **AI:** "AI ürün ekleme" (AI product adding), autonomous listing for Trendyol/n11/Amazon, and ChatGPT ad management in their store packages. **Research:** competitive price analysis (Paket 3+).
- **Hate:** "Teslim Edilmeyen 160.000 TL'lik Yazılım Hizmeti İçin Tam İade Talebi" (2026-04-25, https://www.sikayetvar.com/entegra-bilisim/teslim-edilmeyen-160000-tllik-yazilim-hizmeti-icin-tam-iade-talebi).
- **Exploitable weakness:** Etsy sits behind a ₺125k/yr wall. There is no eBay and no English-language Etsy SEO.

### 2.4 Dopigo (dopigo.com)
- **Positioning:** "E-ticaret mağazalarınızı yönetmeye hemen başlayın." Δ New banner: "Rakibi Değil, Buybox'ı Takip Edin. Buybox Analizi Yayında!"
- **Segment:** domestic marketplace sellers.
- **Pricing Δ (now published; was quote-only in Aug):** Pazaryeri **₺24,999/yr** · E-Ticaret ₺39,999/yr · Muhasebe (ERP) ₺74,999/yr. Unlimited orders and products. 3 installments, 2-week free trial. Claims "4000+ satıcı". Source: https://www.dopigo.com/fiyatlar/
- **Integrations:** Hepsiburada, Trendyol, n11, Çiçeksepeti, PttAVM, Pazarama, Koçtaş, Teknosa, Idefix… plus **Amazon and Temu**. **No Etsy, no eBay.** Cargo: HepsiJET, Aras, Yurtiçi, Kolay Gelsin, PTT, Sürat. e-Fatura: Sovos, ICE, SNI. Accounting: Logo, Mikro, Paraşüt, ETA, DİA. Source: https://www.dopigo.com/tum-entegrasyonlar/
- **AI Δ (concrete now):** AI product image generation (30 credits/day), AI draft answers to Trendyol/HB/Amazon/N11 customer questions, SEO-optimized descriptions, automatic categorization. Source: https://www.dopigo.com/dopigo-yapay-zeka/
- **Research:** Buybox analysis.
- **Praise:** testimonials on the pricing page praise support responsiveness and unified stock control.
- **Hate:** "Dopigo Kargo Etiketlerindeki Hatalar İş Akışımı Aksatıyor Çözüm Alamıyorum" (2025-11-24, https://www.sikayetvar.com/dopigo/dopigo-kargo-etiketlerindeki-hatalar-is-akisimi-aksatiyor-cozum-alamiyorum), "Eksik Entegrasyonlar Ve İade Talebimin Reddi…" (https://www.sikayetvar.com/dopigo/eksik-entegrasyonlar-ve-iade-talebimin-reddi-nedeniyle-magduriyet-yasadim), "Dopigo Üyelik İptali Ve Kontör Ücreti Çelişkisi" (https://www.sikayetvar.com/dopigo/dopigo-uyelik-iptali-ve-kontor-ucreti-celiskisi).
- **Exploitable weakness:** no Etsy and no eBay at all, and annual-only pricing. **Risk: Dopigo has the most complete AI suite among Turkish integrators**, so "AI" alone does not differentiate against it. The differentiator is *English, export-marketplace* AI and research.

### 2.5 PraPazar (prapazar.com)
- **Positioning:** domestic + e-export integrator. Headline selling point on the pricing page: "KDV YOK" (technopark VAT exemption).
- **Pricing Δ (0% VAT):** Demo free (5 days) · Eko **₺2,550/mo** (was 2,350; 5 stores, 1,000 orders/mo, 2,000 products) · Eko Plus ₺27,250/yr · Pra ₺39,250/yr · Uzman ₺59,250/yr · Enterprise ₺74,250/yr. **Paid add-ons:** cargo integration +₺13,000, competitive price analysis, e-invoice +₺1,850–6,500, reporting +₺5,150. Source: https://prapazar.com/tr/paketler
- **Integrations:** 24 Turkish marketplaces. International: **Etsy, eBay**, AliExpress, Ozon, Joom, Allegro, Bol, OnBuy, Temu. Carriers include FedEx, UPS and DHL. Accounting: Uyumsoft, Paraşüt, Bizim Hesap, Odoo. Etsy: orders, invoice + label "in seconds", price/stock updates, category attribute mapping, "multilingual listings with automatic descriptions". Source: https://prapazar.com/tr/entegrasyon/etsy-entegrasyonu
- **AI:** none named as AI (auto-descriptions only). **Research:** none (profit/stock reports).
- **Hate:** "API Kopmaları Stok Aktarımını Bozuyor Ve Ciddi Müşteri Mağduriyetine Yol Açıyor" (2026-06-22, https://www.sikayetvar.com/prapazar/api-kopmalari-stok-aktarimini-bozuyor-ve-ciddi-musteri-magduriyetine-yol-aciyor) and "Prapazar Entegrasyon Sorunları Ve Yetersiz Destek…" (https://www.sikayetvar.com/prapazar/prapazar-entegrasyon-sorunlari-ve-yetersiz-destek-nedeniyle-magduriyet).
- **Exploitable weakness:** PraPazar is KolayXport's closest functional overlap (Etsy + eBay + FedEx/UPS/DHL). It has no listing editor, no SEO AI and no research, and its à-la-carte add-ons inflate the real price (cargo alone +₺13k).

### 2.6 Yengeç (yengec.co)
- **Positioning:** "e-Ticaret entegrasyonu ile yönetimi Yengeç'e bırakın!" Order → invoice → cargo automation.
- **Traction claims:** 10,000+ businesses, 35M+ orders invoiced, 22M+ invoices. Source: https://yengec.co/
- **Pricing (monthly, VAT incl.):** Tekli ₺600 (1 integration) · 3'lü ₺1,500 · Sınırsız ₺3,600. Annual ≈ 10× monthly. **Export plans: $22.90/mo per store**, export cargo $22.90/mo per carrier. Shopify/Wix: $22.90/store. Product-stock module ₺1,400/mo, Buybox ₺1,000/mo. 15-day trial. Source: https://yengec.co/fiyatlar
- **Integrations:** Trendyol, HB, N11, Amazon TR, Pazarama…. Export: **Etsy, eBay, Amazon Global, Trendyol Export**. Carriers: Yurtiçi, Aras, PTT, DHL, Sürat, FedEx, UPS, HepsiJET. e-Fatura via GİB, QNB, EDM.
- **AI / research:** none.
- **Praise:** Shopify App Store 4.8★ (18 reviews), $22.90/mo. Listing is Turkish-only. https://apps.shopify.com/yengec
- **Exploitable weakness:** an ops pipe with no listing management for Etsy/eBay (order/invoice/cargo only), no AI and no research. It is cheap, though: a seller with Etsy + eBay + 1 cargo pays roughly 3 × $22.90 ≈ $69/mo. **Yengeç is the price anchor KolayXport Starter will be compared to.**

### 2.7 ikas — marketplace module (ikas.com)
- **Positioning:** e-commerce site builder. "Ücretsiz E-Ticaret Siteni Aç" (free "Start" plan, lifetime ₺0).
- **Pricing (billed annually) Δ:** Lift ₺4,660/mo (₺55,927/yr) · **Scale ₺6,998/mo (₺83,983/yr): "Trendyol, Hepsiburada, N11, Amazon ve ETSY Entegrasyonu – Hediye"** · Scale Plus ₺11,618/mo (₺139,423/yr). Per ikas, the full set of 19 domestic + 7 international marketplaces is Scale Plus/Premium only. Sources: https://ikas.com/tr/e-ticaret-paketleri · https://ikas.com/tr/pazaryeri-entegrasyonlari
- **AI:** ikas AI (SEO product descriptions, AI Görsel Stüdyosu image editing/generation, automatic translation for e-export, chatbot). Source: https://ikas.com/tr/ikas-yapay-zeka-ozellikleri
- **Research:** none.
- **Hate:** "Vaat Edilen Entegrasyonların Sağlanmaması Nedeniyle 150 Bin TL'lik Ekstra Maliyet" (filed against ikas, https://www.sikayetvar.com/ikas/vaat-edilen-entegrasyonlarin-saglanmamasi-nedeniyle-150-bin-tllik-ekstra-maliyet).
- **Exploitable weakness:** you must buy a ₺84k/yr storefront to get marketplace sync. Store-first AI does not edit Etsy listings natively. ikas is also a channel: KolayXport could integrate ikas as a store source.

### 2.8 Ticimax — marketplace module (ticimax.com)
- **Positioning:** "Dünya Markalarının Tercih Ettiği Türkiye'nin En Gelişmiş E-ticaret Altyapısı."
- **Pricing (annual, campaign prices, "%65 indirim + 1 yıl hediye" promo running):** Advantage ₺46,000/yr · Premier ₺89,000/yr · **Advance ₺99,000/yr, the first tier with Trendyol/HB/n11/Amazon & Temu integrations** · Advance Plus ₺119,900/yr (adds "3 Yurt Dışı Pazaryeri Entegrasyonu") · Ultra (unlimited marketplaces). Δ A KOBİ "GO Paket" was launched at ₺599/mo with marketplace integrations, per [Para Dergi, 2026-04-01](https://www.paradergi.com.tr/sektorler/2026/04/01/ticimaxtan-kobilere-hizli-baslangic-go-paket). Source: https://www.ticimax.com/e-ticaret-paketleri/ (behind Cloudflare; read in browser)
- **AI:** Yapay Zeka İçerik/Görsel/Büyüme/Banner/Fashion asistanları on higher tiers. An Etsy integration page exists (https://www.ticimax.com/etsy-entegrasyonu/).
- **Exploitable weakness:** like ikas, it is storefront-first, and marketplaces are a costly upsell. No eBay listing tooling, no Etsy SEO.

### 2.9 Zunapro (zunapro.com)
- **Positioning:** "Pazaryeri entegrasyonundan e-faturaya, stok yönetiminden depo hizmetlerine – Zunapro tüm e-ticaret süreçlerinizi tek panelden yönetir." Also sells company formation and fulfillment in 16 countries.
- **Pricing (monthly, VAT incl.):** **Starter free forever** (2 marketplaces, 100 products) · Basic ₺1,900 · Plus ₺2,900 · Pro ₺5,900 (smart pricing, commission calc) · Pro+ ₺7,900 (20 marketplaces, international marketplaces) · Special custom. Source: https://www.zunapro.com/turkey/tr/pazaryeri
- **Integrations:** Turkish majors + Amazon.de, **eBay**, Ozon, Temu, Otto, Zalando, Kaufland. Carriers: Yurtiçi, Aras, DHL, PTT, Sürat, HepsiJet, UPS, FedEx. e-Fatura/e-Arşiv via GİB. **No Etsy found.**
- **AI / research:** none advertised. No Şikayetvar brand page (410).
- **Exploitable weakness:** no Etsy, and the EU (DE/NL) focus is a different export motion. Its pricing ladder (₺1,900–7,900/mo, monthly) is the most similar to KolayXport's. Use that for apples-to-apples comparisons.

### 2.10 Sopyo (sopyo.com), included because it advertises heavily
- **Positioning:** "E-ticaret entegrasyon fiyatları işletmenizin büyüklüğüne… göre değişir."
- **Pricing (annual):** Profesyonel ₺25,000 · Gelişmiş ₺40,000 · Uzman ₺60,000 · Plus ₺99,000 (Δ was ₺120k). Kontör ₺0.45–0.88. Source: https://www.sopyo.com/fiyatlar
- **Features:** unlimited Turkish marketplace integration, "Sopyo AI Hub", Aras/MNG/Sürat/Yurtiçi. Etsy/eBay not documented on the pricing page.
- **Hate:** "Sopyo Gelişmiş Pakette Entegrasyon Sorunları Ve Sürekli Hatalar" (2026-09-13, https://www.sikayetvar.com/sopyo/sopyo-gelismis-pakette-entegrasyon-sorunlari-ve-surekli-hatalar) and "Sopyo Entegrasyon Sorunları Amazon Stok Ve Fiyat Senkronizasyonunda Çözüm Bekliyor" (https://www.sikayetvar.com/sopyo/sopyo-entegrasyon-sorunlari-amazon-stok-ve-fiyat-senkronizasyonunda-cozum-bekliyor).

### 2.11 Pazarus (pazarus.io), an AI-first Turkish integrator with a free tier
- **Positioning:** "Pazaryeri Entegrasyonu ve E-Ticaret Yönetim Platformu".
- **Pricing Δ:** Basic **free** (all marketplace integrations, 2 BuyBox tracks, 50 AI requests/mo) · Enterprise ₺199 first month, then **₺1,399/mo** (was ₺999), 1,000 AI requests · Custom. Annual −29%.
- **AI:** marketplace Q&A auto-answers, categorization and content generation, price recommendations, return-reason analysis. **Traction:** 1,246 businesses, 424,373 orders (Δ up from 779 / 286k in Aug). **No Etsy/eBay.** Source: https://pazarus.io/

### 2.12 ShopiVerse (shopiverse.com), the closest "global integrator"
- **Positioning:** "SuperApp of Ecommerce". Multi-channel + fulfillment + WMS.
- **Pricing Δ (now published, USD):** Basic **$140/mo** ($1,680/yr; 1 web platform, 8 marketplaces, 1 carrier, 5k SKU, 1 user) · Pro **$300/mo** ($3,600/yr; 10 marketplaces, ERP) · Premium **$500/mo** ($6,000/yr; 12 marketplaces, 2 carriers, 3 users) · Enterprise quote. 14-day trial, 14-day money-back. Source: https://shopiverse.com/tr/fiyatlandirma/
- **Integrations:** Amazon, **eBay, Etsy**, Walmart, Wayfair, AliExpress, Rakuten, Trendyol, Hepsiburada, Allegro, eMag, Otto, TikTok Shop, Meta. Carriers UPS, DHL, FedEx, USPS, TNT, Aras. Fulfillment Huboo/Oplog/ShipBob. Accounting Xero/Logo/Paraşüt/Nebim. Source: https://shopiverse.com/tr/
- **AI:** "Yapay Zeka Destekli İçerik Çevirisi" only. **Research:** "Pazar Araştırması" is a service line item, not a self-serve tool.
- **Funding:** ~$917K total incl. 2023 equity crowdfunding ([vcbacked](https://www.vcbacked.co/company/shopiverse)). A ₺20M round was reported by Webtekno in the Aug notes but not re-verified this pass. No Şikayetvar page.
- **Exploitable weakness:** 2.4–5× KolayXport's price in USD, no AI listing generation, no self-serve research.

### 2.13 ShipEntegra (shipentegra.com), a notable addition (free software, competes on labels)
- **Positioning:** "Manage your e-export processes with ShipEntegra, save time and money".
- **Model:** "completely free shipping management software". Revenue comes from discounted carrier rates (claims up to 70%). Fulfillment (SEFF), FBA prep, IOSS.
- **Integrations:** 20+ marketplaces incl. **Etsy, eBay**, Walmart, Shopify, WooCommerce, AliExpress. Carriers FedEx, UPS, DHL, TNT, USPS, Hermes. Customs paperwork handled. Also an eBay export partner (https://export.ebay.com/tr/shipentegra).
- **Traction:** 10.48M+ shipments, 100k+ customers.
- **Hate:** Şikayetvar complaints about unexpected customs duties and retroactive charges ("Ship Entegra'dan 44 Dolar Değerindeki Gönderi İçin 488 Dolar Fahiş Gümrük Vergisi", https://www.sikayetvar.com/shipentegra/ship-entegradan-44-dolar-degerindeki-gonderi-icin-488-dolar-fahis-gumruk-vergisi).
- **Implication:** Turkish Etsy sellers often already ship via ShipEntegra for free. **KolayXport should not try to win on labels against free.** Either integrate with or coexist alongside ShipEntegra, and sell listing, AI, research and finance.

### 2.14 eRank (erank.com)
- **Positioning:** "Use eRank for free. Upgrade to track competitors…" · "Trusted by over 2 million sellers."
- **Pricing:** Free · Basic $5.99/mo ($65.99/yr) · Pro $9.99 ($94.99/yr) · Expert $29.99 ($269.99/yr). Source: https://erank.com/pricing
- **Features:** keyword research (5–500/day), competitor tracking (0–200), listing audits, AI Listing Helper (1–100/day). Keyword data spans Etsy, Amazon, eBay, Printify. Chrome extension.
- **Reviews:** Trustpilot 3.1/5 (4 reviews). Praised as "one of the best value-for-money tools available" (2026-07-25). Complaints about refund policy and hidden plan limits. https://www.trustpilot.com/review/erank.com
- **Weakness:** read-only. You copy keywords elsewhere. No listing write-back, no ops, no Trendyol, EN only.

### 2.15 Marmalead (marmalead.com)
- **Pricing:** $19/mo · $53/quarter · $190/yr · $300 lifetime. Claims "260,503" shops. AI description critique and AI FAQs. Etsy only. Source: https://marmalead.com/pricing
- **Reviews:** Trustpilot 2.0/5 (11 reviews, 82% 1-star). Billing-after-cancel and "does nothing to improve SEO" (2026-09-30). https://www.trustpilot.com/review/marmalead.com

### 2.16 EverBee (everbee.io)
- **Pricing Δ (cut since Aug):** Hobby free · Growth **$24.99/mo** ($299/yr; was $39) · Business **$69/mo** ($828/yr; was $99). AI actions 100/mo on Growth. Etsy only. "Trusted by 1M+ sellers". Source: https://everbee.io/pricing/
- **Reviews:** Trustpilot 3.0/5 (57 reviews). Praised for deep per-listing research. Criticized for auto-renew billing and poor mobile ("Site is borderline useless on my mobile browser", 2026-09-25). https://www.trustpilot.com/review/everbee.io

### 2.17 Alura (alura.io)
- **Pricing:** Free · Basic $7.99 · Growth $14.99 · Professional $29.99 (annual up to −50%). "Join 848,058+ Etsy sellers". Etsy only. AI listing optimization, AI support replies, A/B tests, Pinterest. Source: https://www.alura.io/pricing
- **Reviews:** Trustpilot 3.9/5 (435 reviews). "It saves me hours and hours of time." (2026-09-09) vs "Support is almost non existent. Product is buggy." (2026-07-31). https://www.trustpilot.com/review/alura.io

### 2.18 Vela (getvela.com), the UX reference for bulk editing
- **Positioning:** "The AI edge for eCommerce sellers" · "100,000+" sellers.
- **Pricing:** Lite $29.95/mo · Plus $39.95/mo (0–500 listings; scales up to 10K+ quote). −20% multi-shop. 1-week trial, no card. Channels: Etsy, Shopify, eBay, Faire (no Amazon, no Trendyol). AI scoring, bulk optimization (Plus), photo studio (bg removal, alt text, mockups). Source: https://getvela.com/pricing
- **Reviews:** Shopify App Store 4.5★ (239), praised for bulk listing at scale (https://apps.shopify.com/vela). Trustpilot 2.3/5 (7): "Full of bugs, unusable for larger stores" (2025-10-09) (https://www.trustpilot.com/review/getvela.com).
- **Weakness:** no orders, labels, research or finance, and no Turkish support.

### 2.19 ShipStation (shipstation.com)
- **Pricing Δ:** Starter **$14.99/mo** (50 shipments, 3 users) · Standard $29.99+ (scales with volume) · Premium $349.99. 30-day trial, −20% annual. Etsy/eBay/Amazon/Shopify, 200+ carriers. Source: https://www.shipstation.com/pricing/
- **Reviews:** Trustpilot 3.5/5 (713). Phone support praised. Complaints about billing and cancellation ("Deceptive Billing and Phantom Fees", 2026-08-04). https://www.trustpilot.com/review/shipstation.com
- **Weakness for TR sellers:** US-carrier/USPS-centric with no Turkish origin rates, no ETGB, no e-Arşiv.

---

## 3. Feature matrix

✓ = yes · ◐ = partial/limited/add-on only · ✗ = no · ? = not verifiable from public pages

| Capability | **KolayXport** | BirFatura | Sentos | Entegra | Dopigo | PraPazar | Yengeç | ikas | Ticimax | Zunapro | ShopiVerse | ShipEntegra | eRank | Alura | EverBee | Marmalead | Vela | ShipStation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Etsy orders/stock sync | ✓ | ✓ | ◐ (Platinum) | ◐ (Paket 5) | ✗ | ✓ | ◐ ($/store) | ◐ (Scale+) | ◐ | ✗ | ✓ | ◐ (orders) | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (orders) |
| Etsy listing editing (single) | ✓ | ✗ | ◐ (push/pull) | ? | ✗ | ◐ | ✗ | ? | ? | ✗ | ◐ | ✗ | ✗ | ◐ | ✗ | ✗ | ✓ | ✗ |
| Etsy/eBay bulk editing (photos, variations, staged sync) | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ (bulk price) | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| eBay | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ? | ? | ✓ | ✓ | ✓ | ◐ (kw data) | ✗ | ✗ | ✗ | ✓ | ✓ |
| Amazon orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Amazon listing edit | ✗ | ? | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Trendyol | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Advance+) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Hepsiburada / N11 / Çiçeksepeti | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ (HB) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Shopify / Wix | ✓ / ✓ | ✓ / ? | ✓ / ? | ✓ / ? | ✓ / ✗ | ✓ / ? | ✓ / ✓ | own store | own store | ? | ✓ / ? | ✓ / ? | ✗ | ✗ | ✗ | ✗ | ✓ / ✗ | ✓ / ✓ |
| AI listing text (English, marketplace SEO) | ✓ | ✗ | ✗ | ◐ (TR product add) | ◐ (TR SEO desc) | ◐ (auto desc) | ✗ | ◐ (store, translate) | ◐ (store) | ✗ | ◐ (translation) | ✗ | ✓ | ✓ | ◐ | ◐ (critique) | ✓ | ✗ |
| AI product photos | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| AI customer replies | ✓ (Wix+Trendyol) | ✗ | ✗ | ? | ✓ (TR mkpl Q&A) | ✗ | ✗ | ◐ (chatbot) | ? | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Keyword / competitor research | ✓ (Etsy/eBay/Amazon/Trendyol) | ✗ | ✗ | ◐ (price) | ◐ (Buybox) | ◐ (add-on price) | ◐ (Buybox add-on) | ✗ | ✗ | ◐ (smart pricing) | ◐ (service) | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Cross-market arbitrage (Trendyol→eBay) | ✓ (Pro) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Chrome extension overlays | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Intl labels FedEx/UPS/DHL | ✓ (FedEx, UPS) | ? | ✓ (Plus+) | ✓ | ◐ | ◐ (+₺13k add-on) | ✓ (+$/carrier) | ◐ | ◐ | ✓ | ✓ | ✓ (free) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Turkish domestic carriers (Yurtiçi/Aras/MNG) | ◐ (DHL eCom/MNG only) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ (Aras) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Customs / ETGB support | ✓ (ETGB Excel + customs on labels) | ◐ (e-Arşiv for ETGB) | ◐ (export invoice) | ? | ? | ? | ? | ◐ (customs tax, Global store) | ? | ? | ? | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (customs forms) |
| e-Fatura / e-Arşiv | ◐ (Paraşüt only) | ✓ (is provider) | ✓ | ✓ | ✓ (Sovos/ICE/SNI) | ✓ (add-on) | ✓ | ✓ | ✓ | ✓ | ◐ (via ERP) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Multi-channel stock sync | ✓ (Etsy/eBay/Trendyol/Shopify/Wix) | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ (₺1,400 add-on) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (Premium) |
| Multi-marketplace finance / P&L | ✓ (Etsy/eBay/Amazon/Trendyol) | ✗ | ◐ (hakediş, Platinum) | ◐ (reconciliation add-on) | ◐ (gelir/gider) | ◐ (+₺5,150 reports) | ✗ | ✗ | ✗ | ◐ (commission calc) | ◐ (reports) | ✗ | ✗ | ◐ | ◐ (revenue est.) | ✗ | ✗ | ✗ |
| Unified inbox | ✓ (Wix+Trendyol) | ✗ | ✗ | ? | ◐ (Q&A) | ✗ | ✓ (Q&A) | ◐ | ? | ✗ | ◐ (CS mgmt) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Team / sub-users | ✗ | ? | ✓ | ✓ | ? | ✓ (Uzman+) | ? | ✓ | ✓ | ✓ | ✓ | ? | ✗ | ◐ | ✗ | ✗ | ✗ | ✓ |
| Turkish UI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| English UI | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (app TR-only) | ✓ | ? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Monthly billing available | ✓ | ✓ | ✗ | ✗ | ✗ | ◐ (Eko only) | ✓ | ✗ (annual) | ✗ (GO ₺599/mo only) | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Free tier | ✗ (14-day trial) | ✓ | ✗ | ✗ | ✗ (2-wk trial) | ✗ (5-day demo) | ✗ (15-day trial) | ✓ (store only) | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

Notes: Sopyo and Pazarus are omitted from the matrix for width, since they are domestic-only (no Etsy/eBay) and covered in §2. "?" means the vendor's public pages did not settle the question, so verify before using it in a comparison.

---

## 4. Pricing comparison

Monthly equivalents are computed from published annual prices. USD at ₺49.2. VAT treatment follows each vendor (Entegra/Sentos/Zunapro/Yengeç quote VAT-inclusive; PraPazar 0% VAT). **Confirm whether KolayXport list prices include KDV before publishing any comparison.**

| Product | Entry (cheapest paid) | Tier needed for Etsy/eBay export | Top published | Billing | Free tier / trial |
|---|---|---|---|---|---|
| **KolayXport** | Starter ₺2,499/mo ($59) | Starter (Etsy/eBay incl.) | Pro ₺7,999/mo ($149) | Monthly; annual = 2 months free | 14-day no-card trial; founding 40% off for life (20 spots) |
| BirFatura | ₺790/mo or ₺7,100/yr (+kontör) | same (Etsy; no eBay) | ₺7,100/yr + kontör | Monthly or annual | Free tier (20 kontör), 14-day trial |
| Yengeç | ₺600/mo (1 integration) | +$22.90/mo **per export store** (+$22.90/carrier) | ₺3,600/mo unlimited | Monthly or annual (~10×) | 15-day trial |
| Zunapro | ₺1,900/mo | Pro+ ₺7,900/mo (intl; eBay, no Etsy) | Special (quote) | Monthly | Free Starter forever |
| PraPazar | Eko ₺2,550/mo | Etsy/eBay listed as integrations; cargo +₺13,000 add-on | Enterprise ₺74,250/yr (≈₺6,188/mo) | Eko monthly; others annual | 5-day demo |
| Pazarus | ₺1,399/mo (₺199 1st month) | n/a (no Etsy/eBay) | Custom | Monthly; annual −29% | Free Basic |
| Dopigo | ₺24,999/yr (≈₺2,083/mo) | n/a (no Etsy/eBay) | ₺74,999/yr | Annual (3 installments) | 2-week trial |
| Sopyo | ₺25,000/yr (≈₺2,083/mo) | not documented | ₺99,000/yr | Annual | — |
| Sentos | ₺9,500/yr (≈₺792/mo) | **Platinum ₺89,000/yr (≈₺7,417/mo, ~$151)** | Prestige (quote) | Annual (3 installments) | — |
| Entegra | ₺10,500/yr invoice-only; ₺24,750/yr Paket 0 | **Paket 5 ₺125,000/yr (≈₺10,417/mo, ~$212)** | ₺125,000/yr + Flexible | Annual | — |
| ikas | Lift ₺55,927/yr | **Scale ₺83,983/yr (≈₺6,998/mo)** | Scale Plus ₺139,423/yr+ | Annual (multi-year promos) | Free Start (store) |
| Ticimax | GO ₺599/mo (KOBİ, 2026); Advantage ₺46,000/yr | Advance Plus ₺119,900/yr (3 intl. marketplaces) | Ultra (quote) | Annual (promo) | — |
| ShopiVerse | Basic $140/mo ($1,680/yr) | Basic (8 marketplaces) | Premium $500/mo | Monthly or annual | 14-day trial + 14-day refund |
| ShipEntegra | Free software | Free (pays on shipping rates) | — | Per shipment | Free |
| eRank | $5.99/mo | n/a (research) | $29.99/mo | Monthly/annual | Free tier |
| Marmalead | $19/mo | n/a | $300 lifetime | Monthly/qtr/annual/lifetime | — |
| EverBee | $24.99/mo | n/a | $69/mo | Monthly/annual | Free tier |
| Alura | $7.99/mo | n/a | $29.99/mo | Monthly/annual | Free tier |
| Vela | $29.95/mo (≤500 listings) | Lite (Etsy+eBay) | $39.95+/mo, scales by listings | Monthly | 1-week trial |
| ShipStation | $14.99/mo (50 shipments) | Starter | $349.99/mo | Monthly; −20% annual | 30-day trial |

**Stack math for a Turkish Etsy+eBay seller (monthly, Oct 2026):**
- *Integrator + research + editor:* Yengeç 3'lü ₺1,500 + 2 export stores ($45.80 ≈ ₺2,253) + eRank Pro ($9.99 ≈ ₺492) + Vela Lite ($29.95 ≈ ₺1,474) ≈ **₺5,700/mo**, across four logins with no AI photos, P&L or arbitrage. KolayXport Growth is ₺4,999.
- *Sentos route:* Platinum ≈ ₺7,417/mo prepaid annually (₺89k up front), still without eBay, AI or research.
- *Honest counterpoint:* a seller who only needs Etsy orders → e-Arşiv invoices can do that on BirFatura for ₺592–790/mo plus kontör. KolayXport cannot win that buyer on price, only on listing and growth tooling.

---

## 5. Facts for "KolayXport vs X" pages (sourced, last verified 2026-10-17)

State only these, with the link and date. Each fact is the vendor's own published claim. Avoid adjectives about competitors.

**vs Sentos**
- Sentos lists e-export integrations (Amazon, Etsy, Zalando, Ozon) in its Platinum package at ₺89,000/year. Source: https://www.sentos.com.tr/fiyatlar/
- Sentos's Etsy integration page lists Etsy under e-export and does not list eBay among its marketplaces. Source: https://www.sentos.com.tr/etsy-entegrasyonu/
- Sentos packages are priced annually (3 installments available). Source: https://www.sentos.com.tr/fiyatlar/

**vs Entegra**
- Entegra's e-export package (Temu, Etsy, Ozon) is listed in Paket 5, ₺125,000/year VAT-included. Source: https://www.entegrabilisim.com/paketler
- Entegra's integration packages are annual. e-Fatura credits are sold separately. Source: same.

**vs Dopigo**
- Dopigo's integrations page lists Amazon and Temu as international marketplaces. Etsy and eBay are not listed. Source: https://www.dopigo.com/tum-entegrasyonlar/
- Dopigo plans: ₺24,999 / ₺39,999 / ₺74,999 per year. Source: https://www.dopigo.com/fiyatlar/
- (Do not claim "Dopigo has no AI". It advertises AI images, SEO descriptions and Q&A drafts: https://www.dopigo.com/dopigo-yapay-zeka/)

**vs PraPazar**
- PraPazar lists cargo integration as a paid add-on (+₺13,000) and e-invoice integrations as +₺1,850–6,500. Source: https://prapazar.com/tr/paketler
- PraPazar's monthly plan (Eko) is ₺2,550/month. Other plans are annual. Source: same.

**vs BirFatura**
- BirFatura's marketplace integration is free with membership. Membership is ₺790/month or ₺7,100/year, and e-documents use paid kontör (from ₺0.355 to ₺0.96 each). Source: https://birfatura.com/e-fatura-kontor-fiyatlari-e-fatura-fiyatlari/
- BirFatura's marketplace page lists Amazon, Etsy, Ozon, AliExpress and Temu as international. eBay is not listed. Source: https://birfatura.com/pazaryeri-entegrasyonu/

**vs Yengeç**
- Yengeç export integrations are priced at $22.90/month per store, and export cargo at $22.90/month per carrier, on top of the base plan. Source: https://yengec.co/fiyatlar
- Yengeç's Shopify app listing is in Turkish only. Source: https://apps.shopify.com/yengec

**vs ikas**
- ikas lists "Trendyol, Hepsiburada, N11, Amazon ve ETSY Entegrasyonu" in its Scale package, ₺83,983/year. Source: https://ikas.com/tr/e-ticaret-paketleri

**vs Ticimax**
- Ticimax lists Trendyol/Hepsiburada/n11/Amazon & Temu integrations starting in the Advance package (₺99,000/year campaign price) and "3 Yurt Dışı Pazaryeri Entegrasyonu" in Advance Plus (₺119,900/year). Source: https://www.ticimax.com/e-ticaret-paketleri/

**vs Zunapro**
- Zunapro's marketplace page lists Amazon.de, eBay, Ozon, Temu, Otto, Zalando and Kaufland as international. Etsy is not listed. Source: https://www.zunapro.com/turkey/tr/pazaryeri

**vs ShopiVerse**
- ShopiVerse plans: $140 / $300 / $500 per month (Basic/Pro/Premium). Source: https://shopiverse.com/tr/fiyatlandirma/
- ShopiVerse's plan comparison lists "Yapay Zeka Destekli İçerik Çevirisi" as its AI feature. Source: same.

**vs Vela / eRank / Alura / EverBee / Marmalead**
- Vela supports Etsy, Shopify, eBay and Faire, from $29.95/month. Source: https://getvela.com/pricing
- eRank, Alura, EverBee and Marmalead are research/SEO tools. Their pricing pages describe no order management or shipping labels. Alura, EverBee and Marmalead describe themselves as Etsy tools. Sources: https://erank.com/pricing · https://www.alura.io/pricing · https://everbee.io/pricing/ · https://marmalead.com/pricing
- None of these vendors lists Trendyol or a Turkish-language interface (verified on the pricing pages above).

**vs ShipStation**
- ShipStation Starter is $14.99/month for 50 shipments. Source: https://www.shipstation.com/pricing/

**KolayXport-side facts that must stay true when published:** Etsy, eBay, Trendyol, Shopify and Wix editing. FedEx, UPS and DHL eCommerce (MNG) labels. ETGB Excel. Paraşüt e-Fatura/e-Arşiv. TR+EN UI. Monthly billing, 14-day no-card trial. **Do not claim** Hepsiburada/N11, Yurtiçi/Aras, team accounts, Amazon listing editing, or "the only AI integrator in Turkey" (Dopigo, Pazarus, ikas, Ticimax and Entegra all market AI).

---

## 6. Risks: who can copy us fastest

| Threat | Likelihood | Why | Mitigation |
|---|---|---|---|
| **Dopigo adds Etsy/eBay** | Medium–High | Already has the AI stack (images, SEO text, Q&A drafts) and 4,000+ sellers. Etsy is only an API integration away. | Win on Etsy depth: staged bulk edit, variations, video, English SEO rules, research and arbitrage. Ship Etsy research that Dopigo can't bolt on quickly. |
| **PraPazar / Yengeç add AI listing text** | High | They already have Etsy+eBay pipes, and generic LLM description generation is cheap to add. | Moat is research-grounded AI (keywords from live Etsy/eBay data), plus the Chrome extension and finance. Publish proof (before/after listings). |
| **ShipEntegra adds listing tools** | Medium | 100k customers, free software, Etsy/eBay already connected. It owns the export seller relationship. | Partner or integrate: let KolayXport create ShipEntegra shipments. Don't fight on label price. |
| **ShopiVerse adds AI listing + research** | Medium | Already global multi-channel with funding, but priced $140+ and enterprise-tilted. | Hold the SMB price point (₺2,499) and the TR-founder/Etsy-craft niche. |
| **Vela / Alura add Trendyol or a Turkish UI** | Low | Turkey is a small market for them, and Trendyol API onboarding is local. | — |
| **Etsy/eBay native AI** (Etsy's own listing AI, eBay "magical listing") | High (ongoing) | Platforms commoditise AI titles/descriptions for free. | Value shifts to cross-marketplace research, bulk operations and ops+finance, not single-listing text. |
| **Price war from free tiers** (BirFatura, Zunapro, Pazarus, ikas Start, ShipEntegra) | High | Turkish sellers anchor on "ücretsiz". | Consider a free research-only or Chrome-extension tier as the top of funnel. Keep the founding-member discount visible. |
| **Domestic coverage gap** | Ongoing | Sellers who also sell on HB/N11 need a second tool anyway, and that tool may then upsell Etsy. | Integrate with or coexist alongside BirFatura/Yengeç for domestic channels, or prioritise Hepsiburada next. |

---

### Source index (all checked 2026-10-17)
Vendor pages: birfatura.com (/pazaryeri-entegrasyonu/, /etsy-entegrasyonu/, /e-fatura-kontor-fiyatlari-e-fatura-fiyatlari/) · sentos.com.tr (/fiyatlar/, /etsy-entegrasyonu/) · entegrabilisim.com/paketler · dopigo.com (/fiyatlar/, /tum-entegrasyonlar/, /dopigo-yapay-zeka/) · prapazar.com (/tr/paketler, /tr/entegrasyon/etsy-entegrasyonu) · yengec.co (/, /fiyatlar) · ikas.com (/tr/e-ticaret-paketleri, /tr/pazaryeri-entegrasyonlari) · ticimax.com/e-ticaret-paketleri/ · zunapro.com/turkey/tr/pazaryeri · sopyo.com/fiyatlar · pazarus.io · shopiverse.com (/tr/, /tr/fiyatlandirma/) · shipentegra.com · erank.com/pricing · marmalead.com/pricing · everbee.io/pricing/ · alura.io/pricing · getvela.com/pricing · shipstation.com/pricing/
Reviews: sikayetvar.com (sentos, dopigo, entegra, birfatura, prapazar, sopyo, shipentegra brand pages) · trustpilot.com (getvela.com, erank.com, alura.io, everbee.io, marmalead.com, shipstation.com) · apps.shopify.com (vela, yengec)
Secondary: paradergi.com.tr (Ticimax GO Paket, 2026-04-01) · vcbacked.co (ShopiVerse funding) · turkgun.com (FX)
