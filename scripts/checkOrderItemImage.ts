import prisma from '../lib/prisma';

async function main() {
  const item = await prisma.orderItem.findFirst({
    where: { NOT: { image: null } },
    select: { id: true, image: true },
  });
  console.log('First OrderItem with non-null image:', item);
}

main().finally(() => prisma.$disconnect()); 