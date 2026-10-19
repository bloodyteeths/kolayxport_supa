# KolayXport Turkey gameplan: first 100 users, then paid

Date: 2026-10-19. Status: **plan only.** Nothing in here has been sent, posted or spent.
Owner: Atilla (founder). Executed by **Merisa** and **Ekin** (marketing), with Claude sessions and freelancers.

Built on the existing research. This plan doesn't redo any of it, it only links to it:
- [positioning.md](positioning.md) (A + C: "Yurt dışına satışın tek paneli", plus the "Trendyol'dan dünyaya" track)
- [competitors.md](competitors.md), [pain-points.md](pain-points.md), [feature-inventory.md](feature-inventory.md) (the only source for claims), [roadmap.md](roadmap.md)
- [social/](social/README.md) (calendar, communities, outreach templates, ads playbook, legal), [seo/](seo/keyword-map.md), [tracking/](tracking/README.md)

## 0. Facts this plan starts from

| Fact | Value (2026-10-19) | Source |
|---|---|---|
| Paying customers | **0** | Founder |
| Monthly cash cap for Turkey GTM | **₺25.000 (~$500)**, plus partner bounties that are paid only on results | Founder |
| Free tier | **No.** Entry stays the 14-day no-card trial plus the founding offer (40% off for life, first 20 subscribers) | Founder |
| Phases | Phase 1: referral partners (Facebook group admins, X voices), **no ad spend until 100 users**. Phase 2: Instagram posts, then Meta and Google ads | Founder, via orchestrator |
| Executors | Merisa and Ekin. Atilla stays out of the day-to-day | Founder, via orchestrator |
| Marketing site | gtm/overhaul is live (main `43b3bb4f`): the 6 `/cozumler/*` pages and 4 Turkish blog posts | gtm-overhaul session |
| Tracking | **Not live.** No GTM, GA4 or Meta IDs are in prod, and the cookie banner only has "Kabul et" (the full panel is still being built) | gtm-overhaul session |
| YouTube | 7 new tutorials, all unlisted; 8 more are blocked by the upload cap on the unverified channel (15 in total) | gtm-overhaul session |
| Chrome extension | Live on the Chrome Web Store. 9.12.0 (adds Trendyol and Hepsiburada) is in Google review | gtm-overhaul session |
| Prices | **Pricing v2** ([pricing-v2.md](pricing-v2.md)): yearly packages Başlangıç ₺29.990 / Büyüme ₺54.990 / Pro ₺89.990 / Kurumsal (quote), with taksit via iyzico/PayTR; **one** monthly plan, Aylık ₺2.999, plus modules. Shown "+KDV" (accountant to confirm, pricing-v2 §5). Collected by **Tamsar, Inc.** (US) in TRY | Atilla 2026-10-19 (model; numbers are a proposal) |
| Referral support in the app | **None.** First-touch UTMs are kept in the browser (`lib/tracking/events.ts`) and sent with the server `sign_up` event, but **not stored on the user**. Stripe Checkout shows a promotion-code field only when the founding coupon doesn't apply (`pages/api/stripe/create-checkout-session.ts:244`) | code |
| Hepsiburada, Çiçeksepeti | Not live (waiting for integrator approval / replies). **Don't promise them** | feature-inventory N-1, project notes |
| App-store listings | Shopify, Play Store, Claude and ChatGPT MCP directories are in review. **Freeze applies:** nobody touches MCP/OAuth/review accounts | coordination rules |

---

## 1. Who we sell to in Turkey (ICP) and where they gather

### 1.1 Segments, in priority order

| # | Segment | Size band (who pays what) | Their pain (seller words, pain-points.md) | What we lead with | Plan fit |
|---|---|---|---|---|---|
| 1 | **Etsy exporters**: handmade, textile, jewellery, home, POD, digital | Micro (1 person, <50 orders/mo) → Starter. Small (2–5 people, 50–500) → Growth | "134 ürün, 4 satış", SEO in English, which product to sell | Listing doctor, English AI titles/tags, research, bulk edit | Core (A) |
| 2 | **eBay / Amazon global exporters** | Small–mid (2–10 people, 100–1.000 orders) → Growth/Pro | Margins ("4 dolara sattım, 99 lira kaldı"), labels, ETGB confusion | FedEx/UPS labels + paperless invoice, ETGB file, net profit (Pro) | Core (A) |
| 3 | **Trendyol sellers curious about e-export** | Small–mid, already paying an integrator | "Yurt dışına nasıl açılırım", stock across channels | Trendyol → Etsy/eBay cross-listing, stock sync, arbitrage (Pro) | Track C, as an **add-on** to their current integrator |
| 4 | Beginners ("Etsy'de nasıl satış yapılır") | No revenue yet | Shop setup, course scams | Free content only (YouTube, blog) | Content audience, **not** a target for partner pushes (low trial→paid) |
| — | Domestic-only multi-marketplace sellers (HB/N11-heavy) | — | — | Don't target: we lose on breadth (positioning option B, rejected) | Excluded until HB is live |

Amazon.com.tr-only sellers aren't a separate push: orders and labels work, but there's no listing editing (N-5).

### 1.2 Where they gather (with the next action)

| Place | Examples (verified in [social/communities.csv](social/communities.csv)) | Who works it | Phase |
|---|---|---|---|
| **Telegram seller groups** | Etsy ile Gelir (~13k), Etsy Türkiye Grubu (~2.8k), Etsy TR Yardımlaşma (~1.7k), eBay dropshipping TR (~2.4k), Amazon & eBay Yardımlaşma | Merisa | 1 |
| **Facebook groups** | ETSY TÜRKİYE SATIŞ TEKNİKLERİ, plus the rows marked "ARANACAK" in communities.csv (mikro ihracat, Etsy TR, Trendyol sellers, eBay/Amazon TR) | Merisa | 1 |
| **X (Twitter)** | Turkish e-ticaret / e-ihracat voices. Shortlist method in §4.4 | Ekin | 1 |
| **YouTube e-ticaret educators** | Mehmet TEK (200k), Tuger Akkaya (662k), Canberk Öztürk (109k), Hacı Mehmet Kaya, Muhammet Usta, podbul, Veli Seferli, BRMedya, E-Ticaret Adamı | Ekin (as referral partners: same program as X) | 1 (small/mid channels), 2 (big ones) |
| **Newsletters / forums** | E-Aramızda, Sıfırdan Globale (Substack), Etsy Community TR forum, Ekşi Sözlük threads | Merisa (helpful answers only, no links in forums that forbid them) | 1 |
| **Mali müşavirler / e-ihracat consultants** | Babal Mali Müşavirlik (YouTube); local SMMM offices that serve e-ihracat clients | Merisa (partner program, "danışman" tier) | 1 (2–3 test partners), 2 |
| **Logistics / e-ihracat platforms** | ShipEntegra (E-İhracat Akademisi, eBay Büyüme Programı), kargo acenteleri | **Atilla, one intro email**; Merisa follows up | 2 (partnership, roadmap G18) |
| **Associations, programs, fairs** | ETİD (E-Ticaret İşletmeleri Derneği), TOBB E-Ticaret Meclisi, ticaret odaları (Adana TO first: we're a member), TİM/İhracatçı birlikleri e-ihracat trainings, KOSGEB / Ticaret Bakanlığı e-ihracat support programs | Merisa researches; Atilla only signs anything formal | 3 (needs social proof first) |

**Support programs.** Before any copy says "devlet desteğiyle", check with an e-ihracat consultant or the ticaret odası whether a SaaS subscription counts as an eligible expense under the current Ticaret Bakanlığı / KOSGEB e-ihracat supports. **Until then we make no claim** (Ticari Reklam regulation). If it does qualify, it becomes a strong hook in Phase 2 ("aboneliğinizin bir kısmı desteklenebilir: danışmanınıza sorun").

---

## 2. Offer, pricing and onboarding hook (Turkey, TRY)

**Pricing v2 (Atilla, 2026-10-19), full detail in [pricing-v2.md](pricing-v2.md):**
- **Yearly packages are the main offer:** Başlangıç ₺29.990, Büyüme ₺54.990, Pro ₺89.990, Kurumsal from ₺149.990, all +KDV, with taksit via iyzico/PayTR.
- **One monthly plan:** Aylık ₺2.999 +KDV. Monthly users add **modules** (finance, arbitrage, photo studio, extra stores/orders, AI credit packs) instead of upgrading.
- The numbers are a proposal for Atilla to confirm. Until v2 is live, partners and copy quote **no prices**: they link to `/fiyatlandirma`.

| Element | Turkey offer | Why |
|---|---|---|
| Entry | **14-day trial, no card** (no free tier, founder decision). At the end of the trial, the default offer is a yearly package with taksit; Aylık is the second option | Turkish sellers are used to yearly packages paid in installments (PraPazar, Sentos, Entegra) |
| Urgency (real) | **Founding member: 40% off for life, first 20 subscribers**, on any package. Link to the live counter on `/fiyatlandirma`; never state the remaining number | Real scarcity only (README "Real FOMO") |
| Partner audience offer | While founding spots last, referred users get the founding price like everyone else. **After the 20 are gone:** a partner-specific promo code, **20% off** the first yearly payment or the first 3 months of Aylık | Approved 2026-10-19 |
| Anchor in copy | "Etsy ve eBay için Türk entegratörlerde yıllık ₺89–125 bin; KolayXport Pro yıllık ₺89.990 ve her şey dahil" (only with the sourced numbers from competitors.md §5, re-checked before use) | We sit at Sentos Platinum's level with far more export tooling. Never compare to BirFatura on price |
| Onboarding hook (first 10 minutes) | 1) Connect Etsy or eBay. 2) **Listing doctor** on the weakest listing (SEO score + one-click fixes). 3) The Chrome extension on their own Etsy search page | "First listing optimized" is the AI value moment (README §6). The extension is live, so it can be shown now |
| What we never offer | Revenue/sales guarantees, "Etsy partner/onaylı", HB/N11, automatic ETGB declaration | feature-inventory §4 |

**Unit economics used in this plan** (assumptions, update with real data in week 6):
- Average first payment of a referred paying customer: about **₺33.000**. That's Büyüme yearly at the founding price (₺54.990 × 0,60), the most likely pick for export sellers; Aylık buyers pull it down.
- Trial → paid: **6%** for yearly and **4%** for Aylık. Prepay converts lower than monthly.
- **Partner cost per paying customer:** a one-time bounty of 25% of the first yearly payment (≈ ₺8.250 on the example above), or a fixed ₺1.500 for Aylık. It is paid only after the money has been collected and the refund window has passed.
- Paid ads must beat that per customer before they scale (ads-playbook §3; its thresholds get recalculated for yearly prices before Phase 2).

---

## 3. Channels ranked by cost per paying customer

Cash cost = what we pay before knowing whether a customer comes. Estimates are explicit assumptions; Merisa replaces them with tracker data from week 6.

| Rank | Channel | Cash cost / paying customer (estimate) | Speed | Owner | Phase | Status |
|---|---|---|---|---|---|---|
| 1 | **App-directory listings**: Chrome Web Store (live), Shopify App Store, Play Store, Claude/ChatGPT MCP directories (in review) | ≈ ₺0 | Slow, steady | Already handled by the extension / app / MCP sessions. **Marketing only links to them, never edits them** | 1 | Running |
| 2 | **Referral partners**: FB/Telegram admins, X voices, small YouTubers, mali müşavirler. One-time bounty | ₺0 up front; one-time ₺1.500 (Aylık) to ≈ ₺8.250 (Büyüme yearly, founding price), out of collected revenue | Fast once 10+ partners are active | Merisa (groups, müşavirler), Ekin (X, YouTube) | **1 (main)** | To build (§4) |
| 3 | **Helpful community answers** (no links where forbidden) | ₺0 (time only) | Medium | Merisa, Ekin | 1 | Kit ready (social/README §4) |
| 4 | **YouTube tutorials public + embedded on the site** | ₺0 | Slow, compounding | gtm-overhaul session (uploads); Ekin (comments, Shorts) | 1 | 15 videos, unlisted |
| 5 | **Turkish SEO blog** (2 posts a week, calendar ready) | ₺0 (Claude drafts, Merisa fact-checks) | Slow (3–6 months) | gtm-overhaul session + Merisa | 1 | Calendar written, cadence **not started** |
| 6 | **Live demos for partner groups** (Varyant 3, presented by Merisa or Ekin from a script, never by Atilla) | ₺0 | Fast spike per demo | Merisa | 1 (from week 4) | Template ready |
| 7 | **Logistics / accounting partnerships** (ShipEntegra, Paraşüt/QNB partner programs, kargo acenteleri) | ₺0, rev share | Slow (BD cycles) | Atilla: one intro each; Merisa runs it | 2 | Not started |
| 8 | **Freelancers on Bionluk** for list-building (finding groups, admins, X accounts, contact info) | ≈ ₺4–6k one-off, spread over the first ~30 partners | Fast | Merisa hires, one-off job | 1 (week 1) | — |
| 9 | **Instagram organic** (calendar-30d copy reused) | ₺0 + time | Medium | Ekin | **2** | Copy ready |
| 10 | **Meta ads** (ads-playbook, 8 concepts) | Target ≤ ₺4.500 / paying | Fast, costly | Merisa runs, Atilla approves budget | **2**, after the gate | Blocked: tracking + cookie panel |
| 11 | **Google Search ads** (high-intent: "etsy seo aracı", "etgb nedir", "etsy kar hesaplama") | Likely ≥ Meta; test small | Fast | Merisa | 2 (month 3+) | — |
| 12 | Fairs, association stands, paid big-YouTuber sponsorships | ₺20k+ per event or video | — | — | 3, only with traction and testimonials | — |

**Not used:** Armut (it sells local services to consumers; no seller audience). Upwork (an English market; for Turkish outreach and list-building, Bionluk is the right marketplace). Cold mass DMs, buying lists, scraping group members (KVKK + İYS, legal-notes §1, §6).

---

## 4. Phase 1: referral partners → first 100 users (no ad spend)

### 4.1 What counts as a "user"

**User = a signup that connected at least one store within 7 days (activated).** Raw signups are also tracked, but the gate counts activated users, so a partner can't fill it with empty accounts.

### 4.2 The referral program: "KolayXport Ortaklık Programı"

**Decided by Atilla, 2026-10-19:** a one-time bounty (no recurring commission), a partner dashboard in the app, and payouts through Stripe from Tamsar, Inc. Build spec: [referral-spec.md](referral-spec.md).

| Term | Rule | Note |
|---|---|---|
| Bounty: yearly package | **25% of the customer's first yearly payment** (net of KDV, after discounts). **30%** for customers who pay after the partner already has 10 paying referrals | Paid once. Later renewals pay nothing |
| Bounty: Aylık (monthly) | **A fixed ₺1.500**, earned when the customer makes their **2nd** monthly payment | Sign-up-and-cancel earns nothing |
| Upgrade | Aylık → yearly within 90 days of the first payment: the partner gets the yearly bounty **minus** the ₺1.500 already paid | No double payment |
| Modules, AI credit packs | Not part of the bounty | Keeps the bounty predictable |
| Attribution | Partner link (`kolayxport.com/?ref=<KOD>`) or partner promo code. **First touch wins**, 90-day window, 1 partner per customer | Same 90 days as `captureAttribution` |
| Not eligible | Self-referral, existing users, reviewer accounts, Shopify App Store installs, paid-ad traffic that bid on our brand, coupon-site posting | Standard |
| Hold | Payable **30 days after** the payment that earned it (refund window). A refund inside the window cancels the bounty | |
| Payout | Monthly, from **Tamsar, Inc.** through **Stripe Global Payouts**, in **TRY by wire** to the partner's Turkish bank account. The partner enters the bank details on a Stripe-hosted form; we never store IBANs | Stripe Global Payouts supports Turkish recipients (individual: e-mail + name; company: e-mail, company name, address). Tamsar, Inc. collects a W-8BEN / W-8BEN-E; the partner declares the income in Turkey (accountant to confirm, pricing-v2 §5) |
| Partner dashboard | `/app/ortaklik`: the partner's link and code, every referral in **masked** form (e.g. "A*** K. · Büyüme yıllık · ödedi · ödül bekliyor"), and earned / pending / paid totals | Transparent without exposing customers. One line in the privacy notice covers it (KVKK) |
| Partner perks | Free Growth (Büyüme) account while the partner is active (≥1 paying referral per quarter); an early look at new features | Granted by an admin, on Merisa's request; it never uses a founding spot (referral-spec §4) |
| Disclosure | Every partner post must carry **#işbirliği @kolayxport** or **#reklam**; videos also say it aloud | legal-notes §3. Reklam veren must inform the partner: the terms text does it |
| Claims | Partners may only use the "Söyleyebilirsin" list (social/README §3). No income guarantees, no prices until pricing v2 is live | |
| Termination | Either side, any time, by e-mail. Bounties already earned are still paid. Misleading claims or spam end it immediately with no further payouts | |

**Tracking: what has to be built (this blocks signing the 1st partner):**
1. **Store attribution on the user at signup** (roadmap G2): keep the first-touch UTM + `ref` code on the `User` row (signup form and Google/Apple sign-in).
2. **`?ref=<KOD>` capture**: the same as UTM capture, plus `utm_source=partner&utm_content=ref-<kod>` for GA4.
3. **A partner report** (admin) and the **partner dashboard** (`/app/ortaklik`): per code → signups, activated, trialing, paying, bounties pending / payable / paid.
4. **Stripe promotion codes per partner** (founder creates them in Stripe or delegates; the field already shows when the founding coupon doesn't apply). The code also counts as attribution if the link was missed.

Effort: about 2–3 dev days. Full spec with data model, capture points, report and acceptance tests: [referral-spec.md](referral-spec.md). Under the freeze, the ref is captured with our own first-party cookie (middleware) and a post-login claim endpoint; NextAuth/OAuth config is not touched. **Owner:** a dev Claude session that the orchestrator assigns, deployed through the deploy queue (mybaby-sync-product-50). It doesn't touch `lib/mcp/*`, `pages/api/mcp/*` or OAuth/consent (freeze), so the signup change must go through the Google/Apple sign-in callback carefully; flag it to the queue. Stage A (capture, admin report) was deployed on 2026-10-19 by mybaby-sync-product-d7. Stage B (bounty ledger, dashboard, Stripe Global Payouts) follows the updated spec.

**Until it's live:** Merisa may talk to partners, but gives out links only once tracking works. Tell them "takip sistemimiz [tarih] itibarıyla aktif".

**Partner terms page:** a short Turkish page `/ortaklik` with the table above. gtm-overhaul drafts it now and **publishes only when** the terms are approved (done), the `?ref` capture and signup attribution are live, and the accountant has confirmed the payout paperwork (pricing-v2 §5). Until then, Merisa sends the terms as a PDF by e-mail.

### 4.3 Who Merisa and Ekin target, and how many

| Partner type | Shortlist size (week 1) | Contacts / week | Expected partners / week (assumption) |
|---|---|---|---|
| Facebook group admins (Merisa) | 80 groups | 25 | 1–2 |
| Telegram / WhatsApp group admins (Merisa) | 30 groups | 10 | 1 |
| Mali müşavir / e-ihracat consultants (Merisa) | 20 | 5 | 0–1 |
| X voices (Ekin) | 50 accounts | 12 | 1 |
| Small/mid YouTube educators, 2k–110k subs (Ekin) | 20 channels | 3 | 0–1 |
| **Total** | **200** | **55** (Merisa 40, Ekin 15) | **3–4** |

Conversion assumptions: ~30% reply, ~25% of replies accept → ~7% of contacts sign. About half of the partners who sign actually post. Replace these with tracker data in week 4.

### 4.4 How to build the shortlist (week 1, with a Bionluk freelancer + Claude)

**Facebook groups.** Search in Facebook (Groups tab) for: `etsy türkiye`, `etsy satıcıları`, `e-ihracat`, `mikro ihracat`, `ebay türkiye`, `amazon satıcıları türkiye`, `trendyol satıcıları`, `e-ticaret girişimcileri`, `el yapımı ürün satış`, `print on demand türkiye`.
**Telegram.** Start with communities.csv; then use `t.me` search and links that people post in those groups.
**X.** Search: `etsy (satış OR mağaza) lang:tr min_faves:30`, `"e-ihracat" lang:tr min_faves:30`, `"mikro ihracat" lang:tr`, `ebay lang:tr min_faves:20`, `trendyol satıcı lang:tr min_faves:50`. Look at who gets replies, not only follower counts. Check the bio for a contact/DM-open signal.
**YouTube.** communities.csv, plus searching "etsy'de satış nasıl yapılır 2026", "e-ihracat nasıl yapılır", "ebay türkiye satış" and taking channels with recent uploads (≤ 60 days).

**Score every candidate 0–10** (column `score` in the sheet), and contact the highest first:

| Criterion | Points |
|---|---|
| Topic fit: export (Etsy/eBay/Amazon global) = 3, Trendyol-to-abroad = 2, generic e-ticaret = 1 | 0–3 |
| Activity: ≥ 5 posts/day (groups) or ≥ 2 posts/week (X/YouTube) | 0–2 |
| Engagement: real questions and replies, not just ads | 0–2 |
| Admin/owner reachable (named, active in the group, DMs open) | 0–2 |
| Group rules allow announcements or "sponsorlu" posts | 0–1 |

Skip: "Etsy danışmanı / kurs" sellers who promise income (A11 scams; working with them hurts trust), groups that are mostly ad spam, accounts with fake-looking followers.

**Freelancer brief (Bionluk, one-off, budget ₺4–6k):** "Türk e-ticaret/e-ihracat topluluklarının listesi: 120 Facebook/Telegram grubu ve 60 X/YouTube hesabı. Her satır: ad, link, üye/takipçi, son 7 gün paylaşım sayısı, yönetici adı/profil linki, grup kuralları özetinin ekran görüntüsü. Kişisel veri (telefon, e-posta) toplanmayacak; sadece herkese açık profil linkleri." Merisa checks 10 random rows before paying.

### 4.5 Outreach messages (Turkish, copy-paste ready)

Rules from [social/outreach-messages.md](social/outreach-messages.md) §0 apply: give value first (3 helpful answers in the group, or watch 2 videos), say who you are, one channel per person, log every message, follow the 3-step follow-up sequence there.

**Varyant 5 · Grup yöneticisine ortaklık (Facebook / Telegram)**
```
Merhaba [ad],

Ben [Merisa/Ekin], KolayXport'ta pazarlamadan sorumluyum. [Grup adı]'nda [konu] hakkında yazdığınız [somut ayrıntı] çok işime yaradı, emeğiniz belli oluyor.

KolayXport, yurt dışına satan Türk satıcılar için bir panel: Etsy ve eBay ilanlarını yapay zekâyla İngilizce düzenleme, ürün ve anahtar kelime araştırması, sipariş ve yurt dışı kargo etiketi bir arada. 14 gün ücretsiz, kart gerekmiyor.

Grup yöneticileriyle bir ortaklık programı başlatıyoruz: sizin linkinizle gelip yıllık paket alan her satıcı için ilk yıllık ödemesinin %25'i, aylık plana geçen her satıcı için 1.500 TL tek seferlik ödül. Kim geldi, kim abone oldu, ne kadar kazandınız; hepsini panelinizde anlık görürsünüz. Sizden bir paylaşım zorunluluğu yok; ürünü önce kendiniz deneyin diye size ücretsiz bir Growth hesabı da açarız.

Program şartlarını kısa bir metin olarak gönderebilirim. İlgilenmezseniz de hiç sorun değil, teşekkürler.

[ad] · KolayXport (Modsons Yazılım)
```

**Varyant 6 · X / YouTube sesine ortaklık**
```
Merhaba [ad], [paylaşım/video adı]'nda [somut nokta] kısmı çok netti, takip ediyorum.

Ben [ad], KolayXport'tan. Yurt dışına satan Türk satıcılar için Etsy/eBay ilan optimizasyonu, araştırma ve yurt dışı kargo etiketini tek panelde topluyoruz.

E-ihracat üzerine içerik üretenlerle bir ortaklık programı başlattık: linkinizle gelip yıllık paket alan her satıcı için ilk ödemesinin %25'i (10. müşteriden sonra %30), aylık plan için 1.500 TL, tek seferde sizin. Gelenleri ve kazancınızı panelinizden takip edersiniz. Ücretsiz bir hesapla önce kendiniz deneyebilirsiniz; beğenmezseniz hiçbir yükümlülüğünüz olmaz.

Şartları DM'den mi yoksa e-postayla mı göndermemi istersiniz?
```

**Kabul edenlere gönderilecek metin (after a yes)**
```
Harika, teşekkürler [ad]!

1) Ortaklık linkiniz: https://kolayxport.com/?ref=[KOD]
   [Kurucu üye kontenjanı dolduktan sonra geçerli] Takipçilerinize özel kod: [KOD], ilk yıllık ödemede veya aylık planın ilk 3 ayında %20 indirim.
   Ortaklık paneliniz: https://kolayxport.com/app/ortaklik (gelen kayıtlar, abonelikler ve ödülleriniz)
2) Ücretsiz Growth hesabınız [e-posta] adresine açıldı.
3) Paylaşımlarınızda "#işbirliği @kolayxport" (videoda ayrıca sesli olarak) belirtmeniz yasal bir zorunluluk (Reklam Kurulu Sosyal Medya Etkileyicileri Kılavuzu). Kılavuz: [link]
4) Söyleyebileceğiniz özellikler ve kullanabileceğiniz ekran görüntüleri: [paylaşılan klasör linki]. Lütfen gelir veya satış garantisi gibi ifadeler kullanmayın.
5) Ödüller, müşterinin ödemesinden 30 gün sonra ödenebilir hale gelir ve her ayın [5]'inde Stripe üzerinden banka hesabınıza TL olarak gönderilir. Banka bilgilerinizi Stripe'ın güvenli formuna kendiniz girersiniz; biz IBAN saklamayız.

Paylaşım metnini isterseniz biz taslak olarak hazırlayabiliriz, son söz sizde.
```

**Grup paylaşım taslağı (the partner adapts it; Merisa sends it only if asked)**
```
#işbirliği @kolayxport
Etsy/eBay'de satan arkadaşlar: ilanlarınızın İngilizce başlık ve etiketlerini kontrol etmek için KolayXport'u deniyorum. İlan Doktoru eksikleri gösteriyor, yapay zekâ ile düzeltiyorsunuz; değişiklikler siz "gönder" demeden Etsy'ye gitmiyor. 14 gün ücretsiz, kart istemiyor: [ortaklık linki]
Hepsiburada/N11 yok, odak yurt dışı satış.
```

### 4.6 Partner tracking sheet (Google Sheets, owner: Merisa)

Extend [social/outreach-tracker.csv](social/outreach-tracker.csv) with these columns (one row per candidate):

`score`, `partner_type` (fb_admin | tg_admin | x_voice | youtube | musavir), `audience_size`, `terms_sent`, `terms_accepted_date`, `ref_code`, `promo_code`, `free_account_email`, `first_post_date`, `post_link`, `disclosure_ok` (yes/no + screenshot link), `signups`, `activated`, `paying`, `bounty_pending_try`, `bounty_paid_try`, `last_payout_date`, `stripe_payout_onboarded` (yes/no; bank details live only in Stripe).

Numbers for `signups`…`bounty_paid_try` come from the partner report (§4.2 item 3), never typed by hand.

### 4.7 Daily and weekly routine

| When | Merisa | Ekin |
|---|---|---|
| Daily | ~4 h, Mon–Fri: 5 helpful answers in target groups (no links); 8 new admin messages (Varyant 5); follow-ups due today; reply to partner questions; check new partner posts for #işbirliği | ~3 h, Mon–Fri: 3 X replies/quotes on e-ihracat threads; 3 new messages (Varyant 6); 2 Shorts/clips a week from the tutorials (when they're public) |
| Mon | Pick this week's 30 contacts from the shortlist (highest score first); weekly KPI sheet update | Pick 20 X/YouTube contacts |
| Wed | One live demo for a partner group (from week 4), 30 min, scripted on tutorials V01/V02 | Prepares the demo slides/screens from the demo account |
| Fri | KPI report to the orchestrator (§4.8). Unusual deals → one message to Atilla | Content report: which posts brought signups |
| Monthly (5th) | Check the payable bounties in the admin report; send the payout list to Atilla for one approval; payouts go out through Stripe Global Payouts | — |

Hours: **Ekin ~15 h a week** on KolayXport (she splits 30 h with the Amazon shop; founder, 2026-10-19). Merisa is planned at ~20 h a week. The disclosure checks moved from Ekin to Merisa. If Ekin has less time in a given week, drop the YouTube contacts first, then the clips.

### 4.8 Phase 1 KPIs (weekly)

| KPI | Definition | W2 | W4 | W6 | W8 | W10 |
|---|---|---|---|---|---|---|
| Contacts sent (cum.) | First messages, all types | 40 | 150 | 260 | 370 | 480 |
| Partners signed (cum.) | Terms accepted + code issued | 2 | 7 | 12 | 18 | 23 |
| Partners active (cum.) | ≥1 post with disclosure | 1 | 4 | 7 | 10 | 13 |
| Signups (cum.) | All sources | 10 | 42 | 85 | 130 | 175 |
| **Activated users (cum.)** | Store connected within 7 days | 5 | 23 | 45 | 72 | 95 (**100 in W11**) |
| Activation rate | activated / signups | ≥50% | ≥50% | ≥50% | ≥55% | ≥55% |
| Paying (cum.) | First successful Stripe payment | 0 | 1 | 3 | 5 | 9 |
| Trial → paid | Paying / trials ended (cohort) | — | — | read | ≥8% | ≥10% |
| Commission owed | From partner report | ₺0 | ₺0 | small | — | — |

Week 1 is set-up (no contacts). Signups include organic from directories, SEO and YouTube; the partner report shows the split.

**Kill / fix rules (Phase 1):**
- Reply rate < 15% after 80 contacts → rewrite the first line (more specific value), not the offer.
- Partners sign but don't post → send a ready post draft + offer a live demo in their group.
- Signups come but activation < 40% → product problem (onboarding, roadmap G5); tell the orchestrator, don't push more traffic.
- A partner's referrals never activate (fake accounts) → pause that partner.

### 4.9 Gate to Phase 2 (all must be true)

1. **100 activated users** (§4.1).
2. **≥ 5 paying customers**, or trial→paid ≥ 8% on the first full cohort.
3. **Tracking live:** GTM + GA4 + Meta pixel/CAPI set in prod, test events verified (LAUNCH-CHECKLIST §C).
4. **Cookie panel complete** (Accept / Reject / Preferences), consent-gated pixels. gtm-overhaul ships it by **26 Oct**.
5. Attribution stored on the user (§4.2 items 1–2), so ads can be judged by trial→paid.
6. At least 2 customers have given **written consent** for a testimonial (legal-notes §2). This is not strictly required for ads, but it multiplies their conversion.

If by **the end of week 11 (~2027-01-10)** the gate isn't met, Merisa reports the numbers and the orchestrator/Atilla decide. **Ads don't start automatically.**

---

## 5. Phase 2: after 100 users (Instagram → Meta ads → Google ads)

Order and rules, reusing the existing kit:
1. **Instagram organic** (week of the gate, Ekin): post from [social/calendar-30d.md](social/calendar-30d.md) (copy ready), plus reels cut from the tutorials. Add consented testimonials and partner reposts.
2. **Meta ads, 2 weeks later** (Merisa): [social/ads-playbook.md](social/ads-playbook.md) as written, scaled to the cap: **₺15.000 in the first ad month**, which is the playbook's own ₺15k variant (concepts C1, C2, C4, C6, C8). Kill/scale thresholds unchanged (target cost per trial ≤ ₺450). A custom audience of signups (from the pixel) is excluded.
3. **Google Search ads, month after Meta** (Merisa): ₺5.000 test on high-intent terms from [seo/keyword-map.md](seo/keyword-map.md) (e.g. "etsy seo aracı", "etsy kar hesaplama", "etgb nedir", "erank alternatifi"), landing on the matching `/cozumler/*` page. Same CAC ceiling (₺4.500 per paying customer).
4. **Partner program keeps running**, and becomes cheaper than ads per customer; it's the default the ads are compared with.
5. **Partnerships** (now with traction to show): ShipEntegra, Paraşüt/QNB partner programs, 2–3 mali müşavir offices, one association (ETİD or Adana TO) talk/webinar.

---

## 6. 30 / 60 / 90 days

Day 1 = **Mon 2026-10-26** (one week to get Atilla's approvals and the attribution build in).

### Days 1–30 (weeks 1–4): set up and first partners

| Week | Targets | Who |
|---|---|---|
| W1 (26 Oct) | Partner terms approved (done 19 Oct). Cookie panel live (gtm-overhaul, 26 Oct). Attribution + ref + partner report built and deployed (dev session via deploy queue). Shortlist of 200 scored (Bionluk + Claude). Sheet set up. Merisa and Ekin each post 15 helpful answers. YouTube channel phone-verified (Atilla, 2 min) | Atilla, dev session, gtm-overhaul, Merisa, Ekin, freelancer |
| W2 (2 Nov) | 40 contacts. 2 partners signed. Tutorials switched Unlisted → Public (Atilla's OK, then gtm-overhaul; embeds are already live). Blog cadence starts (2/week, Merisa fact-checks each post before it ships) | Merisa, Ekin, gtm-overhaul |
| W3 (9 Nov) | 55 contacts (cum. 95). 4 partners. First partner posts | Merisa, Ekin |
| W4 (16 Nov) | 55 contacts (cum. 150). 7 partners, 4 active. **First live demo** in a partner group. 23 activated users. Review assumptions with real reply/accept rates | Merisa, Ekin |

### Days 31–60 (weeks 5–8): scale partners, Black Friday angle

| Week | Targets |
|---|---|
| W5 (23 Nov) | Black Friday/Cyber Monday content via partners ("Kasım'da ilanlarınızı hazırlayın", seo/content-calendar anchors). 60 contacts |
| W6 (30 Nov) | 12 partners, 7 active. 45 activated. First trial→paid read. **GTM/GA4/Meta IDs live** (Atilla's deadline 30 Nov; needed for the gate) |
| W7 (7 Dec) | Second live demo. Ask the first paying customers for feedback + testimonial consent (Merisa, written form) |
| W8 (14 Dec) | 18 partners, 10 active. 72 activated, 5 paying. First partner payout run (5 Jan for December revenue, after the 30-day hold) |

### Days 61–90 (weeks 9–13): gate, then Phase 2 if met

| Week | Targets |
|---|---|
| W9–W10 (21 Dec – 3 Jan) | 95 activated, 9 paying. Holiday weeks: keep outreach light, focus on onboarding the new users |
| W11 (4 Jan) | 100 activated → **gate review** (§4.9). If the gate is met: Instagram organic starts (Ekin). Partnership intros (Atilla sends one e-mail each to ShipEntegra and Paraşüt/QNB partner teams; Merisa follows up) |
| W12–W13 (11–24 Jan) | Meta ads test at ₺15k for the month, per playbook. Valentine's/Mother's Day listing-prep content (January). Partners keep going |

### Budget (cash cap ₺25.000 / month)

| Item | Month 1 | Month 2 | Month 3 |
|---|---|---|---|
| Bionluk list-building (one-off) | ₺5.000 | — | ₺2.000 (refresh) |
| Tools (Canva Pro, Google Workspace seat if needed, scheduling) | ₺1.500 | ₺1.500 | ₺1.500 |
| Partner perks (free Growth accounts) | ₺0 cash (our cost is the AI/API use) | ₺0 | ₺0 |
| Demo giveaways (e.g. one AI credit pack per demo attendee who activates) | — | ₺0 cash (credits) | ₺0 |
| Meta ads | ₺0 (no ads in Phase 1) | ₺0 | ₺15.000 *(only if the gate passed)* |
| Google ads | — | — | ₺3.000 *(only if the gate passed; the full ₺5k test runs the month after)* |
| Reserve (unspent rolls over) | ₺18.500 | ₺23.500 | ₺3.500 |
| **Cash total** | **₺6.500 (~$130)** | **₺1.500 (~$30)** | **₺21.500 (~$440)** |
| Partner bounties (results only, outside the cap) | ₺0 | ~₺0–10k | ~₺10–40k (covered by the yearly payments that earned them) |

Merisa's and Ekin's pay is not in this table (not known to this plan). USD at ~₺49,2.

### 90-day outcome targets

| KPI | Day 90 target |
|---|---|
| Activated users | ≥ 100 (gate) |
| Paying customers | ≥ 10 (founding spots half full) |
| Revenue collected | ≥ ₺150.000 (yearly prepay + Aylık mix; ~₺33.000 per yearly customer at the founding price) |
| Active partners | ≥ 13 |
| Share of signups from partners | ≥ 50% |
| Cost per paying customer (cash, excl. partner bounties) | ≤ ₺1.000 |
| Testimonials with written consent | ≥ 2 |

---

## 7. Who does what

### Atilla: only these (≈ 1 hour in total, then ~10 minutes a month)

| # | Task | When | Time |
|---|---|---|---|
| 1 | ~~Approve the partner terms~~ (done 2026-10-19 via orchestrator) | — | — |
| 2 | Approve the outreach templates (Varyant 5/6 + acceptance text) once, so Merisa/Ekin can send them without asking every time (social/README §5 still applies to anything non-standard) | Before W1 | 10 min |
| 3 | Phone-verify the YouTube channel (lifts the ~10/day upload cap and makes description links clickable) | **By 26 Oct** | 2 min |
| 3b | OK to switch the tutorials from Unlisted to Public | **By 2 Nov** | 1 min |
| 4 | Create the GTM container, GA4 and Meta pixel IDs and set them in the Hetzner `.env` via stdin (LAUNCH-CHECKLIST §C), or give Merisa admin on the Google/Meta accounts and only do the `.env` step | **By 30 Nov** (Phase 2 gate) | 30 min |
| 5 | Stripe: create the partner coupon once (20% off, repeating 3 months) and set `STRIPE_PARTNER_COUPON_ID`; the admin partner tool then creates each partner's code (referral-spec §4) | Before the first partner link goes out | 5 min |
| 5b | Grant the free Growth account to each new partner (admin user page), or give the admin role to someone who does it | Per partner, on Merisa's request | 2 min each |
| 6 | Monthly partner payouts: approve the payout list Merisa sends; payouts go out through Stripe Global Payouts from Tamsar, Inc. (enable Global Payouts once in the Stripe dashboard) | 5th of each month | 10 min |
| 6b | Confirm the pricing v2 numbers ([pricing-v2.md](pricing-v2.md) §3), and ask the accountant the two questions in pricing-v2 §5 (seller of record + KDV, payout paperwork) | Before pricing v2 is built | 30 min |
| 7 | ~~KDV~~ decided: prices shown "+KDV". Have the muhasebeci check the partner payout paperwork (stopaj / gider pusulası / fatura) | Before the first payout (5 Jan) | — |
| 8 | Phase 2 only: approve the ad budget start; send one intro e-mail each to ShipEntegra and Paraşüt/QNB partner teams (Merisa drafts them) | After the gate | 15 min |

**Atilla never does:** sales calls, demos, DMs, posting, chasing partners.

### Merisa and Ekin

Everything in §4.3–4.8 and §5: shortlists, outreach, partner onboarding, demos, the sheet, weekly KPI report, payout statements, Instagram and ads in Phase 2. Merisa leads groups, müşavirler, partner ops and ads; Ekin leads X, YouTube creators, content clips and Instagram.

### Claude sessions

| Work | Session |
|---|---|
| Referral attribution + `?ref=` + partner report (§4.2) | A dev session the orchestrator assigns; deploy only via mybaby-sync-product-50's queue; no MCP/OAuth-consent files touched |
| Cookie panel, tutorials public + embedded, `/ortaklik` terms page, blog cadence, Instagram assets | kolayxport-gtm-overhaul |
| Extension listing (Chrome Web Store copy), extension referral link in the limit screen (`utm_source=extension` already exists) | hepsiburada-full-integration (extension owner) |
| Play Store / iOS store listings | mybaby-sync-product-d7 |
| Weekly: shortlist research (finding new groups/accounts), personalised first lines for Merisa/Ekin to review, KPI report from the partner report | A marketing-support Claude session (web research only; any prod DB read needs Atilla's explicit permission) |

### Freelancers

- **Bionluk:** list-building (W1, month 3 refresh). Optional later: Reels editing in Phase 2.
- **Not hired:** commission-only "satış temsilcisi". The partner program already pays on results, and a second commission scheme would confuse attribution.

---

## 8. Risks and how the plan handles them

| Risk | Handling |
|---|---|
| Admins say yes but never post | Ready post drafts, a live demo in their group, and a 35% tier for active partners. Track `partners active`, not `signed` |
| Partners overclaim ("ilk ay satış garantisi") | Claims list in the acceptance pack, post check by Ekin, termination clause; reklam veren is co-liable (legal-notes §3) |
| Group audiences skew to beginners with no revenue → low trial→paid | Score groups on export fit; activation (store connected) as the gate metric; beginners get content, not pushes |
| HB/N11 sellers sign up and churn | Every message says "Hepsiburada/N11 yok, odak yurt dışı". Revisit when HB integration is live |
| Founding coupon blocks partner promo codes for the first 20 | Intended: referred users get 40% for life anyway; the partner link still attributes them |
| Attribution build slips | No links go out before it's live; partners can be signed but are told the start date |
| Tracking/cookie panel late → Phase 2 delayed | It's in the gate on purpose; Phase 1 doesn't need pixels |
| Payouts to individuals create tax paperwork | Paid by Tamsar, Inc. through Stripe Global Payouts; W-8BEN on file; the partner declares the income in Turkey (accountant confirms) |
| Yearly-first pricing converts lower without taksit | iyzico/PayTR with taksit before pricing v2 goes live; Aylık stays as the low-commitment option |
| Review freezes (Shopify, MCP, Play) | Marketing never edits those listings or reviewer accounts; links only |

---

## 9. Decisions and open items

Decided:
- **2026-10-19 (Atilla):**
  - Pricing v2 model: yearly packages, one monthly plan, modules, and iyzico/PayTR for taksit.
  - One-time partner bounty: 25% of the first yearly payment, 30% from the 10th paying referral, ₺1.500 for Aylık after the 2nd payment.
  - Partner dashboard in the app.
  - Payouts through Stripe Global Payouts from Tamsar, Inc., which collects in TRY.
- **2026-10-19 (orchestrator):** prices shown "+KDV"; partner code 20% off the first payment or 3 months; Ekin ~15 h/week.

Still open:
1. Pricing v2 numbers (pricing-v2 §3): Atilla confirms.
2. Accountant: seller of record + KDV for Turkish customers, and the payout paperwork (pricing-v2 §5). This also decides which entity holds iyzico/PayTR.
3. Merisa's hours (planned ~20 h/week).
4. The dated Atilla actions in §7: YouTube phone verification (26 Oct), tutorials Public (2 Nov), tracking IDs (30 Nov).
