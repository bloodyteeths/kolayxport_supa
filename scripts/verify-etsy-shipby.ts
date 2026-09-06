/**
 * Read-only check: fetch a single Etsy receipt live and print the ship-by
 * fields (expected_ship_date per transaction, processing profile) next to
 * what we have stored in the DB. For debugging "ship by date looks wrong".
 *
 *   set -a; source .env; set +a
 *   npx tsx scripts/verify-etsy-shipby.ts <receiptId>
 */
import { PrismaClient } from '@prisma/client';
import { EtsyClient } from '@/lib/integrations/etsyClient';
import { decryptIfNeeded, initEncryptionKey } from '@/lib/crypto/credentials';

const prisma = new PrismaClient();
const iso = (sec: any) => {
  const n = Number(sec);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : String(sec);
};

async function main() {
  const receiptId = process.argv[2];
  if (!receiptId) throw new Error('usage: verify-etsy-shipby.ts <receiptId>');
  await initEncryptionKey();

  const shop = await prisma.etsyShop.findFirst({ where: { isActive: true, isDefault: true } })
    || await prisma.etsyShop.findFirst({ where: { isActive: true } });
  if (!shop?.accessToken) throw new Error('no active etsy shop');

  const client = new EtsyClient({
    accessToken: decryptIfNeeded(shop.accessToken) as string,
    refreshToken: (decryptIfNeeded(shop.refreshToken) as string | null) || undefined,
    shopId: shop.shopId,
    tokenExpiresAt: shop.tokenExpiresAt || undefined,
  }, async () => {});

  const url = `https://openapi.etsy.com/v3/application/shops/${shop.shopId}/receipts/${receiptId}`;
  const resp = await (client as any).makeAuthenticatedRequest(url, { method: 'GET', headers: {} });
  if (!resp.ok) throw new Error(`Etsy ${resp.status}: ${await resp.text()}`);
  const r = await resp.json();

  console.log(`Receipt ${receiptId} (${shop.shopName})`);
  console.log(`  status=${r.status} created=${iso(r.created_timestamp)} updated=${iso(r.update_timestamp)}`);
  for (const tx of r.transactions || []) {
    console.log(`  tx ${tx.transaction_id}: expected_ship_date=${iso(tx.expected_ship_date)} paid=${iso(tx.paid_timestamp)} shipped=${iso(tx.shipped_timestamp)}`);
    console.log(`    listing=${tx.listing_id} min_processing_days=${tx.min_processing_days} max_processing_days=${tx.max_processing_days} shipping_profile_id=${tx.shipping_profile_id}`);
  }

  const order = await prisma.order.findFirst({
    where: { orderNumber: String(receiptId) },
    include: { items: true },
  });
  if (order) {
    console.log(`  DB: status=${order.status} items.shipBy=${order.items.map(i => i.shipBy?.toISOString()).join(', ')}`);
  } else {
    console.log('  DB: order not found');
  }
}

main().finally(() => prisma.$disconnect());
