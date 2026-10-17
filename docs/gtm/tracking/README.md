# Tracking & consent: how it works and how to set it up

Status: the code is done on `gtm/overhaul`. The founder needs to provide the IDs listed in §4. Until they are set, **no tag loads at all**.

## 1. The rules

- **KVKK and Consent Mode v2.**
  - Before a visitor chooses, everything non-essential is *denied*. This is set inline in `pages/_document.js` before Google Tag Manager loads.
  - The banner (`components/CookieConsent.tsx`) offers **Tümünü kabul et**, **Yalnızca zorunlu** and **Tercihleri yönet**, with equal weight. The footer link "Çerez tercihleri" reopens it.
  - The choice is stored in `localStorage['kx-consent']` and in the `kx_consent` cookie (`a1m0` means analytics on, marketing off). The server reads the cookie before sending server-side events.
- **GTM is the only tag in the code.** GA4, Meta Pixel, X, TikTok and LinkedIn are added *inside* GTM, so marketing can change tags without a deploy.
- **The same `event_id` is sent from the browser and the server**, so Meta and GA4 count each event once.

## 2. Event schema

| Event | Fired by | Where | Params |
|---|---|---|---|
| `page_view` | browser | every route change (`pages/_app.tsx`) | `page_path` |
| `view_pricing` | browser | `/fiyatlandirma` | — |
| `cta_click` | browser | WhatsApp button, (extend as needed) | `location` |
| `start_signup` | browser | signup form shown, Google button | `method` |
| `sign_up` | browser **and** server | email signup success (`components/AuthForm.jsx`, `pages/api/auth/signup.ts`) | `event_id`, `method` |
| `start_trial` | browser **and** server | at signup; also from Stripe when a subscription starts in trial | `event_id` |
| `connect_marketplace` | browser | `/ayarlar?success=<mp>_connected` after OAuth | `marketplace` |
| `first_listing_optimized` | browser | first successful AI listing suggestion (`useListingAI`) | `marketplace` |
| `begin_checkout` | browser | "Choose plan" on pricing (`useCheckout`) | `plan`, `interval`, `currency` |
| `purchase` | server | Stripe `checkout.session.completed` (`pages/api/stripe/webhook.ts`): a subscription with a card on file, also when the remaining trial carries over (value = plan price) | `value`, `currency`, `plan`, `interval`, `event_id` = checkout session id |
| `contact_submit` | browser | contact form | `location` |

Meta mapping (server): `sign_up` → CompleteRegistration, `start_trial` → StartTrial, `begin_checkout` → InitiateCheckout, `purchase` → Purchase, `contact_submit` → Contact.

**Known gap:** a signup through **Google** fires `start_signup` but not a server `sign_up`, because NextAuth's `createUser` has no request context. Count Google signups with GA4's "first visit to /app" audience, or treat `connect_marketplace` as the activation event.

## 3. GTM container setup (one time, ~30 minutes)

Work in GTM → *Admin → Container settings*, and turn on **Consent overview**.

1. **Variables:** create Data Layer Variables for `event_id`, `plan`, `interval`, `currency`, `value`, `marketplace` and `method`.
2. **GA4:**
   - A *Google tag* with your GA4 ID, triggered on *Consent Initialization – All Pages*. It respects consent automatically.
   - One *GA4 Event* tag with event name `{{Event}}`, triggered on *Custom Event* with regex `^(view_pricing|start_signup|sign_up|start_trial|connect_marketplace|first_listing_optimized|begin_checkout|contact_submit|cta_click)$`. Pass the variables above as parameters.
   - Mark `sign_up`, `start_trial` and `purchase` as **key events** in GA4.
3. **Meta Pixel:**
   - Use the "Facebook Pixel" community template, or the base code in a Custom HTML tag.
   - **Additional consent check:** require `ad_storage`.
   - Map `sign_up` → `CompleteRegistration`, `start_trial` → `StartTrial`, `begin_checkout` → `InitiateCheckout`, and pass `eventID: {{event_id}}` so the server copy de-duplicates.
4. **X, TikTok and LinkedIn:** use their official GTM templates, each requiring `ad_storage`, and fire on `sign_up` and `start_trial`.
5. **SPA page views:** GA4's "enhanced measurement → page changes based on browser history" handles them. Also fire the pixels' PageView on the `page_view` custom event.
6. **Test:**
   - Open GTM *Preview* on https://kolayxport.com.
   - With "Yalnızca zorunlu" chosen, **no** requests should go to facebook.com, google-analytics.com and the others.
   - After "Tümünü kabul et", the events fire once each.
   - For the server copies, use Meta Events Manager's *Test events* with `META_TEST_EVENT_CODE`, and GA4 *DebugView*.

Export the finished container (*Admin → Export container*) and commit it as `docs/gtm/tracking/gtm-container.json`, so the setup is versioned.

## 4. Environment variables (Hetzner `.env`, set via stdin, never in git)

| Variable | What |
|---|---|
| `NEXT_PUBLIC_GTM_ID` | `GTM-XXXXXXX`. Without it no tags load |
| `NEXT_PUBLIC_GSC_VERIFICATION` | Google Search Console HTML-tag token |
| `NEXT_PUBLIC_BING_VERIFICATION` | Bing Webmaster token |
| `META_PIXEL_ID`, `META_CAPI_TOKEN` | Meta Conversions API (server events) |
| `META_TEST_EVENT_CODE` | only while testing; remove after |
| `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | GA4 Measurement Protocol (server `purchase`, `sign_up`) |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | e.g. `905XXXXXXXXX`; shows the WhatsApp button on /iletisim |
| `NEXT_PUBLIC_SOCIAL_INSTAGRAM` / `_X` / `_YOUTUBE` / `_LINKEDIN` / `_FACEBOOK` / `_TIKTOK` | profile URLs; footer links appear only for the ones that are set |
| `STRIPE_FOUNDING_COUPON_ID` | founding-member coupon (40% off, duration "forever", max redemptions 20) |
| `PRICE_PRO_MONTH`, `PRICE_PRO_YEAR` (+ optional `_TRY` / `_USD` variants of every plan) | Stripe price ids |

`NEXT_PUBLIC_*` values are baked in at build time, so set them **before** the deploy build.

## 5. UTM conventions (for the marketing team)

Every link we post or pay for carries UTMs. KolayXport stores the **first** UTM a visitor arrives with for 90 days and sends it with the signup.

| Param | Values |
|---|---|
| `utm_source` | `instagram`, `facebook`, `x`, `youtube`, `tiktok`, `linkedin`, `google`, `newsletter`, `<community-slug>` (e.g. `fb-etsy-turkiye`) |
| `utm_medium` | `social` (organic), `paid`, `community` (group posts / partners), `email`, `video` |
| `utm_campaign` | `<launch\|always-on>_<yyyyq>_<theme>`, e.g. `launch_2026q4_etsy-seo`, `launch_2026q4_trendyol-dunya` |
| `utm_content` | creative / post id from the content calendar, e.g. `d07-reel-ai-title` |
| `utm_term` | paid search keyword only |

Example: `https://kolayxport.com/cozumler/etsy-satici?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_etsy-seo&utm_content=ad03-quote-134urun`

Rules:
- Use lowercase only, with no spaces or Turkish characters.
- One campaign name per theme per quarter. Log every new campaign name in `docs/gtm/social/README.md`.
- Never put personal data in a URL.
