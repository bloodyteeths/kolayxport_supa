import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  // Add connection parameters to handle PgBouncer and prepared statements
  const connectionUrl = `${process.env.DATABASE_URL}?pgbouncer=true&connection_limit=1&pool_timeout=20&idle_timeout=20&connect_timeout=20&statement_cache_size=0`;
  
  return new PrismaClient({
    datasources: {
      db: {
        url: connectionUrl,
      },
    },
    log: ['error', 'warn'],
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// Add cleanup on process termination
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

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