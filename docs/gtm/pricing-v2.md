# Pricing v2 for Turkey: yearly packages + one monthly plan + modules

Date: 2026-10-19. Status: **model, package prices and seller decided by Atilla.** Prices (confirmed 2026-10-19, 19:48): Başlangıç ₺29.990, Büyüme ₺54.990, Pro ₺89.990, Kurumsal from ₺149.990 a year, Aylık ₺2.999 a month. These are **final amounts: Tamsar, Inc. sells and adds no KDV**. All 14 Stripe prices exist (created by d7, live but inert behind `PRICING_V2`; the code is waiting for a deploy). **Module prices** confirmed by Atilla on 2026-10-19 at 20:23 (§3). Open: how to offer taksit (§5). Partners quote no prices until checkout is live.
Supersedes the monthly ladder (Starter ₺2.499 / Growth ₺4.999 / Pro ₺7.999 a month) for Turkish customers. Shopify App Store pricing (`shopify_free`) is not affected.

## 1. Decisions (Atilla, 2026-10-19)

1. **Yearly packages are the main offer.** Only **one** monthly plan exists. Monthly users add **modules** instead of upgrading.
2. **Yearly packages are pay-in-full only** (Stripe card). There is no taksit and no "yearly, paid monthly" option. Aylık ₺2.999 stays as the no-commitment option (Atilla, 2026-10-19, via the board).
3. **Seller of record = Tamsar, Inc.** (US) for all customers. It charges in TRY via Stripe, **with no KDV added**. Modsons Yazılım E-Ticaret İthalat İhracat Ltd. Şti. ([company.md](company.md)) invoices Tamsar, Inc. for its services and runs marketing on the Turkish side (Atilla, 2026-10-19, in d7's session).
4. **Prices are shown as final amounts**, with no "+KDV" (this supersedes the earlier "+KDV" decision of the same day).

## 2. Why (PraPazar, checked 2026-10-19 on prapazar.com/tr/paketler)

- **Monthly:** one plan only, Eko Aylık at ₺2.550/mo (5 stores, 1.000 orders, no sub-users), with paid modules such as e-Fatura +₺1.850, Mağaza Import +₺1.150, and stock modules at +₺250 each.
- **Yearly:** Eko Plus ₺27.250, Pra ₺39.250, Uzman ₺59.250 and Enterprise ₺74.250. Cargo integration is a +₺13.000/yr module below Uzman.
- **KDV and payment:** prices carry no KDV (teknopark exemption), and 3 taksit are offered on major cards.
- **Where we stand:** our old yearly equivalents (₺24.990 / ₺49.990 / ₺79.990) were already in PraPazar's range. The gap was the structure, not the level. Sentos (₺89k) and Entegra (₺125k) are still far above us for the Etsy/eBay tier ([competitors.md](competitors.md) §4).

## 3. Price list (final amounts, no KDV added)

### Yearly packages (main offer): prices DECIDED 2026-10-19

| | **Başlangıç** | **Büyüme** | **Pro** | **Kurumsal** |
|---|---|---|---|---|
| Price / year | **₺29.990** | **₺54.990** | **₺89.990** | from **₺149.990** (quote) |
| ≈ per month | ₺2.499 | ₺4.583 | ₺7.499 | — |
| Payment | yearly, **paid in full** by card (Stripe) | same | same | by agreement |
| Connected stores | 3 | 6 | 12 | custom |
| Orders / year | 6.000 | 24.000 | 72.000 | custom |
| Labels / year | 3.000 | 12.000 | 36.000 | custom |
| AI credits / month | 300 | 1.500 | 3.000 | 10.000 (cap) |
| Listing studio, AI text, research, Chrome extension, labels, ETGB file, stock sync | ✓ | ✓ | ✓ | ✓ |
| Finance & net profit | module | module | ✓ | ✓ |
| Arbitrage / price gap | module | module | ✓ | ✓ |
| Bulk photo studio | module | module | ✓ | ✓ |
| Priority support (WhatsApp) | — | — | ✓ | ✓ |

The feature split follows today's gates (Pro-only = `financials`, `arbitrage`, bulk photo studio in `lib/billing/featureMap.ts`), so the code change is mostly plan keys, limits and checkout. Order/label limits move from monthly to yearly buckets for yearly packages.

### The one monthly plan: price DECIDED 2026-10-19

| **Aylık** | |
|---|---|
| Price | **₺2.999 / month** (card, Stripe; no KDV added) |
| Includes | 2 stores, 500 orders/month, 250 labels/month, 300 AI credits/month, listing studio, AI text, research, Chrome extension, labels, ETGB file, stock sync |
| Purpose | A low-commitment entry for sellers who won't prepay. It's deliberately priced above Başlangıç's monthly equivalent (₺2.499), so yearly is the obvious deal |

### Modules (add-ons): prices DECIDED 2026-10-19 (20:23), final amounts, no KDV added

| Module | On Aylık (per month) | On a yearly package (per year) |
|---|---|---|
| Finance & net profit (Etsy, eBay, Amazon, Trendyol) | ₺990 | ₺9.900 |
| Arbitrage / price gap | ₺990 | ₺9.900 |
| Bulk photo studio | ₺790 | ₺7.900 |
| Extra connected store | ₺490 each | ₺4.900 each |
| +500 orders / month (yearly: +6.000 / year) | ₺490 | ₺4.900 |
| AI credit packs | existing: 500 / 1.500 / 5.000 / 15.000 credits for ₺599 / ₺1.599 / ₺3.999 / ₺9.999 | same |

**Rule in the UI:** when a user's modules cost more than the next package, show "Büyüme/Pro yıllık daha uygun" with the difference. Modules are the upsell path, not a way around packages.

### Offers that stay

- **14-day trial, no card**, no free tier. At the end of the trial, the default offer is a **yearly package, paid in full**, with Aylık as the no-commitment option.
- **Founding member: 40% off for life, first 20 subscribers**, on any package or Aylık. Live counter only.
- **Partner audience code** (after the founding spots are gone): **20% off** the first yearly payment, or the first 3 months of Aylık.
- **Shopify App Store installs:** unchanged (`shopify_free`; no prices or upgrades shown, App Store rule 1.2.1).

## 4. What has to be built (for the orchestrator to assign)

| # | Work | Owner | Notes |
|---|---|---|---|
| P1 | Plan keys `aylik`, `baslangic_yil`, `buyume_yil`, `pro_yil`, `kurumsal`; yearly order/label buckets; module entitlements (`financials`, `arbitrage`, `bulkPhotoStudio`, `extraStore`, `extraOrders`) | **DONE** 2026-10-19 (d7, `d44c426e`, behind `PRICING_V2`, flag off) | `lib/billing/planLimits.ts`, `featureMap.ts`, usage middleware. Existing Starter/Growth/Pro subscribers (none paying today) can be migrated or grandfathered |
| P2 | ~~iyzico/PayTR checkout~~ | **Dropped** 2026-10-19 (Atilla) | Parked idea in §5 |
| P3 | Stripe prices: all 14 (yearly packages, Aylık, modules; TRY and USD) | **DONE** 2026-10-19 by d7 (live, inert behind `PRICING_V2`); the code is waiting for a deploy slot | Module amounts confirmed 2026-10-19 |
| P4 | `/fiyatlandirma` redesign: 4 yearly cards + "Aylık" line + module table, **final amounts (no "+KDV")** | kolayxport-gtm-overhaul | Claims check; no AI credit counts unless metered (they are now, see AI credits) |
| P5 | Copy updates (cases, compare pages, ads playbook unit economics) | kolayxport-gtm-overhaul | After P1–P4 are live |

## 5. Seller of record and taksit (both resolved)

**Resolved by Atilla (2026-10-19):** Tamsar, Inc. is the seller for all customers, charges in TRY via Stripe and adds no KDV. Modsons invoices Tamsar, Inc. for services and does marketing in Turkey. Consequences:
- **Partner bounties are paid by Tamsar, Inc.** via Stripe Global Payouts (referral-spec §4.3). For tax paperwork (W-8BEN / W-8BEN-E from partners; partners declare the income in Turkey), have the accountant confirm once before the first payout run (5 Jan). This is not a blocker for building.
- **Bounty base = the amount paid** (no KDV is charged, so nothing is deducted).
- **Copy:** never "+KDV"; prices are final amounts.

**Taksit: decided by Atilla (2026-10-19, via the board)**
- Yearly packages are **pay-in-full only** by card through Stripe. Aylık ₺2.999 a month is the no-commitment option.
- "Yearly, paid monthly on a 12-month commitment" was proposed and **rejected**.
- iyzico/PayTR (P2) are **dropped**: they onboard Turkish-registered merchants only, and Tamsar, Inc. is the seller. Stripe card installments exist only for Mexico and Japan accounts.
- The partner bounty stays at **25% of the first yearly payment**, paid once (no split).
- **Parked idea:** real taksit is only possible later via a Turkish seller entity (e.g. a Turkish company selling to Turkish customers with iyzico/PayTR). Revisit only if yearly conversion proves too low.
- Copy never mentions taksit. If a seller asks, the answer is: "Yıllık paket tek çekimle ödenir; taahhütsüz seçenek olarak Aylık plan var." Don't suggest bank-side installment conversion.

## 6. Effect on the gameplan

- **Unit economics:** a referred yearly customer brings ₺29.990–89.990 up front (less 40% for founding members). Yearly prepay will convert at a lower rate than monthly, so plan trial→paid at **6%** for yearly and **4%** for Aylık until week 6 data replaces it.
- **The partner bounty** is one-time ([turkey-gameplan.md](turkey-gameplan.md) §4.2).
