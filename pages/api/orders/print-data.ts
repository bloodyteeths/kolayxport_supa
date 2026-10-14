import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { PRINT_MAX_IDS } from '@/components/print/types';
import type { PrintDataResponse, PrintOrder, PrintAddress, PrintItem } from '@/components/print/types';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function parseJson(value: unknown): any {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return { fullAddress: trimmed }; }
  }
  return { fullAddress: trimmed };
}

/**
 * Parse ids from `?ids=a,b,c` or repeated `?ids=a&ids=b`. Malformed ids are
 * not queried but are counted in `rejected`, so they still show up as missing.
 */
export function parseIds(raw: string | string[] | undefined): { ids: string[]; rejected: number } {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const unique = Array.from(new Set(list.flatMap(v => String(v).split(',')).map(v => v.trim()).filter(Boolean)));
  const ids = unique.filter(v => /^[A-Za-z0-9_-]{1,64}$/.test(v));
  return { ids, rejected: unique.length - ids.length };
}

/**
 * Items stored only in rawData.line_items (Shippo/Etsy, Veeqo) — the same
 * fallback the labels page uses when the order has no OrderItem rows.
 */
function rawLineItems(orderId: string, rawData: unknown): PrintItem[] {
  const raw = parseJson(rawData);
  const lines = raw && Array.isArray(raw.line_items) ? raw.line_items : [];
  return lines
    .filter((li: unknown) => li && typeof li === 'object')
    .map((li: any, i: number): PrintItem => {
      const sellable = li.sellable && typeof li.sellable === 'object' ? li.sellable : null;
      const qty = Number(li.quantity);
      return {
        id: str(li.object_id) || str(li.id) || `${orderId}-raw-${i}`,
        sku: sellable ? str(sellable.sku_code) : str(li.sku),
        title: sellable ? str(sellable.full_title) || str(li.title) : str(li.title) || str(li.name),
        variation: str(li.variantInfo) || str(li.variant_title) || str(li.variation),
        quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1,
        note: str(li.notes),
        image: sellable
          ? str(sellable.image_url) || str(sellable.product?.main_image_src)
          : str(li.image) || str(li.image_url),
      };
    });
}

/**
 * Pick the most structured ship-to address available for an order. Mirrors the
 * precedence used by /api/orders (Trendyol shipmentAddress, rawData.to_address,
 * Wix nested destination, Order.shippingAddress) plus the OrderShipping row.
 */
function extractAddress(order: {
  marketplace: string;
  customerName: string | null;
  shippingAddress: unknown;
  rawData: unknown;
  shipping: null | {
    firstName: string; lastName: string | null; company: string | null; street1: string; street2: string | null;
    city: string; state: string | null; postalCode: string; countryCode: string; phone: string;
  };
}): PrintAddress {
  const raw = parseJson(order.rawData) || {};
  const isTrendyol = /trendyol/i.test(order.marketplace);

  if (isTrendyol && raw.shipmentAddress && typeof raw.shipmentAddress === 'object') {
    const a = raw.shipmentAddress;
    return {
      name: str(a.fullName) || `${str(a.firstName)} ${str(a.lastName)}`.trim(),
      street1: str(a.address1),
      street2: str(a.address2),
      neighborhood: str(a.neighborhood),
      district: str(a.district),
      city: str(a.city),
      state: str(a.stateName),
      postal: str(a.postalCode),
      country: str(a.countryCode) || 'TR',
      phone: str(a.phone),
    };
  }
  if (raw.to_address && typeof raw.to_address === 'object') {
    return { ...raw.to_address } as PrintAddress;
  }
  const wixDest = raw.shippingInfo?.logistics?.shippingDestination;
  if (wixDest?.address && typeof wixDest.address === 'object') {
    const w = wixDest.address;
    const c = wixDest.contactDetails || raw.billingInfo?.contactDetails || {};
    return {
      name: `${str(c.firstName)} ${str(c.lastName)}`.trim(),
      phone: str(c.phone),
      street1: str(w.addressLine) || str(w.addressLine1),
      street2: str(w.addressLine2),
      city: str(w.city),
      state: str(w.subdivisionFullname) || str(w.subdivision),
      postal: str(w.postalCode),
      country: str(w.country),
    };
  }
  const stored = parseJson(order.shippingAddress);
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0) {
    return stored as PrintAddress;
  }
  if (order.shipping) {
    const s = order.shipping;
    return {
      firstName: s.firstName,
      lastName: s.lastName,
      company: s.company,
      street1: s.street1,
      street2: s.street2,
      city: s.city,
      state: s.state,
      postalCode: s.postalCode,
      countryCode: s.countryCode,
      phone: s.phone,
    };
  }
  return {};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<PrintDataResponse | { error: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

  const { ids, rejected } = parseIds(req.query.ids);
  if (ids.length + rejected > PRINT_MAX_IDS) return res.status(400).json({ error: `Too many orders (max ${PRINT_MAX_IDS})` });
  if (ids.length === 0 && rejected > 0) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ orders: [], missingCount: rejected, sender: null });
  }
  if (ids.length === 0) return res.status(400).json({ error: 'No order ids' });

  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const [orders, shipper] = await Promise.all([
      // userId in the WHERE clause is the ownership check: ids that belong to
      // another user simply do not come back and are reported as missing.
      prisma.order.findMany({
        where: { id: { in: ids }, userId: user.id },
        select: {
          id: true,
          orderNumber: true,
          marketplace: true,
          customerName: true,
          createdAt: true,
          uiOrderDate: true,
          shippingAddress: true,
          rawData: true,
          giftMessage: true,
          customerNote: true,
          shipping: {
            select: {
              firstName: true, lastName: true, company: true, street1: true, street2: true,
              city: true, state: true, postalCode: true, countryCode: true, phone: true,
            },
          },
          items: {
            select: {
              id: true,
              sku: true,
              productName: true,
              variantInfo: true,
              quantity: true,
              notes: true,
              image: true,
              product: { select: { imageUrl: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
      }),
      prisma.shipperProfile.findUnique({
        where: { userId: user.id },
        select: {
          shipperName: true, shipperPersonName: true, shipperStreet1: true, shipperStreet2: true,
          shipperCity: true, shipperStateCode: true, shipperPostalCode: true, shipperCountryCode: true,
          shipperPhoneNumber: true,
        },
      }),
    ]);

    const byId = new Map(orders.map(o => [o.id, o]));
    const result: PrintOrder[] = [];
    // Keep the caller's order (the selection order on the labels page).
    for (const id of ids) {
      const o = byId.get(id);
      if (!o) continue;
      result.push({
        id: o.id,
        orderNumber: o.orderNumber,
        marketplace: o.marketplace,
        customerName: o.customerName || '',
        orderDate: (o.uiOrderDate || o.createdAt).toISOString(),
        address: extractAddress(o),
        giftMessage: str(o.giftMessage),
        customerNote: str(o.customerNote),
        items: o.items.length > 0
          ? o.items.map(it => ({
              id: it.id,
              sku: str(it.sku),
              title: str(it.productName),
              variation: str(it.variantInfo),
              quantity: Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 1,
              note: str(it.notes),
              image: str(it.image) || str(it.product?.imageUrl),
            }))
          : rawLineItems(o.id, o.rawData),
      });
    }

    return res.status(200).json({
      orders: result,
      missingCount: ids.length - result.length + rejected,
      sender: shipper
        ? {
            name: str(shipper.shipperName) || str(shipper.shipperPersonName),
            personName: str(shipper.shipperPersonName),
            street1: str(shipper.shipperStreet1),
            street2: str(shipper.shipperStreet2),
            city: str(shipper.shipperCity),
            state: str(shipper.shipperStateCode),
            postal: str(shipper.shipperPostalCode),
            country: str(shipper.shipperCountryCode),
            phone: str(shipper.shipperPhoneNumber),
          }
        : null,
    });
  } catch (err) {
    console.error('[orders/print-data] failed', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Failed to load orders' });
  }
}
