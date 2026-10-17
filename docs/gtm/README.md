# KolayXport go-to-market handbook

This is for the person who runs marketing day to day. It covers where everything is, how to change it without a developer, and the weekly routine.

> **Golden rule: we only say what the product really does.**
> Every feature claim must match a row in [`feature-inventory.md`](feature-inventory.md). If a feature isn't there, or it's marked *stub*, we don't advertise it. This is also Turkish law (Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği): no invented customers, numbers, reviews or fake urgency.

## 1. What's where

| Need | File / folder |
|---|---|
| Positioning (what we are, for whom) | [`positioning.md`](positioning.md): **"Yurt dışına satışın tek paneli"** (export-first), plus the "Trendyol'dan dünyaya" track |
| What the product can and can't do | [`feature-inventory.md`](feature-inventory.md); see §4 "Do NOT claim" and §7 for recent fixes |
| Seller pains and their exact words (ad hooks, keywords) | [`pain-points.md`](pain-points.md) |
| Competitors, prices, comparison facts | [`competitors.md`](competitors.md) |
| Brand: logo, colours, fonts, tone ("siz") | [`../brand.md`](../brand.md), assets in `public/brand/` |
| Social: strategy, 30-day calendar, communities, outreach messages, ads, legal | [`social/`](social/README.md) |
| SEO keyword map, 3-month blog calendar, Search Console | [`seo/`](seo/keyword-map.md) |
| Tracking, consent, UTM rules | [`tracking/README.md`](tracking/README.md) |
| Product gaps and roadmap | [`roadmap.md`](roadmap.md) |
| Company details (for legal and footer) | [`company.md`](company.md) and `lib/site/company.ts` |
| Site audits | [`site-audit.md`](site-audit.md) (baseline before the rebuild), `audit/latest.md` (automated, after) |

## 2. Editing the website (no code)

All long texts are Markdown files in **`content/`**. Edit them on GitHub (open the file, click ✏️, then **Commit changes** → *Create a new branch* → open a pull request). The founder merges it, and it deploys automatically.

| Page | File |
|---|---|
| Use-case pages `/cozumler/<slug>` (also the ad landing pages) | `content/tr/cases/<slug>.md` (+ `content/en/cases/…`) |
| Integration pages `/entegrasyonlar/<slug>` | `content/tr/integrations/<slug>.md` |
| Comparisons `/karsilastirma/<slug>` | `content/tr/compare/<slug>.md` (re-check competitor prices before every edit) |
| Blog `/blog/<slug>` | `content/tr/blog/<slug>.md` (new post = new file; copy an existing one) |
| How-to guides `/nasil-kullanirim/<slug>` | generated from `scripts/tutorials/tutorials/<slug>.yaml`; see §4 |
| Legal texts (KVKK, çerez, gizlilik, şartlar, mesafeli satış) | `content/tr/legal/*.md` (lawyer review needed before changes) |
| Home page, menus, buttons, footer, FAQ on the home page | `messages/tr.json` and `messages/en.json`, under the `"site"` key |

The format (the block between `---` lines at the top of each file) is explained in [`content/README.md`](../../content/README.md).

**Before you open a pull request,** ask the developer (or run it yourself) to check:
```bash
npm run gtm:check-claims   # every feature mentioned maps to the inventory; no "en iyi / #1 / garantili"
npm run gtm:og             # regenerates the link-preview images for new or changed pages
```

### Images
- **Product screenshots** come from the demo account, never a real customer: `npx tsx scripts/gtm/capture-screens.ts`. They go to `public/marketing/screens/`.
- **Lifestyle photos** are AI illustrations of Turkish workshops, hands and parcels, made with `scripts/brand/generate-marketing-images.ts`. This needs a **billed** Gemini key.
  - Pick the best from `docs/gtm/brand/images/<round>/contact-sheet.html`.
  - Save the picks as `public/marketing/<slot>.webp`, for example `hero-packing.webp`.
  - Pages pick them up automatically.
  - Never put a customer name or quote next to an AI photo.

## 3. Social media & community

Start with [`social/README.md`](social/README.md). In short:
- Post from [`social/calendar-30d.md`](social/calendar-30d.md); the copy is ready.
- Every link gets UTMs (see the [rules](tracking/README.md#5-utm-conventions-for-the-marketing-team)).
- Approach community admins with [`social/outreach-messages.md`](social/outreach-messages.md) and log everything in [`social/outreach-tracker.csv`](social/outreach-tracker.csv).
- Paid ads: [`social/ads-playbook.md`](social/ads-playbook.md). Start small and scale only by the stated metrics.
- Legal: [`social/legal-notes.md`](social/legal-notes.md). This covers İYS before any SMS or e-mail campaign, written consent for any customer quote, and the #reklam / #işbirliği labels for influencers.

**Real FOMO only:**
- The founding-member offer: 40% off for life for the first 20 subscribers, with a live counter on `/fiyatlandirma`. Never write a number of remaining spots yourself; link to the page.
- Real launch dates.

**Testimonials:** the site shows none until we have real ones with written consent. When a customer agrees, save the signed consent and add a file to `content/testimonials/` (the developer wires it in).

## 4. Tutorial videos

Everything is in [`scripts/tutorials/README.md`](../../scripts/tutorials/README.md). One YAML per tutorial produces:
- a YouTube video (16:9)
- a Reels/Shorts/TikTok cut (9:16, captions burned in)
- Turkish subtitles
- the YouTube title, description, chapters and tags (`public/media/tutorials/<slug>.youtube.txt`)
- the written guide on the site

**When the UI changes, re-run the pipeline instead of re-recording:** `npm run tutorials -- all`.

After uploading to YouTube, paste the video id into `content/tr/guides/<slug>.md` → `video.youtubeId`, so the site embeds it.

## 5. Weekly checklist

| Day | Task |
|---|---|
| Mon | Look at last week's numbers (§6). Pick next week's posts from the calendar and adapt the hooks that worked. |
| Mon | Search Console → Performance: new queries and pages that lost clicks. Add keywords to `seo/keyword-map.md`. |
| Tue + Thu | Publish the blog posts from `seo/content-calendar.md`; check each fact and source first. |
| Daily | Post per channel cadence. Reply to comments and DMs within 24 hours. Update the outreach tracker. |
| Wed | Ads: kill or scale per the playbook thresholds. Refresh creatives older than 14 days. |
| Fri | Re-check competitor prices used on comparison pages if they're older than 30 days. |
| Monthly | Ask the developer to re-run `node scripts/gtm/audit-site.mjs --write` and `npm run tutorials -- all` if the UI changed. |

## 6. KPIs (where to read them)

| KPI | Source | Target to start with |
|---|---|---|
| Landing page → signup rate | GA4: `sign_up` / sessions on `/cozumler/*` | ≥ 3% from paid social |
| Cost per trial | Meta Ads Manager: `StartTrial` | ≤ ₺450 (see the ads playbook) |
| Activation: store connected within 24 hours | GA4: `connect_marketplace` / `sign_up` | ≥ 50% |
| AI value moment | GA4: `first_listing_optimized` / `sign_up` | ≥ 35% |
| Trial → paid | Stripe + GA4 `purchase` | ≥ 10% |
| Organic | Search Console clicks to `/blog` + `/cozumler` | growth week over week |

## 7. Things the founder still has to do

The step-by-step version is in [`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md).


- **Company identity.**
  - Confirm the company details in `company.md` against the ticaret sicil.
  - Add the MERSİS number, vergi dairesi and KEP to `lib/site/company.ts`.
  - Have a lawyer review `content/*/legal/*` and set `lawyerReviewed: true`.
- **Server environment** (`.env` on Hetzner, set via stdin):
  - GTM and pixel IDs, `META_CAPI_TOKEN`, `GA4_API_SECRET`
  - `NEXT_PUBLIC_WHATSAPP_NUMBER`, social profile URLs
  - `PRICE_PRO_*`, `STRIPE_FOUNDING_COUPON_ID`
  - The full list is in [`tracking/README.md`](tracking/README.md#4-environment-variables-hetzner-env-set-via-stdin-never-in-git).
- **Search Console and Bing:** follow [`seo/search-console-checklist.md`](seo/search-console-checklist.md).
- **Billed Gemini key:** needed for the lifestyle photos (`scripts/brand/generate-marketing-images.ts`).
- **Shipping settings:** fill in **Settings › Gönderici** with the company name and VKN. The ETGB file now uses each seller's own details.
- **Chrome extension:** publish it to the Chrome Web Store (roadmap). Until then, copy never says "install from the Web Store".
