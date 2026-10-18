// Before capturing the eBay tutorial's real answers (fixtures/ebay-create/mocks.yaml): remove the local demo user's
// FAKE eBay user token, so our server's eBay reads fall back to the application token (lib/integrations/ebayClient
// getEbayTokenFor) instead of sending a fake user token to eBay. Local demo DB (localhost:5544) only; re-seed after.
//   npx tsx scripts/tutorials/ebay-capture-prep.mts
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(process.cwd(), '.env.local'), quiet: true } as any);
const url = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1):5544\//.test(url)) throw new Error('DATABASE_URL is not the local demo DB (localhost:5544): refusing');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const r = await prisma.credential.updateMany({ where: { userId: 'demo-user-kolayxport' }, data: { ebayAccessToken: null, ebayRefreshToken: null } });
console.log(`[ebay-capture-prep] demo user eBay user token removed (${r.count} row); re-seed the demo account after capturing`);
await prisma.$disconnect();
