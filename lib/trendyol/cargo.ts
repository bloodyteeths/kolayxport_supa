/**
 * Trendyol cargo on a stored Trendyol order: Trendyol's common label (ZPL, Trendyol Express / Aras on Trendyol-paid
 * cargo), our own PDF cargo label for every order (Code 128 of the cargo number), and the package statuses the
 * seller reports (Picking → Invoiced). Reads the raw shipment package kept in `Order.rawData` (lib/mappers/trendyol.ts).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createTrendyolClient, type TrendyolApiClient } from '@/lib/integrations/trendyolApiClient';
import type { CargoLabelParty } from '@/lib/shipping/cargoLabelPdf';

export async function trendyolClientFor(userId: string): Promise<TrendyolApiClient | null> {
  const cred = await prisma.credential.findUnique({
    where: { userId },
    select: { trendyolSupplierId: true, trendyolApiKey: true, trendyolApiSecret: true },
  });
  if (!cred?.trendyolSupplierId || !cred.trendyolApiKey || !cred.trendyolApiSecret) return null;
  return createTrendyolClient(cred);
}

export async function loadTrendyolOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId, marketplace: { equals: 'Trendyol', mode: 'insensitive' } } });
  if (!order) return null;
  const raw = (order.rawData || {}) as Record<string, any>;
  return { order, raw };
}

export { trendyolCargoInfo, type TrendyolCargoInfo } from './cargoInfo';

/** Create (idempotently) and read Trendyol's common label. Returns ZPL documents, one per parcel. */
export async function fetchCommonLabel(client: TrendyolApiClient, cargoNumber: string, boxQuantity = 1): Promise<string[]> {
  const read = async () => ((await client.getCommonLabel(cargoNumber))?.data || []).map((d) => d?.label || '').filter(Boolean);
  try {
    const existing = await read();
    if (existing.length) return existing;
  } catch { /* not created yet */ }
  try {
    await client.createCommonLabel(cargoNumber, { boxQuantity });
  } catch (err: any) {
    // 409/400 "already requested" is fine; anything else means no common label for this package.
    if (err?.status !== 409 && err?.status !== 400) throw err;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    try {
      const docs = await read();
      if (docs.length) return docs;
    } catch (err: any) {
      if (err?.status && err.status !== 404) throw err;
    }
  }
  throw Object.assign(new Error('Trendyol has not produced the common label yet; try again in a minute'), { status: 409 });
}

/** Recipient from the raw package's shipmentAddress. */
export function recipientOf(raw: Record<string, any>): CargoLabelParty {
  const a = raw.shipmentAddress || {};
  const name = a.fullName || [a.firstName, a.lastName].filter(Boolean).join(' ') || [raw.customerFirstName, raw.customerLastName].filter(Boolean).join(' ') || '';
  const street = [a.address1, a.address2].filter(Boolean).join(' ') || a.fullAddress || '';
  const area = [a.neighborhood, a.district, a.city].filter(Boolean).join(' / ');
  return { name, lines: [street, [area, a.postalCode].filter(Boolean).join(' ')].filter(Boolean), phone: a.phone || null };
}

/** Sender: the seller's default Trendyol shipment address, else the KolayXport shipper profile. */
export async function senderOf(client: TrendyolApiClient | null, userId: string): Promise<CargoLabelParty | null> {
  if (client) {
    try {
      const res: any = await client.getAddresses();
      const list: any[] = Array.isArray(res?.supplierAddresses) ? res.supplierAddresses : [];
      const a = res?.defaultShipmentAddress || list.find((x) => /shipment/i.test(String(x?.addressType)) && x?.default) || list.find((x) => /shipment/i.test(String(x?.addressType))) || list[0];
      if (a) {
        return {
          name: a.fullName || a.name || a.companyName || '',
          lines: [a.address || a.fullAddress || '', [a.district, a.city].filter(Boolean).join(' / ')].filter(Boolean),
          phone: a.phone || null,
        };
      }
    } catch (err) {
      logger.warn('[TRENDYOL CARGO] supplier addresses failed', { userId, error: (err as Error)?.message });
    }
  }
  const p = await prisma.shipperProfile.findUnique({ where: { userId } });
  if (!p?.shipperName && !p?.shipperStreet1) return null;
  return {
    name: p.shipperName || p.shipperPersonName || '',
    lines: [[p.shipperStreet1, p.shipperStreet2].filter(Boolean).join(' '), [p.shipperCity, p.shipperPostalCode].filter(Boolean).join(' ')].filter(Boolean),
    phone: p.shipperPhoneNumber || null,
  };
}

export function contentsOf(raw: Record<string, any>): string | null {
  const lines: any[] = Array.isArray(raw.lines) ? raw.lines : [];
  if (!lines.length) return null;
  return lines.map((l) => `${Number(l?.quantity) || 1} × ${l?.productName || l?.merchantSku || ''}`.trim()).join(', ').slice(0, 240);
}
