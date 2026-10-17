# Google Search Console & Bing Webmaster: setup checklist

The code is already in place: verification meta tags (from env), `sitemap.xml` with hreflang, `robots.txt` that blocks the app, and canonical URLs. Steps that need **your** Google or Microsoft login are marked 👤.

## Google Search Console (about 15 minutes)
1. 👤 Go to https://search.google.com/search-console and click **Add property**.
2. **Recommended: a Domain property.** Enter `kolayxport.com`. Google shows a **TXT record**.
   - 👤 Add it at your DNS provider (name `@`, type `TXT`, value `google-site-verification=…`) and click **Verify**. This covers `www`, http and https in one property.
   - Wait about 10 minutes for DNS before clicking Verify.
3. **Alternative: a URL-prefix property** `https://kolayxport.com/`. Choose **HTML tag** and copy only the `content="…"` value.
   - Set it on the server: `NEXT_PUBLIC_GSC_VERIFICATION=<value>` in `/home/deploy/kolayxport/.env`, via stdin, never pasted into chat.
   - Redeploy, because this value is baked in at build time, then click Verify.
4. **Sitemaps:** submit `https://kolayxport.com/sitemap.xml`.
5. **URL inspection:** request indexing for `/`, `/en`, `/fiyatlandirma` and the six `/cozumler/*` pages.
6. **Settings → Users:** add the marketing employee as **Full** (not Owner).
7. Check after one week:
   - **Pages:** the app URLs (`/app/*`, `/login`) appear under "Excluded by robots.txt / noindex". That is expected.
   - **Enhancements:** FAQ and Breadcrumb are detected without errors.
   - **International targeting:** no hreflang errors.

## Bing Webmaster Tools (about 5 minutes)
1. 👤 Go to https://www.bing.com/webmasters and **Import from Google Search Console**. This is the fastest route and verifies automatically.
2. Otherwise, use the meta tag: `NEXT_PUBLIC_BING_VERIFICATION=<value>`, then redeploy.
3. Submit the sitemap. Bing also feeds DuckDuckGo, Ecosia and Yahoo, and its index is used by ChatGPT search.

## Rich Results / schema check (after each deploy)
- Open https://search.google.com/test/rich-results for `/`, `/cozumler/etsy-satici`, one `/blog/*` post and one `/nasil-kullanirim/*` guide.
- Expected types: Organization, WebSite, SoftwareApplication (home), FAQPage, BreadcrumbList, BlogPosting (blog), HowTo + VideoObject (guides with a YouTube id).
- Then open https://validator.schema.org with the same URLs; it should show 0 errors.

## Redirects to watch (301s)
| Old URL | New URL |
|---|---|
| `/privacy-tr`, `/privacy` | `/gizlilik-politikasi`, `/en/gizlilik-politikasi` |
| `/terms-tr`, `/terms` | `/kullanim-sartlari`, `/en/kullanim-sartlari` |
| `/kariyer` | `/kurumsal` |
| `/support` | `/iletisim` |
| `/docs/*` | `/nasil-kullanirim` |
| the 8 old `/blog/*` posts | `/blog` or the closest real page |

👤 Update the **privacy policy and terms URLs** registered with **Google OAuth (consent screen), Etsy, eBay, Amazon SP-API, Shopify and Wix** to the new URLs. The redirects work, but reviewers prefer the final URL.
