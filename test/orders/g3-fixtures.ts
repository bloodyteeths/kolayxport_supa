// M3 orders-G3: OrderRow fixtures for the OrderPanel tests (shape = lib/orders/types.ts).
import type { OrderRow, ShipTo } from '@/lib/orders/types';

export const SHIP_TO_US: ShipTo = {
  name: 'Sarah Miller',
  firstName: 'Sarah',
  lastName: 'Miller',
  phone: '+15550134',
  email: 'sarah@example.com',
  country: 'US',
  street1: '12 Oak St',
  street2: 'Apt 4',
  city: 'Austin',
  state: 'TX',
  postal: '78701',
  district: '',
  neighbourhood: '',
  missing: [],
  unavailable: false,
  nameHidden: false,
  enrichedFromEtsy: false,
};

export function makeRow(over: Partial<OrderRow> = {}): OrderRow {
  const base: OrderRow = {
    id: 'o1',
    orderNumber: '3891',
    marketplace: 'BelleCoutureGifts',
    store: { key: 'etsy:bellecouturegifts', marketplace: 'etsy', shopName: 'BelleCoutureGifts' },
    storeName: 'BelleCoutureGifts',
    isManual: false,
    orderedAt: '2026-10-13T18:12:00.000Z',
    importedAt: '2026-10-13T18:20:00.000Z',
    shipBy: '2099-10-20T20:59:00.000Z',
    shippedAt: null,
    shippingUpgrade: 'Express',
    total: 169.99,
    currency: 'USD',
    buyerName: 'Sarah Miller',
    items: [
      {
        id: 'i1', title: 'Personalized Baby Blanket', listingUrl: 'https://www.etsy.com/listing/1', variant: 'Pink', sku: 'BB-PINK',
        quantity: 2, unitPrice: 69.99, image: null, personalization: 'LENA – 03.10.2026', weightKg: 0.4, hsCode: null, originCountry: 'TR', shipBy: null,
      },
      {
        id: 'i2', title: 'Gift wrap', listingUrl: null, variant: null, sku: null,
        quantity: 1, unitPrice: 5, image: null, personalization: null, weightKg: null, hsCode: null, originCountry: null, shipBy: null,
      },
    ],
    shipTo: SHIP_TO_US,
    giftMessage: 'Congratulations on your little girl!',
    buyerNote: null,
    note: 'Use the pink ribbon.',
    status: { domain: 'order', key: 'to_ship', raw: 'paid' },
    rawStatus: 'paid',
    label: null,
    labelFailure: null,
    marketplaceCargoNumber: null,
    trackingSubmission: null,
    carrierCost: null,
    isFBA: false,
    isMCF: false,
    canLabel: true,
    marketplaceUrl: 'https://www.etsy.com/your/orders/sold?order_id=3891',
    history: [
      { kind: 'ordered', at: '2026-10-13T18:12:00.000Z' },
      { kind: 'imported', at: '2026-10-13T18:20:00.000Z' },
    ],
    raw: { id: 'o1', marketplace: 'BelleCoutureGifts', orderNumber: '3891' },
  };
  return { ...base, ...over };
}

export function labeledRow(over: Partial<OrderRow> = {}): OrderRow {
  return makeRow({
    canLabel: false,
    status: { domain: 'order', key: 'label_created', raw: 'paid' },
    label: { source: 'shipment', shipmentId: 's1', carrier: 'UPS', trackingNumber: '1Z999AA10123456784', labelHref: 'https://x.test/label.pdf', createdAt: '2026-10-14T08:00:00.000Z' },
    trackingSubmission: { state: 'queued', trackingNumber: '1Z999AA10123456784', carrierName: 'UPS', submittedAt: '2026-10-14T08:01:00.000Z', deliveredAt: null, error: null },
    ...over,
  });
}

export function fbaRow(over: Partial<OrderRow> = {}): OrderRow {
  return makeRow({
    id: 'o9',
    orderNumber: '113-1234567-7654321',
    marketplace: 'Amazon',
    store: { key: 'amazon', marketplace: 'amazon', shopName: null },
    storeName: 'Amazon',
    isFBA: true,
    canLabel: false,
    status: { domain: 'order', key: 'to_ship', raw: 'Unshipped', reason: 'fba' },
    marketplaceUrl: null,
    ...over,
  });
}
