import prisma from '../lib/prisma';

async function main() {
  const columns = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'OrderItem'`;
  console.log('OrderItem columns:', columns);
}

main().finally(() => prisma.$disconnect()); 