import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userIds = await prisma.order.findMany({
    select: { userId: true },
    distinct: ['userId']
  });
  console.log('Distinct userIds in Order table:', userIds.map(u => u.userId));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); }); 