# Positioning options (Phase 1, needs the owner's decision)

Date: 2026-10-17. Based on [feature-inventory.md](feature-inventory.md), [pain-points.md](pain-points.md) and [competitors.md](competitors.md). No page gets built until the owner picks an option.

## What the research says, in one paragraph

Domestic integration is crowded and price-anchored. BirFatura is free, Yengeç starts at ₺600/mo, Zunapro and Pazarus have free tiers, and BirFatura covers 32+ marketplaces. KolayXport doesn't have Hepsiburada, N11, Çiçeksepeti, or Yurtiçi/Aras labels, and AI no longer sets anyone apart on domestic marketplaces, since Dopigo, Entegra and Pazarus all market it. On the export side, Turkish integrators lock Etsy and eBay behind ₺83k–₺125k/yr tiers and only sync orders and stock there. No one offers English listing SEO, research or staged bulk editing. Global tools (eRank, Vela, EverBee) do one slice each, in English, and know nothing about ETGB, Paraşüt or the lira. The most frequent export pain in the research is "134 ürün, 4 satış": sellers get no visibility. KolayXport's deepest code addresses exactly that.

---

## Option A: Export-first (recommended)

**Promise:** *"Etsy, eBay ve Amazon'da satan Türk satıcının tek paneli: ilanını yapay zekâ ile İngilizce optimize et, ne satacağını veriyle bul, kargonu ve ETGB'ni aynı yerden hallet."*
Short form: **"Yurt dışına satışın tek paneli."**

- **Primary ICP:** Turkish sellers on Etsy and/or eBay, with Amazon global secondary. Shops of 1–10 people in handmade, textile, jewellery, home and POD. Two sub-segments: *stuck* (listings live, few sales) and *scaling* (orders flowing, ops pain).
- **Top 3 proof points** (inventory IDs):
  1. Etsy/eBay listing studio: single and staged bulk editing, English AI titles/tags/descriptions, AI photos, listing doctor, Etsy↔eBay cross-listing, scheduled sends (see inventory §1 Listing management + AI tools; `crosslist-etsy-ebay`, `scheduled-send`, `research-listing-doctor`, `ai-listing-copy`).
  2. Research hub across Etsy/eBay/Amazon/Trendyol, the Trendyol→eBay arbitrage finder, and Chrome extension overlays on 11 marketplace sites (`research-keywords`, `research-product-finder`, `arbitrage-price-gap`, `ext-research-overlay`).
  3. Export operations: FedEx/UPS labels with a paperless commercial invoice, ETGB file + Paraşüt e-Arşiv, and real net profit in USD and TL (`label-fedex`, `label-ups`, `customs-commercial-invoice`, `etgb-excel-email`, `reports-profit`).
- **Competitors it beats:**
  - The "integrator + eRank + Vela" stack: ₺89k/yr Sentos Platinum or ₺125k/yr Entegra Paket 5, plus $40–70/mo of English tools.
  - ShopiVerse ($140–500/mo, AI limited to translation).
  - PraPazar (no listing editor or research).
- **Pricing implication:** the current ladder holds. Pro at ₺7,999/mo, billed monthly, undercuts the export tiers of every Turkish integrator. Starter (₺2,499) will be compared with Yengeç's export add-on ($22.90 per store), so Starter copy should lead on AI and research rather than "connection". A free or very low-cost entry point (research or extension only) would counter "ücretsiz" anchoring. Treat that as a product decision for later.
- **Risks:**
  - The two loudest export pains, payouts and account suspensions, can't be solved by software. Copy must not imply it.
  - **The ETGB flow hard-codes the founder's company as exporter** (`etgb-excel-email`, N-3), so it can't be advertised until that's fixed.
  - The Chrome extension has no install path (it isn't on the Web Store).
  - The market is smaller than domestic, and it depends on Etsy's policies.
  - ShipEntegra gives shipping software away for free, so labels shouldn't be the lead message.

## Option B: "All marketplaces, one panel" (not recommended)

**Promise:** *"Tüm pazaryerlerin tek panelde: sipariş, stok, fatura, kargo."*

- **ICP:** domestic multi-marketplace sellers (Trendyol + Hepsiburada + N11 + Amazon TR).
- **Proof:** Trendyol orders and listings, stock sync (Etsy/eBay/Trendyol/Shopify/Wix), DHL eCommerce labels.
- **Competitor it would have to beat:** BirFatura, Sentos and Dopigo. **It loses** on coverage (no Hepsiburada, N11 or Çiçeksepeti), on Turkish carriers (no Yurtiçi, Aras or Sürat) and on entry price (free and ₺600 offers exist).
- **Pricing implication:** it would force prices below ₺1,000/mo and contradicts the "price above integrators" decision.
- **Risk:** the ads would promise integrations that don't exist. Under the Ticari Reklam regulation that is a legal exposure, not just a conversion problem.

## Option C: Hybrid "Trendyol'dan dünyaya" (recommended as a secondary story under A)

**Promise:** *"Trendyol'da satıyorsun; aynı ürünleri Etsy ve eBay'de de sat. Stok tek yerden, ilanlar yapay zekâyla İngilizce."*

- **ICP:** Trendyol sellers (250k+) curious about e-export. This segment searches "trendyol'dan alıp ebay'de satmak" and "mikro ihracat nasıl yapılır".
- **Proof:** Trendyol product management, stock sync Trendyol↔Etsy/eBay/Shopify, Trendyol→eBay arbitrage, cross-listing.
- **Competitor it beats:** ShopiVerse and Yengeç (export add-on with no listing tools).
- **Pricing implication:** Growth or Pro.
- **Risks:**
  - The Trendyol integration is env-gated (`MARKETPLACE_TRENDYOL`). Confirm it is on for all users before advertising it.
  - These sellers often also need Hepsiburada and will keep their current integrator for it, so position KolayXport as an add-on rather than a replacement.

---

## Recommendation

**Go with A as the brand story and C as one campaign and landing-page track.**

- **Home and brand:** "Yurt dışına satışın tek paneli", with export-first copy throughout.
- **Use-case pages:**
  - Etsy satıcısı (core)
  - eBay'de satış
  - Trendyol'dan dünyaya (option C)
  - Mikro ihracat: kargo + ETGB, after the ETGB fix
  - AI ile ilan optimizasyonu
  - Ürün araştırması ve arbitraj
- **Domestic features stay as supporting proof:** Trendyol, stock sync, DHL eCommerce. Never lead with "tüm pazaryerleri".
- **Tone:** concrete outcomes ("134 ürün, 4 satış" → see what's missing in your listing), no "#1/only/en iyi" claims, and every claim backed by an inventory row.

### Must fix before Option A's claims go into ads
1. ETGB exporter hard-coded to one company: make it per-user (exporter name, VKN, address, default HS code from settings).
2. Chrome extension: publish to the Web Store, or remove "install" CTAs.
3. Trendyol/Shopify "Add tracking" button saves the number locally only: label it honestly or hide it.
4. The `financials` gate is UI-only: add `requireFeature` on `/api/finance/*`, or the Pro tier sells a free feature.
5. Already done on `gtm/overhaul`: 14-day trial, Pro purchasable, founding-member offer backed by a real Stripe coupon, signup-intent links.
