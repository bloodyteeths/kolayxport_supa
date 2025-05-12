import { PrismaClient } from '@prisma/client';

let prisma;

if (process.env.NODE_ENV === 'production') {
  // Append pool options to the DATABASE_URL
  const dbUrl = new URL(process.env.DATABASE_URL);
  dbUrl.searchParams.set('pool_timeout', '30'); // 30 seconds
  dbUrl.searchParams.set('connection_limit', '5'); 

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl.toString(),
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

// Handle cleanup - this might not be necessary with Supabase/Vercel as they manage lambda lifecycles
// but can be kept for other environments or explicit control.
if (process.env.NODE_ENV === 'production') {
  process.on('beforeExit', async () => {
    if (prisma && typeof prisma.$disconnect === 'function') {
      await prisma.$disconnect();
    }
  });
}

export default prisma; 