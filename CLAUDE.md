# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**KolayXport** is an e-commerce order management and shipping label generation platform that integrates with multiple marketplaces and shipping carriers. The system provides a unified dashboard for managing orders from various sources and generating shipping labels.

## Tech Stack

- **Framework**: Next.js 15.3.2 with React 18.2.0 (Pages Router)
- **Language**: TypeScript (primary) with some JavaScript
- **Database**: PostgreSQL via Supabase, using Prisma ORM
- **Authentication**: NextAuth v4 with Supabase Auth integration
- **Styling**: Tailwind CSS v4 + Material-UI components
- **State Management**: Zustand
- **Data Fetching**: SWR for client-side caching
- **Testing**: Vitest (unit), Playwright (E2E)
- **Deployment**: Vercel

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
Required in `.env.local`:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service key
- `STRIPE_SECRET_KEY` - Stripe API key for billing
- `NEXTAUTH_SECRET` - NextAuth session secret
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth credentials

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

The `feature/trendyol` branch is actively implementing:
- Trendyol API client with authentication
- Order synchronization from Trendyol
- Product image handling
- Comprehensive test coverage
- Architecture documentation for shipping limitations

Additionally, Stripe billing integration is being enhanced with user-facing subscription management features.

## Debugging Tools

Several debug scripts are available:
- `debug-trendyol-images.ts` - Test Trendyol image fetching
- `debug-veeqo-orders-check.ts` - Verify Veeqo order sync
- `debug-full-sync-audit.ts` - Comprehensive sync diagnostics
- `fix-marketplace-identification.ts` - Repair marketplace assignments

Run these with: `tsx [script-name].ts`