import React from "react";
// import Layout from "@/components/Layout"; // Old Layout removed
import PublicLayout from "@/components/PublicLayout"; // New PublicLayout imported

export default function PrivacyPolicyEN() {
  const companyName = "Tamsar Tekstil Dış Tic. Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "kolayxport@gmail.com";
  const websiteUrl = "https://kolayxport.com";
  const lastUpdated = "May 7, 2025"; // Update as needed

  return (
    <PublicLayout title="Privacy Policy">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Using prose for better typography for long-form text */}
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Privacy Policy</h1>
          <p><em>Last Updated: {lastUpdated}</em></p>

          <p>
            This Privacy Policy explains how {companyName} ("Company", "we", "us", or "our")
            collects, uses, discloses, and protects your personal data when you use the {appName}
            application ("Application") and the {websiteUrl} website ("Site"). Please read this policy carefully.
            By using our Services, you agree to the practices described in this Privacy Policy.
          </p>

          <h2>1. Data Controller</h2>
          <p>
            In accordance with Turkey's Law on the Protection of Personal Data No. 6698 ("KVKK"),
            the data controller for your personal data is {companyName}, a company established in Turkey.
          </p>
          
          <h2>2. Personal Data We Collect</h2>
          <p>We may collect the following personal data from you:</p>
          <ul>
            <li>
              <strong>Identity and Contact Information:</strong> Your name, surname, and email address when you sign in with your Google account.
            </li>
            <li>
              <strong>Google Account Data (with OAuth Permissions):</strong>
              <ul>
                <li><code>openid, https://www.googleapis.com/auth/userinfo.email, https://www.googleapis.com/auth/userinfo.profile</code>: To authenticate you and retrieve basic profile information (name, email, profile picture).</li>
                <li><code>https://www.googleapis.com/auth/spreadsheets</code>: To read and write data to the specific Google Sheet you designate for the Application to function. This is the primary sheet where your orders and related data are stored and processed.</li>
                <li><code>https://www.googleapis.com/auth/drive.file</code>: To access, manage, and save specific files that the Application creates or that you authorize it to access (e.g., generated shipping labels) into a specific Google Drive folder. We do not request access to your entire Drive.</li>
                <li><code>https://www.googleapis.com/auth/script.projects, script.scriptapp, script.external_request, script.storage</code>: To run our backend scripts via the Google Apps Script Execution API to perform automation tasks such as order synchronization and label generation. This enables the core functionalities of the Application.</li>
              </ul>
            </li>
            <li>
              <strong>Usage Data:</strong> Information about how you use our Application and Site (e.g., access times, pages viewed).
            </li>
            <li>
              <strong>Other Stored Data:</strong> We store certain identifiers in our database, such as your Google Sheet ID, Google Drive Folder ID, and any third-party API keys (e.g., shipping carrier API keys) you provide to configure the Application settings. These keys are stored encrypted.
            </li>
          </ul>

          <h2>3. How We Use Your Personal Data</h2>
          <p>We use your personal data for the following purposes:</p>
          <ul>
            <li>To provide, maintain, and improve our Services.</li>
            <li>To authenticate you with your Google account.</li>
            <li>To synchronize order data with your designated Google Sheet.</li>
            <li>To create and manage shipping labels in your Google Drive.</li>
            <li>To respond to your requests and provide support. Contact: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</li>
            <li>To comply with legal obligations.</li>
          </ul>

          <h2>4. Legal Basis for Processing Personal Data</h2>
          <p>We process your personal data based on the following legal grounds under KVKK Article 5:</p>
          <ul>
            <li>Processing is necessary for the establishment or performance of a contract to which you are a party.</li>
            <li>Processing is necessary for compliance with a legal obligation to which the data controller is subject.</li>
            <li>Processing is necessary for the legitimate interests pursued by the data controller, provided that such processing does not harm your fundamental rights and freedoms.</li>
            <li>Your explicit consent (which will be sought separately for specific situations).</li>
          </ul>

          <h2>5. Sharing of Personal Data</h2>
          <p>We do not share your personal data with third parties, except in the following circumstances:</p>
          <ul>
            <li>With Google (via OAuth and API services, with your consent).</li>
            <li>If required by law or upon request from public authorities.</li>
            <li>With trusted service providers who assist us in delivering our Services (e.g., database hosting), but only if they comply with this policy and confidentiality obligations.</li>
          </ul>

          <h2>6. Data Retention and Security</h2>
          <p>
            We retain your personal data for as long as necessary for the purposes for which it was collected or as required by law.
            We take appropriate technical and organizational measures to protect your data against unauthorized access, alteration, disclosure, or destruction.
            Sensitive data such as API keys are stored encrypted in our database.
          </p>

          <h2>7. Your Rights Under KVKK</h2>
          <p>Under KVKK Article 11, you have the following rights:</p>
          <ul>
            <li>To learn whether your personal data is processed.</li>
            <li>To request information if your personal data has been processed.</li>
            <li>To learn the purpose of processing your personal data and whether they are used appropriately for their purpose.</li>
            <li>To know the third parties to whom your personal data is transferred domestically or abroad.</li>
            <li>To request correction of your personal data if it is incomplete or incorrectly processed.</li>
            <li>To request the deletion or destruction of your personal data under the conditions stipulated in KVKK Article 7.</li>
            <li>To request notification of the operations carried out pursuant to sub-paragraphs (d) and (e) to third parties to whom your personal data has been transferred.</li>
            <li>To object to the occurrence of a result against you by analyzing your processed data exclusively through automated systems.</li>
            <li>To claim compensation for damages arising from the unlawful processing of your personal data.</li>
          </ul>
          <p>You can exercise these rights by contacting us at {supportEmail}.</p>

          <h2>8. Cookies</h2>
          <p>
            Our Site may use cookies to enhance user experience. You can refuse cookies through your browser settings,
            but this may cause some functions of the Site to not operate properly.
          </p>

          <h2>9. Links to Other Websites</h2>
          <p>
            Our Site may contain links to other websites that are not operated by us.
            If you click on a third-party link, you will be directed to that third party's site.
            We strongly advise you to review the Privacy Policy of every site you visit.
            We have no control over and assume no responsibility for the content, privacy policies, or practices of any third-party sites or services.
          </p>

          <h2>10. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on the Site.
            You are advised to review this Privacy Policy periodically for any changes.
          </p>

          <h2>11. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us:
            <br />
            {companyName}
            <br />
            Email: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 