import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const legacyKeys = [
  'veeqoApiKey',
  'shippoToken',
  'fedexAccountNumber',
  'fedexMeterNumber',
  'fedexApiKey',
  'fedexApiSecret',
  'trendyolSupplierId',
  'trendyolApiKey',
  'trendyolApiSecret',
  'hepsiburadaMerchantId',
  'hepsiburadaApiKey',
] as const;

type UserWithLegacy = {
  id: string;
} & Partial<Record<typeof legacyKeys[number], string | null>>;

async function main() {
  console.log('Migrating legacy keys…');
  const users = await prisma.user.findMany({
    where: {
      OR: legacyKeys.map((k) => ({ [k]: { not: null } })),
    },
    select: legacyKeys.reduce(
      (sel, key) => ({ ...sel, [key]: true }),
      { id: true }
    ) as any,
  }) as unknown as UserWithLegacy[];

  console.log(`Found ${users.length} users to migrate.`);
  let success = 0, fail = 0;

  for (const u of users) {
    try {
      await prisma.userIntegrationSettings.upsert({
        where: { userId: u.id },
        create: { userId: u.id, ...u },
        update: { ...u },
      });
      console.log(`✔ Migrated ${u.id}`);
      success++;
    } catch (e) {
      console.error(`✖ Failed ${u.id}:`, e);
      fail++;
    }
  }

  console.log(`Done. Success: ${success}, Fail: ${fail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect()); 