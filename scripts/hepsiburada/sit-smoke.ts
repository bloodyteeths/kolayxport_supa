/**
 * Hepsiburada SIT smoke test — exercises the client end-to-end against HB's test environment (no DB writes).
 * Also the checklist HB's SIT certification asks for before production access.
 *
 *   HEPSIBURADA_ENV=sit HEPSIBURADA_INTEGRATOR_NAME=<name> HB_MERCHANT_ID=<guid> HB_SERVICE_KEY=<key> \
 *     npx tsx scripts/hepsiburada/sit-smoke.ts [--create-order] [--pack] [--label] [--questions]
 *
 * Credentials come from env only (never commit them).
 */
import fs from 'fs';
import { HepsiburadaClient, hbErrorMessage } from '../../lib/hepsiburada/client';
import { collectHepsiburadaOrders } from '../../lib/hepsiburada/orderSync';
import { toUIOrder } from '../../lib/hepsiburada/orderMapper';
import { fetchLabel } from '../../lib/hepsiburada/fulfilment';

const args = new Set(process.argv.slice(2));

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    console.log(`✔ ${name}`);
    return out;
  } catch (err) {
    console.log(`✘ ${name}: ${hbErrorMessage(err)}`);
    return undefined;
  }
}

async function main() {
  if (process.env.HEPSIBURADA_ENV !== 'sit') throw new Error('Refusing to run: set HEPSIBURADA_ENV=sit');
  const merchantId = process.env.HB_MERCHANT_ID || '';
  const serviceKey = process.env.HB_SERVICE_KEY || '';
  const client = new HepsiburadaClient({ merchantId, serviceKey, env: 'sit' });

  const listings = await step('listings', () => client.listListings({ offset: 0, limit: 5 }));
  console.log(`  listings total: ${(listings as any)?.totalCount ?? '?'}`);

  if (args.has('--create-order')) {
    const sku = (listings as any)?.listings?.[0];
    await step('create SIT test order', () => client.createTestOrder({
      OrderNumber: String(Date.now()).slice(-9),
      OrderDate: new Date().toISOString(),
      PaymentStatus: 'Paid',
      Customer: { CustomerId: 'kx-sit-customer', Name: 'KolayXport SIT' },
      DeliveryAddress: { AddressId: 'kx-sit', Name: 'KolayXport SIT', AddressDetail: 'Test Mah. 1', Email: 'sit@kolayxport.com', CountryCode: 'TR', PhoneNumber: '5550000000', District: 'Moda', City: 'İstanbul' },
      LineItems: [{ Sku: sku?.hepsiburadaSku || 'HBV00000TEST', MerchantId: merchantId, Quantity: 1, Price: { Amount: 100, Currency: 'TRY' }, Vat: 18, TotalPrice: { Amount: 100, Currency: 'TRY' }, CargoCompanyId: 89100, DeliveryOptionId: 1 }],
    }));
  }

  const book = await step('collect orders', () => collectHepsiburadaOrders(client));
  const orders = book ? Array.from(book.orders.values()).map(toUIOrder) : [];
  console.log(`  orders: ${orders.length}`);
  for (const o of orders.slice(0, 5)) console.log(`   - ${o.orderNumber} ${o.externalStatus} ${o.totalPrice} ${o.currency} lines=${o.line_items.length} pkg=${o.rawData.packageNumber ?? '-'}`);

  if (args.has('--pack')) {
    const open = orders.find((o) => o.rawData.hbLines.some((l: any) => l.state === 'open' && !l.packageNumber));
    if (open) {
      const lines = open.rawData.hbLines.filter((l: any) => l.state === 'open' && !l.packageNumber);
      const pkg = await step(`pack ${open.orderNumber}`, () => client.createPackage({ lineItemRequests: lines.map((l: any) => ({ id: l.id, quantity: l.quantity })) }));
      console.log(`  package: ${JSON.stringify(pkg)}`);
    } else console.log('  (no open order to pack)');
  }

  if (args.has('--label')) {
    const packed = orders.find((o) => o.rawData.packageNumber);
    if (packed) {
      const label = await step(`label ${packed.rawData.packageNumber}`, () => fetchLabel(client, packed.rawData.packageNumber));
      if (label) {
        const file = `/tmp/hb-label-${packed.rawData.packageNumber}.pdf`;
        fs.writeFileSync(file, label.data);
        console.log(`  wrote ${file} (${label.data.length} bytes, ${label.format})`);
      }
    } else console.log('  (no packaged order for a label)');
  }

  if (args.has('--questions')) {
    const counts = await step('question counts', () => client.questionCounts());
    console.log(`  ${JSON.stringify(counts)}`);
    await step('questions', () => client.listQuestions({ page: 1, size: 5 }));
  }

  await step('claims', () => client.listClaims({ begin: new Date(Date.now() - 7 * 864e5), end: new Date(), limit: 10 }));
  await step('finance transactions', () => client.listTransactions({ recordStart: new Date(Date.now() - 7 * 864e5), recordEnd: new Date(), limit: 10 }));
}

main().catch((err) => {
  console.error(hbErrorMessage(err));
  process.exit(1);
});
