import { PrismaClient } from '@prisma/client';

let prisma;

if (process.env.NODE_ENV === 'production') {
  let dbUrlString = process.env.DATABASE_URL;

  if (dbUrlString) {
    const dbUrl = new URL(dbUrlString);
    // Ensure pgbouncer=true is set if it's likely a Supabase pooler URL (port 6543)
    // Also, set conservative pooling options suitable for serverless with PgBouncer.
    if (dbUrl.port === '6543' && !dbUrl.searchParams.has('pgbouncer')) {
      dbUrl.searchParams.set('pgbouncer', 'true');
    }
    // Supabase/Prisma docs recommend connection_limit=1 for serverless with PgBouncer
    if (!dbUrl.searchParams.has('connection_limit')) {
      dbUrl.searchParams.set('connection_limit', '1'); 
    }
    // A default pool_timeout, can be adjusted based on needs
    if (!dbUrl.searchParams.has('pool_timeout')) {
      dbUrl.searchParams.set('pool_timeout', '10'); 
    }
    dbUrlString = dbUrl.toString();
  } else {
    // Fallback or error if DATABASE_URL is not set in production
    console.error('DATABASE_URL environment variable is not set in production.');
    // Depending on desired behavior, either throw an error or try to initialize PrismaClient without a URL (which will likely fail)
    // For now, let it proceed, and PrismaClient will throw an error if the URL is missing/invalid.
  }

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrlString, // Use the modified URL
      },
    },
  });
} else {
  // Ensure the prisma instance is re-used during hot-reloading
  // Prevents creating too many connections
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

// process.on('beforeExit') for $disconnect is generally not needed or recommended 
// for serverless environments as the lifecycle is managed by the platform.
// Prisma Client handles connections on demand.

export default prisma; 