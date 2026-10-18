/**
 * Hepsiburada fulfilment on one stored order: pack open lines, fetch HB's mutual cargo label ("ortak barkod"),
 * own-cargo in-transit, invoice link. Works from `Order.rawData` written by the order mapper
 * (`hbLines`, `packages`, `packageNumber`).
 */
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import type { HepsiburadaClient } from './client';
import { HB_MARKETPLACE } from './orderMapper';

export interface HbStoredLine { id: string; quantity: number; state: string; packageNumber: string | null }

export async function loadHbOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId, marketplace: HB_MARKETPLACE } });
  if (!order) return null;
  const raw = (order.rawData || {}) as Record<string, any>;
  const lines: HbStoredLine[] = Array.isArray(raw.hbLines) ? raw.hbLines : [];
  return { order, raw, lines };
}

/** Lines that still need a package: open state, no package yet. */
export function unpackedLines(lines: HbStoredLine[]): HbStoredLine[] {
  return lines.filter((l) => l.state === 'open' && !l.packageNumber && l.id);
}

/** Pack every unpacked line of the order into one package (HB rejects lines that cannot share one). */
export async function packOrder(client: HepsiburadaClient, userId: string, orderId: string): Promise<{ packageNumber: string; barcode?: string } | null> {
  const loaded = await loadHbOrder(userId, orderId);
  if (!loaded) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (loaded.raw.packageNumber && !unpackedLines(loaded.lines).length) {
    return { packageNumber: String(loaded.raw.packageNumber), barcode: loaded.raw.cargoTrackingNumber ?? undefined };
  }
  const todo = unpackedLines(loaded.lines);
  if (!todo.length) return null;
  const res = await client.createPackage({ lineItemRequests: todo.map((l) => ({ id: l.id, quantity: l.quantity })) });
  const packageNumber = res?.packageNumber ? String(res.packageNumber) : '';
  if (!packageNumber) throw new Error('Hepsiburada did not return a package number');

  // Reflect it locally right away; the next order sync brings the full package.
  const raw = loaded.raw;
  const hbLines = loaded.lines.map((l) => (todo.some((t) => t.id === l.id) ? { ...l, state: 'packed', packageNumber } : l));
  const packages = [...(Array.isArray(raw.packages) ? raw.packages : []), { packageNumber, barcode: res.barcode, status: 'packed' }];
  await prisma.order.update({
    where: { id: orderId },
    data: {
      externalStatus: 'Packaged',
      rawData: { ...raw, hbLines, packages, packageNumber, cargoTrackingNumber: res.barcode ?? raw.cargoTrackingNumber ?? null } as unknown as Prisma.InputJsonValue,
    },
  });
  return { packageNumber, barcode: res.barcode };
}

/** HB label documents for a package → one Buffer (first document; HB returns one per parcel). */
export async function fetchLabel(client: HepsiburadaClient, packageNumber: string, format: 'PDF' | 'ZPL' = 'PDF'): Promise<{ data: Buffer; format: string; all: Buffer[] }> {
  const res = await client.getLabel(packageNumber, format);
  const docs = (res?.data || []).filter((d) => typeof d === 'string' && d.length);
  if (!docs.length) throw Object.assign(new Error('Hepsiburada returned no label for this package'), { status: 404 });
  const all = docs.map((d) => Buffer.from(d.replace(/^data:[^,]+,/, ''), 'base64'));
  return { data: all[0], format: res?.format || format, all };
}

/** Own-cargo only: report the shipment to HB and store tracking locally. */
export async function markInTransit(
  client: HepsiburadaClient,
  userId: string,
  orderId: string,
  input: { trackingNumber: string; trackingUrl?: string; carrier?: string; shippedAt?: Date },
) {
  const loaded = await loadHbOrder(userId, orderId);
  if (!loaded) throw Object.assign(new Error('Order not found'), { status: 404 });
  const packageNumber = loaded.raw.packageNumber;
  if (!packageNumber) throw Object.assign(new Error('Order has no Hepsiburada package yet'), { status: 409 });
  await client.markInTransit(String(packageNumber), {
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl,
    shippedDate: (input.shippedAt ?? new Date()).toISOString(),
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { trackingNumber: input.trackingNumber, shippedAt: input.shippedAt ?? new Date(), externalStatus: 'Shipped', status: 'SHIPPED' },
  });
  logger.info('[HEPSIBURADA] package marked in transit', { userId, orderId, packageNumber });
}

export async function addInvoiceLink(client: HepsiburadaClient, userId: string, orderId: string, invoiceLink: string) {
  const loaded = await loadHbOrder(userId, orderId);
  if (!loaded) throw Object.assign(new Error('Order not found'), { status: 404 });
  const packageNumber = loaded.raw.packageNumber;
  if (!packageNumber) throw Object.assign(new Error('Order has no Hepsiburada package yet'), { status: 409 });
  await client.addInvoice(String(packageNumber), { invoiceLink });
}
