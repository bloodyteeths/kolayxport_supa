# KolayXport

KolayXport is a modern e-commerce order management and shipping label generation system. It syncs orders from multiple marketplaces (Veeqo, Trendyol, etc.) and provides a unified interface for order management and label generation.

## Technology Stack

- **Frontend**: Next.js with React and Tailwind CSS
- **Authentication**: Supabase Auth
- **Database**: PostgreSQL via Supabase
- **ORM**: Prisma
- **Hosting**: Vercel

## Features

- User authentication and account management
- API key management for multiple marketplaces and carriers
- Automatic order syncing from connected marketplaces
- Order dashboard with filtering and search capabilities
- Label generation for multiple carriers
- Analytics dashboard with key metrics

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- A Supabase account (free tier is fine for development)
- Vercel account (optional for deployment)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/kolayxport.git
cd kolayxport
```

2. Install dependencies:

```bash
npm install
```

3. Create a Supabase project at [supabase.com](https://supabase.com)

4. Create a `.env.local` file in the project root with your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
```

5. Push the Prisma schema to your Supabase database:

```bash
npx prisma db push
```

6. Start the development server:

```bash
npm run dev
```

7. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

- `/pages`: Next.js pages
  - `/api`: API routes
  - `/app`: Authenticated application routes
- `/components`: Reusable React components
- `/lib`: Utility functions and Supabase client
- `/prisma`: Database schema and migrations
- `/public`: Static assets
- `/styles`: Global styles

## Marketplace Integration

To integrate with marketplaces, you'll need to:

1. Create an account on the marketplace developer platform
2. Generate API credentials
3. Add these credentials in the Settings page of KolayXport

Currently supported marketplaces:
- Veeqo
- Trendyol

## Shipping Carrier Integration

Currently supported carriers:
- Shippo (multiple carriers)
- FedEx (direct integration)

## Deployment

This project is designed to be deployed on Vercel:

1. Push your code to a GitHub repository
2. Connect the repository to Vercel
3. Add the environment variables in the Vercel project settings
4. Deploy

## License

This project is licensed under the MIT License - see the LICENSE file for details.
# kolayxport_supa

<!-- Trigger Vercel Redeploy -->

<!-- Ensuring Vercel picks up the latest commit -->
