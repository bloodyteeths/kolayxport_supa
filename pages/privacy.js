import React from "react";

export default function PrivacyPolicy() {
  return (
    <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>Privacy Policy</h1>
      <p>Last updated: May 5, 2025</p>

      <section>
        <h2>1. Introduction</h2>
        <p>
          Welcome to MyBaby Sync ("we", "us", "our"). We value your privacy and
          are committed to protecting your personal information in compliance
          with applicable laws, including Turkey's Law on the Protection of
          Personal Data (KVKK).
        </p>
      </section>

      <section>
        <h2>2. Information We Collect</h2>
        <ul>
          <li>
            <strong>Basic Profile Information:</strong> We collect your Google
            account name and email address via OAuth just to identify you and
            personalize your experience.
          </li>
          <li>
            <strong>OAuth Tokens:</strong> We store access and refresh tokens to
            call Google APIs on your behalf (e.g., accessing a designated
            spreadsheet or folder). These tokens are encrypted and stored in
            our database.
          </li>
          <li>
            <strong>Resource Identifiers:</strong> We store the IDs of your
            specific Google Sheet, Drive folder, and Apps Script deployment so
            that we can run the syncing and labeling operations you request.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>
            <strong>Authentication:</strong> Use your Google profile to log in
            securely.<br />
          </li>
          <li>
            <strong>Spreadsheet Sync:</strong> Read and write data to the single
            "wrapper" Google Sheet you specify.<br />
          </li>
          <li>
            <strong>Folder Labeling:</strong> Apply or update labels within the
            specific Google Drive folder you choose.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. OAuth Scopes We Request</h2>
        <ul>
          <li>
            <code>openid</code>, <code>userinfo.email</code>, <code>userinfo.profile</code>: Authenticate you and read your basic profile.
          </li>
          <li>
            <code>https://www.googleapis.com/auth/spreadsheets</code>: Read and write the designated spreadsheet.
          </li>
          <li>
            <code>https://www.googleapis.com/auth/drive.file</code>: Create or modify files your app touches (apply labels to your chosen folder only).
          </li>
          <li>
            <code>https://www.googleapis.com/auth/script.projects</code>, <code>script.scriptapp</code>, <code>script.external_request</code>, <code>script.storage</code>: Run our Apps Script wrapper via the Execution API to perform sync and labeling operations.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Data Retention</h2>
        <p>
          We retain your data (profile info, tokens, and resource IDs) only as
          long as your account is active. You may delete your account and data
          at any time by contacting us.
        </p>
      </section>

      <section>
        <h2>6. Your Rights Under KVKK</h2>
        <p>
          Under Turkey's KVKK, you have the right to access, rectify, delete,
          or object to processing of your personal data. To exercise these
          rights, please contact us using the details below.
        </p>
      </section>

      <section>
        <h2>7. Security Measures</h2>
        <p>
          We implement industry-standard technical and organizational measures
          to protect your data against unauthorized access, alteration,
          disclosure, or destruction.
        </p>
      </section>

      <section>
        <h2>8. Contact Us</h2>
        <p>
          If you have any questions or requests regarding your personal data,
          please contact us at <a href="mailto:support@example.com">support@example.com</a>.
        </p>
      </section>

      <footer>
        <p>
          This policy may be updated periodically. We will notify you of any
          material changes.
        </p>
      </footer>
    </div>
  );
} 