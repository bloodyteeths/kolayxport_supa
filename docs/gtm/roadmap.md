# Product-gap roadmap (Phase 7)

Date: 2026-10-17. Branch: `gtm/overhaul`. Inputs: [pain-points.md](pain-points.md) §3 and segment sections, [competitors.md](competitors.md) "Where KolayXport loses" and §6 risks, [feature-inventory.md](feature-inventory.md) §4 (never claim), §6 (half-built) and §7 (branch changes), [site-audit.md](site-audit.md) §4 fix list, [positioning.md](positioning.md) (decision A+C).

**How to read this.** Each gap lists the demand evidence as `file:line`, effort (S ≤ 3 dev-days, M ≤ 2 weeks, L > 2 weeks, solo founder pace), revenue impact, dependencies, and whether it **blocks the paid-ad launch**. The ordering follows the positioning decision. Export-first (A) and the "Trendyol'dan dünyaya" track (C) come first. Domestic breadth gaps are real, but they belong to option B, which was rejected, so they rank lower unless they protect the C track.

"Blocks ads" means one of two things. Either an ad or landing page would make a claim the product can't back, which is a legal exposure under the Ticari Reklam regulation (see [social/legal-notes.md](social/legal-notes.md) §2). Or paid traffic would land somewhere it can't convert or can't be measured.

---

## 0. Must-haves already DONE on `gtm/overhaul` (committed, not yet live)

The live site was audited on 2026-10-17. None of the items below are live until the branch is merged and deployed. **Deploying the branch (G0) is the first must-have.**

| Must-have | Status on branch | Commit(s) | Was |
|---|---|---|---|
| 14-day trial everywhere (signup, Google OAuth, Shopify install, copy; Stripe carries over remaining trial) | DONE | `af08f85` | H-3, site-audit P0-1 |
| Pro purchasable + enforced limits = decided tiers (Trial 150/30, Starter 500/250, Growth 2000/1000, Pro 6000/3000) | DONE (order meter still counts sync calls, see G6) | `d446f0a` | H-1, H-2 |
| Founding-member coupon backend (`/api/billing/founding-spots`, coupon applied at checkout, 409 `founding_full`) | DONE | `d446f0a` | H-11, P0-10 |
| Signup-mode links (`/login?mode=signup` opens signup; CTAs point there) | DONE | `20ef38b` | P0-2 |
| Contact form escaping + no error leakage | DONE | `cc1c991` | security |
| Finance APIs Pro-gated server-side (`requireFeature('financials')`) | DONE | `d77f996` | H-5 |
| ETGB exporter per user (name, VKN, default GTİP, origin from Gönderici profili; refuses when missing) | DONE (still an Excel emailed to the broker, not a filing) | `6cdd6fa` | N-3, H-10 |
| LCP fix (no `opacity:0` page transition) | DONE | `90fd24f` | P0-11 |
| Sitemap/robots exclude app, auth and account pages | DONE | `90fd24f` | P1-6 |
| Valid OG image + favicon + brand assets | DONE (also made after the brief) | `83f8e43` | P0-6, P0-7 |
| Marketing site rebuilt from the inventory (false claims removed, legal texts, /cozumler, /nasil-kullanirim, KVKK cookie banner, Consent Mode v2, GTM loader, first-touch UTM capture) | DONE in code (also made after the brief). Not verified by me against the live claim list; run `npm run gtm:check-claims` | `d03421a` | P0-3 (partly), P0-4, P0-5, P0-12 (partly) |
| Server-side funnel events (`sign_up`, `start_trial`) | IN PROGRESS: uncommitted changes in the working tree (`lib/tracking/server.ts`, `pages/api/auth/signup.ts`) | — | P0-3 |

---

## 1. Gap register

### Launch blockers (pre-ads)

| ID | Gap | Demand / evidence | Effort | Revenue impact | Dependency | Blocks ads? |
|---|---|---|---|---|---|---|
| G0 | **Deploy `gtm/overhaul` to production and verify live** | site-audit.md:11 (fixes on branch "are not live"), :421–432 (P0 list) | S | Prerequisite for everything: the live site still says 30-day trial and has a broken signup path | Founder runs the deploy (VPS autodeploy) | **Yes** |
| G1 | **Analytics + pixels live**: set `NEXT_PUBLIC_GTM_ID`, add GA4 + Meta pixel/CAPI + TikTok pixel in GTM, consent-gated; verify `sign_up` / `begin_checkout` | site-audit.md:423 (P0-3), :424 (P0-4) | S (code exists in `d03421a`; the rest is configuration) | Without it, ad spend can't be optimised or judged ([ads-playbook.md](social/ads-playbook.md) §3) | G0; Meta Business verification | **Yes** |
| G2 | **Signup attribution stored on the user** (first-touch UTM from `kx-utm` written to the User row at signup) so trial→paid can be read per channel/concept | ads-playbook §3 kill/scale rules need it. First-touch capture exists only in the browser (`lib/tracking/events.ts:44–47`) | S | Lets you cut losing channels in month 2. Without it, trial→paid is blind | G0, schema field | **Yes** (for measurement) |
| G3 | **Order meter counts orders, not sync calls** (or relabel pricing until it does) | feature-inventory.md:297 (H-2); `lib/billing/planLimits.ts` `ENFORCEMENT_GAP`: "150 sync calls" vs "150 orders/month" | M (count distinct new orders per period); S to relabel | Trial users who refresh often can hit 150 *calls* within days and get blocked: a conversion killer for ad traffic. Pricing says "orders", so this is also a claim mismatch | — | **Yes** (fix or relabel) |
| G4 | **AI cost guard on trial** (per-user daily caps on AI image generation and bulk AI) and remove "AI kredisi" counts from pricing until metered | feature-inventory.md:299 (H-4), :259 (N-10); `ai-image-gen` is ungated in the editor (:119) | S (caps); M (real credit metering, G19) | Protects Gemini margin once paid traffic brings many no-card trials. Removes an unmetered claim | — | **Yes** (caps + copy) |
| G5 | **Onboarding on first login**: show the existing setup checklist to new users instead of an empty sales report (S). A full wizard comes later | feature-inventory.md:301 (H-6), :192 (`onboarding-checklist` hidden) | S (unhide + redirect new users); M (guided wizard) | Activation of paid trials. Ad traffic that lands on an empty dashboard churns | G0 | **Yes** (S version) |
| G6 | **"Add tracking" honesty for Trendyol/Shopify/Hepsiburada**: label it "save locally" or hide it; fix HTTP 200 on failed push | feature-inventory.md:304 (H-9), :256 (N-7); pain-points.md:191 (B8 "kargoya verildi olarak görünmüyor") | S | Avoids support tickets and claim exposure on the Trendyol track | — | **Yes** for the Trendyol'dan dünyaya ads (C6/C7) |
| G7 | **Hide Hepsiburada as an integration** (Connections tile, nav gating) until it exists | feature-inventory.md:310 (H-15), :250 (N-1) | S | Avoids a misleading claim and HB-seller signups that can't be served | — | **Yes** |
| G8 | **Confirm Trendyol/Wix production flags** (`MARKETPLACE_TRENDYOL`, `MARKETPLACE_WIX`), or limit Trendyol copy to listings | feature-inventory.md:311 (H-16), :50; positioning.md:52 (risk) | S (verify on VPS) | The C campaign depends on it | VPS access | **Partly**: C-track ads only |
| G9 | **Chrome extension: publish to the Chrome Web Store, or remove every "install" CTA** | feature-inventory.md:302 (H-7), :261 (N-12); competitors.md:26 (extension is a differentiator); positioning.md:29 | M (store listing, privacy disclosures, review time); S to remove CTAs | Unlocks Etsy addresses + tracking push (`ext-etsy-address`, `ext-etsy-tracking`) and a free top-of-funnel tool (G21) | Google review; privacy policy covering extension data | **Removing the CTAs: yes. Publishing: no** (calendar Day 29 is gated) |

### First 30 days after launch

| ID | Gap | Demand / evidence | Effort | Revenue impact | Dependency | Blocks ads? |
|---|---|---|---|---|---|---|
| G10 | **Discount-code entry at checkout** (Stripe promotion codes; Checkout currently passes `discounts` for the founding coupon only. Stripe treats `discounts` and `allow_promotion_codes` as alternatives, so decide which applies) | Needed for outreach Variant 2 ([outreach-messages.md](social/outreach-messages.md)); `pages/api/stripe/create-checkout-session.ts` (founding `discounts`, no promo field) | S | Community/creator deals and attribution by code | Founder creates promotion codes in Stripe | No |
| G11 | **In-app help linked to the video library** (V01–V12) and per-integration guides; fix "Kurulum rehberini gör" links | feature-inventory.md:303 (H-8), :191; site-audit.md:442 (P1-5 video placeholder) | S per guide once the videos exist | Activation; less founder support time | Videos from [calendar-30d.md](social/calendar-30d.md) | No |
| G12 | **Paraşüt errors surfaced** (stop swallowing; show per-order invoice result after ETGB) | feature-inventory.md:84, :253 (N-4) | S | Trust in the export-ops story (calendar Day 25, ad C5) | — | No (C5 is gated anyway) |
| G13 | **WhatsApp Business support line** (number as text + `wa.me`, a Turkish response-time promise you can keep) | pain-points.md:301 (§3 #8 "Human, reachable support"), :134–141 (B2); competitors.md:33; site-audit.md:448 (P1-11) | S (site supports it "when configured", `d03421a`) | Conversion: Turkish SMBs expect WhatsApp. Differentiates against integrators' support complaints | A dedicated business number | No |
| G14 | **Shopify tracking push** (wire the existing `createFulfillment`) | feature-inventory.md:64, :256 (N-7) | S–M | Shopify-free installs and Shopify sellers on the C track | — | No |
| G15 | **Pro feature previews** (screenshots in the locked states) | feature-inventory.md:307 (H-12) | S (screens now exist in `public/marketing/screens/`) | Starter→Pro upsell for arbitrage, profit and bulk photo studio | — | No |
| G16 | **Close unmetered sync paths** (`/api/orders/fullSync`, cron) | feature-inventory.md:308 (H-13) | S | Revenue leakage / plan fairness | G3 | No |
| G17 | **Listing doctor "add tags in bulk"** (currently disabled) | feature-inventory.md:314 (H-19); pain-points.md:42–53 (A4, top export pain) | S–M | Strengthens the core A4 promise used in ads C1/C3 | Keyword explorer data | No |
| G18 | **ShipEntegra: partnership conversation** (business development only in this window, see G27) | competitors.md:146 ("should not try to win on labels against free"), :313 | S (founder time) | Distribution to Etsy/eBay sellers who already ship with ShipEntegra | — | No |

### Next quarter

| ID | Gap | Demand / evidence | Effort | Revenue impact | Dependency | Blocks ads? |
|---|---|---|---|---|---|---|
| G19 | **AI credit metering** (real counters per plan; matches the decided `aiCredits`) | feature-inventory.md:299 (H-4), :259 (N-10); `planLimits.ts` `DECIDED_PLAN_LIMITS` | M | Lets pricing show AI credits honestly and enables credit packs | G4 | No |
| G20 | **Standalone e-invoice UI** ("Fatura kes" button + invoice list on top of the Paraşüt client) | pain-points.md:101–108 (A10), :188–195 (B8); feature-inventory.md:84, :253 (N-4) | M | Enables the claim "e-Arşiv faturanızı panelden kesin" for export and Trendyol sellers | G12 | No |
| G21 | **Free research / extension tier** (counter "ücretsiz" anchoring) | competitors.md:32 (entry price), :212 (free-tier row), :317 (price war → "free research-only or Chrome-extension tier"); positioning.md:25 | M (plan key, gating, limits) | Top-of-funnel volume; upsell to Starter. Risk: cannibalisation and support load | G9 (extension published), G19 | No |
| G22 | **Payout reconciliation** (expected vs received, per marketplace; flag gaps) | pain-points.md:11–21 (A1, Etsy payouts), :153–161 (B4, Trendyol "3.250 TL satış karşılığı 626 TL"); feature-inventory.md:150 (`reports-payouts` exists) | M | Strong hook for Pro. Must not imply we fix payouts | Finance sync | No |
| G23 | **Duty / DDP / IOSS calculator** (estimate per destination at label time; also a free public calculator page for SEO) | pain-points.md:73–81 (A7, US de minimis end, EU €3 fee), :298 (§3 #5) | M | New, rising pain. The free calculator is a lead magnet and fits the label flow | Tariff data source; legal disclaimer | No |
| G24 | **Hepsiburada integration** (orders + stock first, listings later) | pain-points.md:294 (§3 #1 "Highest priority gap"), :122–132 (B1); competitors.md:29, :318 | L | Opens domestic multi-marketplace sellers and protects the C track (sellers list on Trendyol + HB together). Under positioning A it is supporting, not lead | HB merchant API access | No |
| G25 | **One domestic carrier label (Yurtiçi or Aras)**, or a cargo aggregator integration | pain-points.md:297 (§3 #4), :188–195 (B8); competitors.md:30, :202 | M per carrier | Removes the most common "can't switch" objection for Trendyol sellers | Carrier API contracts | No |
| G26 | **e-Fatura providers beyond Paraşüt** (start with one: BirFatura as a partner, or a GİB-integrator such as Sovos/ICE/QNB/EDM) | competitors.md:31, :51 (BirFatura as "a likely partner or target integration") | M per provider | Removes an accounting blocker for sellers not on Paraşüt | G20 | No |
| G27 | **ShipEntegra integration** (create ShipEntegra shipments from KolayXport orders) | competitors.md:146, :313 | M | Coexists with the free shipping incumbent instead of fighting it; keeps users in KolayXport for orders/listings | G18 agreement, API access | No |
| G28 | **Trendyol tracking push** | feature-inventory.md:64, :256 (N-7); pain-points.md:191 (B8) | M | C-track completeness | G8 | No |
| G29 | **FedEx/UPS tracking status + API void** | feature-inventory.md:263 (N-14), :75–76; pain-points.md:83–90 (A8 "teslim edildi ama gelmedi") | M | Retention for export sellers. Evidence for buyer disputes | Carrier tracking APIs | No |
| G30 | **Team accounts / sub-users** | competitors.md:33 ("Mid-size sellers expect sub-users"), :208 (matrix row) | M–L (roles, audit) | Unlocks Pro/Enterprise for 3–10 person shops | — | No |
| G31 | **WhatsApp notifications** (overdue dispatch, stock-out, reauth) via the WhatsApp Business Platform; the Telegram stub can follow | pain-points.md:301; feature-inventory.md:167 (Telegram stub), :268 (N-19) | M (templates, opt-in, per-message cost) | Engagement and retention. Needs İYS-compliant opt-in for anything promotional | G13; legal-notes §1 | No |
| G32 | **Amazon listing editing + stock** | feature-inventory.md:110, :254 (N-5), :266 (N-17); competitors.md:191 (every integrator edits Amazon listings) | L | Amazon is the secondary ICP; parity item, not a differentiator | SP-API roles (listings) | No |
| G33 | **N11 / Çiçeksepeti** | pain-points.md:294; competitors.md:29 | L each | Domestic breadth (option B); low priority under A+C | G24 first | No |

Not product gaps, and not in this roadmap: payouts to Türkiye (A1), account suspensions (A2) and marketplace support quality (B9). Software can't solve these; marketing may only publish informational content about them (pain-points.md:21, :31, :202).

---

## 2. Prioritised roadmap

### A. Must-have before ads

Ads open only when every row here is DONE **and live**. The checklist in [social/ads-playbook.md](social/ads-playbook.md) §1 mirrors it.

| # | Item | Status |
|---|---|---|
| 1 | 14-day trial everywhere | DONE on branch (`af08f85`) |
| 2 | Pro purchasable + enforced limits = decided tiers | DONE on branch (`d446f0a`) |
| 3 | Founding-member coupon backend + live counter | DONE on branch (`d446f0a`) |
| 4 | Signup-mode links | DONE on branch (`20ef38b`) |
| 5 | Contact form escaping | DONE on branch (`cc1c991`) |
| 6 | Finance APIs Pro-gated server-side | DONE on branch (`d77f996`) |
| 7 | ETGB exporter per user | DONE on branch (`6cdd6fa`) |
| 8 | LCP fix | DONE on branch (`90fd24f`) |
| 9 | Sitemap/robots | DONE on branch (`90fd24f`) |
| 10 | OG image, favicon, brand assets | DONE on branch (`83f8e43`) |
| 11 | Site claims cleanup, legal pages, cookie consent, GTM loader, first-touch UTM | DONE in code on branch (`d03421a`). Company identity fields (MERSİS, vergi dairesi, KEP) still need founder confirmation (company.md) |
| 12 | **G0** Deploy branch + verify live | TODO |
| 13 | **G1** GTM ID + GA4 + Meta/TikTok pixels configured and tested | TODO (server events in progress, uncommitted) |
| 14 | **G2** UTM stored on the user at signup | TODO / verify |
| 15 | **G3** Order meter = orders, or pricing relabelled | TODO |
| 16 | **G4** AI caps on trial + no unmetered "AI kredisi" on pricing | TODO |
| 17 | **G5** New users land on the setup checklist | TODO |
| 18 | **G6** "Add tracking" honest for Trendyol/Shopify/HB | TODO |
| 19 | **G7** Hepsiburada hidden as an integration | TODO |
| 20 | **G8** Trendyol/Wix prod flags confirmed (for C-track ads) | TODO (VPS check) |
| 21 | **G9** Extension install CTAs removed, or the extension published | TODO |

### B. First 30 days (in parallel with the launch calendar)

1. G9 Chrome Web Store publishing (unlocks calendar Day 29 and G21 later)
2. G10 Discount-code entry (unlocks outreach Variant 2)
3. G11 In-app help → video library (V01–V12 as they ship)
4. G13 WhatsApp Business support line
5. G12 Paraşüt errors surfaced
6. G15 Pro previews
7. G16 Unmetered sync paths closed
8. G14 Shopify tracking push
9. G17 Listing doctor bulk tags
10. G18 ShipEntegra conversation (founder)

### C. Next quarter

Ordered by fit with A+C first, then by evidence strength.

1. G20 Standalone e-invoice UI → G26 a second e-Fatura provider
2. G22 Payout reconciliation
3. G23 Duty/DDP/IOSS calculator (+ free public calculator page)
4. G19 AI credit metering → G21 free research/extension tier
5. G24 Hepsiburada (orders + stock)
6. G25 One domestic carrier (Yurtiçi or Aras) or aggregator
7. G28 Trendyol tracking push, G29 FedEx/UPS tracking + void
8. G27 ShipEntegra integration (if G18 lands)
9. G30 Team accounts
10. G31 WhatsApp notifications
11. G32 Amazon listings/stock
12. G33 N11 / Çiçeksepeti (beyond this quarter unless HB proves domestic demand)

---

## 3. What marketing may say while a gap is open

Use this table to answer "do you have X?" in comments, DMs and outreach. In this table the answers are in English for the founder; the social kit has the Turkish versions.

| Asked about | Answer until shipped |
|---|---|
| Hepsiburada / N11 / Çiçeksepeti | "Not yet. KolayXport focuses on selling abroad; keep your current integrator for domestic channels." |
| Yurtiçi / Aras / Sürat labels | "Domestic labels are DHL eCommerce (MNG) only for now." |
| Automatic ETGB / e-Fatura | "We prepare the ETGB Excel file and email it to your broker. The declaration is theirs. Paraşüt invoice creation runs inside that step." |
| Etsy tracking auto-upload | "It needs the KolayXport Chrome extension" (only after G9 publishing; before that, "not yet"). |
| Amazon listings | "Amazon orders, labels, tracking and finance: yes. Listing editing: not yet." |
| Team accounts | "Not yet." |
| AI credits | "AI tools are included; we'll publish credit limits when metering ships." (after G4 removes the counts from pricing) |
