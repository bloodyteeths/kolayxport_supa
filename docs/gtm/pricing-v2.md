# Pricing v2 for Turkey: yearly packages + one monthly plan + modules

Date: 2026-10-19. Status: **model and package prices decided by Atilla** (prices confirmed 2026-10-19, 19:48: Başlangıç ₺29.990, Büyüme ₺54.990, Pro ₺89.990, Kurumsal from ₺149.990 a year, Aylık ₺2.999 a month, all +KDV). **Module prices are still a proposal.** Still open: seller of record / KDV (§5). Nothing is built or published yet; partners quote no prices until checkout exists.
Supersedes the monthly ladder (Starter ₺2.499 / Growth ₺4.999 / Pro ₺7.999 a month) for Turkish customers. Shopify App Store pricing (`shopify_free`) is not affected.

## 1. Decisions (Atilla, 2026-10-19)

1. **Yearly packages are the main offer.** Only **one** monthly plan exists. Monthly users add **modules** instead of upgrading.
2. **iyzico or PayTR** for yearly payments in TRY **with taksit**. Turkish sellers pay ₺30–90k yearly fees in installments, and Stripe can't offer Turkish installments.
3. **Today**, payments are collected by **Tamsar, Inc.** (US) in TRY via Stripe, under its agreement with Modsons Yazılım (Atilla, 2026-10-19). KolayXport itself is published by **Modsons Yazılım E-Ticaret İthalat İhracat Ltd. Şti.** (Adana; [company.md](company.md)). Which entity sells to *Turkish* customers is the accountant question in §5.
4. Prices are shown **"+KDV"**, with the KDV-inclusive total at checkout (orchestrator decision, 2026-10-19). **See §5: this needs the accountant now that the seller is a US company.**

## 2. Why (PraPazar, checked 2026-10-19 on prapazar.com/tr/paketler)

- **Monthly:** one plan only, Eko Aylık at ₺2.550/mo (5 stores, 1.000 orders, no sub-users), with paid modules such as e-Fatura +₺1.850, Mağaza Import +₺1.150, and stock modules at +₺250 each.
- **Yearly:** Eko Plus ₺27.250, Pra ₺39.250, Uzman ₺59.250 and Enterprise ₺74.250. Cargo integration is a +₺13.000/yr module below Uzman.
- **KDV and payment:** prices carry no KDV (teknopark exemption), and 3 taksit are offered on major cards.
- **Where we stand:** our yearly equivalents (₺24.990 / ₺49.990 / ₺79.990 +KDV) were already in PraPazar's range. The gap was the structure, not the level. Sentos (₺89k) and Entegra (₺125k) are still far above us for the Etsy/eBay tier ([competitors.md](competitors.md) §4).

## 3. Proposed price list (+KDV)

### Yearly packages (main offer, taksit via iyzico/PayTR): prices DECIDED 2026-10-19

| | **Başlangıç** | **Büyüme** | **Pro** | **Kurumsal** |
|---|---|---|---|---|
| Price / year | **₺29.990** | **₺54.990** | **₺89.990** | from **₺149.990** (quote) |
| ≈ per month | ₺2.499 | ₺4.583 | ₺7.499 | — |
| Taksit | up to 6 | up to 9 | up to 12 | by agreement |
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
| Price | **₺2.999 / month** +KDV (card, Stripe) |
| Includes | 2 stores, 500 orders/month, 250 labels/month, 300 AI credits/month, listing studio, AI text, research, Chrome extension, labels, ETGB file, stock sync |
| Purpose | A low-commitment entry for sellers who won't prepay. It's deliberately priced above Başlangıç's monthly equivalent (₺2.499), so yearly is the obvious deal |

### Modules (add-ons): prices still a PROPOSAL

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

- **14-day trial, no card**, no free tier. At the end of the trial, the default offer is a **yearly package with taksit**, with Aylık as the secondary button.
- **Founding member: 40% off for life, first 20 subscribers**, on any package or Aylık. Live counter only.
- **Partner audience code** (after the founding spots are gone): **20% off** the first yearly payment, or the first 3 months of Aylık.
- **Shopify App Store installs:** unchanged (`shopify_free`; no prices or upgrades shown, App Store rule 1.2.1).

## 4. What has to be built (for the orchestrator to assign)

| # | Work | Owner | Notes |
|---|---|---|---|
| P1 | Plan keys `aylik`, `baslangic_yil`, `buyume_yil`, `pro_yil`, `kurumsal`; yearly order/label buckets; module entitlements (`financials`, `arbitrage`, `bulkPhotoStudio`, `extraStore`, `extraOrders`) | **DONE** 2026-10-19 (d7, `d44c426e`, behind `PRICING_V2`, flag off) | `lib/billing/planLimits.ts`, `featureMap.ts`, usage middleware. Existing Starter/Growth/Pro subscribers (none paying today) can be migrated or grandfathered |
| P2 | iyzico **or** PayTR checkout for yearly TRY payments with taksit; webhook → same entitlement code as Stripe | dev session | Merchant account: whichever entity the accountant names (§5). The partner bounty must also fire on these payments (referral-spec §3) |
| P3 | Stripe prices for Aylık + modules (TRY and USD) | **On hold until the accountant answers** (orchestrator, 2026-10-19); then Atilla creates them in Stripe and dev wires the env ids | |
| P4 | `/fiyatlandirma` redesign: 4 yearly cards + "Aylık" line + module table, "+KDV" with the total at checkout | kolayxport-gtm-overhaul | Claims check; no AI credit counts unless metered (they are now, see AI credits) |
| P5 | Copy updates (cases, compare pages, ads playbook unit economics) | kolayxport-gtm-overhaul | After P1–P4 are live |

## 5. Open items that need the accountant (before P2/P4 go live)

**Recommended (orchestrator + this plan):** split by customer country.
- **Turkish customers:** **Modsons is the seller of record.** It issues an e-fatura/e-Arşiv with KDV, holds the iyzico/PayTR account (yearly with taksit), and possibly also takes Aylık via iyzico/PayTR card subscriptions.
- **Non-Turkish customers:** Tamsar, Inc. stays the seller via Stripe.
- **Why:** Turkish sellers can book a Turkish e-fatura as an expense and deduct its KDV directly. A US invoice forces them to self-assess KDV (sorumlu sıfatıyla), which small sellers dislike. iyzico/PayTR also need a Turkish merchant.
- This changes what Atilla described today (Tamsar collects TRY from everyone), so **he and the accountant decide**.

**Question for the accountant:**
1. Can Modsons be the seller of record for KolayXport subscriptions sold to Turkish customers (e-fatura/e-Arşiv with 20% KDV, payment through iyzico/PayTR with taksit), while Tamsar, Inc. keeps selling to foreign customers via Stripe? Does the existing Modsons–Tamsar agreement need changing for that?
2. If Tamsar, Inc. instead keeps collecting from Turkish customers: what are its KDV obligations as a foreign e-service provider (B2C registration, B2B reverse charge), and can we still show prices "+KDV"?
3. Partner referral bounties (one-time, ₺1.500–₺27.000) paid to Turkish individuals and companies:
   - **If Modsons pays:** companies send a fatura; for individuals, is it a gider pusulası with stopaj (which rate), or must they issue a serbest meslek makbuzu?
   - **If Tamsar, Inc. pays** via Stripe Global Payouts: is a W-8BEN / W-8BEN-E enough, with the partner declaring the income in Turkey?
4. Is the KolayXport subscription a deductible expense for Turkish sellers in each case (Modsons e-fatura vs Tamsar invoice)?

**What changes with the answer:**
- **Modsons sells in Turkey:** iyzico/PayTR (P2) under Modsons; Stripe stays for non-TR customers. Partner payouts go by **EFT from Modsons**: the bounty ledger stays the same and the payout run uses the CSV fallback (referral-spec §4.3). Stripe Global Payouts only covers bounties earned on Tamsar, Inc. sales.
- **Tamsar, Inc. sells everywhere:** as written today; iyzico/PayTR would need another route (they are Turkish merchants), and "+KDV" wording follows the accountant.

## 6. Effect on the gameplan

- **Unit economics:** a referred yearly customer brings ₺29.990–89.990 up front (less 40% for founding members). Yearly prepay will convert at a lower rate than monthly, so plan trial→paid at **6%** for yearly and **4%** for Aylık until week 6 data replaces it.
- **The partner bounty** is one-time ([turkey-gameplan.md](turkey-gameplan.md) §4.2).
