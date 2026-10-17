# Go-live checklist (founder)

Work through this list in order. Steps marked 👤 need your logins. Everything else is already done on branch `gtm/overhaul`.

## A. Before merging to `main` (merging deploys to production)

1. 👤 **Your own ETGB details:** in KolayXport go to **Ayarlar › Gönderici** and fill in the company name (the exporter name on the ETGB) and the VKN.
   - The ETGB file used to have one company hard-coded. It now reads each seller's own Gönderici profile and **refuses to build** when these fields are empty.
2. 👤 **Stripe (Dashboard → Products):**
   - Create the Pro prices: monthly ₺7.999 / $149 and yearly ₺79.990 / $1.490.
   - Optionally add per-currency prices for every plan.
   - Create the **founding coupon**: 40% off, duration *forever*, **max redemptions 20**.
   - Create any community **promotion codes** (Checkout now shows a code field whenever the founding coupon doesn't apply).
3. 👤 **Server `.env`** (`/home/deploy/kolayxport/.env`, set via stdin). `NEXT_PUBLIC_*` values are baked in at build time, so set them before the merge.
   - `PRICE_PRO_MONTH`, `PRICE_PRO_YEAR` (+ optional `_TRY` / `_USD`), and `STRIPE_FOUNDING_COUPON_ID`
   - WhatsApp: done, +90 542 568 33 62 is built in (`lib/site/company.ts`)
   - `NEXT_PUBLIC_SOCIAL_*`, only for accounts that exist
   - The tracking IDs can wait until step C.
   - **Gemini for the SaaS:** use a key from a Google project **with billing enabled** (the free tier allows ~10–20 requests per model per day, so a few customers would exhaust it).
     - New projects can't use `gemini-2.5-flash`, so set `GEMINI_TEXT_MODEL=gemini-3.8-flash` (or `gemini-3.5-flash`) together with the new `GEMINI_API_KEY`.
     - Optionally set `GEMINI_IMAGE_MODEL`.
     - All AI routes read these from `lib/ai/models.ts`.
4. 👤 **Company details:** add the MERSİS number, vergi dairesi and KEP to `lib/site/company.ts`. Until then they're simply not shown.
5. 👤 **Legal review:** send `content/tr/legal/*.md` to a lawyer. The pages show a "taslak" note until `lawyerReviewed: true`.
6. **Merge** `gtm/overhaul` → `main`, or merge the PR. The VPS deploy builds it; check `.next/BUILD_ID`, then `curl https://kolayxport.com/api/health`.

## B. Right after the deploy (15 minutes)
- Open `/`, `/cozumler/etsy-satici`, `/fiyatlandirma` and `/login?mode=signup` on your phone.
- Sign up with a test address and check that the trial shows **14 days**.
- Open `/plan` while signed in and check that **Pro** can be bought (with the Stripe test clock or a real card plus a refund).
- Check that `https://kolayxport.com/sitemap.xml` lists no `/app` URLs, and that `robots.txt` blocks `/app`, `/plan` and `/login`.
- 👤 Update the privacy and terms URLs in Google OAuth, Etsy, eBay, Amazon SP-API, Shopify and Wix app settings: `/gizlilik-politikasi`, `/kullanim-sartlari` (English: `/en/...`).

## C. Tracking (before spending on ads)
- 👤 Create GTM, GA4 and Meta Pixel. Set `NEXT_PUBLIC_GTM_ID`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `GA4_MEASUREMENT_ID` and `GA4_API_SECRET`, then redeploy.
- Configure the tags in GTM per [`tracking/README.md`](tracking/README.md) §3.
- Test with **"Yalnızca zorunlu"**: no requests to facebook.com or google-analytics.com.
- Then test **"Tümünü kabul et"**: `sign_up` arrives in Meta Events Manager → *Test events* and in GA4 DebugView, each once.
- 👤 Set up Search Console and Bing per [`seo/search-console-checklist.md`](seo/search-console-checklist.md).

## D. Content & media
- 👤 Add a **billed** Gemini key to generate the lifestyle photos: `npx tsx scripts/brand/generate-marketing-images.ts`. Pick from the contact sheet and save the picks as `public/marketing/<slot>.webp`, then run `node scripts/brand/export-assets.mjs variants`.
- Upload the tutorial videos (`public/media/tutorials/*.mp4`, metadata in `*.youtube.txt`). Paste the YouTube ids into `content/tr/guides/<slug>.md` → `video.youtubeId`.
- Chrome extension: publish it to the Chrome Web Store (roadmap). Until then, copy says it is installed via support.

## E. Ads on
- Follow [`social/ads-playbook.md`](social/ads-playbook.md): small test budget, kill/scale thresholds, and landing pages `/cozumler/*`.
- The marketing team works from [`README.md`](README.md).
