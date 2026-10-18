---
title: "Privacy Policy | KolayXport"
description: "What data KolayXport processes, how it protects sellers' buyer data, how long it keeps data and who it shares it with. All the details are here."
h1: "Privacy Policy"
keyword: "kolayxport privacy policy"
updated: 2026-10-18
effective: 2026-10-17
lawyerReviewed: true
inventoryRefs: []
---

This Privacy Policy explains how MODSONS YAZILIM E-TİCARET İTHALAT İHRACAT LİMİTED ŞİRKETİ ("KolayXport", "we") processes data through the kolayxport.com website, the KolayXport app (on the web and the Android app on Google Play) and the KolayXport Chrome extension (together, the "Service"). The statutory notice under KVKK Art. 10 is in the [KVKK Privacy Notice](/en/kvkk-aydinlatma-metni) and cookies are covered in the [Cookie Policy](/en/cerez-politikasi). This policy adds to them. The Turkish version prevails.

## 1. Whose data, whose responsibility?

There are two kinds of data in the Service, and our role differs:

- **Your data (as a KolayXport user / seller):** account, subscription, payment, support and usage data. **KolayXport is the data controller** for this data.
- **Your buyers' data:** the buyer name, shipping address, phone, e-mail, order contents, gift notes and customer messages in orders from the shops you connect. **The seller is the data controller** for this data; KolayXport is a **data processor** that processes it only on the seller's behalf, on the seller's instructions and to provide the Service.

As a seller, you are responsible for informing your buyers and for having a valid legal basis to process their data. Marketplaces' rules on buyer data also apply to you.

## 2. Data we collect and where it comes from

**Account and subscription:** name, e-mail, a hash of your password, or, with Sign in with Google, the name, e-mail and profile photo Google shares; plan, trial period, usage counters; subscription and payment status from Stripe. Stripe collects your card details directly; your full card number is not kept on our servers.

**Sender and export details:** your sender profile (name/company name, address, phone), the tax number you enter for ETGB and commercial invoices, your customs broker's e-mail address and similar details.

**Connected accounts:** when you connect Etsy, eBay, Amazon (SP-API and Veeqo), Shopify, Wix, Trendyol, Hepsiburada, N11, Çiçeksepeti, Shippo, FedEx, UPS, DHL eCommerce (MNG Kargo) or Paraşüt, and within the permissions you grant: shop information, listings and images, stock, orders (including buyer details), shipments, customer messages (on supported channels) and finance records (sales, fees, ad spend, payouts). We store access tokens or API keys to reach these accounts.

**Chrome extension:** if you install the extension, it:
- reads the buyer name, shipping address and e-mail that the Etsy API does not provide from **your own order pages** in your own Etsy seller session, and adds them only to the matching order in your KolayXport account,
- enters tracking numbers on your Etsy orders on your instruction,
- shows research indicators on public listing pages on Etsy, eBay and Amazon,
- sends technical error reports about page selectors that stop working; personal data is removed from these reports before they are sent.

**Research tools:** we process listing, price, shop and search data that is public on marketplaces. This can include information such as shop names that may count as personal data; we use it only for market research.

**Technical data:** IP address, browser information, session data, activity and error logs.

## 3. How we use data

- To provide the Service: sync orders, keep your listing changes as drafts and send them to the marketplace when you approve, sync stock, prepare shipping labels, commercial invoices and ETGB files, send tracking numbers to marketplaces, and produce finance reports.
- To manage your account, subscription and plan limits, and send you transactional e-mails (verification, password reset, payment and security notices).
- To give support, fix errors, keep the Service secure and prevent abuse.
- To meet legal obligations.

We **do not sell** data. We do not share data obtained through marketplace APIs with third parties for advertising and do not use it for ad targeting.

## 4. AI features

When you use AI features (title, description and tag suggestions, image generation, alt text, research explanations, the AI assistant, reply drafts for customer messages), the relevant input is sent to **Google's Gemini API**:

- In listing tools: product title, description, tags, attributes, category details and, where needed, product images.
- In reply drafts (only when you press the button): the latest messages in that conversation, the buyer's display name, order summaries such as order number and product details, and your shop name.
- Buyer personal data from Amazon orders is not sent to the AI service.

AI output is a suggestion; you must review and approve it before it is sent to a marketplace. The Service does not make automated decisions with legal effect about you or your buyers based on AI output. We use the Gemini API on the paid tier; on that tier Google does not use the content sent to train its models. Google's API terms govern Google's processing of this data.

## 5. Who we share data with

We share data only with the following, and only as far as necessary:

- **Infrastructure providers:** Hetzner Online GmbH (hosting, Germany), Cloudflare (encrypted backup storage), Google (sign-in and Gemini API), Stripe (payments), Postmark (transactional e-mail).
- **Services you connect:** marketplaces, carriers and Paraşüt, only on your instruction and only the data the task needs (for example the buyer address to the carrier for a label, buyer details to Paraşüt for an e-invoice, the ETGB file to the customs broker you name).
- **Authorities:** where the law requires.
- **Changes in company structure:** in a merger, transfer or sale, provided the protections in this policy continue.

The list of transfers abroad and their legal basis is in section 7 of the KVKK Privacy Notice.

## 6. Security

Our main safeguards:

- All connections are encrypted with HTTPS (TLS).
- Access tokens and API keys for your marketplace and carrier accounts are encrypted at the application layer before they are written to the database; the encryption keys are protected by a separate key management service.
- The database is not exposed to the internet; it can be reached only from inside the server. Administrator access to the server is limited to individual SSH keys; a firewall and intrusion-blocking tools are in use.
- Backups are encrypted on the client side and stored in a location separate from the server.
- Passwords, access tokens and buyer personal data are masked before they are written to logs.
- Each user can access only the data linked to their own account.

No system can be perfectly secure. As of this date KolayXport **does not hold** ISO 27001, SOC 2 or any similar certification. If a data breach affects your personal data, we will notify the Board and, where required, you under KVKK Art. 12/5; we will notify the seller concerned without delay of a breach affecting buyer data.

## 7. Retention

- **Account data:** while your account is open. When you delete your account, your data is deleted immediately and leaves the rotating backups within about 3 months at most. Invoices and contract records we must keep by law are kept for the required period (up to 10 years).
- **Buyer personal data** (name, address, phone, e-mail, notes): kept for at most **90 days** from the order date and then deleted automatically. Order details that contain no personal data (order number, amount, SKU, status) are kept for reporting. [TODO(owner): üretimde PII_PURGE_DRY_RUN=false ayarlandığını ve silme işinin gerçekten çalıştığını teyit edin; Amazon verileri için Amazon'un Veri Koruma Politikası'ndaki daha kısa süreyi (teslimattan sonra 30 gün) karşılayıp karşılamadığımızı kontrol edin]
- **Access tokens for connected accounts:** while the connection exists; deleted when you disconnect.
- **Marketplace listing data:** refreshed in line with each marketplace's API terms; Etsy listing data is refreshed at least every 6 hours and other Etsy content at least every 24 hours.
- **Listing images and videos you uploaded but have not sent yet:** on our server until the draft is sent or cancelled.
- **System logs:** up to 12 months. **Backups:** rotated, kept for about 3 months at most.

## 8. Your rights and deleting your data

Your rights under KVKK Art. 11 and how to apply are explained in the KVKK Privacy Notice. You can permanently delete your account and data yourself under **Settings › Preferences › Delete account**, on the web or in the Android app; the steps are on the [Account deletion](/en/hesap-silme) page. To get a copy of your data, or to ask for deletion if you cannot sign in, write to destek@kolayxport.com from the e-mail address registered in your account. You can disconnect marketplace accounts in settings at any time.

If you are a seller's buyer, please send requests about your data to that seller first; we forward requests we receive to the seller.

## 9. Marketplace-specific notes

- KolayXport uses the Etsy API. The term "Etsy" is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
- Data obtained from Amazon is used only to manage and ship the relevant seller's orders, is processed in line with Amazon's data protection rules, and is not used for any other purpose.
- Each marketplace's own privacy policy and API terms also apply.

## 10. Children

The Service is for people aged 18 or over who run a business. We do not allow anyone under 18 to open an account and do not knowingly collect their data.

## 11. Changes

We may update this policy. We will announce important changes by e-mail or in-app notice before they take effect. The current version is always on this page.

## 12. Contact

MODSONS YAZILIM E-TİCARET İTHALAT İHRACAT LİMİTED ŞİRKETİ
Beyazevler Mah. 80053 Sok. Tanrıkulu Apt. No:8 İç Kapı No:02, 01170 Çukurova / Adana, Türkiye
E-mail: destek@kolayxport.com
