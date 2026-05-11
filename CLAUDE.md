# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**KolayXport** is an e-commerce order management and shipping label generation platform that integrates with multiple marketplaces and shipping carriers. The system provides a unified dashboard for managing orders from various sources and generating shipping labels.

## Tech Stack

- **Framework**: Next.js 16.1.6 with React 18.2.0 (Pages Router)
- **Language**: TypeScript (primary) with some JavaScript
- **Database**: PostgreSQL on Hetzner VPS, using Prisma ORM
- **Authentication**: NextAuth v4 with Supabase Auth integration
- **Styling**: Tailwind CSS v4 + Material-UI components
- **State Management**: Zustand
- **Data Fetching**: SWR for client-side caching
- **Testing**: Vitest (unit), Playwright (E2E)
- **Deployment**: Hetzner VPS

## Current Production Environment

KolayXport is fully Hetzner-hosted. Do not assume Vercel or Supabase production hosting.

- **Domain**: `https://kolayxport.com`
- **VPS**: Hetzner server `46.224.169.225`
- **Production app path**: `/home/deploy/kolayxport`
- **Production process**: systemd service `kolayxport.service`
- **Production DB**: local PostgreSQL database `kolayxport` on the VPS
- **Health check**: `https://kolayxport.com/api/health`
- **Uploads**: staged Etsy draft media files are stored under `/home/deploy/kolayxport/uploads/etsy-drafts/...`

Useful production commands:

```bash
ssh deploy@46.224.169.225 'cd /home/deploy/kolayxport && npm run build'
ssh root@46.224.169.225 'systemctl restart kolayxport.service && systemctl is-active kolayxport.service'
ssh root@46.224.169.225 'journalctl -u kolayxport.service --since "30 minutes ago" --no-pager'
curl -fsS https://kolayxport.com/api/health
```

Local `.env` in some older local copies may still point at Supabase. For production truth, use Hetzner `.env` in `/home/deploy/kolayxport`.

## Key Commands

```bash
# Development
npm run dev              # Start development server
npm run build            # Build for production (includes Prisma generation)
npm run start            # Start production server

# Testing
npm run test             # Run unit tests with Vitest
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run test:ui          # Run tests with Vitest UI
npm run test:all         # Run all test suites (unit, api, smoke)

# Database
npx prisma migrate dev   # Run database migrations in development
npx prisma generate      # Generate Prisma client
npx prisma studio        # Open Prisma Studio for database inspection

# Debugging & Scripts
npm run debug:sync       # Debug order synchronization
tsx scripts/[script].ts  # Run TypeScript scripts in /scripts directory
```

## Architecture Overview

### API Routes Pattern
All backend logic is implemented as Next.js API routes in `/pages/api/`:
- `/api/auth/*` - Authentication endpoints
- `/api/orders/*` - Order management and synchronization
- `/api/user/*` - User settings and credential management
- `/api/stripe/*` - Billing and subscription management

### Integration Architecture
Marketplace integrations follow a consistent pattern:
1. **Client**: `/lib/integrations/[marketplace]Client.ts` - API communication
2. **Service**: `/lib/integrations/[marketplace].ts` - Business logic
3. **Mapper**: `/lib/mappers/[marketplace]Mapper.ts` - Data transformation
4. **Types**: `/lib/types.ts` - TypeScript interfaces

### Data Flow
1. User configures marketplace credentials (stored encrypted in database)
2. Sync process fetches orders via marketplace APIs
3. Orders are normalized to common schema and stored in PostgreSQL
4. Frontend displays unified order view across all marketplaces
5. Labels are generated on-demand via carrier APIs

### Key Services
- **Order Sync**: `/lib/orderSync.ts` - Orchestrates marketplace synchronization
- **Prisma Client**: `/lib/prisma.ts` - Database access layer
- **Logger**: `/lib/logger.ts` - Structured logging with Pino
- **Rate Limiting**: `/lib/middleware/usageLimiter.ts` - API usage control

## Database Schema

Key models (defined in `/prisma/schema.prisma`):
- **User**: Core user with billing and sync tracking
- **Order**: Unified order representation with shipping details
- **OrderItem**: Line items with SKU, pricing, weight
- **Credential**: Encrypted marketplace API credentials
- **ShipperProfile**: User's shipping configuration
- **Shipment**: Generated labels and tracking info
- **EtsyListing**: Synced Etsy listing cache
- **EtsyListingDraft**: DB-backed staged Etsy changes before sync
- **EtsyDraftMedia**: Pending Etsy media operations and local staged file metadata
- **EtsyDraftSyncAttempt**: Per-draft sync attempts, results, failures, and conflicts

## Etsy Editing Architecture

Etsy listing editing has been migrated toward a staged-draft workflow. UI edits should not directly mutate Etsy. They should create/update local draft records, and Etsy is changed only by an explicit "Sync to Etsy" action.

Primary implementation files:

- `/lib/etsy/draftService.ts` - draft CRUD helpers, sync executor, Etsy token helper, media sync safety logic
- `/lib/etsy/draftClient.ts` - browser helpers for staging draft patches and media uploads
- `/pages/api/etsy-drafts/*` - draft API surface, media upload, single sync, bulk sync
- `/components/etsy/ListingEditorDrawer.tsx` - single listing editor staging
- `/components/etsy/BulkEditor.tsx` - bulk editor staging
- `/components/etsy/ImageManager.tsx` - single listing photo staging and reordering
- `/components/etsy/VideoUploader.tsx` - video staging
- `/components/etsy/VariationEditor.tsx` - inventory/variation staging
- `/pages/api/clawd/etsy.ts` - still exists as low-level Etsy executor/read API; UI should not call mutation actions directly when a staged draft path exists

Current behavior:

- Core listing fields, taxonomy details, personalization, inventory/variations, variation images, media upload/delete/reorder/alt text, state actions, copy/delete/renew/deactivate/publish are staged as drafts where migrated.
- `EtsyListingDraft.status` includes `draft`, `syncing`, `conflict`, `failed`, `synced`, `cancelled`.
- Conflict protection blocks sync when Etsy remote `updated_timestamp` changed after the draft base snapshot.
- Failed syncs preserve the draft and record an `EtsyDraftSyncAttempt`.
- Staged media files live on the Hetzner filesystem, not Postgres.

Important sync hardening from May 2026:

- Media sync validates current Etsy image IDs before delete/reorder/alt updates.
- Missing/wrong-listing image/video IDs are skipped instead of crashing the whole sync.
- Duplicate staged image deletes are ignored.
- Reorder/alt staged ops keep the latest operation per image.
- Duplicate queued actions are deduped.

Known caution:

- A conflict may be correct if a previous partial sync changed Etsy before failing. Do not blindly force a conflicted draft. Inspect `EtsyListingDraft`, `EtsyDraftMedia`, and `EtsyDraftSyncAttempt` first, especially `queuedActions` because a queued `delete` can delete the listing.

## Current Integrations

### Marketplaces
- **Veeqo**: Multi-marketplace aggregator (primary)
- **Shippo**: Shipping platform with marketplace features
- **Trendyol**: Turkish marketplace (in development on feature/trendyol branch)
- **Hepsiburada**: Turkish marketplace (credentials supported)

### Shipping Carriers
- **FedEx**: Direct API integration
- **UPS**: Label generation with customization options
- **Shippo**: Multi-carrier through Shippo platform

## Development Guidelines

### Adding New Marketplace Integration
1. Create client in `/lib/integrations/[marketplace]Client.ts`
2. Implement service logic in `/lib/integrations/[marketplace].ts`
3. Add mapper in `/lib/mappers/[marketplace]Mapper.ts`
4. Update `/lib/orderSync.ts` to include new marketplace
5. Add credential types to database schema
6. Create UI components for configuration

### Testing Approach
- Unit tests for mappers and utilities
- Integration tests for API routes
- Use test fixtures in `/__tests__/fixtures/`
- Mock external APIs in tests
- Run `npm run test:all` before committing

### Environment Variables
Required in production `.env` on Hetzner:
- `DATABASE_URL` - PostgreSQL connection string for local Hetzner Postgres
- `DIRECT_URL` - direct Prisma/Postgres connection when configured
- `NEXTAUTH_SECRET` - NextAuth session secret
- `ETSY_API_KEY` / `ETSY_API_SECRET` - Etsy API credentials
- `ETSY_DRAFT_UPLOAD_DIR` - optional override for staged Etsy draft media root
- `STRIPE_SECRET_KEY` - Stripe API key for billing
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth credentials

Older Supabase variables may still exist in stale local files. Do not infer production DB/server from those.

### Feature Flags
Control features via environment variables:
- `ENABLE_TRENDYOL` - Enable Trendyol integration
- `ENABLE_STRIPE_BILLING` - Enable Stripe subscription features

## Stripe Billing Implementation

### Completed Components
- **Infrastructure**: Stripe client (`/lib/stripe.ts`) and pricing configuration (`/lib/stripePrices.ts`)
- **Database**: User model extended with billing fields (plan, status, usage counters)
- **API Endpoints**:
  - `/api/stripe/create-checkout-session.ts` - Checkout flow with 30-day trial
  - `/api/stripe/webhook.ts` - Subscription lifecycle management
- **Usage Limiting**: Middleware enforcing plan limits on order sync and label generation
- **Pricing Page**: Turkish language pricing at `/fiyatlandirma` with plan selection

### Plan Limits
- **Trial**: 50 order syncs, 10 labels (30 days)
- **Starter**: 200 order syncs, 100 labels/month
- **Growth**: 2000 order syncs, 500 labels/month
- **Enterprise**: Unlimited (manual setup)

### Pending Stripe Tasks
1. User subscription dashboard showing current plan and usage
2. Plan upgrade/downgrade functionality
3. Usage reset automation on billing cycle
4. Trial expiration handling and notifications
5. Payment failure recovery flows
6. Billing history and invoice access

### Required Stripe Environment Variables
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
PRICE_STARTER_MONTH
PRICE_STARTER_YEAR
PRICE_GROWTH_MONTH
PRICE_GROWTH_YEAR
```

## Current Development Focus

Recent work has focused on Etsy listing editing quality and safety:

- DB-backed staged editing instead of direct Etsy writes
- Explicit sync-to-Etsy workflow with conflict protection
- Single and bulk photo management: show all photos, preview/enlarge, drag reorder, alt text, bulk upload, staged delete/upload/reorder
- Video upload/delete staging
- Variation editor staging and second variation UX
- Category-specific Etsy details in single and bulk editors
- Bulk editor category search/autocomplete using Etsy taxonomy tree
- Hetzner production deployment and log-based debugging

When auditing Etsy bugs, always check:

```sql
SELECT id,status,"etsyListingId","etsyShopId","baseEtsyUpdatedTimestamp","lastSyncError","updatedAt",
       "fieldPatch","taxonomyPatch","inventoryPatch","variationImagesPatch","personalizationPatch","queuedActions"
FROM "EtsyListingDraft"
WHERE status IN ('draft','failed','conflict','syncing')
ORDER BY "updatedAt" DESC;

SELECT id,"draftId",status,"startedAt","finishedAt",error,"requestPlan"
FROM "EtsyDraftSyncAttempt"
ORDER BY "startedAt" DESC
LIMIT 20;
```

## Debugging Tools

Several debug scripts are available:
- `debug-trendyol-images.ts` - Test Trendyol image fetching
- `debug-veeqo-orders-check.ts` - Verify Veeqo order sync
- `debug-full-sync-audit.ts` - Comprehensive sync diagnostics
- `fix-marketplace-identification.ts` - Repair marketplace assignments

Run these with: `tsx [script-name].ts`
