/**
 * Trendyol cargo on a stored Trendyol order: Trendyol's common label (ZPL, Trendyol Express / Aras on Trendyol-paid
 * cargo), our own PDF cargo label for every order (Code 128 of the cargo number), and the package statuses the
 * seller reports (Picking → Invoiced). Reads the raw shipment package kept in `Order.rawData` (lib/mappers/trendyol.ts).
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createTrendyolClient, type TrendyolApiClient } from '@/lib/integrations/trendyolApiClient';
import type { CargoLabelInput, CargoLabelParty } from '@/lib/shipping/cargoLabelPdf';
import { trendyolCargoInfo as cargoInfoOf, type TrendyolCargoInfo as CargoInfo } from './cargoInfo';

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
  } catch (err) {
    // Not enabled for this seller: every further call fails the same way.
    if (isCommonLabelNotAllowed(err)) throw err;
  }
  try {
    await client.createCommonLabel(cargoNumber, { boxQuantity });
  } catch (err: any) {
    if (isCommonLabelNotAllowed(err)) throw err;
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

/**
 * Sender: the seller's default Trendyol shipment address, else the KolayXport shipper profile. Trendyol's address
 * carries no name, so the name comes from the shipper profile (company) when Trendyol has none.
 */
export async function senderOf(client: TrendyolApiClient | null, userId: string): Promise<CargoLabelParty | null> {
  const p = await prisma.shipperProfile.findUnique({ where: { userId } });
  const profileName = (p?.shipperName || p?.shipperPersonName || '').trim();
  const fromTrendyol = await trendyolSender(client, userId);
  if (fromTrendyol) return { ...fromTrendyol, name: fromTrendyol.name || profileName, phone: fromTrendyol.phone || p?.shipperPhoneNumber || null };
  if (!p?.shipperName && !p?.shipperStreet1) return null;
  return {
    name: profileName,
    lines: [[p.shipperStreet1, p.shipperStreet2].filter(Boolean).join(' '), [p.shipperCity, p.shipperPostalCode].filter(Boolean).join(' ')].filter(Boolean),
    phone: p.shipperPhoneNumber || null,
  };
}

async function trendyolSender(client: TrendyolApiClient | null, userId: string): Promise<CargoLabelParty | null> {
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
  return null;
}

/** Trendyol error body → its own message ("errors[0].title" / "message"), or ''. */
export function trendyolErrorText(err: any): { code: string; text: string } {
  const b = err?.body;
  const e0 = Array.isArray(b?.error?.errors) ? b.error.errors[0] : Array.isArray(b?.errors) ? b.errors[0] : null;
  return {
    code: String(e0?.type || e0?.key || b?.error?.type || ''),
    text: String(e0?.title || e0?.message || b?.message || b?.error?.message || '').trim(),
  };
}

/** Trendyol refuses the common label for sellers it has not enabled (kategori sorumlusu turns it on). */
export function isCommonLabelNotAllowed(err: any): boolean {
  return trendyolErrorText(err).code === 'COMMON_LABEL_NOT_ALLOWED';
}

export function contentsOf(raw: Record<string, any>): string | null {
  const lines: any[] = Array.isArray(raw.lines) ? raw.lines : [];
  if (!lines.length) return null;
  return lines.map((l) => `${Number(l?.quantity) || 1} × ${l?.productName || l?.merchantSku || ''}`.trim()).join(', ').slice(0, 240);
}

export const CARGO_LABEL_CAPTIONS = {
  tr: { recipient: 'Alıcı', sender: 'Gönderen', order: 'Sipariş', package: 'Paket', contents: 'İçerik', deci: 'Desi' },
  en: { recipient: 'Recipient', sender: 'Sender', order: 'Order', package: 'Package', contents: 'Contents', deci: 'Deci' },
};

/** The PDF cargo label of one stored Trendyol order (single label route and bulk). */
export function cargoLabelInputOf(
  order: { orderNumber?: string | null },
  raw: Record<string, any>,
  info: CargoInfo,
  sender: CargoLabelParty | null,
  locale: 'tr' | 'en',
): CargoLabelInput {
  return {
    carrier: info.carrier || 'Trendyol',
    cargoNumber: info.cargoNumber || '',
    marketplace: 'Trendyol',
    orderNumber: order.orderNumber || String(raw.orderNumber || ''),
    packageId: info.packageId,
    recipient: recipientOf(raw),
    sender,
    contents: contentsOf(raw),
    deci: Number(raw.cargoDeci) || null,
    t: CARGO_LABEL_CAPTIONS[locale],
  };
}

/** Seller opted in to "report Picking when a cargo label is printed" (Settings › Sender › Trendyol). */
export async function autoPickingEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { shippingSettings: true } });
  return !!(user?.shippingSettings as any)?.trendyolAutoPicking;
}

/**
 * Best effort: report Picking for a Created package when the seller opted in. Never fails the label.
 * `enabled` skips the settings read when the caller already has it (bulk).
 */
export async function autoPicking(userId: string, orderId: string, raw: Record<string, any>, client: TrendyolApiClient | null, enabled?: boolean) {
  if (!client) return;
  const info = cargoInfoOf(raw);
  if (info.nextStatus !== 'Picking' || !info.packageId || !info.lines.length) return;
  if (!(enabled ?? (await autoPickingEnabled(userId)))) return;
  try {
    await client.updatePackageStatus(info.packageId, info.lines, 'Picking');
    await prisma.order.update({
      where: { id: orderId },
      data: { externalStatus: 'Picking', rawData: { ...raw, status: 'Picking' } as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    logger.warn('[TRENDYOL CARGO] auto Picking failed', { userId, orderId, ...trendyolErrorText(err) });
  }
}

/**
 * Mark cargo labels printed (bulk printing skips these). Only rows still unmarked and owned by `userId`;
 * returns how many rows changed.
 */
export async function markCargoLabelsPrinted(userId: string, orderIds: readonly string[], at = new Date()): Promise<number> {
  if (!orderIds.length) return 0;
  const res = await prisma.order.updateMany({
    where: { id: { in: [...orderIds] }, userId, cargoLabelPrintedAt: null },
    data: { cargoLabelPrintedAt: at },
  });
  return res.count;
}

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
