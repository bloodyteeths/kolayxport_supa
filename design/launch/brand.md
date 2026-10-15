**Review of the "brand" plan**

## Errors and corrections (checked against `/Users/tamsar/Downloads/backup integration/kx-ux-phase0`)

1. **Etsy wording is wrong.** The plan says our Terms use "old wording" and should change to a new sentence: "This Application uses Etsy's API, but is not endorsed or certified by Etsy." I could not confirm that. etsy.com/legal/api returns 403 to WebFetch and curl, so the "updated Aug 18 2026" date and that sentence are unverified. The Etsy developer docs (developers.etsy.com/documentation) do give the mandatory text, and it must sit in a "prominent position" for Commercial Access apps: **"The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."** Our current text (`pages/terms.js:57`, `components/PublicFooter.js:107`) already matches it except that it is missing the final ", Inc.". The fix is to add ", Inc.", not to rewrite the sentence.
2. **The plan missed the existing footer.** It says "the sentence is in the Terms only". In fact `components/PublicFooter.js:107` already shows the Etsy sentence on every public page, and `pages/terms-tr.js:57` has a Turkish version. It is missing from the logged-in app shell (`components/AppLayout.js`), so that part of the plan's point stands.
3. **Wrong usage claim for the FedEx and UPS images.** The plan says `public/images/FedEx-Logo-PNG-Transparent.png` and `United_Parcel_Service_logo.png` are used in `HomeContent.js` and `entegrasyonlar.js`. Nothing in `components/`, `pages/` or `lib/` references them. They are unused files. UPS, FedEx, MNG and Shippo use `logo: null` with a lucide `Truck` icon (`pages/entegrasyonlar.js:34-37`).
4. **Two assets left out of the inventory.** `public/logos/n11.png` (2560x1357 RGBA) and `public/logos/woocommerce.svg` exist. Neither is referenced in `components/` or `pages/`. Treat both as unofficial.
5. **The plan didn't look at the sidebar the user pointed to.** The sidebar is in `components/AppLayout.js:133-158`. It uses generic lucide icons that are not consistent: Etsy uses `Store`, eBay and Shopify use `ShoppingBag`, Trendyol and Wix use `Package`, Amazon research uses `Globe2`. No logos are used there today. The plan's "neutral glyph" default should be stated as a concrete change to this file.
6. **The trade-dress problem is wider than eBay's blue.** The plan only flags the eBay `text-blue-600`. `HomeContent.js:31-34` also uses Etsy orange, Amazon yellow and Trendyol rose/orange gradients and badges on the power-tool cards. The trust bar renders "WIX" in a hand-styled wordmark.
7. **Marks missing from the plan.** Shippo, Veeqo (Amazon-owned; the plan mentions it in notes but leaves it out of the Terms list), Google/Gemini/Chrome (all on the integrations page as "Chrome" and "Gemini AI") and n11 (a repo asset). They need to go in the Terms list.
8. **The plan contradicts itself on Shopify.** The summary says "Shopify allow[s] logo use". But the public brand-assets page (verified) says "Use of our brand assets must be expressly authorized in writing". The same page calls the full-colour green logo the *primary* logo and allows monochrome where single-colour is needed. I could not verify the plan's claim that the Partner Toolkit restricts partners to monochrome. The 80px minimum, the x-height clear space, the ½ S bag clear space and the zip URL are all verified.
9. **Placeholders can be filled now.** `pages/terms.js:5` sets `companyName = "Modsons Yazılım E-Ticaret Ltd. Şti."` and `appName = "KolayXport"`.
10. **Out of scope, but worth fixing.** `pages/terms.js:23` still describes the service as "automates the creation of Google Drive folders, Sheets, and Apps Script". That is wrong for today's product and undermines the Terms page.

## Checked against official sources

- **eBay:** confirmed, word for word: "We don't allow the use of our logo in connection with your app." The allowed forms are "[APP NAME] for eBay", "...for eBay stores" and "...for eBay sellers".
- **Amazon SP-API Website Guidelines:** confirmed: no trademark violations in "app or service name, URL, tabs, images, logos, videos, or written content"; the site must comply with the Amazon Trademark Usage Guidelines; no unauthorized endorsements; no unverified claims like "#1 app". "Approval doesn't license the marks" is a reasonable inference, not a quoted line.
- **FedEx FDPLA:** confirmed. §2(a) allows using Marks in Applications. §5(c), (g) and (n) forbid removing notices, unauthorised use and modification. §6(g) and (h) require submitting screenshots where Marks are used, and FedEx reviews that use.
- **Not re-checked:** Etsy API Terms details ("less prominent", signature colours, the DISCLAIMER block), Wix, UPS 2024 §10, DHL, and the Shopify Partner Toolkit. Treat these as the plan's claims, not verified.

## Risky assumptions

- **"Authorised by each channel" is not a logo licence.** That is correct for API access in general. Only FedEx (in the FDPLA) grants logo use in apps. Shopify and Wix depend on contract terms or written permission.
- **The Etsy DISCLAIMER paragraph is unverified.** Keep it, since it costs nothing and protects us, but don't present it as verbatim-required.
- **Wix:** the Partner Agreement covers saying the app is offered on the Wix App Market. That clearly covers marketing pages. Covering an in-app sidebar icon is a stretch, so medium risk.
- **The eBay §4.2 sublicence obligation** needs a lawyer's opinion. Don't assume it either way.

---

## CORRECTED FINAL VERSION

### Short answer
Being approved for a channel's API does not license its logo.
- **eBay:** its logo can't be used with an app (verified).
- **Etsy, Amazon, UPS, DHL:** need written permission.
- **Trendyol, Hepsiburada:** publish no guidelines, so treat them as needing permission.
- **FedEx:** licenses its marks inside apps, but only its own portal-supplied assets and after its screen review.
- **Shopify:** requires written authorisation for brand assets.
- **Wix:** allows marks to say the app is on the Wix App Market.

The safe default is the channel name as plain text plus one consistent neutral icon. What we owe is a **trademark** notice, not a copyright notice. Nothing in the repo was changed.

### Per brand

| Brand | allowedInAppUI | conditions | requiredAttributionText | officialAssetUrl | existingAssetInRepo | notes / risk |
|---|---|---|---|---|---|---|
| **Etsy** | Name yes. Logo only with written approval. | No implied endorsement. Don't copy Etsy look and feel or trade dress (orange). Don't alter marks. Don't put "Etsy" in our name or domain. | Mandatory, prominent (dev docs, verified): **"The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."** Recommended in Terms: the DISCLAIMER block below (unverified as currently mandated). | None public. Ask developer@etsy.com. | `public/logos/etsy.svg`: not official, the word "Etsy" in Arial bold `#F1641E`, a fake wordmark. Used in `HomeContent.js:20,31` and `entegrasyonlar.js:26`. | The sentence already exists in `terms.js:57`, `terms-tr.js:57` and `PublicFooter.js:107`, but without ", Inc.". Add it to the `AppLayout` shell. **HIGH risk.** Use text. |
| **eBay** | Logo **no** (verified). Descriptive name yes. | No logo licence in the API License Agreement (badges only). No publicity about the program without approval. Avoid "eBay authorised/approved". | None mandated. Recommended: "eBay is a trademark of eBay Inc. KolayXport is not affiliated with or endorsed by eBay." | Badges only: https://developer.ebay.com/grow/loyalty-program/badge-usage-terms | None. Text "eBay" in `text-blue-600` (`HomeContent.js:21,32`). | Drop the blue styling and blue gradient cards. §4.2 sublicence terms need a lawyer. **HIGH.** Text only. |
| **Amazon / Veeqo** | Logo only with express written permission. | SP-API Website Guidelines (verified): no trademark violations in name, URL, tabs, images or logos; follow the Trademark Usage Guidelines; no implied endorsement; no "#1 / best / only" claims. Approved art only: no proportion, colour or font changes, clear space, no ™. | Where marks appear: "Amazon and all related marks are trademarks of Amazon.com, Inc. or its affiliates." | On approval. Guidelines: https://www.amazon.com/gp/help/customer/display.html?nodeId=GNYNL3A8HPATWCH8 (trademarks@amazon.com) | `public/logos/amazon.svg`: real smile wordmark, but an Inkscape/Wikimedia copy. Used in `HomeContent.js:22,33` and `entegrasyonlar.js:28`. | Matters more because of the open SP-API compliance review. Also remove the Amazon-yellow card styling. **HIGH.** Text. |
| **Shopify** | Only with written authorisation (verified). Never in our app name, product names or domain. | Digital minimum 80px wide. Clear space = x-height around the logo, ½ S around the bag alone. Green full-colour is the primary logo; monochrome when single-colour. No distortion, effects, outdated or custom versions. Lead with our own brand. | None mandated. Recommended: "Shopify is a trademark of Shopify Inc. KolayXport is not affiliated with or endorsed by Shopify." | https://www.shopify.com/brand-assets (zip: https://cdn.shopify.com/static/brand-assets/shopify-brand-assets.zip) | `public/logos/shopify.jpg`: 1280x363 JPEG with a white box, possibly an outdated version. Used in `HomeContent.js:25` and `entegrasyonlar.js:31`. | App Store review rejects Shopify branding in our app's icon or name. Partner Toolkit "monochrome only" not verified. **MEDIUM.** Text until authorised, then the official asset from the zip only. |
| **Wix** | Yes, to refer to our app on the Wix App Market (Partner Agreement). Other uses need consent. | Official asset, unmodified, legible, clear space. No implied partnership. No Wix in our name or domain. | None mandated. Recommended: "Wix is a trademark of Wix.com Ltd." | https://www.wix.com/partners/brand-guidelines (partnerscommunity@wix.com) | None. Hand-styled "WIX" text (`HomeContent.js:23`). | In-app icon use is outside the clear "App Market" reference (unverified). **LOW to MEDIUM.** |
| **Trendyol** | Unknown. No public developer brand guidelines. | Turkish trademark law (SMK 6769): descriptive name use OK, logo needs permission. | None published. Recommended: "Trendyol, DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş.'nin markasıdır." | None public. Ask Trendyol partner/integration support. | `public/logos/trendyol.png`: 600x600, looks current-official, source unknown. Used in `HomeContent.js:23,34` and `entegrasyonlar.js:29`. | **MEDIUM.** Text until written OK. |
| **Hepsiburada** | Unknown. | Same as Trendyol. | Recommended: "Hepsiburada, D-Market Elektronik Hizmetler ve Ticaret A.Ş.'nin markasıdır." | None public. Ask merchant/integrator support. | `public/logos/hepsiburada.png`: 600x600, looks official, source unknown. Unreferenced. | **MEDIUM.** Text. |
| **FedEx** | Yes, inside the app, using FedEx-provided Marks (FDPLA §2(a), verified). | Only FedEx-provided materials. Don't remove notices. No modification (§5). Submit screenshots of every screen using Marks for certification (§6(g)-(i)). | None verbatim. Recommended: "FedEx and the FedEx logo are trademarks of Federal Express Corporation." | FedEx Developer Portal Materials (https://developer.fedex.com), https://brand.fedex.com | `public/images/FedEx-Logo-PNG-Transparent.png`: 5231x1680 stock download. **Unreferenced.** The UI uses a `Truck` icon. | **LOW**, but only with the portal asset after review. Delete the stock PNG. |
| **UPS** | Only with UPS authorisation (2024 API Access Agreement §10, unverified here). | Official shield, unmodified, clear space ≥1/3 of the mark's height (legacy guide). No implied endorsement. Don't use UPS brown as our accent. | Legacy Developer Kit text (use if the shield ever appears): "UPS, the UPS brand mark, and the Color Brown are trademarks of United Parcel Service of America, Inc. All Rights Reserved." | https://brand.ups.com (after authorisation) | `public/images/United_Parcel_Service_logo.png`: 859x1020 Wikimedia copy. **Unreferenced.** | **MEDIUM to HIGH.** Text "UPS". |
| **DHL / MNG Kargo** | No, without written permission (DHL developer terms, unverified here). | DHL yellow and red are trade dress. Don't imitate them. | Recommended: "DHL and DHL eCommerce are trademarks of Deutsche Post AG." | https://www.dpdhl-brands.com; terms https://developer.dhl.com/api-reference/legal-terms | None. Text "MNG Kargo (DHL eCommerce)". | Check the MNG contract for co-brand rights. **HIGH.** Text. |
| **Others on our pages** (Shippo, Google/Gemini/Chrome, n11, WooCommerce) | Text only unless permission. | Same principles. | Covered by the "respective owners" clause plus the list below. | — | `n11.png` and `woocommerce.svg`: unofficial, unreferenced. | Delete the unused files. |

### Recommendation for the sidebar and integrations UI
- **Sidebar (`components/AppLayout.js:133-158`):** replace the mixed `Store`/`ShoppingBag`/`Package`/`Globe2` icons with one consistent scheme: a neutral marketplace glyph plus the channel name in our own colours, or a monogram chip (initial letter in our neutral palette, no brand colours). No third-party logos in the app for now.
- **Logos that can be allowed later:** FedEx (portal asset, after screen review), Wix (official asset, in App Market context), Shopify (official asset after written authorisation).
- **Email for written permission before any logo use:** Etsy (developer@etsy.com), Amazon (trademarks@amazon.com), UPS, DHL, Trendyol, Hepsiburada.
- **eBay:** text only, permanently.
- **Remove from marketing pages:**
  - In `HomeContent.js` and `entegrasyonlar.js`: `etsy.svg`, `amazon.svg`, `shopify.jpg`, `trendyol.png`, and the brand-colour gradients and badges in `HomeContent.js:31-34`.
  - Unused files to delete: the FedEx and UPS PNGs, `hepsiburada.png`, `n11.png`, `woocommerce.svg`.
- **Marketing copy:** say "integrates with" or "connects to". Never "authorised by", "official partner" or "certified" without a written designation. No "#1 / best / only" claims (Amazon rule).
- **Etsy sentence placement:**
  - Add ", Inc." in `terms.js:57`, `terms-tr.js:57` (Turkish: "Etsy, Inc. tarafından") and `PublicFooter.js:107`.
  - Add the sentence to the logged-in `AppLayout` footer or settings → connections.

### Draft: Terms section (English)

**Trademarks and Third-Party Services**

KolayXport is an independent software service provided by Modsons Yazılım E-Ticaret Ltd. Şti. KolayXport connects to third-party marketplaces, e-commerce platforms, shipping carriers and other services through their published application programming interfaces (APIs), using permissions you grant. Our access to those APIs does not make Modsons Yazılım E-Ticaret Ltd. Şti. an agent, partner, reseller or representative of any of these companies.

All product names, company names, logos and trademarks shown in KolayXport belong to their respective owners. We use them only to identify the services you connect and to describe compatibility. Their use does not mean that any owner sponsors, endorses, certifies or is affiliated with KolayXport, unless we expressly say so for a specific programme. In particular:

- The term "Etsy" is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
- eBay is a trademark of eBay Inc.
- Amazon, Veeqo and all related marks are trademarks of Amazon.com, Inc. or its affiliates.
- Shopify is a trademark of Shopify Inc.
- Wix is a trademark of Wix.com Ltd.
- Trendyol is a trademark of DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş.
- Hepsiburada is a trademark of D-Market Elektronik Hizmetler ve Ticaret A.Ş.
- FedEx is a trademark of Federal Express Corporation.
- UPS, the UPS brand mark, and the Color Brown are trademarks of United Parcel Service of America, Inc. All Rights Reserved.
- DHL and DHL eCommerce are trademarks of Deutsche Post AG. MNG Kargo is a trademark of its respective owner.
- Shippo is a trademark of Shippo (Goshippo, Inc.).
- Google, Gemini and Chrome are trademarks of Google LLC.

Each third-party service has its own terms, policies and privacy practices, and these apply to your use of it. The third parties do not provide KolayXport, are not responsible for it, and make no warranties about it or about data accessed through it. Any of them may change, limit or stop their API at any time, which may affect features of KolayXport.

DISCLAIMER: THIS APPLICATION IS SOLELY PROVIDED BY MODSONS YAZILIM E-TICARET LTD. ŞTI. (THE "APPLICATION DEVELOPER"). YOU ACKNOWLEDGE THAT ETSY, INC. AND ITS AFFILIATES, AND EACH OTHER THIRD-PARTY SERVICE PROVIDER NAMED ABOVE, ARE NOT THE APPLICATION DEVELOPER, DO NOT PROVIDE THE APPLICATION SERVICE, AND MAKE NO WARRANTIES OF ANY KIND WITH RESPECT TO THE APPLICATION OR DATA ACCESSED THROUGH IT.

If you believe a mark is used improperly, contact {supportEmail}.

### Draft: Terms section (Turkish)

**Markalar ve Üçüncü Taraf Hizmetler**

KolayXport, Modsons Yazılım E-Ticaret Ltd. Şti. tarafından sunulan bağımsız bir yazılım hizmetidir. KolayXport, sizin verdiğiniz yetkilerle, üçüncü taraf pazaryerlerine, e-ticaret platformlarına, kargo firmalarına ve diğer hizmetlere, bu firmaların yayımladığı uygulama programlama arayüzleri (API) üzerinden bağlanır. Bu API'lere erişimimiz, Modsons Yazılım E-Ticaret Ltd. Şti.'yi bu şirketlerin acentesi, ortağı, bayisi veya temsilcisi yapmaz.

KolayXport içinde gösterilen tüm ürün adları, şirket adları, logolar ve markalar ilgili sahiplerine aittir. Bunları yalnızca bağladığınız hizmetleri tanımlamak ve uyumluluğu belirtmek için kullanırız. Belirli bir program için açıkça belirtmediğimiz sürece bu kullanım, marka sahiplerinin KolayXport'a sponsor olduğu, onu onayladığı, sertifikalandırdığı veya onunla bağlantılı olduğu anlamına gelmez. Özellikle:

- The term "Etsy" is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc. ("Etsy" terimi Etsy, Inc.'in markasıdır. Bu uygulama Etsy API'sini kullanır ancak Etsy, Inc. tarafından onaylanmamış veya sertifikalandırılmamıştır.)
- eBay, eBay Inc.'in markasıdır.
- Amazon, Veeqo ve ilgili tüm markalar Amazon.com, Inc. veya bağlı şirketlerinin markalarıdır.
- Shopify, Shopify Inc.'in markasıdır.
- Wix, Wix.com Ltd.'nin markasıdır.
- Trendyol, DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş.'nin markasıdır.
- Hepsiburada, D-Market Elektronik Hizmetler ve Ticaret A.Ş.'nin markasıdır.
- FedEx, Federal Express Corporation'ın markasıdır.
- UPS, UPS marka logosu ve Kahverengi Renk, United Parcel Service of America, Inc.'in markalarıdır. Tüm hakları saklıdır.
- DHL ve DHL eCommerce, Deutsche Post AG'nin markalarıdır. MNG Kargo, ilgili sahibinin markasıdır.
- Shippo, Shippo (Goshippo, Inc.) markasıdır.
- Google, Gemini ve Chrome, Google LLC'nin markalarıdır.

Her üçüncü taraf hizmetin kendi koşulları, politikaları ve gizlilik uygulamaları vardır ve bu hizmetleri kullanımınız için bunlar geçerlidir. Bu üçüncü taraflar KolayXport'u sağlamaz, ondan sorumlu değildir ve KolayXport ya da onun üzerinden erişilen veriler hakkında hiçbir garanti vermez. Bu taraflardan herhangi biri API'sini istediği zaman değiştirebilir, kısıtlayabilir veya durdurabilir; bu durum KolayXport'un bazı özelliklerini etkileyebilir.

FERAGATNAME: BU UYGULAMA YALNIZCA MODSONS YAZILIM E-TİCARET LTD. ŞTİ. ("UYGULAMA GELİŞTİRİCİSİ") TARAFINDAN SAĞLANMAKTADIR. ETSY, INC. VE BAĞLI ŞİRKETLERİNİN VE YUKARIDA ADI GEÇEN DİĞER ÜÇÜNCÜ TARAF HİZMET SAĞLAYICILARIN UYGULAMA GELİŞTİRİCİSİ OLMADIĞINI, UYGULAMA HİZMETİNİ SAĞLAMADIĞINI VE UYGULAMA YA DA ONUN ÜZERİNDEN ERİŞİLEN VERİLER HAKKINDA HİÇBİR TÜRDE GARANTİ VERMEDİĞİNİ KABUL EDERSİNİZ.

Bir markanın uygunsuz kullanıldığını düşünüyorsanız {supportEmail} adresinden bize ulaşın.

The Etsy sentence stays in English on purpose, with the Turkish in brackets as a translation only, because Etsy requires that exact wording.

### Footer line
For `PublicFooter.js:107`, and also for the `AppLayout` shell.
- **EN:** "Etsy, eBay, Amazon, Shopify, Wix, Trendyol, Hepsiburada, FedEx, UPS, DHL and other marks are trademarks of their respective owners. KolayXport is independent and not endorsed by them. The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."
- **TR:** "Etsy, eBay, Amazon, Shopify, Wix, Trendyol, Hepsiburada, FedEx, UPS, DHL ve diğer markalar ilgili sahiplerinin markalarıdır. KolayXport bağımsızdır ve bu şirketler tarafından onaylanmamıştır." Follow it with the Etsy sentence in English.

### Sources
- Verified:
  - Etsy developer docs: https://developers.etsy.com/documentation/
  - eBay brand FAQ: https://brandpermission.ebay.com/faqs
  - Amazon SP-API Website Guidelines: https://developer-docs.amazon/sp-api/docs/website-guidelines
  - Shopify brand assets: https://www.shopify.com/brand-assets
  - FedEx Developer Portal License Agreement: https://developer.fedex.com/api/en-us/legal/fdpla.html
- Cited but not re-checked:
  - Etsy API Terms (403 to every fetch): https://www.etsy.com/legal/api
  - Etsy Trademark Policy: https://www.etsy.com/legal/trademarks/
  - eBay API License Agreement: https://developer.ebay.com/join/api-license-agreement
  - Amazon Trademark Usage Guidelines: https://www.amazon.com/gp/help/customer/display.html?nodeId=GNYNL3A8HPATWCH8
  - Shopify trademarks: https://www.shopify.com/legal/trademarks
  - Shopify Partner Toolkit PDF (2024): https://help.shopify.com/cdn/shopifycloud/help-center/pdf/partners/Shopify_Partner_Toolkit_Marketing_and_Brand_Guidelines_2024.pdf
  - Wix partner brand guidelines: https://www.wix.com/partners/brand-guidelines
  - Wix App Market partner agreement: https://dev.wix.com/app-market-partner-agreement
  - UPS API Access Agreement: https://www.ups.com/assets/resources/webcontent/en_GB/ups_api_access_agreement.pdf
  - DHL developer legal terms: https://developer.dhl.com/api-reference/legal-terms

Repo files read (all in `/Users/tamsar/Downloads/backup integration/kx-ux-phase0`):
- `pages/terms.js`
- `pages/terms-tr.js`
- `components/PublicFooter.js`
- `components/AppLayout.js`
- `components/marketing/HomeContent.js`
- `pages/entegrasyonlar.js`
- `public/logos/*`
- `public/images/FedEx-Logo-PNG-Transparent.png`
- `public/images/United_Parcel_Service_logo.png`