/**
 * One-time backfill: fill Order.shippingAddress from the Chrome-extension-scraped
 * EtsyAddress table, for Etsy orders whose API-synced address is empty (street blank).
 *
 * Why: the shop's Etsy OAuth token predates the `address_r` scope (Jan 31 2026), so the
 * Etsy API returns null addresses. The extension scrapes them into EtsyAddress, but the
 * merge into Order was never wired (extractAddressEnriched has no callers). This backfills
 * the orders already scraped. Reconnecting Etsy fixes future orders at the source.
 *
 * Safe by design:
 *  - Only touches orders where the current street1 is empty (never clobbers real data).
 *  - Only uses EtsyAddress rows that actually have a street (line1).
 *  - Mirrors how the app persists addresses (JSON.stringify into the Json column).
 *
 * Usage: npx tsx scripts/backfill-etsy-addresses.ts <userEmail> [--commit]
 *   Without --commit it's a dry run (prints what it would change).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COUNTRY_TO_ISO: Record<string, string> = {
  'united states': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
  scotland: 'GB', wales: 'GB',
  canada: 'CA', australia: 'AU', 'new zealand': 'NZ',
  germany: 'DE', deutschland: 'DE', france: 'FR', italy: 'IT', italia: 'IT',
  spain: 'ES', 'españa': 'ES', espana: 'ES',
  netherlands: 'NL', holland: 'NL', belgium: 'BE',
  switzerland: 'CH', schweiz: 'CH', suisse: 'CH', austria: 'AT', oesterreich: 'AT', 'österreich': 'AT',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', iceland: 'IS',
  ireland: 'IE', portugal: 'PT', poland: 'PL', czechia: 'CZ', 'czech republic': 'CZ',
  croatia: 'HR', greece: 'GR', hungary: 'HU', romania: 'RO', slovakia: 'SK', slovenia: 'SI',
  japan: 'JP', china: 'CN', 'south korea': 'KR', korea: 'KR', singapore: 'SG', 'hong kong': 'HK',
  mexico: 'MX', brazil: 'BR', brasil: 'BR', argentina: 'AR', chile: 'CL',
  israel: 'IL', turkey: 'TR', 'türkiye': 'TR', turkiye: 'TR',
  'united arab emirates': 'AE', uae: 'AE', 'saudi arabia': 'SA',
  india: 'IN', 'south africa': 'ZA', 'puerto rico': 'PR',
};

function toIso(country: string): string {
  if (!country) return '';
  if (country.length === 2) return country.toUpperCase();
  let key = country.trim().toLowerCase();
  if (key.startsWith('the ')) key = key.slice(4); // "The Netherlands" -> "netherlands"
  return COUNTRY_TO_ISO[key] || country;
}

function parseAddr(val: unknown): any {
  if (!val) return {};
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
  return val as any;
}

async function main() {
  const email = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!email) { console.error('Usage: tsx scripts/backfill-etsy-addresses.ts <userEmail> [--commit]'); process.exit(1); }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) { console.error(`No user for ${email}`); process.exit(1); }

  const addrs = await prisma.etsyAddress.findMany({
    where: { userId: user.id },
    select: { orderNumber: true, shippingAddress: true },
  });
  console.log(`Found ${addrs.length} EtsyAddress rows for ${email}`);

  let updated = 0, skippedNoStreet = 0, skippedHasAddr = 0, noOrder = 0;

  for (const a of addrs) {
    const src = parseAddr(a.shippingAddress);
    const line1 = (src.line1 || src.street1 || '').trim();
    if (!line1) { skippedNoStreet++; continue; }

    const order = await prisma.order.findFirst({
      where: { userId: user.id, orderNumber: a.orderNumber },
      select: { id: true, shippingAddress: true },
    });
    if (!order) { noOrder++; continue; }

    const cur = parseAddr(order.shippingAddress);
    if ((cur.street1 || '').trim()) { skippedHasAddr++; continue; } // already has a street — leave it

    const merged = {
      name: src.name || cur.name || '',
      phone: cur.phone || src.phone || '',
      street1: line1,
      street2: (src.line2 || '').trim(),
      city: (src.city || '').trim(),
      state: (src.state || '').trim(),
      postal: (src.postalCode || src.postal || '').trim(),
      country: toIso((src.country || '').trim()),
      isResidential: true,
      email: cur.email || '',
    };

    console.log(`${commit ? 'UPDATE' : 'DRY'} #${a.orderNumber}: ${merged.name} — ${merged.street1}, ${merged.city}, ${merged.state} ${merged.postal} ${merged.country}`);
    if (commit) {
      await prisma.order.update({ where: { id: order.id }, data: { shippingAddress: JSON.stringify(merged) } });
    }
    updated++;
  }

  console.log(`\n${commit ? 'Updated' : 'Would update'}: ${updated} | skipped(no street in scrape): ${skippedNoStreet} | skipped(order already had street): ${skippedHasAddr} | no matching order: ${noOrder}`);
  if (!commit) console.log('DRY RUN — re-run with --commit to apply.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
