import React from "react";
import PublicLayout from "@/components/PublicLayout";

export default function TermsOfServiceEN() {
  const companyName = "Modsons Yazılım E-Ticaret Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "destek@kolayxport.com";
  const lastUpdated = "May 7, 2025";
  const websiteUrl = "https://www.kolayxport.com";

  return (
    <PublicLayout title="Terms of Service">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Terms of Service</h1>
          <p><em>Last Updated: {lastUpdated}</em></p>
          <p>These Terms of Service apply to {appName} at <a href={websiteUrl}>{websiteUrl}</a>.</p>

          <h2>1. Acceptance</h2>
          <p>By signing in with your Google account and using {appName}, you agree to these Terms of Service.</p>

          <h2>2. Service Description</h2>
          <p>{appName} automates the creation of Google Drive folders, Sheets, and Apps Script for shipping workflows.</p>

          <h2>3. User Obligations</h2>
          <ul>
            <li>You must provide a valid Google account and grant only the requested OAuth scopes.</li>
            <li>You must not misuse the APIs or interfere with our service operations.</li>
          </ul>

          <h2>4. License</h2>
          <p>We grant you a limited, non-exclusive license to use the service for your personal or business needs.</p>

          <h2>5. Prohibited Conduct</h2>
          <ul>
            <li>Unauthorized scraping, hacking, or reverse-engineering our code or APIs.</li>
            <li>Uploading or sharing illegal content via generated Drive files.</li>
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
          <p>
            The term &ldquo;Etsy&rdquo; is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy.
          </p>

          <h2>9. Termination</h2>
          <p>We may suspend or terminate your access if you violate these Terms.</p>

          <h2>10. Modifications</h2>
          <p>We may update these Terms; updated versions will be posted with a revised date.</p>

          <h2>11. Governing Law</h2>
          <p>These Terms are governed by the laws applicable where {companyName} is located.</p>

          <h2>12. Contact</h2>
          <p>
            For questions, email us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 