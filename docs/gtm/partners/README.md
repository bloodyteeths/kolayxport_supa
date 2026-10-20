# Partner outreach pack (Merisa + Ekin)

Date: 2026-10-20. Phase 1 of [turkey-gameplan.md](../turkey-gameplan.md): referral partners → first 100 activated users, no ad spend.

| File | What | When |
|---|---|---|
| [turkey-gameplan.md §4.5](../turkey-gameplan.md) | First messages (Varyant 5 groups, Varyant 6 X/YouTube), the "after yes" text, group post draft | Every first contact |
| [../social/outreach-messages.md](../social/outreach-messages.md) | Follow-up sequence (+4/+9/+16 days), live-demo offer (Varyant 3), do/don't | Follow-ups, demo offers |
| [ortaklik-sartlari.md](ortaklik-sartlari.md) | Partner terms in Turkish, sent as PDF to everyone who says yes | After a yes |
| [ortak-sss.md](ortak-sss.md) | Copy-paste answers to partner and seller questions | Daily |
| [canli-demo-senaryosu.md](canli-demo-senaryosu.md) | 30-minute live demo script | From week 4 |
| [shortlist-wave1.csv](shortlist-wave1.csv) | First researched shortlist, scored: 89 rows (27 X, 26 Facebook = 21 groups + 5 pages, 13 Telegram, 13 YouTube, 10 müşavir/consultant). Public pages only, checked 2026-10-20; 2 rows "unverified" | Week 1: Merisa/Ekin re-check the top rows, then paste them into the ERP "Partner pipeline" tab |
| [../KolayXport-ERP.xlsx](../KolayXport-ERP.xlsx) | Tracking: tasks, pipeline, weekly targets, decisions | Every day |

## After a partner says yes (checklist)

1. **Create the partner** in `/admin/partners`. This needs the admin role: Atilla does it, or gives Merisa admin. Use code = short uppercase group/handle, e.g. `ETSYILEGELIR`. The promo code is attached to coupon `KX_PARTNER_20_3M` automatically.
2. **Test the link once** in a private window (`/?ref=CODE`). The partner should see the signup page; don't sign up.
3. Ask Atilla (admin) to **grant the free Büyüme account** to the partner's KolayXport login.
4. Send the **"after yes" text** (gameplan §4.5) + **ortaklik-sartlari.md as PDF**.
5. Fill the ERP row: `Status=Signed`, `Date signed`, `Ref code`, `Promo code`.
6. When they post: save the post link, check **#işbirliği @kolayxport** is there (screenshot), set `Disclosure OK`.

## Claims: check before you say it

- The claims list is [../social/README.md §3](../social/README.md). Until gtm-overhaul's branch `gtm/claims-sheet-1020` (5b35094c) reaches main, two lines there are outdated:
  - The Chrome extension **is** on the Web Store, verified 2026-10-20. You may say "Web Mağazası'ndan yükleyin". Its numbers are **estimates**: never say "anlık satış verisi". The Trendyol/Hepsiburada panel turns on only with the user's consent.
  - The 14-day trial and the ETGB e-mail flow **are** live.
  - "Hepsiburada" is never-say only as a store integration (orders, listings, stock). The extension's Hepsiburada research panel is real.
- **Not live yet, don't promise:** partner dashboard `/app/ortaklik` and automatic Stripe payouts (Stage B, ERP T25), new pricing (pricing v2, behind a flag), Hepsiburada store integration.
- Any number (users, signups, money) comes from `/admin/partners` or Stripe, never from memory. Write the source and date next to it.

## Notes on the wave-1 shortlist

- `scam_flag=yes` (4 rows) = income-promise marketing. **Don't partner with these.** "COURSE SELLER" in the note = ordinary course/consulting sellers. They're allowed, but check their claims first.
- The biggest groups (etsytr, TurkiyeAmazon) ban promo posts, so the only way in is the admins (Varyant 5).
- **Ahmet Konak (@koneeek, Optimsy): wave 2** (orchestrator, 2026-10-20). Contact him only after 2–3 wave-1 partners are signed, so we come with proof. Pitch the complementary angle: Optimsy does Etsy listings, KolayXport does multi-marketplace orders, finance/net profit and stock, so this is a referral or integration, not a fight over SEO. Don't lead with listing-SEO tools. If he reads as a competitor, drop it politely.
- Kerem Başalı (@k_basali) owns t.me/etsyilegelir and @EtsyileGelir, which are already in communities.csv. Treat them as one contact.
- **Gaps:** few Trendyol-seller and print-on-demand Facebook groups found. A second research pass is planned.
- Counts and activity are a snapshot (2026-10-20). Re-check on the day you contact someone.
