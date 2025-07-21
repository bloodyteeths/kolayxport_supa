import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  // Ensure we have proper PgBouncer parameters to avoid prepared statement conflicts
  const databaseUrl = process.env.DATABASE_URL;
  
  // Check if the URL already has the required parameters
  let finalUrl = databaseUrl;
  if (databaseUrl) {
    const urlParams = new URLSearchParams(databaseUrl.split('?')[1] || '');
    
    // Add required PgBouncer parameters if not present
    if (!urlParams.has('pgbouncer')) {
      urlParams.set('pgbouncer', 'true');
    }
    if (!urlParams.has('statement_cache_size')) {
      urlParams.set('statement_cache_size', '0');
    }
    if (!urlParams.has('pool_timeout')) {
      urlParams.set('pool_timeout', '30');
    }
    if (!urlParams.has('connection_limit')) {
      urlParams.set('connection_limit', '10');
    }
    
    const baseUrl = databaseUrl.split('?')[0];
    finalUrl = `${baseUrl}?${urlParams.toString()}`;
  }

  return new PrismaClient({
    log: ['error', 'warn'],
    errorFormat: 'pretty',
    datasources: {
      db: {
        url: finalUrl,
      },
    },
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// Add cleanup on process termination
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