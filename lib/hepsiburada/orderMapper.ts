/**
 * Hepsiburada → UIOrder.
 *
 * HB's OMS is line-based and split across endpoints: open (unpacked) lines, packages awaiting shipment, shipped /
 * delivered / undelivered package lists (status only, no items), and cancelled lines. We key one KolayXport order
 * per HB `orderNumber` (stable across packing, unlike `packageNumber`), fold every source into an aggregate, then
 * map the aggregate once. Packages live in `rawData.packages` (barcode, cargo company, status) for labels/tracking.
 *
 * Pure: no I/O. Fixtures in test/hepsiburada.
 */
import type { UIOrder } from '@/lib/types';
import { parseHbIso } from './date';
import type {
  LineRepresentation,
  ExternalRawPackageRepresentation,
  PackageLine,
  CancelledOrderLineRepresentation,
  Money,
} from './generated/order';

export const HB_MARKETPLACE = 'Hepsiburada';
export const HB_SOURCE = 'hepsiburada';

/** Line/package state, most-advanced last. */
export type HbLineState = 'open' | 'packed' | 'shipped' | 'delivered' | 'undelivered' | 'cancelled' | 'returned';

const STATE_RANK: Record<HbLineState, number> = {
  open: 0, packed: 1, shipped: 2, undelivered: 3, delivered: 4, returned: 5, cancelled: 6,
};

/** HB's free-text status strings → our line state. Unknown → open (never hide a live order). */
export function hbLineState(raw: unknown): HbLineState {
  const s = String(raw ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (!s) return 'open';
  if (s.includes('cancel') || s === 'iptal') return 'cancelled';
  if (s.includes('return') || s.includes('claim') || s === 'iade') return 'returned';
  if (s.includes('undeliver') || s.includes('notdelivered')) return 'undelivered';
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('ship') || s.includes('intransit') || s.includes('transit') || s.includes('kargo')) return 'shipped';
  if (s.includes('unpack')) return 'open';
  if (s.includes('pack') || s.includes('readytoship') || s.includes('picking')) return 'packed';
  return 'open';
}

export interface HbAggLine {
  id: string;
  sku: string; // hbSku
  merchantSku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
  commission?: number;
  vatRate?: number;
  image?: string;
  variantInfo?: string;
  state: HbLineState;
  packageNumber?: string;
  dueDate?: string;
  customizedText?: string;
}

export interface HbAggPackage {
  packageNumber: string;
  barcode?: string;
  cargoCompany?: string;
  status: HbLineState;
  rawStatus?: string;
  deci?: number;
  shippedAt?: string;
  deliveredAt?: string;
  undeliveredReason?: string;
  trackingUrl?: string;
  /** HB's mutual barcode can be printed via /labels (HB-contracted cargo). */
  dueDate?: string;
}

export interface HbAddress {
  name?: string;
  address?: string;
  district?: string;
  town?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
  phone?: string;
  email?: string;
}

export interface HbOrderAggregate {
  orderNumber: string;
  orderId?: string;
  orderDate?: string;
  customerName?: string;
  customerId?: string;
  email?: string;
  address?: HbAddress;
  invoice?: unknown;
  lines: Map<string, HbAggLine>;
  packages: Map<string, HbAggPackage>;
}

const money = (m: Money | undefined | null): number => (m && typeof m.amount === 'number' ? m.amount : 0);
const cur = (...ms: Array<Money | undefined | null>): string => ms.find((m) => m?.currency)?.currency || 'TRY';

/** HB product image URLs are a template: `.../{size}/...`. */
export function hbImage(format: string | undefined | null, size = 500): string | undefined {
  if (!format || typeof format !== 'string') return undefined;
  return format.replace(/\{size\}/gi, String(size));
}

function variantOf(line: { properties?: Array<{ name?: string; value?: string }> }): string | undefined {
  const props = Array.isArray(line.properties) ? line.properties : [];
  const v = props.map((p) => [p?.name, p?.value].filter(Boolean).join(': ')).filter(Boolean).join(' - ');
  return v || undefined;
}

function customized(line: Record<string, any>): string | undefined {
  const parts = ['customizedText01', 'customizedText02', 'customizedText03', 'customizedText04', 'customizedTextX']
    .map((k) => line[k]).filter((x) => typeof x === 'string' && x.trim());
  return parts.length ? parts.join(' | ') : undefined;
}

export class HbOrderBook {
  readonly orders = new Map<string, HbOrderAggregate>();

  private agg(orderNumber: string): HbOrderAggregate {
    let a = this.orders.get(orderNumber);
    if (!a) {
      a = { orderNumber, lines: new Map(), packages: new Map() };
      this.orders.set(orderNumber, a);
    }
    return a;
  }

  private setLine(a: HbOrderAggregate, next: HbAggLine) {
    const prev = a.lines.get(next.id);
    if (!prev) { a.lines.set(next.id, next); return; }
    // Keep the most advanced state and any details the other source lacked.
    const state = STATE_RANK[next.state] >= STATE_RANK[prev.state] ? next.state : prev.state;
    a.lines.set(next.id, {
      ...prev,
      ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== '' && v !== 0)),
      state,
    } as HbAggLine);
  }

  /** Open lines (`/orders`) and order detail (`/orders/.../ordernumber/{n}`) items. */
  addLine(line: LineRepresentation, header?: { orderDate?: string; customerName?: string; customerId?: string; address?: any; invoice?: any; orderId?: string }) {
    const orderNumber = String(line.orderNumber ?? '').trim();
    if (!orderNumber || !line.id) return;
    const a = this.agg(orderNumber);
    a.orderId ??= line.orderId ?? header?.orderId;
    a.orderDate ??= line.orderDate ?? header?.orderDate;
    a.customerName ??= line.customerName ?? header?.customerName;
    a.customerId ??= line.customerId ?? header?.customerId;
    const addr = line.shippingAddress ?? header?.address;
    if (addr && !a.address) {
      a.address = {
        name: addr.name, address: addr.address, district: addr.district, town: addr.town, city: addr.city,
        postalCode: addr.postalCode, countryCode: addr.countryCode, phone: addr.phoneNumber || addr.alternatePhoneNumber, email: addr.email,
      };
      a.email ??= addr.email;
    }
    a.invoice ??= line.invoice ?? header?.invoice;
    const state = line.packageNumber && hbLineState(line.status) === 'open' ? 'packed' : hbLineState(line.status);
    this.setLine(a, {
      id: String(line.id),
      sku: line.sku || '',
      merchantSku: line.merchantSKU || '',
      name: line.name || 'Hepsiburada ürünü',
      quantity: line.quantity || 1,
      unitPrice: money(line.unitPrice),
      totalPrice: money(line.totalPrice),
      currency: cur(line.unitPrice, line.totalPrice),
      commission: line.commission ? money(line.commission) : undefined,
      vatRate: line.vatRate,
      image: hbImage(line.productImageUrlFormat),
      variantInfo: variantOf(line as any),
      state,
      packageNumber: line.packageNumber || undefined,
      dueDate: line.dueDate,
      customizedText: customized(line as any),
    });
    if (line.packageNumber) {
      this.setPackage(a, { packageNumber: line.packageNumber, barcode: line.barcode, cargoCompany: line.cargoCompanyModel?.name || line.cargoCompany, status: state, rawStatus: line.status, dueDate: line.dueDate, trackingUrl: line.cargoCompanyModel?.trackingUrl });
    }
  }

  private setPackage(a: HbOrderAggregate, next: HbAggPackage) {
    const prev = a.packages.get(next.packageNumber);
    if (!prev) { a.packages.set(next.packageNumber, next); return; }
    const status = STATE_RANK[next.status] >= STATE_RANK[prev.status] ? next.status : prev.status;
    a.packages.set(next.packageNumber, {
      ...prev,
      ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== '')),
      status,
    } as HbAggPackage);
  }

  /** Packed packages awaiting shipment (`/packages`). One package may hold lines of several orders. */
  addPackage(pkg: ExternalRawPackageRepresentation) {
    const packageNumber = String(pkg.packageNumber ?? '').trim();
    if (!packageNumber) return;
    const pkgState = hbLineState(pkg.status) === 'open' ? 'packed' : hbLineState(pkg.status);
    for (const item of (pkg.items || []) as PackageLine[]) {
      const orderNumber = String(item.orderNumber ?? '').trim();
      if (!orderNumber) continue;
      const a = this.agg(orderNumber);
      a.orderDate ??= item.orderDate ?? pkg.orderDate;
      a.customerName ??= pkg.customerName;
      a.customerId ??= pkg.customerId;
      a.email ??= pkg.email;
      if (!a.address) {
        a.address = {
          name: pkg.recipientName || pkg.customerName, address: pkg.shippingAddressDetail, district: pkg.shippingDistrict,
          town: pkg.shippingTown, city: pkg.shippingCity, countryCode: pkg.shippingCountryCode, phone: pkg.phoneNumber, email: pkg.email,
        };
      }
      const id = String(item.lineItemId ?? '').trim();
      if (id) {
        this.setLine(a, {
          id,
          sku: item.hbSku || '',
          merchantSku: item.merchantSku || '',
          name: item.productName || 'Hepsiburada ürünü',
          quantity: item.quantity || 1,
          unitPrice: money(item.merchantUnitPrice ?? item.price),
          totalPrice: money(item.merchantTotalPrice ?? item.totalPrice),
          currency: cur(item.merchantUnitPrice, item.price, item.totalPrice),
          commission: item.commission ? money(item.commission) : undefined,
          vatRate: item.vatRate,
          image: hbImage(item.productImageUrlFormat),
          variantInfo: variantOf(item as any),
          state: pkgState,
          packageNumber,
          dueDate: pkg.dueDate,
          customizedText: customized(item as any),
        });
      }
      this.setPackage(a, {
        packageNumber, barcode: pkg.barcode, cargoCompany: pkg.cargoCompany, status: pkgState, rawStatus: pkg.status,
        deci: pkg.totalDeci, dueDate: pkg.dueDate,
      });
    }
  }

  /** Shipped / delivered / undelivered lists: status for packages of orders we already know. */
  addPackageStatus(row: { OrderNumber?: string; OrderNumbers?: string[]; PackageNumber?: string; Barcode?: string; ShippedDate?: string; DeliveredDate?: string; UndeliveredDate?: string; UndeliveredReason?: string; Deci?: number }, state: 'shipped' | 'delivered' | 'undelivered') {
    const packageNumber = String(row.PackageNumber ?? '').trim();
    if (!packageNumber) return;
    const numbers = new Set([row.OrderNumber, ...(row.OrderNumbers || [])].filter((x): x is string => !!x));
    for (const orderNumber of numbers) {
      const a = this.agg(orderNumber);
      this.setPackage(a, {
        packageNumber, barcode: row.Barcode, status: state, deci: row.Deci,
        shippedAt: row.ShippedDate, deliveredAt: row.DeliveredDate, undeliveredReason: row.UndeliveredReason,
      });
      for (const line of a.lines.values()) {
        if (line.packageNumber === packageNumber && STATE_RANK[state] > STATE_RANK[line.state]) line.state = state;
      }
    }
  }

  addCancelled(row: CancelledOrderLineRepresentation) {
    const orderNumber = String(row.orderNumber ?? '').trim();
    const id = String(row.lineItemId ?? '').trim();
    if (!orderNumber || !id) return;
    const a = this.agg(orderNumber);
    const prev = a.lines.get(id);
    if (prev) { prev.state = 'cancelled'; return; }
    a.lines.set(id, {
      id, sku: row.sku || '', merchantSku: row.merchantSku || '', name: 'Hepsiburada ürünü', quantity: row.quantity || 1,
      unitPrice: 0, totalPrice: 0, currency: 'TRY', state: 'cancelled',
    });
  }

  /** Orders that only appeared in status lists (no line details yet) — the sync fetches their detail. */
  ordersMissingDetail(): string[] {
    return Array.from(this.orders.values())
      .filter((a) => !Array.from(a.lines.values()).some((l) => l.name !== 'Hepsiburada ürünü' || l.unitPrice > 0))
      .map((a) => a.orderNumber);
  }
}

/** Order-level state from its lines (ignoring cancelled lines unless all are). */
/** A line's state, advanced by its package's state (status lists may arrive before the line detail). */
export function lineState(a: HbOrderAggregate, l: HbAggLine): HbLineState {
  if (l.state === 'cancelled') return 'cancelled';
  const pkg = l.packageNumber ? a.packages.get(l.packageNumber) : undefined;
  return pkg && pkg.status !== 'cancelled' && STATE_RANK[pkg.status] > STATE_RANK[l.state] ? pkg.status : l.state;
}

export function orderState(a: HbOrderAggregate): HbLineState {
  const lines = Array.from(a.lines.values()).map((l) => ({ ...l, state: lineState(a, l) }));
  if (!lines.length) {
    const pk = Array.from(a.packages.values());
    if (!pk.length) return 'open';
    return pk.reduce<HbLineState>((m, p) => (STATE_RANK[p.status] < STATE_RANK[m] ? p.status : m), 'cancelled');
  }
  const live = lines.filter((l) => l.state !== 'cancelled');
  if (!live.length) return 'cancelled';
  // The least-advanced live line decides (an order is shipped only when every live line is).
  return live.reduce<HbLineState>((m, l) => (STATE_RANK[l.state] < STATE_RANK[m] ? l.state : m), 'returned');
}

const APP_STATUS: Record<HbLineState, string> = {
  open: 'AWAITING_FULFILLMENT',
  packed: 'AWAITING_FULFILLMENT',
  shipped: 'SHIPPED',
  undelivered: 'SHIPPED',
  delivered: 'DELIVERED',
  returned: 'CANCELLED',
  cancelled: 'CANCELLED',
};

/** Display/raw status kept in Order.externalStatus (HB's own vocabulary, normalised). */
const EXTERNAL_STATUS: Record<HbLineState, string> = {
  open: 'Open',
  packed: 'Packaged',
  shipped: 'Shipped',
  undelivered: 'Undelivered',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export function toUIOrder(a: HbOrderAggregate): UIOrder {
  const state = orderState(a);
  const lines = Array.from(a.lines.values());
  const dueDates = lines.map((l) => parseHbIso(l.dueDate)).filter(Boolean) as string[];
  const shipBy = dueDates.sort()[0] ?? Array.from(a.packages.values()).map((p) => parseHbIso(p.dueDate)).filter(Boolean).sort()[0];
  const orderDate = parseHbIso(a.orderDate);
  const live = lines.filter((l) => l.state !== 'cancelled');
  const total = (live.length ? live : lines).reduce((s, l) => s + (l.totalPrice || l.unitPrice * l.quantity), 0);
  const addr = a.address || {};
  const street1 = [addr.address, addr.district].filter(Boolean).join(', ');
  const customerName = a.customerName || addr.name || '';
  const packages = Array.from(a.packages.values());
  const activePackage = packages.find((p) => p.status !== 'cancelled') ?? packages[0];

  const line_items = lines.map((l) => ({
    id: l.id,
    title: l.name,
    value: l.unitPrice,
    quantity: l.quantity,
    weight: 0.5,
    sku: l.merchantSku || l.sku,
    image: l.image || '',
    variantInfo: [l.variantInfo, l.customizedText].filter(Boolean).join(' · '),
    shipBy: parseHbIso(l.dueDate) ?? shipBy,
  }));

  return {
    id: a.orderNumber,
    marketplaceKey: a.orderNumber,
    orderNumber: a.orderNumber,
    customerName,
    uiOrderDate: orderDate,
    marketplaceOrderDate: orderDate,
    shipByDate: shipBy,
    line_items,
    status: APP_STATUS[state],
    externalStatus: EXTERNAL_STATUS[state],
    currency: lines.find((l) => l.currency)?.currency || 'TRY',
    totalPrice: Math.round(total * 100) / 100,
    source: HB_SOURCE as UIOrder['source'],
    channel: HB_SOURCE as UIOrder['channel'],
    marketplace: HB_MARKETPLACE,
    shippingAddress: addr.address ? [addr.name, street1, addr.town, addr.city, addr.countryCode || 'TR'].filter(Boolean).join(', ') : null,
    to_address: {
      name: addr.name || customerName,
      phone: addr.phone || '',
      street1,
      street2: '',
      city: addr.city || '',
      state: addr.town || '',
      postal: addr.postalCode || '',
      country: addr.countryCode || 'TR',
      isResidential: true,
      email: addr.email || a.email || '',
    },
    commodityDesc: line_items[0]?.title || '',
    recipientEmail: addr.email || a.email || '',
    rawData: {
      hepsiburada: true,
      orderNumber: a.orderNumber,
      orderId: a.orderId,
      customerId: a.customerId,
      customerEmail: addr.email || a.email || null,
      address: a.address ?? null,
      invoice: a.invoice ?? null,
      packages,
      // Fields the shared order views read for marketplace cargo (lib/orders/toOrderRows.ts).
      cargoTrackingNumber: activePackage?.barcode ?? null,
      cargoProviderName: activePackage?.cargoCompany ?? null,
      packageNumber: activePackage?.packageNumber ?? null,
      // Not `lines`: lib/stock/orderKey.ts detects Trendyol by raw.orderNumber + raw.lines.
      hbLines: lines.map((l) => ({ id: l.id, hbSku: l.sku, merchantSku: l.merchantSku, quantity: l.quantity, state: lineState(a, l), packageNumber: l.packageNumber ?? null, commission: l.commission ?? null })),
    },
  } as UIOrder;
}
