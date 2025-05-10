import React from "react";
import PublicLayout from "@/components/PublicLayout";

export default function TermsOfServiceEN() {
  const companyName = "Tamsar Tekstil Dış Tic. Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "destek@kolayxport.com";
  const websiteUrl = "https://kolayxport.com";
  const lastUpdated = "May 7, 2025";

  return (
    <PublicLayout title="Terms of Service">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Terms of Service</h1>
          <p><em>Last Updated: {lastUpdated}</em></p>

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

          <h2>8. Termination</h2>
          <p>We may suspend or terminate your access if you violate these Terms.</p>

          <h2>9. Modifications</h2>
          <p>We may update these Terms; updated versions will be posted with a revised date.</p>

          <h2>10. Governing Law</h2>
          <p>These Terms are governed by the laws applicable where {companyName} is located.</p>

          <h2>11. Contact</h2>
          <p>
            For questions, email us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 