import React from "react";
import PublicLayout from "@/components/PublicLayout";

export default function TermsOfServiceEN() {
  const companyName = "Modsons Yazılım E-Ticaret Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "destek@kolayxport.com";
  const lastUpdated = "October 15, 2026";
  const websiteUrl = "https://www.kolayxport.com";

  return (
    <PublicLayout title="Terms of Service">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Terms of Service</h1>
          <p><em>Last Updated: {lastUpdated}</em></p>
          <p>These Terms of Service apply to {appName} at <a href={websiteUrl}>{websiteUrl}</a>.</p>

          <h2>1. Acceptance</h2>
          <p>By creating an account, signing in and using {appName}, you agree to these Terms of Service.</p>

          <h2>2. Service Description</h2>
          <p>
            {appName} is a multichannel e-commerce operations platform for online sellers. Depending on the integrations you connect and your plan, the service lets you:
          </p>
          <ul>
            <li>import and manage orders from connected marketplaces and stores in one place;</li>
            <li>create shipping labels, track shipments and send tracking details back to the marketplace through connected carriers;</li>
            <li>create and edit product listings; listing edits you make are saved in {appName} first and sent to the marketplace only when you choose to sync them;</li>
            <li>optionally turn on inventory sync, which, after you confirm, keeps stock quantities in step across connected channels automatically and may mark sold-out listings or variations inactive;</li>
            <li>use product, keyword and market research tools, including optional AI-assisted suggestions that you review before use;</li>
            <li>read and reply to customer messages from connected channels;</li>
            <li>view sales, fee, advertising and profit reports based on data from your connected accounts.</li>
          </ul>
          <p>Features may change over time, and some features depend on what each third-party service makes available through its API.</p>

          <h2>3. User Obligations</h2>
          <ul>
            <li>You must provide accurate account information and connect only marketplace, store and carrier accounts that you are authorized to use.</li>
            <li>You must not misuse the APIs or interfere with our service operations.</li>
          </ul>

          <h2>4. License</h2>
          <p>We grant you a limited, non-exclusive license to use the service for your personal or business needs.</p>

          <h2>5. Prohibited Conduct</h2>
          <ul>
            <li>Unauthorized scraping, hacking, or reverse-engineering our code or APIs.</li>
            <li>Using the service to create, upload or publish illegal or infringing content, or content that violates a connected marketplace&apos;s policies.</li>
          </ul>

          <h2>6. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, we are not liable for any indirect, special, or consequential damages.</p>

          <h2>7. Disclaimer</h2>
          <p>All services are provided "as-is" without warranty of any kind.</p>

          <h2>8. Third-Party API Integrations</h2>
          <p>
            {appName} integrates with various third-party marketplace APIs, including but not limited to Etsy, Amazon, Shopify, and others, to provide its services. By using our Service:
          </p>
          <ul>
            <li>You authorize {appName} to access your marketplace accounts via OAuth 2.0 to retrieve and manage your orders, listings, and shop data on your behalf.</li>
            <li>We comply with each marketplace&apos;s API Terms of Use, including Etsy&apos;s API Terms of Use (<a href="https://www.etsy.com/legal/api">https://www.etsy.com/legal/api</a>).</li>
            <li>Listing data obtained through marketplace APIs is refreshed within 6 hours, and all other content is refreshed within 24 hours, in compliance with caching policies.</li>
            <li>Data obtained through marketplace APIs is handled in accordance with our Privacy Policy and is never sold or shared with third parties for advertising purposes.</li>
          </ul>
          <h2>9. Trademarks and Third-Party Services</h2>
          <p>
            {appName} is an independent software service provided by {companyName}. {appName} connects to third-party marketplaces, e-commerce platforms, shipping carriers and other services through their published application programming interfaces (APIs), using permissions you grant. Our access to those APIs does not make {companyName} an agent, partner, reseller or representative of any of these companies.
          </p>
          <p>
            All product names, company names, logos and trademarks shown in {appName} belong to their respective owners. We use them only to identify the services you connect and to describe compatibility, and we will remove any logo at its owner&apos;s request. Their use does not mean that any owner sponsors, endorses, certifies or is affiliated with {appName}, unless we expressly say so for a specific programme. In particular:
          </p>
          <ul>
            <li>The term &ldquo;Etsy&rdquo; is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</li>
            <li>eBay is a trademark of eBay Inc.</li>
            <li>Amazon, Veeqo and all related marks are trademarks of Amazon.com, Inc. or its affiliates.</li>
            <li>Shopify is a trademark of Shopify Inc.</li>
            <li>Wix is a trademark of Wix.com Ltd.</li>
            <li>Trendyol is a trademark of DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş.</li>
            <li>Hepsiburada is a trademark of D-Market Elektronik Hizmetler ve Ticaret A.Ş.</li>
            <li>FedEx is a trademark of Federal Express Corporation.</li>
            <li>UPS, the UPS brand mark, and the Color Brown are trademarks of United Parcel Service of America, Inc. All Rights Reserved.</li>
            <li>DHL and DHL eCommerce are trademarks of Deutsche Post AG. MNG Kargo is a trademark of its respective owner.</li>
            <li>Shippo is a trademark of Shippo (Goshippo, Inc.).</li>
            <li>Paraşüt is a trademark of its respective owner.</li>
            <li>Google, Gemini and Chrome are trademarks of Google LLC.</li>
          </ul>
          <p>
            Each third-party service has its own terms, policies and privacy practices, and these apply to your use of it. The third parties do not provide {appName}, are not responsible for it, and make no warranties about it or about data accessed through it. Any of them may change, limit or stop their API at any time, which may affect features of {appName}.
          </p>
          <p>
            DISCLAIMER: THIS APPLICATION IS SOLELY PROVIDED BY {companyName.toUpperCase()} (THE &ldquo;APPLICATION DEVELOPER&rdquo;). YOU ACKNOWLEDGE THAT ETSY, INC. AND ITS AFFILIATES, AND EACH OTHER THIRD-PARTY SERVICE PROVIDER NAMED ABOVE, ARE NOT THE APPLICATION DEVELOPER, DO NOT PROVIDE THE APPLICATION SERVICE, AND MAKE NO WARRANTIES OF ANY KIND WITH RESPECT TO THE APPLICATION OR DATA ACCESSED THROUGH IT.
          </p>
          <p>
            If you believe a mark is used improperly, contact us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
          </p>

          <h2>10. Termination</h2>
          <p>We may suspend or terminate your access if you violate these Terms.</p>

          <h2>11. Modifications</h2>
          <p>We may update these Terms; updated versions will be posted with a revised date.</p>

          <h2>12. Governing Law</h2>
          <p>These Terms are governed by the laws applicable where {companyName} is located.</p>

          <h2>13. Contact</h2>
          <p>
            For questions, email us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 