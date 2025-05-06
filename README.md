# KolayXport: E-Ticaret Otomasyon SaaS

A Next.js + React dashboard acting as a control panel for e-commerce sellers, integrating with various marketplaces and services. It leverages a central Google Apps Script API for certain backend operations like Google Sheet/Drive interactions for order processing and label generation assistance.

## Architecture Overview

1.  **Public Frontend**: A set of static and server-rendered pages (Homepage, About, Integrations, How-to, Contact, Pricing, Careers, Docs) built with Next.js and React, using `PublicLayout.js` for consistent structure and `next-seo` for SEO management.
2.  **Authenticated App**: The user dashboard resides under the `/app` path, using a dedicated `AppLayout.js` which includes a sidebar and topbar for navigation and core app functionalities.
3.  **Authentication**: Users log in via their Google Account using NextAuth.js.
4.  **Onboarding**: Upon first login, the backend (`/api/onboarding/setup.js`):
    *   Copies a template Google Sheet into the user\'s Google Drive.
    *   Creates a dedicated folder (e.g., "KolayXport_Labels") in the user\'s Drive.
    *   Stores the new `googleSheetId` and `driveFolderId` in the application\'s user database (Prisma).
5.  **Configuration**: Users input their API keys (e.g., for marketplaces, shipping providers) via a Settings Modal in the `/app/settings` section.
    *   Keys are saved securely in the application database.
6.  **Core Operations (via Apps Script)**:
    *   User triggers operations like order sync or label generation from the `/app` UI.
    *   The Next.js backend fetches user-specific data (sheetId, API keys) from the database.
    *   It uses a Service Account and the Apps Script API (`scripts.run`) to execute functions within a **central, deployed Wrapper Apps Script** (identified by `NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID`).
    *   The Wrapper Script calls a private Core Logic Library (another Apps Script project) to perform the actual tasks (e.g., interacting with Google Sheets/Drive, calling external APIs like FedEx).

## Features

- **Public Frontend**:
  - Homepage (`pages/index.js`)
  - About/Kurumsal (`pages/kurumsal.js`)
  - Integrations (`pages/entegrasyonlar.js`)
  - How-to/Nasıl Kullanılır (`pages/nasil-kullanirim.js`)
  - Contact (`pages/iletisim.js`)
  - Pricing (`pages/fiyatlandirma.js`)
  - Careers (`pages/kariyer.js`)
  - Documentation Landing (`pages/docs/index.js`)
  - Privacy Policy (EN & TR)
- **Authenticated Application (at `/app`)**:
  - Google Account Login (NextAuth.js)
  - Modern Dashboard Layout (`components/AppLayout.js`) with collapsible sidebar and topbar.
  - User-specific dashboard view (`pages/app/index.js`)
  - Sections for Orders, Products, Shipping, Analytics, Settings (placeholder pages to be built).
- **Backend & Core Logic**:
  - Central API Executable Wrapper Apps Script deployed.
  - Private Core Logic Apps Script Library.
  - Backend API routes for onboarding, settings, and core operations.
  - Prisma ORM with Supabase (PostgreSQL) for database management.
- **SEO & General**:
  - Global SEO management with `next-seo` (`next-seo.config.js`).
  - Sitemap generation (`next-sitemap`).
  - Unit tests (Jest), E2E tests (Cypress).
  - GitHub Actions for CI.

## SEO & Verification

- **Sitemap:** `sitemap.xml` and an updated `robots.txt` are generated on build using `next-sitemap`.
- **SEO Meta:** Global and per-page SEO metadata is managed using `next-seo`.
- **OpenGraph Images:** Ensure `/og-public.png`, `/og-pricing.png`, `/og-kariyer.png`, `/og-docs.png` (and others as needed) are present in the `/public` directory.
- **Google OAuth Verification:** The app is currently undergoing Google OAuth consent screen verification. This is necessary to ensure full, unrestricted access to Google APIs (Drive, Sheets, Apps Script Execution). Progress is tracked in `dev_plan.json`.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Google Cloud Project with:
  - Google Drive API, Google Sheets API, Apps Script API enabled.
- OAuth 2.0 Client ID credentials.
- A Service Account with credentials (JSON key) and `https://www.googleapis.com/auth/script.projects` scope.
- A Template Google Sheet.
- Deployed Central Wrapper Apps Script & Private Core Logic Library.
- Supabase project for PostgreSQL database.

### Installation

1.  Clone the repo.
2.  Install dependencies: `npm install`
3.  Configure Environment Variables (`.env.local`):
    ```env
    DATABASE_URL="your_supabase_direct_connection_string"
    GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
    GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
    NEXTAUTH_SECRET=GENERATE_A_STRONG_SECRET_KEY
    NEXTAUTH_URL=http://localhost:3000 # For local dev; https://kolayxport.com for production
    
    GOOGLE_SHEETS_SPREADSHEET_ID=YOUR_TEMPLATE_GOOGLE_SHEET_ID
    NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID=YOUR_WRAPPER_SCRIPT_DEPLOYMENT_ID
    NEXT_PUBLIC_APPS_SCRIPT_ID=YOUR_WRAPPER_SCRIPT_ID # Optional, for reference

    GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
    ```
4.  Apply Database Migrations:
    ```bash
    npx prisma db push # If schema is already aligned with DB
    # or npx prisma migrate dev # If you have pending migrations
    ```

## Development

- Run the development server: `npm run dev`
- Open http://localhost:3000.
- Log in with your Google Account (redirects to `/app`).
- Navigate the public pages and the authenticated app section (`/app`).

## Key Implementation Status (Refactoring for Central Script Architecture)

- **Prisma Schema:** Updated for user API keys, `driveFolderId`. **(Completed)**
- **Onboarding (`/api/onboarding/setup.js`):** Copies sheet, creates folder, saves IDs to DB. **(Completed)**
- **API Key Saving:** Saves keys to Prisma DB. `SettingsModal.jsx` updated. **(Completed)**
- **Backend API Calls:** `/api/syncOrders`, `/api/getOrders`, `/api/generateLabel` use central script & DB data. **(Completed)**
- **Core Logic Library:** Functions accept parameters. **(Completed)**

## Testing

- Run Jest unit tests: `npm test`
- Run Cypress E2E tests: `npx cypress run` or `npx cypress open`

## Deployment

- **Database:** Supabase (PostgreSQL) is configured.
- **Apps Scripts:** Central Wrapper Script deployed as API Executable; Core Logic Library saved.
- **Next.js App:** Deploy to Vercel. Ensure all production environment variables are set.

## Roadmap

See [ROADMAP.md](./ROADMAP.md).
