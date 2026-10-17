# KolayXport public site audit

Audited 2026-10-17 against live production `https://kolayxport.com`. Source reference: branch `gtm/overhaul` of this repo.

**Method**
- Lighthouse 12, mobile emulation with simulated throttling, one run per route. Raw JSON is in the session scratchpad and is not committed.
- Playwright with headless Chrome at 375×812 and 1440×900, plus axe-core using the wcag2a, wcag2aa, wcag21aa and wcag22aa tags.
- DOM extraction of SEO facts, an HTTP status check of every internal and outbound link, and a fetch of every `og:image`, `/sitemap*.xml`, `/robots.txt` and `/favicon.ico`.
- Screenshots are full-page. Scroll-reveal animations were forced visible for the capture. In a normal full-page capture these sections are blank: see sitewide item S-5.

**Live vs branch.** Three fixes are committed on `gtm/overhaul` but are not live. Every finding below describes **production**. Where the branch already fixes something, the fix list says so.
- `af08f85` makes the trial 14 days everywhere.
- `20ef38b` makes `/login?mode=signup` open the signup form.
- `cc1c991` hardens the contact form.

---

## 1. Scorecard

Scores run from 1 (bad) to 5 (good). Column abbreviations:
- **Msg**: message clarity
- **Vis**: visual quality
- **Mob**: mobile UX
- **CWV**: Core Web Vitals
- **A11y**: accessibility
- **SEO**: SEO
- **Conv**: conversion path
- **Trust**: trust signals
- **LH P/A/BP/S**: Lighthouse mobile scores for Performance, Accessibility, Best Practices and SEO

| Page | Msg | Vis | Mob | CWV | A11y | SEO | Conv | Trust | LH P/A/BP/S | LCP | CLS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 3 | 3 | 3 | 1 | 3 | 2 | 2 | 1 | 56/94/96/100 | 8.3 s | 0 |
| `/en` | 3 | 3 | 3 | 1 | 3 | 2 | 2 | 1 | 69/94/96/100 | 7.0 s | 0 |
| `/ozellikler` | 3 | 3 | 2 | 1 | 4 | 3 | 2 | 2 | 57/98/96/100 | 7.8 s | 0 |
| `/entegrasyonlar` | 4 | 3 | 2 | 1 | 3 | 3 | 1 | 2 | 69/98/96/100 | 7.8 s | 0 |
| `/fiyatlandirma` | 4 | 3 | 2 | 1 | 4 | 2 | 2 | 2 | 63/98/96/100 | 8.9 s | 0 |
| `/nasil-kullanirim` | 2 | 2 | 3 | 2 | 3 | 3 | 2 | 1 | 65/94/96/100 | 6.2 s | 0 |
| `/kurumsal` | 2 | 3 | 3 | 2 | 3 | 3 | 2 | 1 | 71/96/96/100 | 6.2 s | 0 |
| `/blog` | 2 | 3 | 3 | 1 | 4 | 2 | 2 | 1 | 69/100/96/100 | 7.8 s | 0 |
| `/blog/[slug]` | 2 | 3 | 3 | n/a | 4 | 1 | 2 | 1 | not run | — | — |
| `/iletisim` | 3 | 3 | 3 | 1 | 4 | 3 | 3 | 2 | 67/96/96/100 | 7.8 s | 0 |
| `/kariyer` | 1 | 2 | 2 | 1 | 4 | 2 | n/a | 1 | 68/100/96/92 | 7.7 s | 0 |
| `/support` (unlinked) | 2 | 3 | 3 | 2 | 3 | 2 | 2 | 1 | 73/94/96/100 | 6.3 s | 0 |
| `/docs` | 1 | 3 | 3 | 1 | 3 | 1 | 1 | 1 | 71/96/96/100 | 7.8 s | 0 |
| `/privacy`, `/privacy-tr` | 3 | 3 | 4 | 2 | 5 | 2 | n/a | 2 | 73/100/96/100, 72/100/96/100 | 6.2–6.3 s | 0 |
| `/terms`, `/terms-tr` | 3 | 3 | 4 | 1 | 5 | 2 | n/a | 2 | 70/100/96/100 | 7.5 s | 0 |
| `/docs/terms`, `/docs/terms-tr` | 2 | 3 | 4 | — | 5 | 1 | n/a | 1 | not run | — | — |
| `/login` | 3 | 3 | 4 | 1 | 5 | 2 | 1 | 2 | 70/100/96/100 | 7.5 s | 0 |

**What the numbers say**
- **Lighthouse SEO 100 is misleading.** Lighthouse does not check that the OG image is valid, that hreflang pairs are correct, that the sitemap is clean, or that the blog renders on the server. All four are broken (section 3).
- **LCP is slow on every page, with one cause.**
  - LCP is 6–9 s everywhere, while first paint is 1.1 s.
  - Render delay accounts for 92–93% of LCP, and the LCP element is the cookie banner `<p class="text-sm text-gray-600">` on every page.
  - The banner is client-only, and all server-rendered content starts at `opacity:0`: 32 `style="opacity:0…"` nodes in the home HTML.
  - So nothing counts as painted until the 565 KB `_app` chunk hydrates.
  - Details in S-5.
- **Best Practices is 96 on every page.** The only failures are console errors (`/favicon.ico` 404, plus page-specific 404s) and missing source maps.

---

## 2. Per-page findings

### `/` Home
Screenshots: [375](audit/screens/home-375.jpg) · [1440](audit/screens/home-1440.jpg)

**Hero:** "AI Destekli E-Ticaret Komuta Merkezi — Pazar araştırması, AI listeleme, rakip analizi, sipariş yönetimi ve kargo — Etsy, eBay, Amazon, Trendyol, Wix ve Shopify için ihtiyacınız olan her şey, %100 Türkçe." CTAs: "30 Gün Ücretsiz Dene", then "Özellikler →".

**Message**
- The hero says "everything for everyone". A Turkish seller cannot tell within 5 seconds whether this is for Etsy exporters, Trendyol sellers or arbitrage.
- There is no outcome ("save X hours", "ship to the US in one click") and no target persona.
- The hero image is a stock laptop-on-desk render, not the product.

**Trust**
- **Testimonials are unverifiable.** The three cards are attributed to "Etsy Satıcısı", "E-ticaret Girişimcisi" and "Online Mağaza Sahibi". They have letter avatars and hardcoded 5★ ratings, with no name, shop, photo or link.
  - Source: `components/marketing/HomeContent.js`, `messages/tr.json` (≈ line 9226).
  - Under the Turkish advertising rules (Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği), unverifiable testimonials are a risk.
- **Mock figures read as real proof.**
  - The extension mockup shows "~142 Aylık Satış / $18.4K Tahmini Gelir / 4.9★ Mağaza Puanı" (`HomeContent.js` ≈ lines 284–367).
  - The arbitrage card shows ₺459 → $38.50, ROI +95%, labelled "Gerçek tarama örneği — Türk Peştemal kategorisi". Calling it a real scan is a factual claim; keep it only if it is reproducible.
- No customer count, logos of real customers, company details, ratings-platform badge (Shopify App Store, Chrome Web Store) or founder face.

**Conversion**
- All 4 trial CTAs go to `/login`, which opens in **login** mode.
- Signup takes: CTA, then the "Hesabınız yok mu? Kayıt Ol" link, then the form. That is 2 clicks plus the form, and the page is titled "Giriş Yap".
- Pricing is reachable only from an inline text link in the bottom CTA band ("Fiyatlandırma planlarını inceleyin"). The nav has no pricing link.

**Copy**
- "30 Gün Ücretsiz Dene" contradicts `/fiyatlandirma`, which says "14 gün ücretsiz".
- English inside Turkish copy: "timeout olmadan tara". "Kâr" and "Kar" are used inconsistently.
- The footer has English "Privacy Policy" and "Terms of Service" links next to the Turkish ones, on a page that claims "%100 Türkçe".

**Visual and mobile**
- The marketplace strip shows Etsy as a grey serif "E", and the Trendyol logo is about 30 px wide and unreadable (screenshot 375, about y=1100).
- The cookie banner covers about 17% of the first mobile viewport.
- The page is 14,193 px tall at 375 px. The "Her Plana Dahil" checklist alone is 16 full-width rows (about 1,500 px).

**Accessibility (axe)**
- `color-contrast` ×7. Example: orange badge `#f54900` on `#ffedd4`, 3.13:1.
- `link-in-text-block` ×1: an inline link is 1.44:1 against the surrounding text.

**SEO**
- Title is 82 characters and gets truncated.
- One H1. Canonical is correct.
- OG image is broken: S-2.
- JSON-LD has **Organization twice**, plus FAQPage and SoftwareApplication with `price:"0"` and "30 gun ucretsiz deneme" (no Turkish characters).

**Console:** `/favicon.ico` 404.

### `/en`
Screenshots: [375](audit/screens/en-375.jpg) · [1440](audit/screens/en-1440.jpg)

- **Hero:** "AI-Powered E-Commerce Command Center". Same content as `/` in English.
- **`<html lang="tr">` on the English page**, set in `pages/_document.js` and only synced on the client.
- hreflang is fine on this page only (tr, en, x-default). The other English pages do not exist, so the EN toggle drops users back into Turkish everywhere else.
- axe: 15 contrast failures. Example: `#739efd` on white, 2.61:1.
- "Start 30-Day Free Trial" also conflicts with 14 days.

### `/ozellikler`
Screenshots: [375](audit/screens/ozellikler-375.jpg) · [1440](audit/screens/ozellikler-1440.jpg)

- **Hero:** "KolayXport'un Güçlü Özelliklerini Keşfedin — E-ticaret operasyonlarınızı basitleştiren, zaman kazandıran…" This is generic self-praise with no product image.
- **Breadcrumb overlaps the fixed nav.** "Ana Sayfa > Özellikler" renders under and over the "KolayXport" logo on mobile and desktop. Visible in a live viewport, not only in the screenshot. Source: `components/Breadcrumb.js`, which has no top offset for the 72 px fixed `PublicNav`.
- 15 feature cards with icons only: no screenshots, GIFs or before/after.
- The "30 Gün Ücretsiz Deneme" card says "Kredi kartı gerekmeden".
- The card text "Avrupa merkezli (Almanya) kurumsal sunucu altyapımız" is fine, but there is no DPA or security page to back it.
- OG image `og-ozellikler.png` is a valid image but **1536×1024 and 2.5 MB**. Recommended: 1200×630, under 300 KB.
- Lighthouse Performance is 57, and TBT is 760 ms, the worst of all pages.

### `/entegrasyonlar`
Screenshots: [375](audit/screens/entegrasyonlar-375.jpg) · [1440](audit/screens/entegrasyonlar-1440.jpg)

- **Hero:** "Etsy'den Trendyol'a, UPS'ten FedEx'e — Tek Çatı Altında — 6 pazaryeri, 4 kargo entegrasyonu ve AI araçları. 30 gün ücretsiz denemede hepsi dahil." This is the clearest hero on the site.
- **All 13 "Detayları Gör →" links point into the app** (`/ayarlar?tab=connections`, `/ayarlar?tab=apiKeys`, `/ayarlar`). An anonymous visitor lands on the login wall instead of integration detail. There are no per-integration landing pages, which wastes the "Trendyol entegrasyonu" and "Etsy entegrasyonu" search intent.
- **Logos are inconsistent:**
  - Etsy uses an "E" glyph.
  - eBay uses a generic shopping-cart icon.
  - Wix uses a lightning-bolt icon.
  - The Shopify card has **no icon at all**.
  - Trendyol is a tiny wordmark.
- Same breadcrumb overlap as `/ozellikler`.
- axe: 13 contrast failures, including the `#90a1b9` "Kurulum Adımları" label at 2.63:1.
- The integration list here excludes Hepsiburada and n11. `/nasil-kullanirim` and `/iletisim` claim them: see the claims list under `/iletisim`.

### `/fiyatlandirma`
Screenshots: [375](audit/screens/fiyatlandirma-375.jpg) · [1440](audit/screens/fiyatlandirma-1440.jpg)

- **Hero:** "Fiyatlandırma — Etsy, eBay, Amazon, Trendyol ve daha fazlası için siparişler, etiketler, ilanlar ve araştırma. 14 gün ücretsiz. Kart gerekmez."
- **The H1 overlaps the fixed nav** on both 375 and 1440, where "Fiyatlandırma" is drawn through the "KolayXport" logo. `components/domain/pricing/PricingPage.tsx` has no top padding under the 72 px nav.
- **Not linked from the nav** (`components/PublicNav.js`) or the footer.
- **Trial length:**
  - This page says 14 days in copy, meta description and FAQ ("Kart girmeden 14 gün boyunca Pro özelliklerini kullanırsınız…").
  - Every other page and the JSON-LD say 30.
  - This is the single most visible contradiction on the site.
- **CTAs** go to `/login?mode=signup&callbackUrl=%2Fapp&plan=…`. On production, `mode=signup` is ignored and the form opens in login mode (screenshot [login-mode-signup-375](audit/screens/login-mode-signup-375.jpg)). Fixed on the branch in `20ef38b`.
- **`GET /api/billing/founding-spots` returns 404** on every load, with a console error. The founding-member counter the code expects is not deployed. The SWR polling also keeps the page from reaching network-idle, which made Playwright time out.
- **Mixed language:** a visible "Pricing summary (English)" block sits at the bottom of the Turkish page.
- On mobile, **Growth renders before Starter**, so the cheapest plan is second. The comparison table collapses to a single column with no plan header.
- No VAT note: it does not say whether ₺2.499 includes KDV. Turkish B2B buyers expect "+KDV" or "KDV dahil".
- "AI kredisi" is not explained.
- OG `og-pricing.png` returns **404** (HTML).

### `/nasil-kullanirim`
Screenshots: [375](audit/screens/nasil-kullanirim-375.jpg) · [1440](audit/screens/nasil-kullanirim-1440.jpg)

- **Hero:** "KolayXport Nasıl Çalışır? — Sadece 4 basit adımda e-ticaret operasyonlarınızı otomatikleştirin…"
- **Placeholder video.** Under "Detaylı İnceleyin" the copy promises "aşağıdaki videomuzda keşfedin", and the block shows **"Video yakinda gelecek / Tanitim videomuz hazirlanmaktadir"**. The placeholder has no Turkish characters. Source: `pages/nasil-kullanirim.js:145`.
- **Step 2** lists "Trendyol, Hepsiburada, Amazon, Shopify…". Hepsiburada is not an integration on `/entegrasyonlar`.
- **The "Ek Bilgiler" section describes features I could not verify:**
  - CSV import/export.
  - "Otomasyon Kuralları", for example auto-adding insurance above an amount or routing by region.
  - "müşteri analizleri".
  - Confirm each exists or remove it.
- The step cards truncate mid-word on mobile ("hesabınız…"). Only step 1 is expanded.
- "Belgeleri Oku" goes to `/docs`, which is a fake API portal (see `/docs`).

### `/kurumsal`
Screenshots: [375](audit/screens/kurumsal-375.jpg) · [1440](audit/screens/kurumsal-1440.jpg)

- **Hero:** "Hakkımızda — E-ticaret satıcılarının süreçlerini hızlandıran KolayXport, İstanbul'da doğdu, dünyaya açıldı."
- **Timeline contradicts `/kariyer`:**
  - `/kurumsal` says founded 2019, prototype 2020, "Resmi Lansman" 2022.
  - `/kariyer` says "2023 MVP Lansmanı" and "2024 İlk 50 Satıcı".
  - The 2022 entry also says "resmi olarak piyasaya sürüldü, ilk kullanıcılarla test edildi", which describes a launch and a test in the same line.
- "Sayılarla KolayXport" shows only capability counts (6+ pazaryeri, 4 kargo, "AI", "7/24 Erişim"). It has no customer, order or label numbers.
- No team, founder name, photo, address, MERSİS or vergi no.
- Mission and values are boilerplate ("Müşteri Odaklılık, İnovasyon, Şeffaflık…").
- Claims "düzenli güvenlik denetimleri" with no evidence page.
- OG `og-about.png` is **not an image**: a 1,815-byte text file containing a `data:image/png;base64,…` string.

### `/blog` and `/blog/[slug]`
Screenshots: [blog 375](audit/screens/blog-375.jpg) · [1440](audit/screens/blog-1440.jpg) · [post 375](audit/screens/blog-kargo-maliyet-optimizasyonu-375.jpg) · [post 1440](audit/screens/blog-kargo-maliyet-optimizasyonu-1440.jpg)

- **Stale.** The newest post is dated 2025-01-15. The "E-Ticaret Otomasyon Rehberi 2025" title is now dated, and nothing has been published in 21 months.
- **Authors look fabricated.** "Ahmet Yılmaz, Zeynep Kaya, Mehmet Özkan, Ayşe Demir, Emre Şahin, Burak Yıldız" are the most common Turkish names, with no bios or profiles. The company is a solo founder.
- **Unsourced statistics.**
  - "Kargo Maliyetlerini %30 Azaltmanın 7 Yolu" contains "%15-30 indirim", "%10-20 tasarruf" and "%40'a kadar", all without sources.
  - The post has only **3 sections**, not 7.
  - It claims "KolayXport'un otomatik fiyat karşılaştırma özelliği", a rate-shopping feature not described anywhere else.
- **Typos in the post body:** "yapiyorsanız", "üçretlerden", "Teslimat'a" in a title.
- **The post body does not server-render.**
  - The SSR HTML for `/blog/kargo-maliyet-optimizasyonu` contains `<h1>Yazı bulunamadı</h1>` and none of the body text. The post only appears after client JS runs `router.query`.
  - Unknown slugs (`/blog/olmayan-yazi`) return **HTTP 200**, a soft 404.
  - Source: `pages/blog/[slug].js`, which needs `getStaticPaths` and `getStaticProps`.
- Post OG image `/images/blog-placeholder.png` returns **404**. `next/image` also returns 400 for it, with a console error.
- Mobile: the meta row (category · date · read time · author) wraps into 4 cramped columns. Dates are ISO (`2025-01-15`) instead of Turkish format.
- "Abone Ol" newsletter CTA: not tested.

### `/iletisim`
Screenshots: [375](audit/screens/iletisim-375.jpg) · [1440](audit/screens/iletisim-1440.jpg)

- **Hero:** "Bize Ulaşın — Sorularınız, önerileriniz veya işbirliği talepleriniz için buradayız."
- **Good:** the legal entity is named, "Modsons Yazılım E-Ticaret Ltd. Şti."
- **Missing:** street address, phone, WhatsApp, MERSİS and vergi dairesi/no.
- The "Konumumuz" map is an empty grey box reading "Istanbul, Turkiye", without Turkish characters.
- **FAQ makes false or contradictory claims:**
  - "Trendyol, Hepsiburada, Amazon, **n11**, Shopify, **WooCommerce** ve daha birçok…". n11 and WooCommerce are not integrations (`pages/iletisim.js:286`).
  - "E-posta yoluyla 7/24 destek… Acil durumlarda **telefon desteği** de mevcuttur… video rehberlerimiz". There is no phone number and no videos (`pages/iletisim.js:290`).
  - "Kullandığınız kadar ödersiniz". Pricing is flat tiers.
  - "30 günlük ücretsiz deneme".
- **Duplicated contact cards:** "Destek" and "E-posta" both show `destek@kolayxport.com`, and the address appears three times on the page.
- The "Iletisim Formu" card reads "Detayli sorulariniz icin yukaridaki formu kullanabilir veya dogrudan e-posta gonderebilirsiniz", with no Turkish characters.
- Form submission was not tested, to avoid sending mail. Branch `cc1c991` hardens it.

### `/kariyer`
Screenshots: [375](audit/screens/kariyer-375.jpg) · [1440](audit/screens/kariyer-1440.jpg)

- **Hero:** "Vibe Coding Seviyorsan, E-İhracata İz Bırak! — Monorepo, taze kahve, mem'ler ve TypeScript. KolayXport, gönüllü-odaklı ekibine yeni yoldaşlar arıyor."
- **This page damages credibility with buyers.**
  - All roles are unpaid ("Açık Pozisyonlar (Gönüllü)", "Haftada 5-10 saat (gönüllü)"), with "Token Vested" and "token payı" compensation.
  - It says "Projemiz büyüdükçe ve gelir elde etmeye başladıkça…", which tells prospects the product has no revenue.
  - It claims "Kodlarımızın bir kısmı GitHub'da" with no link, "Topluluk Yöneticisi (Discord/Forum)" with no Discord, and a roadmap ending at 2025.
- **The nav is invisible on the dark hero.** The dark logo and hamburger sit on `#1e293b` (live viewport check).
- **Hydration error:** React #418 is thrown 3× on load.
- Lighthouse SEO 92 (`crawlable-anchors`).
- OG `og-kariyer.png` returns **404**.
- Heavy English: "Remote-First", "Continuous Shipment", "Vibe Coding", "side-project", "commit mesafesinde".

### `/support` (not linked from nav or footer; footer "Destek" goes to `/iletisim`)
Screenshots: [375](audit/screens/support-375.jpg) · [1440](audit/screens/support-1440.jpg)

- **Hero:** "KolayXport Destek Merkezi — … Sıkça Sorulan Sorular (yakında) bölümümüze göz atabilirsiniz." It says "(yakında)", yet the FAQ is on the same page.
- **Fake system status:** "API Servisleri Çalışıyor %99.9 Uptime", "Veritabanı… Ortalama yanıt süresi: 45ms". These values are hardcoded (`pages/support.js:231-245`).
- "Telefon desteği Pazartesi-Cuma 09:00-18:00". There is no phone number.
- "Plan kısıtlaması olmaksızın… bağlanabilirsiniz". This contradicts the pricing limits of 2, 5 and 10 connected stores.
- The "Kurulum Rehberi", "Video Rehberler" and "API Dokümantasyonu" tiles all link to `/app/entegrasyonlar-ve-rehberler`, which 307-redirects to an auth-only page.
- The "Bilgi Bankası" lists 15 article titles that are **not links**.
- It is indexed and in the sitemap even though nothing links to it.

### `/docs`
Screenshots: [375](audit/screens/docs-375.jpg) · [1440](audit/screens/docs-1440.jpg)

- **Hero:** "KolayXport Geliştirici Dokümanları — REST API, Webhooks ve entegrasyon rehberleri. Başlamak 5 dakika sürer."
- **Placeholder portal for an API that does not exist.**
  - All **7 guide links return 404**: `/docs/api/hizli-baslangic`, `/docs/webhooks/olaylar`, `/docs/auth/oauth-akisi`, `/docs/ornekler/nodejs`, `/docs/entegrasyonlar`, `/docs/sdks`, `/docs/api-referans`.
  - Next prefetches them, giving 7 console 404s.
  - The cURL sample targets `https://api.kolayxport.com/v1/orders`, and **`api.kolayxport.com` does not resolve in DNS**.
  - Source: `pages/docs/index.js:63`.
- The "⌘K" search does nothing on mobile.
- axe: `scrollable-region-focusable` on the code `<pre>`, plus 8 contrast failures.
- OG `og-docs.png` returns **404**.

### Legal: `/privacy`, `/privacy-tr`, `/terms`, `/terms-tr`, `/docs/terms`, `/docs/terms-tr`
Screenshots:
- [privacy-tr 375](audit/screens/privacy-tr-375.jpg) · [privacy-tr 1440](audit/screens/privacy-tr-1440.jpg)
- [terms-tr 375](audit/screens/terms-tr-375.jpg) · [terms-tr 1440](audit/screens/terms-tr-1440.jpg)
- [privacy 375](audit/screens/privacy-375.jpg) · [terms 375](audit/screens/terms-375.jpg)
- [docs-terms-tr 375](audit/screens/docs-terms-tr-375.jpg) · [docs-terms 375](audit/screens/docs-terms-375.jpg)

**`/privacy-tr` is outdated**
- "Son Güncelleme: May 7, 2025", with an English date on a Turkish page.
- It describes the **legacy Google Sheets and Apps Script architecture**: scopes `spreadsheets`, `drive.file`, `script.projects`, and "Google E-Tablosu… siparişlerinizin saklandığı ve işlendiği ana tablodur".
- It does not mention the actual processors: Gemini/Google AI, Stripe, Postmark, Hetzner (Germany), OpenBao, or the Amazon, eBay, Trendyol, Wix and Shopify data.
- Typo: "kişisel verileriniz **tekintinde** veri sorumlusu" (should be "hakkında" or "bakımından").

**`/terms-tr`** is dated 15 Ekim 2026. It has no subscription, renewal, refund, price-change or trial terms, even though the site sells paid plans.

**Duplicate, conflicting terms**
- `/docs/terms` and `/docs/terms-tr` are an older 2025 version (Apps Script era) and are still live and in the sitemap.
- So two different "Kullanım Şartları" are indexed.

**Metadata**
- Legal page titles have no brand ("Terms of Service", "Gizlilik Politikası").
- The meta description on all legal pages and `/login` is the sitewide default sales blurb, ending "30 gün ücretsiz deneme!" (`next-seo.config.js:5`).

**Missing pages**
- **KVKK Aydınlatma Metni.** KVKK Art. 10 requires a standalone notice; the privacy policy only partly covers it.
- **Açık rıza metni** for marketing emails and for cross-border transfer. KVKK Art. 9 as amended in 2024 requires a basis for transfers to Gemini (US) and Stripe.
- **Çerez Politikası.** The policy is only §9 of the privacy page.
- **Mesafeli Satış Sözleşmesi / Ön Bilgilendirme Formu**, with cayma hakkı wording for B2C. Required under 6502 and the Mesafeli Sözleşmeler Yönetmeliği if any buyer is a consumer.
- **İade/İptal Politikası.**
- **ETBİS** registration badge.
- **Company identity block**: MERSİS no, vergi dairesi/no, registered address, KEP. Required under TTK Art. 39/40 and 6563 for commercial websites.
- `/kvkk` and `/cerez-politikasi` both return 404.

### `/login`
Screenshots: [375](audit/screens/login-375.jpg) · [1440](audit/screens/login-1440.jpg) · [?mode=signup 375](audit/screens/login-mode-signup-375.jpg)

- **Card heading:** "Giriş Yap / Kayıt Ol", with **no H1**. The default form is login-only, and signup is a text link at the bottom.
- `?mode=signup` has no effect live (fixed on the branch in `20ef38b`). The `plan=` parameter carries through, but the user sees "Giriş Yap".
- The signup state has no reassurance: no trial length, no "kart gerekmez", no reminder of the plan they picked.
- `/login` is `index, follow` and in the sitemap. It should be `noindex`.

---

## 3. Sitewide findings

### S-1 Navigation, footer and link hygiene
- **Nav** (`components/PublicNav.js`): Kurumsal, Özellikler, Entegrasyonlar, Nasıl Kullanırım, İletişim, "Giriş Yap / Ücretsiz Dene", EN.
  - **No Fiyatlandırma and no Blog.**
  - The brand is text only, with no logo mark.
  - "Kurumsal" comes first, ahead of Features.
- **Footer** (`components/PublicFooter.js`):
  - Under "Çözümlerimiz", **both "Gönderim" and "Otomasyon" link to `/ozellikler`** (lines 7–8).
  - "Destek" goes to `/iletisim`, so `/support` is orphaned.
  - Turkish and English legal links are shown together on every page.
  - No address, MERSİS, phone or WhatsApp.
  - The YouTube link `https://youtube.com/kolayxport` returns **404**. X/Twitter could not be verified (login wall). LinkedIn returns 200.
- **Internal link check:** all public page links return 200 except the 7 `/docs/*` links (404). The `/entegrasyonlar` and `/support` links send anonymous visitors into the authenticated app.
- **No WhatsApp contact anywhere.** For Turkish SMB sellers WhatsApp is the default support channel, and its absence is conspicuous.

### S-2 Brand assets and Open Graph
| Asset | Status |
|---|---|
| `/favicon.ico` | **404**. Referenced in `<head>` on every page, and a console error on every page |
| `/apple-touch-icon.png` | 200 but **202 KB**, loaded on every page (2nd-largest asset after `_app`) |
| `/manifest.json` | 404 |
| `/og-public.png` (default for 12 pages, including `/`) | **1 byte** (`0x20`), not an image. Every WhatsApp, LinkedIn or X share shows no preview |
| `/og-ozellikler.png` | valid, 1536×1024, 2.5 MB (oversized) |
| `/og-about.png` | text file with a base64 data-URI, not an image |
| `/og-pricing.png`, `/og-kariyer.png`, `/og-support.png`, `/og-docs.png`, `/images/blog-placeholder.png` | **404** |

There is no logo file: the brand everywhere is the text "KolayXport" in Inter.

### S-3 SEO infrastructure
- **hreflang is wrong on every page except `/` and `/en`.** All pages emit `tr`, `tr-TR` and `x-default` pointing to the **homepage**, so Google sees `/fiyatlandirma`'s Turkish alternate as `/`. Static `languageAlternates` in `next-seo.config.js:32-44`; it should be per-page or removed.
- **`<html lang="tr">` on `/en`** (`pages/_document.js:6`).
- **`www.kolayxport.com` serves 200 instead of a 301 to the apex.** The canonical tag mitigates this, but the nginx config should redirect. HTTP to HTTPS is a 301 (good).
- **Sitemap** (`next-sitemap.config.js` has no `exclude`): 42 URLs, of which about 20 are private or app URLs:
  - `/app`, `/app/*` (9 entries), `/ayarlar`, `/dashboard`, `/envanter`, `/faturalar`, `/siparisler`, `/urunler`, `/orders/*`, `/subscribe`, `/logout`, `/offline`, `/auth/confirm-email`, `/auth/error`, `/login`.
  - It **omits all 8 blog posts**.
  - It has no `lastmod` strategy.
- **robots.txt** is `Allow: /` with no disallows for `/app`, `/api` or `/ayarlar`. The `Host:` directive is non-standard.
- **Titles:** the brand position varies ("X – KolayXport", "X · KolayXport", "X - KolayXport", none at all). The home title is 82 characters.
- **Meta descriptions:** legal pages and `/login` fall back to the default, which still says "30 gün".
- **Blog is client-rendered** (see `/blog/[slug]`), so there is effectively no indexable content marketing.
- **No per-integration landing pages** ("Etsy entegrasyonu", "Trendyol entegrasyonu", "eBay kargo etiketi"). These are the highest-intent Turkish queries.

### S-4 Structured data (`pages/_app.tsx`, `components/PublicLayout.js`)
- **`Organization` is emitted twice on every page.**
- `SoftwareApplication.offers` is `price: "0"` with "30 gun ucretsiz deneme". It is an ASCII string, has the wrong trial length, and lists no paid offers. The branch changes the string to "14 gün" but still `price:"0"`.
- No `aggregateRating`. That is correct: do not add one without real reviews.
- FAQPage on home only. BreadcrumbList on `/ozellikler` and `/entegrasyonlar`. Article on blog posts, but the body is not server-rendered.

### S-5 Performance root cause
- `PublicLayout` wraps every page in `motion.main` with `initial={{opacity:0}}`, and section reveals use `whileInView` with `opacity:0` and `translateY`.
- The server HTML is invisible until the **565 KB `_app` chunk** downloads, parses and hydrates. That is the shared bundle for the whole authenticated app, loaded on marketing pages.
- Lighthouse measures LCP render delay at 6.9–8.3 s, which is 92–93% of LCP.
- The cookie banner is client-only (`components/CookieConsent.tsx`, `useEffect` then `setVisible`). It becomes the LCP element because the hero is still transparent when the banner paints.
- Full-page screenshots and some crawlers' renderers see blank sections.
- **Fix:**
  - Remove the opacity-0 initial state from `PublicLayout` and make the reveals CSS-only or `initial={false}`.
  - Split the marketing pages off the app `_app` providers (MUI, SWR, Zustand).
  - Shrink `apple-touch-icon.png` to under 20 KB.
- **CLS is 0 everywhere** (good).

### S-6 Tracking and consent
- **No analytics or ad tags of any kind**: no GA4, GTM, Meta Pixel, Google Ads, Clarity, Plausible or PostHog.
- The CSP (`script-src 'self' … js.stripe.com`) would also block them as currently configured.
- Paid ads cannot be measured or optimized: no conversion events for signup, trial start or checkout.
- **The cookie banner is Accept-only.** "Sitemizi kullanmaya devam ederek çerez politikamızı kabul etmiş olursunuz" is implied consent, which is not valid under KVKK and the KVKK "Çerez Uygulamaları Hakkında Rehber" for non-essential cookies.
  - No Reject button and no category choice.
  - The consent value is stored but never read by anything.
  - "Daha Fazla Bilgi" goes to `/privacy-tr` instead of a cookie policy.
  - Covers about 17% of the mobile viewport.
- Before adding tracking, add Reject/Settings and gate the tags on consent (Google Consent Mode v2).

### S-7 Claims consistency (sitewide)
| Claim | Where | Reality |
|---|---|---|
| Trial 30 days | `/`, `/en`, `/ozellikler`, `/entegrasyonlar`, `/iletisim`, `/support`, JSON-LD, default meta | `/fiyatlandirma` says **14 days**; branch `af08f85` standardizes on 14 |
| n11, WooCommerce, Hepsiburada integrations | `/iletisim` FAQ, `/nasil-kullanirim`, blog | not on `/entegrasyonlar` |
| Phone support, 7/24 support, video guides | `/iletisim`, `/support` | no phone number published, no videos (YouTube 404) |
| 99.9% uptime, 45 ms DB | `/support` | hardcoded |
| Public REST API, webhooks, SDKs | `/docs` | links 404, host does not resolve |
| Founded 2019 / launched 2022 | `/kurumsal` | `/kariyer` says MVP 2023 |
| "Plan kısıtlaması olmaksızın" stores | `/support` | plans cap at 2/5/10 stores |
| "Kullandığınız kadar ödersiniz" | `/iletisim` | flat tiers |
| 5★ testimonials, $18.4K/4.9★ | home | anonymous, mock |

### S-8 Turkish language quality
- **Missing Turkish characters:**
  - "Video yakinda gelecek / Tanitim videomuz hazirlanmaktadir"
  - "Iletisim Formu / Detayli sorulariniz icin… gonderebilirsiniz"
  - "Istanbul, Turkiye"
  - JSON-LD "30 gun ucretsiz deneme"
- **Typos:** "tekintinde" (privacy-tr), "yapiyorsanız", "üçretlerden", "Teslimat'a".
- **English mixed into Turkish pages:**
  - Footer "Privacy Policy / Terms of Service".
  - Pricing "Pricing summary (English)" block.
  - "timeout", "Multi-Channel", "Remote-First", "Continuous Shipment", "Token Vested", "Uptime".
  - Privacy-tr date "May 7, 2025".
- **Inconsistent spelling:** "Kâr" and "Kar" for profit. "pazaryeri" is used consistently (good).

### S-9 Accessibility summary (axe, 375 px)
- **Serious:** `color-contrast` on 13 of 21 pages. The worst are `/en` (15 nodes), `/entegrasyonlar` (13) and `/docs` (8). Recurring offenders: slate-400 `#90a1b9` on white or slate-100, `#739efd` gradient text, and orange badges.
- **Serious:** `link-in-text-block` on `/`, `/en` and `/docs` (link colour only 1.18–1.44:1 against body text, no underline).
- **Serious:** `scrollable-region-focusable` on `/docs`.
- Missing image alt: 0 (good). No horizontal overflow at 375 px (good).
- Keyboard and focus testing (including the mobile menu) was not done; axe does not cover it.

---

## 4. Prioritized fix list

### P0: must fix before any paid ads

| # | Fix | Where |
|---|---|---|
| P0-1 | One trial length (14) everywhere: copy, meta default, JSON-LD, FAQ. **Merge and deploy `af08f85`**, then grep for the leftover "30 gün" in `next-seo.config.js:5` and the `/iletisim` and `/support` hardcoded FAQs | `next-seo.config.js`, `pages/iletisim.js`, `pages/support.js`, `messages/*.json`, `pages/_app.tsx` |
| P0-2 | Signup intent: **deploy `20ef38b`**. Point every trial CTA (including home and nav "Giriş Yap / Ücretsiz Dene") to `/login?mode=signup`. Add trial and "kart gerekmez" reassurance to the signup state. Mark `/login` `noindex` | `components/AuthForm.jsx`, `components/marketing/HomeContent.js`, `components/PublicNav.js`, `pages/login.js` |
| P0-3 | Install analytics and conversion tracking (GA4 or GTM plus the Google Ads and Meta conversion events `sign_up` and `begin_checkout`). Widen the CSP. Gate on consent | `pages/_document.js` or `_app.tsx`, `next.config.js` CSP headers |
| P0-4 | Cookie banner with Accept / Reject / Settings, no implied consent. Read the consent value before loading tags. Add a Çerez Politikası page | `components/CookieConsent.tsx`, new `pages/cerez-politikasi.js` |
| P0-5 | Remove or replace false and unverifiable claims: anonymous 5★ testimonials, mock $18.4K/4.9★ (label as "Örnek" or use a real screenshot), n11/WooCommerce/Hepsiburada, phone support, 7/24, video guides, fake status panel, "Plan kısıtlaması olmaksızın", "Kullandığınız kadar" | `components/marketing/HomeContent.js`, `messages/tr.json` (testimonials ≈ 9226), `pages/iletisim.js:280-300`, `pages/support.js:200-250`, `pages/nasil-kullanirim.js` |
| P0-6 | Valid OG images: 1200×630, under 300 KB PNG or JPG for default, pricing, about, careers, support, docs and blog. Fix the 1-byte `og-public.png` and the text-file `og-about.png` | `public/og-*.png`, `next-seo.config.js`, per-page `openGraph.images` |
| P0-7 | Favicon, logo mark and manifest: add `favicon.ico`, an SVG favicon and a real logo in the nav and footer. Compress `apple-touch-icon.png` (202 KB) | `public/`, `components/PublicNav.js`, `components/PublicFooter.js`, `pages/_document.js` |
| P0-8 | Fix the nav overlap: pricing H1 and breadcrumbs sit under the 72 px fixed nav. Fix the invisible nav on the `/kariyer` dark hero | `components/domain/pricing/PricingPage.tsx`, `components/Breadcrumb.js`, `components/PublicNav.js` |
| P0-9 | Add Fiyatlandırma to the nav and footer | `components/PublicNav.js`, `components/PublicFooter.js` |
| P0-10 | Fix or hide `/api/billing/founding-spots` (404 on every pricing load) | `lib/billing/useFoundingSpots.ts`, missing `pages/api/billing/founding-spots.ts` |
| P0-11 | LCP 6–9 s: remove `opacity:0` initial from `PublicLayout` `motion.main` and from the scroll reveals; render the cookie banner without blocking. Target LCP under 2.5 s, since paid traffic is mostly mobile | `components/PublicLayout.js`, `components/marketing/HomeContent.js`, `components/CookieConsent.tsx` |
| P0-12 | Legal minimum for selling subscriptions in Turkey: KVKK Aydınlatma Metni, açık rıza (cross-border: Gemini, Stripe, Postmark), Mesafeli Satış Sözleşmesi + Ön Bilgilendirme, iade/iptal terms, company identity block (MERSİS, vergi no, address) in the footer and `/iletisim`. Rewrite `/privacy-tr` (remove Google Sheets/Apps Script, list real processors, fix "tekintinde", Turkish date) | new `pages/kvkk.js`, `pages/mesafeli-satis.js`; `pages/privacy-tr.js`, `pages/privacy.js`, `pages/terms-tr.js`, `components/PublicFooter.js` |

### P1: before or together with the relaunch

| # | Fix | Where |
|---|---|---|
| P1-1 | Rewrite the home hero for one persona and outcome (for example Turkish Etsy/eBay exporter: listing + order + label in one place), using a real product screenshot instead of the stock render | `components/marketing/HomeContent.js`, `messages/tr.json` `marketing.*` |
| P1-2 | Real proof: 2–3 named customer quotes with shop links, user/order/label counts from the DB, Shopify App Store and Chrome Web Store badges/ratings, founder name and photo on `/kurumsal` | `HomeContent.js`, `pages/kurumsal.js` |
| P1-3 | `/kariyer`: unpublish or rewrite (no "gönüllü", tokens or "gelir elde etmeye başladıkça"); fix React #418 | `pages/kariyer.js` |
| P1-4 | `/docs`: remove the fake API portal (404 links, non-existent `api.kolayxport.com`) or replace it with a help-center index. Remove `/docs/terms*` duplicates (301 to `/terms*`) | `pages/docs/index.js`, `pages/docs/terms*.js` |
| P1-5 | `/nasil-kullanirim`: replace the "Video yakinda gelecek" placeholder with a real 60–90 s demo or remove the section. Remove unverified features (CSV, automation rules, customer analytics) | `pages/nasil-kullanirim.js` |
| P1-6 | Sitemap and robots: exclude `/app/*`, `/ayarlar`, `/dashboard`, `/envanter`, `/faturalar`, `/siparisler`, `/urunler`, `/orders/*`, `/subscribe`, `/logout`, `/offline`, `/auth/*`, `/login`, `/support` (or link it); include blog posts; `Disallow: /app /api /ayarlar` | `next-sitemap.config.js` |
| P1-7 | Per-page hreflang (or drop it except on `/` and `/en`); server-render `lang="en"` on `/en`; 301 `www` to apex | `next-seo.config.js:32`, `pages/_document.js`, nginx site config on the VPS |
| P1-8 | Blog SSR: `getStaticPaths` + `getStaticProps`, real 404 for unknown slugs, add posts to the sitemap | `pages/blog/[slug].js`, `pages/blog.js` |
| P1-9 | `/entegrasyonlar`: "Detayları Gör" should go to public per-integration pages (`/entegrasyonlar/etsy`, `/trendyol`, …) instead of `/ayarlar`; use consistent real logos (Shopify missing, eBay/Wix generic icons) | `pages/entegrasyonlar.js`, `public/logos/` |
| P1-10 | Footer: distinct "Çözümlerimiz" targets, "Destek" → `/support` or remove `/support`, show only Turkish legal links on Turkish pages, fix the YouTube link (404) | `components/PublicFooter.js:7-24` |
| P1-11 | WhatsApp Business contact (number as text plus a `wa.me` link) and a phone number, or remove the phone claims | `pages/iletisim.js`, `components/PublicFooter.js` |
| P1-12 | Pricing page: remove the "Pricing summary (English)" block from the TR view, state KDV, order Starter → Growth → Pro on mobile, add a plan header to the mobile comparison table, explain "AI kredisi" | `components/domain/pricing/PricingPage.tsx` |
| P1-13 | JSON-LD: emit Organization once; SoftwareApplication `offers` with real tier prices (`AggregateOffer` lowPrice 2499 TRY) and a Turkish trial string | `pages/_app.tsx`, `components/PublicLayout.js` |
| P1-14 | Split marketing pages from the 565 KB app `_app` bundle (lazy-load MUI, SWR and app providers on `/app` only) | `pages/_app.tsx` |

### P2: later

| # | Fix | Where |
|---|---|---|
| P2-1 | Blog: retire the fake author names (use the founder or "KolayXport Ekibi"), cite the statistics, match the "7 yol" title to its content, fix the typos, Turkish date format, publish a current post schedule | `pages/blog/[slug].js`, `pages/blog.js` |
| P2-2 | Fix contrast tokens (slate-400 → slate-600 on white, gradient text, orange badges), underline inline links, focusable `<pre>` | Tailwind classes in `HomeContent.js`, `pages/entegrasyonlar.js`, `pages/docs/index.js`; shared theme |
| P2-3 | Turkish copy pass: Turkish characters in all hardcoded strings, "Kâr" consistency, replace English jargon | `pages/nasil-kullanirim.js:145`, `pages/iletisim.js`, `pages/kariyer.js`, `messages/tr.json` |
| P2-4 | `/kurumsal`: one consistent timeline (or none), replace boilerplate values with founder story and real numbers; trim mission copy | `pages/kurumsal.js` |
| P2-5 | Consistent title pattern "<Page> · KolayXport" under 60 characters, unique meta descriptions for legal pages | per page `PublicLayout seo` props, `next-seo.config.js` |
| P2-6 | Shorten the home page (14k px on mobile): collapse "Her Plana Dahil" into a 2-column grid or remove it (it duplicates the feature cards) | `components/marketing/HomeContent.js` |
| P2-7 | Resize `og-ozellikler.png` (2.5 MB) to 1200×630 | `public/og-ozellikler.png` |
| P2-8 | ETBİS registration badge and a security/DPA page backing "Almanya sunucu" and "güvenlik denetimleri" | footer, new page |
