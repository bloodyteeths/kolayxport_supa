# Roadmap

This document outlines planned features, improvements, and long-term vision for the project.

## Current Status & Blockers (May 5, 2025)

*   **Core Functionality Blocked by Google OAuth Verification:** After refactoring to the central Apps Script architecture and resolving various setup issues (library dependencies, deployment IDs, GCP project linking, CI fixes), the application is currently blocked by persistent `Invalid Credentials (401)` errors when calling Google APIs (Sheets, Drive, Apps Script Execution) using the user's OAuth token.
*   **Troubleshooting Done:** Verified client ID/secret, OAuth scopes in NextAuth & GCP, API enablement, token refresh logic, forced token revocation/re-granting. The issue persists even when the `googleapis` library reports successful token refresh.
*   **Likely Cause:** Restrictions imposed by Google on OAuth clients in "Testing" mode using sensitive scopes, requiring formal verification.
*   **Next Step:** The Google OAuth verification process has been initiated (scope justifications submitted). **A demo video proving scope usage is required by Google and needs to be created and added to the verification submission.** Progress on API-dependent features is paused until this verification is underway or complete.
*   **Google OAuth Verification In Progress:** The app is undergoing Google OAuth consent screen verification. Key API functionalities (Drive, Sheets, Apps Script Execution) might be limited until full verification. Current steps involve resolving homepage ownership in Google Search Console and ensuring the privacy policy URL is correctly configured in GCP.
*   **New Onboarding Flow Implemented & Pending Full Test:** 
    *   The onboarding process (`/api/onboarding/setup`) now copies a master Google Sheet template (which has the necessary Apps Script pre-bound to it) into the user's Google Drive.
    *   The user is then guided to open this sheet and run an "Initialize Settings" function from a custom menu within the sheet.
    *   This Apps Script function saves initial UserProperties (like FedEx Folder ID) and then makes a callback to a new Next.js API endpoint (`/api/gscript/register-script-id`).
    *   The `/api/gscript/register-script-id` endpoint receives the user's actual `scriptId` (from the copied script) and `sheetId`, authenticates the call using a shared secret, and saves these IDs to the user's record in the database.
    *   This approach ensures the backend correctly identifies the user's specific script for subsequent operations like `set-user-property`, resolving previous issues with obtaining the correct script ID immediately after copy and permission complexities.
*   **Sitemap Generated:** A `sitemap.xml` is now generated via `next-sitemap` during the build process.
*   **Public Blog Implemented:** Initial blog listing page (`/blog`) and dynamic post pages (`/blog/[slug]`) are now live with placeholder content. This lays the groundwork for content marketing and additional SEO opportunities.

## Upcoming Features

- [ ] Structured data (JSON-LD) for products, articles, and organization
- [ ] Per-page Open Graph & Twitter images
- [ ] Canonical URL tags and noindex for staging/preview
- [ ] Image optimization audit (WebP, responsive sizes, lazy-loading)
- [ ] Accessibility review (lighthouse scores ≥ 95)
- [ ] WYSIWYG or MDX blog authoring workflow (e.g., Contentlayer or CMS)
- [ ] Implement full Apps Script deployment flow via /api/setScriptProps
- [ ] Enhance Dashboard UI with visual order table and filtering
- [ ] Add automated label PDF download and email notifications
- [ ] Support multi-user authentication and role-based permissions
- [ ] Integrate additional marketplaces (Shopify, WooCommerce, Amazon MWS)
- [ ] Implement real-time WebSocket updates for order sync status

## Improvements

- Refine error handling and logging throughout backend and **central Apps Script wrapper/library**
- Add robust form validation using React Hook Form + Zod
- Optimize performance for large datasets and pagination
- Improve unit and E2E test coverage
- Add documentation site for API reference and developer guides

## Future Vision

- Offer this as a fully managed SaaS with tenant isolation **(enabled by central script architecture)**
- Provide a marketplace for user-contributed sync scripts
- Build a plugin system for custom marketplaces and carriers
- Incorporate AI-driven automation for exception handling and label optimization 

## Testing

- [x] Manual Testing: Onboarding & Settings (Completed)
- [ ] Manual Testing: Sync Orders & Label Generation
- [ ] Unit Tests: Run `npm test` to validate individual modules
- [ ] E2E Tests: Run `npx cypress open` or `npx cypress run` to validate full user flows 