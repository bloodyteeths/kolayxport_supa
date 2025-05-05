# MyBaby Sync Product

A Next.js + React dashboard acting as a control panel for per-user Google Apps Script instances that automate order synchronization and label generation.

## Architecture Overview

This application enables users to manage their own automated workflows hosted within their Google account, leveraging a central Apps Script API.

1.  **Authentication:** Users log in via their Google Account using NextAuth.js.
2.  **Onboarding:** Upon first login, the backend (`/api/onboarding/setup.js`):
    *   Copies a template Google Sheet into the user\'s Google Drive.
    *   Creates a dedicated folder (e.g., "myBabySync_ShippingLabels") in the user\'s Drive.
    *   Stores the new `googleSheetId` and `driveFolderId` in the application\'s user database (Prisma). **It no longer copies or stores a script ID.**
3.  **Configuration:** Users input their API keys (Veeqo, Trendyol, FedEx, etc.) via a Settings Modal in the Next.js UI.
    *   The frontend calls a backend API route (e.g., `/api/saveUserSettings`).
    *   This backend route **saves the encrypted keys directly into the user's record in the application database**. It **no longer** calls Apps Script to save keys.
4.  **Sync Operation:**
    *   User triggers sync from the Next.js UI ("Senkron" tab).
    *   Frontend calls the backend (`/api/syncOrders`).
    *   Backend fetches the user's `googleSheetId` and relevant API keys from the database.
    *   Backend uses a Service Account and the Apps Script API (`scripts.run`) to execute the `syncOrdersToSheet` function within the **central, deployed Wrapper Apps Script** (identified by `NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID`).
    *   The backend passes the user's `spreadsheetId` and API keys as parameters to the Wrapper Script.
    *   The Wrapper Script calls the Core Logic Library, passing the necessary data.
    *   The Core Logic Library performs the sync and returns results to the Wrapper.
    *   The Wrapper appends data to the user's sheet (using `SpreadsheetApp.openById(spreadsheetId)`).
5.  **Data Display:**
    *   The frontend (`OrdersTable` component) calls a backend API (`/api/getOrders`).
    *   Backend fetches the user's `googleSheetId` from the database.
    *   Backend uses `scripts.run` to execute `getOrdersFromSheet` in the **central Wrapper Script**, passing the `spreadsheetId`.
    *   The Wrapper Script reads data from the user's Sheet (using `openById`) and returns it for display.
6.  **Label Generation:**
    *   Triggered from the UI (`OrdersTable`).
    *   Calls a backend API (`/api/generateLabel`).
    *   Backend fetches the user's FedEx keys and `driveFolderId` from the database.
    *   Backend uses `scripts.run` to execute `generateLabelForOrder` in the **central Wrapper Script**, passing the FedEx keys, `driveFolderId`, and necessary `orderData`.
    *   The Wrapper Script calls the Core Logic Library, passing the data.
    *   The Core Logic Library generates the label via FedEx API, saves it to the user's Drive folder (using `DriveApp.getFolderById(driveFolderId)`), and returns the result (e.g., tracking number, Drive file URL).

## Features (Current State)

- Google Account Login (NextAuth.js)
- **Central API Executable Wrapper Apps Script (`apps-script/mergedSyncAndLabel.gs`) deployed (ID: `NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID`)**
- **Private Core Logic Apps Script Library (referenced by Wrapper)**
- Backend API structure for interacting with the central Wrapper script via `scripts.run`
  - `/api/syncOrders`
  - `/api/generateLabel`
  - `/api/getOrders`
  - `/api/setScriptProps` (Needs refactoring to save keys to DB)
  - `/api/onboarding/setup.js` (Needs refactoring for new architecture)
- Prisma ORM setup (needs schema update: remove `googleScriptId`, add keys/folderId).
- Frontend Dashboard (`Dashboard.js`, `Layout.js`)
- Settings Modal (`SettingsModal.jsx`) (Needs update to call new key saving API).
- Orders Table (`OrdersTable.jsx`)
- Unit tests setup (Jest), E2E tests setup (Cypress).

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Google Cloud Project with:
  - **Google Drive API** enabled
  - **Google Sheets API** enabled
  - **Apps Script API** enabled
- OAuth 2.0 Client ID credentials (for NextAuth Google Provider)
- A Service Account with credentials (JSON key) and appropriate permissions:
  - Required Scopes: `https://www.googleapis.com/auth/script.projects` (to run the central script). The Service Account *does not* need Drive/Sheet permissions itself if the central script runs as the user or uses user tokens.
- A **Template Google Sheet** (used for copying during onboarding).
- A **Deployed Central Wrapper Apps Script (API Executable)** - See `NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID`.
- A **Private Core Logic Apps Script** added as a library to the Wrapper Script.

### Installation

1.  Clone the repo.
2.  Install dependencies: `npm install`
3.  Configure Environment Variables (`.env.local`):
    ```env
    # Database (SQLite or PostgreSQL)
    DATABASE_URL="file:./prisma/dev.db" # Or your PostgreSQL URL

    # NextAuth
    GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
    GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
    NEXTAUTH_SECRET=GENERATE_A_STRONG_SECRET_KEY
    NEXTAUTH_URL=http://localhost:3000

    # App Specific
    TEMPLATE_SHEET_ID=YOUR_TEMPLATE_GOOGLE_SHEET_ID
    # Central Apps Script API Executable Deployment ID
    NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID=YOUR_WRAPPER_SCRIPT_DEPLOYMENT_ID
    # (Optional but good practice) Central Wrapper Script ID (for reference/OAuth scope if needed)
    NEXT_PUBLIC_APPS_SCRIPT_ID=YOUR_WRAPPER_SCRIPT_ID

    # Service Account Credentials (for Backend -> Apps Script API)
    GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nYOUR_KEY_HERE\\n-----END PRIVATE KEY-----\\n"

    # REMOVE this if present: TEMP_USER_SCRIPT_ID=...
    ```
4.  Apply Database Migrations:
    ```bash
    # Update prisma/schema.prisma first (remove googleScriptId, add fields)
    npx prisma migrate dev
    ```

## Development

- Run the development server: `npm run dev`
- Open http://localhost:3000.
- Log in with your Google Account.
- **Onboarding:** The `/api/onboarding/setup.js` route needs to be implemented/refactored to copy the sheet, create the folder, and save `googleSheetId`/`driveFolderId` to the DB.
- Open the "Ayarlar" tab, click "API Anahtarlarını ve Ayarları Yönet". This needs to be refactored to save keys to the **database** via a new API endpoint, not Apps Script PropertiesService.
- Go to the "Senkron" tab and click "Sync Orders". Backend API (`/api/syncOrders`) needs refactoring to fetch user data/keys from DB and call the central Wrapper script.

## Key Implementation TODOs (Refactoring for Central Script Architecture)

- **Prisma Schema:** Update `prisma/schema.prisma` to remove `googleScriptId`, add `driveFolderId`, add fields for user API keys (consider encryption). Run `npx prisma migrate dev`.
- **Onboarding (`/api/onboarding/setup.js`):** Refactor to only copy sheet and create folder, storing only `googleSheetId` and `driveFolderId` in DB. Remove Script ID logic.
- **API Key Saving:** Refactor `/api/setScriptProps.js` (or create `/api/saveUserSettings`) to save keys to the Prisma DB. Update `SettingsModal.jsx` to call this new endpoint.
- **Backend API Calls:** Modify `/api/syncOrders`, `/api/getOrders`, `/api/generateLabel` to:
    - Fetch user's `googleSheetId`, `driveFolderId`, and API keys from DB based on session.
    - Call the **central Wrapper Script's Deployment ID** using `scripts.run`.
    - Pass the fetched `spreadsheetId`, keys, `driveFolderId`, etc., as parameters to the wrapper script functions.
- **Core Logic Library:** Ensure the online private library script functions accept all necessary data as parameters.
- **`OrdersTable` Data Fetching & Display:** Ensure it calls the refactored `/api/getOrders` and renders data correctly.
- **Label Generation:** Ensure `OrdersTable` calls the refactored `/api/generateLabel` correctly.

## Testing

- Run Jest unit tests: `npm test`
- Run Cypress E2E tests: `npx cypress run` or `npx cypress open`

## Deployment

- **Database:** Switch Prisma provider to PostgreSQL and configure connection URL. Run migrations.
- **Apps Scripts:** Ensure the **central Wrapper Script** is deployed as an API Executable and the **Core Logic Library** is saved. No per-user script deployment needed.
- **Next.js App:** Deploy to Vercel, Netlify, Fly.io, etc. Ensure all production environment variables are set, especially `NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID`.

## Roadmap

See [ROADMAP.md](./ROADMAP.md).
