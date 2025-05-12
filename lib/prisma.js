import { PrismaClient } from '@prisma/client';

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    // Add connection pooling for serverless
    connectionLimit: 5,
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000,
    }
  });
} else {
  // Ensure the prisma instance is re-used during hot-reloading
  // Prevents creating too many connections
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

// Handle cleanup
if (process.env.NODE_ENV === 'production') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

export default prisma; 