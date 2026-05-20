# Sentry Setup Instructions

## 1. Install the package

```bash
npm install @sentry/nextjs
```

## 2. Wrap next.config.js

In `next.config.js`, replace the final export:

```js
// Before:
module.exports = withPWA(nextConfig);

// After:
const { withSentryConfig } = require('@sentry/nextjs');
module.exports = withSentryConfig(withPWA(nextConfig), {
  silent: true,
  hideSourceMaps: true,
});
```

Remove the TODO comment at the top of next.config.js once this is done.

## 3. Set environment variables

Add these to the production `.env` on Hetzner (`/home/deploy/kolayxport/.env`):

```
NEXT_PUBLIC_SENTRY_DSN=https://<your-key>@o<org-id>.ingest.sentry.io/<project-id>
SENTRY_DSN=https://<your-key>@o<org-id>.ingest.sentry.io/<project-id>
```

## 4. Create a Sentry project

1. Go to https://sentry.io and sign in or create an account
2. Create a new project, select "Next.js" as the platform
3. Copy the DSN from the project settings into the env vars above

## Config files already created

- `sentry.client.config.ts` - Browser-side Sentry init
- `sentry.server.config.ts` - Server-side Sentry init
- `sentry.edge.config.ts` - Edge runtime Sentry init
