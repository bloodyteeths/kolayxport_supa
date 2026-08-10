/**
 * Functional test: does the (reconnected) Etsy token return buyer addresses?
 * Proves whether the new token carries the `address_r` scope. Read-only.
 *
 * Usage: npx tsx scripts/check-etsy-address-scope.ts <userEmail>
 */
import prisma from '@/lib/prisma';
import { EtsyClient } from '@/lib/integrations/etsyClient';
import { decryptIfNeeded, initEncryptionKey } from '@/lib/crypto/credentials';

async function main() {
  const email = process.argv[2];
  if (!email) { console.error('Usage: tsx scripts/check-etsy-address-scope.ts <userEmail>'); process.exit(1); }

  // Unwrap the DEK from OpenBao/Vault the same way the app does at startup,
  // so decryptIfNeeded can read the encrypted token.
  await initEncryptionKey();

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) { console.error(`No user for ${email}`); process.exit(1); }

  const shop = await prisma.etsyShop.findFirst({ where: { userId: user.id, isActive: true } });
  if (!shop?.accessToken || !shop.shopId) { console.error('No active Etsy shop / token'); process.exit(1); }

  console.log(`Shop: ${shop.shopName} (${shop.shopId}) | token updated ${shop.updatedAt.toISOString()}`);

  const client = new EtsyClient({
    accessToken: decryptIfNeeded(shop.accessToken) as string,
    refreshToken: (decryptIfNeeded(shop.refreshToken) as string | null) || undefined,
    shopId: shop.shopId,
    tokenExpiresAt: shop.tokenExpiresAt || undefined,
  });

  const res = await client.getReceipts({ limit: 5, offset: 0, includes: ['Transactions'] });
  const receipts = res.results || [];
  console.log(`Fetched ${receipts.length} recent receipts\n`);

  let withAddr = 0;
  for (const r of receipts) {
    const hasAddr = Boolean(r.first_line || r.city || r.zip);
    if (hasAddr) withAddr++;
    console.log(`#${r.receipt_id} ${r.name || ''} -> ` + (hasAddr
      ? `ADDR OK: ${r.first_line || ''}, ${r.city || ''}, ${r.state || ''} ${r.zip || ''} ${r.country_iso || ''}`
      : `NO ADDRESS (first_line/city/zip all null)`));
  }

  console.log(`\n${withAddr}/${receipts.length} receipts returned a street/city/zip.`);
  console.log(withAddr > 0
    ? '✅ Token HAS address_r — the API now returns addresses. The extension is no longer required.'
    : '❌ Token still returns NO addresses — address_r not granted (reconnect may not have re-consented). Extension scraping still needed.');
}

main().catch((e) => { console.error('ERROR:', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
