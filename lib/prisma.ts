import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  // For serverless/Vercel, use DIRECT_URL to bypass pgbouncer issues
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL_NOPREP || process.env.DATABASE_URL;
  
  console.log('[Prisma] Initializing with DIRECT_URL:', databaseUrl ? 'present' : 'missing');
  
  let finalUrl = databaseUrl;
  
  // If we're using DIRECT_URL, use it as-is without any parameters
  if (process.env.DIRECT_URL && databaseUrl === process.env.DIRECT_URL) {
    console.log('[Prisma] Using direct database connection (bypassing pgbouncer)');
    finalUrl = databaseUrl;
  } else {
    // Only add serverless-friendly parameters for pooled connections
    if (databaseUrl) {
      const urlParams = new URLSearchParams(databaseUrl.split('?')[1] || '');
      
      // Serverless-optimized parameters
      if (!urlParams.has('pgbouncer')) {
        urlParams.set('pgbouncer', 'true');
      }
      if (!urlParams.has('statement_cache_size')) {
        urlParams.set('statement_cache_size', '0');
      }
      if (!urlParams.has('connection_limit')) {
        urlParams.set('connection_limit', '1');  // Single connection for serverless
      }
      
      const baseUrl = databaseUrl.split('?')[0];
      finalUrl = `${baseUrl}?${urlParams.toString()}`;
      console.log('[Prisma] Using connection params:', urlParams.toString());
    }
  }

  const client = new PrismaClient({
    log: ['error', 'warn'],
    errorFormat: 'pretty',
    datasources: {
      db: {
        url: finalUrl,
      },
    },
  });

  // CRITICAL: Eagerly connect to avoid connection issues
  client.$connect().catch(err => {
    console.error('[Prisma] Failed to connect:', err);
  });

  return client;
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
  var prismaEventsRegistered: boolean | undefined;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

// CRITICAL: Store the singleton in globalThis for ALL environments
// This prevents connection pool exhaustion in production
globalThis.prisma = prisma;

// Add cleanup on process termination (only once)
if (!globalThis.prismaEventsRegistered) {
  process.on('beforeExit', async () => {
    try {
      await prisma.$disconnect();
    } catch (error) {
      console.error('Error disconnecting Prisma:', error);
    }
  });

  process.on('SIGINT', async () => {
    try {
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error('Error disconnecting Prisma on SIGINT:', error);
      process.exit(1);
    }
  });

  process.on('SIGTERM', async () => {
    try {
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error('Error disconnecting Prisma on SIGTERM:', error);
      process.exit(1);
    }
  });
  
  globalThis.prismaEventsRegistered = true;
}

// Connection health check function
export async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database connection check failed:', error);
    return false;
  }
}

// --- LabelJob delete logging patch ---
if (prisma && prisma.labelJob) {
  const origDelete = prisma.labelJob.delete.bind(prisma.labelJob);
  type DeleteType = typeof prisma.labelJob.delete;
  type DeleteManyType = typeof prisma.labelJob.deleteMany;

  prisma.labelJob.delete = ((args: Parameters<DeleteType>[0]) => {
    console.warn('[LabelJob DELETE]', JSON.stringify(args));
    return origDelete(args);
  }) as unknown as DeleteType;

  const origDeleteMany = prisma.labelJob.deleteMany.bind(prisma.labelJob);
  prisma.labelJob.deleteMany = ((args: Parameters<DeleteManyType>[0]) => {
    console.warn('[LabelJob DELETE MANY]', JSON.stringify(args));
    return origDeleteMany(args);
  }) as unknown as DeleteManyType;
}


export default prisma; 