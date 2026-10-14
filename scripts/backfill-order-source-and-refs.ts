/**
 * W4 backfill: Order.source (from the rawData shape), Etsy shipByAt / shippedAt,
 * and OrderItem.listingRef / variantRef / variantValueKey for direct Etsy
 * orders (from rawData.transactions, matched by transaction_id = line key).
 *
 * Dry-run by default; prints counts only.
 *   npx tsx scripts/backfill-order-source-and-refs.ts [--user=<id>] [--limit=N]
 *   KX_ALLOW_PROD_WRITE=1 npx tsx scripts/backfill-order-source-and-refs.ts --apply --db-host=<host>
 */
import { runSafeDbScript } from './lib/safeDb';
import { etsyVariantKeys } from '../lib/etsy/variantKey';

function sourceFromRaw(o: { marketplace: string; marketplaceKey: string; rawData: any }): string | null {
  const raw = o.rawData && typeof o.rawData === 'object' ? o.rawData : null;
  const m = (o.marketplace || '').toLowerCase();
  if (raw?.receipt_id !== undefined && String(raw.receipt_id) === o.marketplaceKey) return 'etsy-api';
  if (raw?.channel && (raw?.deliver_to || raw?.line_items || raw?.allocations)) return 'veeqo';
  if (raw?.object_id && (raw?.shop_app !== undefined || raw?.order_status !== undefined)) return 'shippo';
  if (raw?.orderId && raw?.creationDate) return 'ebay-api';
  if (raw?.AmazonOrderId || raw?.['amazon-order-id'] || m === 'amazon' || m.includes('fba')) return 'amazon';
  if (m === 'trendyol') return 'trendyol';
  if (m === 'wix') return 'wix';
  if (m === 'shopify') return 'shopify';
  if (m === 'manual') return 'manual';
  if (m === 'ebay') return 'ebay-api';
  return null;
}

function shipBy(raw: any): Date | null {
  const txs = Array.isArray(raw?.transactions) ? raw.transactions : [];
  const s = txs.map((t: any) => Number(t?.expected_ship_date)).filter((n: number) => Number.isFinite(n) && n > 0);
  return s.length ? new Date(Math.min(...s) * 1000) : null;
}

function shippedAt(raw: any): Date | null {
  const ships = Array.isArray(raw?.shipments) ? raw.shipments : [];
  const s = ships.map((x: any) => Number(x?.shipment_notification_timestamp)).filter((n: number) => Number.isFinite(n) && n > 0);
  return s.length ? new Date(Math.min(...s) * 1000) : null;
}

void runSafeDbScript('backfill-order-source-and-refs', async ({ prisma, write, args, count }) => {
  let cursor: string | undefined;
  let seen = 0;
  for (;;) {
    const rows = await prisma.order.findMany({
      where: { ...(args.userId ? { userId: args.userId } : {}), OR: [{ source: null }, { source: 'etsy-api', shipByAt: null }] },
      select: { id: true, marketplace: true, marketplaceKey: true, rawData: true, source: true, shipByAt: true, shippedAt: true, status: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const o of rows) {
      seen++;
      const src = o.source ?? sourceFromRaw(o as any);
      count(`orders.source.${src ?? 'unknown'}`);
      const data: Record<string, any> = {};
      if (!o.source && src) data.source = src;
      if (src === 'etsy-api') {
        const raw: any = o.rawData;
        const sb = shipBy(raw);
        if (!o.shipByAt && sb) data.shipByAt = sb;
        const sh = shippedAt(raw);
        if (!o.shippedAt && sh && /shipped|delivered|completed/i.test(o.status || '')) data.shippedAt = sh;

        const txById = new Map<string, any>();
        for (const tx of Array.isArray(raw?.transactions) ? raw.transactions : []) if (tx?.transaction_id) txById.set(String(tx.transaction_id), tx);
        const items = await prisma.orderItem.findMany({
          where: { orderId: o.id, listingRef: null },
          select: { id: true, uniqueLineKey: true, remoteLineId: true },
        });
        for (const it of items) {
          const tx = txById.get(String(it.remoteLineId || it.uniqueLineKey || ''));
          if (!tx?.listing_id) {
            count('items.unmatched');
            continue;
          }
          const pairs = (Array.isArray(tx.variations) ? tx.variations : [])
            .filter((v: any) => Number.isFinite(Number(v?.property_id)) && v?.value_id !== null && v?.value_id !== undefined && v?.value_id !== '')
            .map((v: any) => ({ propertyId: Number(v.property_id), valueId: Number(v.value_id), value: v.formatted_value ?? null }));
          const keys = pairs.length ? etsyVariantKeys(pairs) : { variantKey: '', variantValueKey: '' };
          count('items.refs');
          if (write) {
            await prisma.orderItem.update({
              where: { id: it.id },
              data: { listingRef: String(tx.listing_id), variantRef: keys.variantKey, variantValueKey: keys.variantValueKey },
            });
          }
        }
      }
      if (Object.keys(data).length) {
        for (const k of Object.keys(data)) count(`orders.set.${k}`);
        if (write) await prisma.order.update({ where: { id: o.id }, data });
      }
      if (args.limit && seen >= args.limit) return;
    }
  }
});
