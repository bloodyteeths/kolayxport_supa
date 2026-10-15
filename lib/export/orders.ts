/**
 * Order export (labels page): row mapping + CSV / XLSX / PDF writers.
 *
 * Pure apart from the file writers; the DB query lives in
 * pages/api/orders/export.ts. Address + line-item fallbacks follow the same
 * precedence as /api/orders/print-data (Trendyol shipmentAddress,
 * rawData.to_address, Wix nested destination, Order.shippingAddress,
 * OrderShipping row; rawData.line_items when there are no OrderItem rows).
 *
 * SECURITY: the "xlsx" package (SheetJS 0.18.5) is used for WRITING only.
 * Never parse user-supplied files with it (parse-time prototype pollution CVE).
 */
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import enMessages from '@/messages/en.json';
import trMessages from '@/messages/tr.json';
import { normalizeAddress, type CopyableAddress } from '@/lib/format/address';

export const EXPORT_MAX_ORDERS = 1000;
export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportLocale = 'tr' | 'en';

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === 'string' && (EXPORT_FORMATS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Input shape (what the API route selects from Prisma)
// ---------------------------------------------------------------------------

type DecimalLike = number | string | { toString(): string } | null | undefined;

export interface ExportSourceItem {
  sku?: string | null;
  productName?: string | null;
  variantInfo?: string | null;
  quantity?: number | null;
  unitPrice?: DecimalLike;
  totalPrice?: DecimalLike;
  notes?: string | null;
  recipientEmail?: string | null;
}

export interface ExportSourceOrder {
  id: string;
  orderNumber: string;
  marketplace: string;
  status?: string | null;
  labelStatus?: string | null;
  trackingNumber?: string | null;
  shippingLabelUrl?: string | null;
  currency?: string | null;
  totalPrice?: number | null;
  manualShippingCost?: DecimalLike;
  manualShippingCostCurrency?: string | null;
  customerName?: string | null;
  createdAt: Date | string;
  uiOrderDate?: Date | string | null;
  shippingAddress?: unknown;
  rawData?: unknown;
  items?: ExportSourceItem[];
  shipping?: null | {
    firstName: string; lastName: string | null; company: string | null; street1: string; street2: string | null;
    city: string; state: string | null; postalCode: string; countryCode: string; phone: string;
  };
  shipments?: Array<{ carrier?: string | null; status?: string | null; trackingNumber?: string | null; pdfUrl?: string | null }>;
  trackingSubmissions?: Array<{ carrierName?: string | null; trackingNumber?: string | null }>;
  senkronData?: { internalNote?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Output rows
// ---------------------------------------------------------------------------

export type LabelState = 'created' | 'not_created' | 'failed';

export interface ExportItemRow {
  sku: string;
  title: string;
  variation: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  note: string;
}

export interface ExportOrderRow {
  orderNumber: string;
  store: string;
  orderDateIso: string;
  orderDate: string;
  status: string;
  labelStatus: LabelState;
  carrier: string;
  trackingNumber: string;
  buyerName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  district: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  itemCount: number;
  itemsSummary: string;
  total: number | null;
  currency: string;
  shippingCost: number | null;
  shippingCostCurrency: string;
  privateNote: string;
  items: ExportItemRow[];
}

export const ORDER_COLUMNS = [
  'orderNumber', 'store', 'orderDateIso', 'orderDate', 'status', 'labelStatus', 'carrier', 'trackingNumber',
  'buyerName', 'email', 'phone', 'address1', 'address2', 'district', 'city', 'state', 'postalCode', 'country',
  'itemCount', 'itemsSummary', 'total', 'currency', 'shippingCost', 'shippingCostCurrency', 'privateNote',
] as const;
export type OrderColumn = (typeof ORDER_COLUMNS)[number];

export const ITEM_COLUMNS = [
  'orderNumber', 'store', 'orderDateIso', 'sku', 'title', 'variation', 'quantity', 'unitPrice', 'lineTotal',
  'currency', 'itemNote',
] as const;
export type ItemColumn = (typeof ITEM_COLUMNS)[number];

export type Cell = string | number | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const firstStr = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return '';
};

export function toNumber(v: DecimalLike): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseJson(value: unknown): any {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return { fullAddress: trimmed }; }
  }
  return { fullAddress: trimmed };
}

/** Same precedence as /api/orders/print-data extractAddress. */
export function pickAddress(order: ExportSourceOrder): CopyableAddress {
  const raw = parseJson(order.rawData) || {};
  if (/trendyol/i.test(order.marketplace) && raw.shipmentAddress && typeof raw.shipmentAddress === 'object') {
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
      email: str(raw.customerEmail),
    };
  }
  if (raw.to_address && typeof raw.to_address === 'object') return { ...raw.to_address };
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
      email: str(raw.buyerInfo?.email),
    };
  }
  const stored = parseJson(order.shippingAddress);
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0) {
    return stored as CopyableAddress;
  }
  if (order.shipping) {
    const s = order.shipping;
    return {
      firstName: s.firstName, lastName: s.lastName, company: s.company, street1: s.street1, street2: s.street2,
      city: s.city, state: s.state, postalCode: s.postalCode, countryCode: s.countryCode, phone: s.phone,
    };
  }
  return {};
}

/** OrderItem rows, or rawData.line_items (Shippo/Etsy, Veeqo) when there are none. */
export function pickItems(order: ExportSourceOrder): ExportItemRow[] {
  const qtyOf = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  };
  if (order.items && order.items.length > 0) {
    return order.items.map(it => {
      const quantity = qtyOf(it.quantity);
      const unitPrice = toNumber(it.unitPrice);
      const lineTotal = toNumber(it.totalPrice) ?? (unitPrice !== null ? Math.round(unitPrice * quantity * 100) / 100 : null);
      return {
        sku: str(it.sku),
        title: str(it.productName),
        variation: str(it.variantInfo),
        quantity,
        unitPrice,
        lineTotal,
        note: str(it.notes),
      };
    });
  }
  const raw = parseJson(order.rawData);
  const lines = raw && Array.isArray(raw.line_items) ? raw.line_items : [];
  return lines
    .filter((li: unknown) => li && typeof li === 'object')
    .map((li: any): ExportItemRow => {
      const sellable = li.sellable && typeof li.sellable === 'object' ? li.sellable : null;
      const quantity = qtyOf(li.quantity);
      const unitPrice = toNumber(li.price ?? li.unit_price ?? li.amount ?? null);
      return {
        sku: sellable ? str(sellable.sku_code) : str(li.sku),
        title: sellable ? str(sellable.full_title) || str(li.title) : str(li.title) || str(li.name),
        variation: str(li.variantInfo) || str(li.variant_title) || str(li.variation),
        quantity,
        unitPrice,
        lineTotal: unitPrice !== null ? Math.round(unitPrice * quantity * 100) / 100 : null,
        note: str(li.notes),
      };
    });
}

/** "2× SKU — title (variation)" per line, joined with "; ". */
export function summarizeItems(items: ExportItemRow[]): string {
  return items
    .map(it => {
      const name = [it.sku, it.title].filter(Boolean).join(' — ');
      return `${it.quantity}× ${name || '?'}${it.variation ? ` (${it.variation})` : ''}`;
    })
    .join('; ');
}

/** Mirrors the "has label" condition of /api/orders labelFilter=labeled. */
export function labelStateOf(order: ExportSourceOrder): LabelState {
  const hasShipment = (order.shipments || []).some(s => s.status === 'created' && (s.trackingNumber || s.pdfUrl));
  if (str(order.trackingNumber) || str(order.shippingLabelUrl) || order.labelStatus === 'created' || hasShipment) return 'created';
  if (order.labelStatus === 'failed') return 'failed';
  return 'not_created';
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Validated IANA zone, else Europe/Istanbul (most sellers are in Turkey). */
export function safeTimeZone(tz: unknown): string {
  const zone = typeof tz === 'string' && tz.length <= 64 ? tz : '';
  if (zone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return zone;
    } catch { /* fall through */ }
  }
  return 'Europe/Istanbul';
}

export function formatReadableDate(d: Date, locale: ExportLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** YYYY-MM-DD in the given zone (for the download file name). */
export function localIsoDay(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface MapOptions {
  locale?: ExportLocale;
  timeZone?: string;
}

export function mapOrderToExportRow(order: ExportSourceOrder, opts: MapOptions = {}): ExportOrderRow {
  const locale = opts.locale || 'tr';
  const timeZone = safeTimeZone(opts.timeZone);
  const raw = parseJson(order.rawData) || {};
  const addr = normalizeAddress(pickAddress(order));
  const items = pickItems(order);
  const date = toDate(order.uiOrderDate) || toDate(order.createdAt);

  const shipments = order.shipments || [];
  const submissions = order.trackingSubmissions || [];
  const createdShipment = shipments.find(s => s.status === 'created' && s.trackingNumber);
  const trackingNumber = firstStr(
    order.trackingNumber,
    createdShipment?.trackingNumber,
    submissions[0]?.trackingNumber,
    raw.cargoTrackingNumber,
  );
  const carrier = firstStr(
    createdShipment?.carrier,
    shipments[0]?.carrier,
    submissions[0]?.carrierName,
    raw.cargoProviderName,
    raw.carrier,
  );
  const email = firstStr(
    addr.email,
    raw.buyer_email,
    raw.buyerEmail,
    raw.customerEmail,
    raw.buyerInfo?.email,
    raw.customer?.email,
    raw.email,
    ...(order.items || []).map(i => i.recipientEmail),
  );

  return {
    orderNumber: str(order.orderNumber) || order.id,
    store: str(order.marketplace),
    orderDateIso: date ? date.toISOString() : '',
    orderDate: date ? formatReadableDate(date, locale, timeZone) : '',
    status: str(order.status),
    labelStatus: labelStateOf(order),
    carrier,
    trackingNumber,
    buyerName: firstStr(addr.name, order.customerName),
    email,
    phone: addr.phone,
    address1: firstStr(addr.street1, !addr.street1 && !addr.city ? addr.fullAddress : ''),
    address2: [addr.neighborhood && !addr.street1.toLocaleLowerCase('tr').includes(addr.neighborhood.toLocaleLowerCase('tr')) ? addr.neighborhood : '', addr.street2]
      .filter(Boolean)
      .join(', '),
    district: addr.district,
    city: addr.city,
    state: addr.state,
    postalCode: addr.postal,
    country: addr.country,
    itemCount: items.reduce((n, it) => n + it.quantity, 0),
    itemsSummary: summarizeItems(items),
    total: toNumber(order.totalPrice),
    currency: str(order.currency),
    shippingCost: toNumber(order.manualShippingCost),
    shippingCostCurrency: str(order.manualShippingCostCurrency),
    privateNote: str(order.senkronData?.internalNote),
    items,
  };
}

/**
 * Same duplicate rule as the /api/orders list (marketplace + order number):
 * keep the copy with real item prices, otherwise the first one.
 */
export function dedupeOrders<T extends ExportSourceOrder>(orders: T[]): T[] {
  const map = new Map<string, T>();
  const priced = (o: T) => (o.items || []).some(i => (toNumber(i.unitPrice) || 0) > 0);
  for (const o of orders) {
    // Same key as makeKey in pages/api/orders/index.ts: Order has no
    // marketplaceOrderId column, so the list's `marketplaceOrderId ?? orderNumber`
    // resolves to `orderNumber || id`.
    const key = `${(o.marketplace || '').toLowerCase()}-${o.orderNumber || o.id}`;
    const existing = map.get(key);
    if (!existing || (!priced(existing) && priced(o))) map.set(key, o);
  }
  // Preserve original ordering of the kept entries.
  const kept = new Set(map.values());
  return orders.filter(o => kept.has(o));
}

// ---------------------------------------------------------------------------
// Labels (i18n via messages/*.json → labels.export.*, English fallback)
// ---------------------------------------------------------------------------

const FALLBACK_COLUMNS: Record<OrderColumn | ItemColumn, string> = {
  orderNumber: 'Order No',
  store: 'Store',
  orderDateIso: 'Order Date (ISO)',
  orderDate: 'Order Date',
  status: 'Order Status',
  labelStatus: 'Label Status',
  carrier: 'Carrier',
  trackingNumber: 'Tracking Number',
  buyerName: 'Buyer',
  email: 'Email',
  phone: 'Phone',
  address1: 'Address Line 1',
  address2: 'Address Line 2',
  district: 'District',
  city: 'City',
  state: 'State / Province',
  postalCode: 'Postal Code',
  country: 'Country',
  itemCount: 'Item Count',
  itemsSummary: 'Items',
  total: 'Order Total',
  currency: 'Currency',
  shippingCost: 'Shipping Cost',
  shippingCostCurrency: 'Shipping Cost Currency',
  privateNote: 'Private Note',
  sku: 'SKU',
  title: 'Product',
  variation: 'Variation',
  quantity: 'Quantity',
  unitPrice: 'Unit Price',
  lineTotal: 'Line Total',
  itemNote: 'Item Note',
};

const FALLBACK_LABEL_STATES: Record<LabelState, string> = {
  created: 'Label created',
  not_created: 'No label',
  failed: 'Label failed',
};

const FALLBACK_PDF: Record<string, string> = {
  title: 'Orders',
  generated: 'Generated {date} · {count} orders',
  page: 'Page {page} / {total}',
  colOrder: 'Order #',
  colDate: 'Date',
  colBuyer: 'Buyer',
  colDestination: 'City / Country',
  colItems: 'Items',
  colTotal: 'Total',
  colTracking: 'Tracking',
};

const MESSAGES: Record<ExportLocale, any> = { en: enMessages, tr: trMessages };

export interface ExportLabels {
  column: (key: OrderColumn | ItemColumn) => string;
  labelState: (s: LabelState) => string;
  pdf: (key: keyof typeof FALLBACK_PDF, vars?: Record<string, string | number>) => string;
}

export function getExportLabels(locale: ExportLocale): ExportLabels {
  const node = MESSAGES[locale]?.labels?.export || {};
  const enNode = MESSAGES.en?.labels?.export || {};
  const pick = (group: string, key: string, fallback: string) => {
    const v = node?.[group]?.[key] ?? enNode?.[group]?.[key];
    return typeof v === 'string' && v ? v : fallback;
  };
  const fill = (s: string, vars?: Record<string, string | number>) =>
    vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  return {
    column: key => pick('columns', key, FALLBACK_COLUMNS[key]),
    labelState: s => pick('labelStates', s, FALLBACK_LABEL_STATES[s]),
    // `pdfDoc`, not `pdf`: labels.export.pdf is the menu's "PDF" string.
    pdf: (key, vars) => fill(pick('pdfDoc', key, FALLBACK_PDF[key]), vars),
  };
}

// ---------------------------------------------------------------------------
// Tabular projection
// ---------------------------------------------------------------------------

export interface Table {
  headers: string[];
  rows: Cell[][];
}

export function ordersTable(rows: ExportOrderRow[], labels: ExportLabels): Table {
  return {
    headers: ORDER_COLUMNS.map(c => labels.column(c)),
    rows: rows.map(r =>
      ORDER_COLUMNS.map((c): Cell => (c === 'labelStatus' ? labels.labelState(r.labelStatus) : (r[c] as Cell))),
    ),
  };
}

export function itemsTable(rows: ExportOrderRow[], labels: ExportLabels): Table {
  const out: Cell[][] = [];
  for (const r of rows) {
    for (const it of r.items) {
      out.push([r.orderNumber, r.store, r.orderDateIso, it.sku, it.title, it.variation, it.quantity, it.unitPrice, it.lineTotal, r.currency, it.note]);
    }
  }
  return { headers: ITEM_COLUMNS.map(c => labels.column(c)), rows: out };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralize CSV / formula injection: a text cell starting with = + - @ TAB
 * or CR is prefixed with a single quote so spreadsheet apps treat it as text.
 * (Typed numbers are written verbatim and never neutralized.)
 */
export function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_TRIGGERS.has(value[0]) ? `'${value}` : value;
}

/** RFC 4180 field: quoted when it contains a comma, quote, CR or LF; quotes doubled. */
export interface CsvOptions {
  /**
   * 'tr' writes ';' separators and ',' decimals: Excel with Turkish regional
   * settings uses ';' as the list separator, so a comma CSV opens as one column.
   * No `sep=` line on purpose (it makes Excel ignore the BOM).
   */
  locale?: ExportLocale;
}

const csvDialect = (opts?: CsvOptions) =>
  opts?.locale === 'tr' ? { delimiter: ';', decimal: ',' } : { delimiter: ',', decimal: '.' };

export function csvField(value: Cell | undefined, opts?: CsvOptions): string {
  const { decimal } = csvDialect(opts);
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return decimal === '.' ? String(value) : String(value).replace('.', decimal);
  }
  const s = neutralizeFormula(String(value));
  // Quote on both separators so a cell is safe in either dialect.
  const needsQuote = /[",;\r\n]/.test(s);
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

export const UTF8_BOM = '\uFEFF';

/** UTF-8 CSV with BOM (Excel then decodes Turkish characters correctly), CRLF rows. */
export function toCsv(table: Table, opts?: CsvOptions): string {
  const { delimiter } = csvDialect(opts);
  const lines = [table.headers, ...table.rows].map(row => row.map(v => csvField(v, opts)).join(delimiter));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// XLSX (write-only)
// ---------------------------------------------------------------------------

function sheetFromTable(table: Table): XLSX.WorkSheet {
  const aoa: Cell[][] = [table.headers, ...table.rows.map(r => r.map(v => (v === null ? '' : v)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ref = ws['!ref'];
  if (ref) ws['!autofilter'] = { ref };
  ws['!cols'] = table.headers.map((h, i) => {
    let max = String(h).length;
    for (const r of table.rows) {
      const v = r[i];
      const len = v === null || v === undefined ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 8), 60) };
  });
  return ws;
}

/**
 * Two sheets ("Orders", "Items"). SheetJS Community does not write cell
 * styles, so the header row cannot be bolded; the autofilter marks it instead.
 */
export function toXlsx(rows: ExportOrderRow[], labels: ExportLabels): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromTable(ordersTable(rows, labels)), 'Orders');
  XLSX.utils.book_append_sheet(wb, sheetFromTable(itemsTable(rows, labels)), 'Items');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** System / env TTFs with Turkish glyphs. The repo ships no font file. */
// Repo-local fonts first (drop OFL DejaVuSans.ttf / DejaVuSans-Bold.ttf into
// lib/export/fonts to stop depending on the host), then system fonts.
// On the Hetzner VPS: `apt install fonts-dejavu-core` provides the first
// system candidate. The logged `unicodeFont` flag shows which path was taken.
const FONT_CANDIDATES: Array<{ regular: string; bold?: string }> = [
  { regular: path.join(process.cwd(), 'lib/export/fonts/DejaVuSans.ttf'), bold: path.join(process.cwd(), 'lib/export/fonts/DejaVuSans-Bold.ttf') },
  { regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  { regular: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', bold: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf' },
  { regular: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', bold: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' },
  { regular: '/usr/share/fonts/TTF/DejaVuSans.ttf', bold: '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf' },
  { regular: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' },
  { regular: '/Library/Fonts/Arial Unicode.ttf' },
];

export function findUnicodeFont(): { regular: string; bold: string } | null {
  const fromEnv = process.env.EXPORT_PDF_FONT_PATH;
  const list = fromEnv ? [{ regular: fromEnv, bold: process.env.EXPORT_PDF_FONT_BOLD_PATH }, ...FONT_CANDIDATES] : FONT_CANDIDATES;
  for (const c of list) {
    try {
      if (c.regular && fs.existsSync(c.regular)) {
        const bold = c.bold && fs.existsSync(c.bold) ? c.bold : c.regular;
        return { regular: c.regular, bold };
      }
    } catch { /* keep looking */ }
  }
  return null;
}

const TR_TRANSLIT: Record<string, string> = { 'ğ': 'g', 'Ğ': 'G', 'ş': 's', 'Ş': 'S', 'ı': 'i', 'İ': 'I' };
const WINANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
const isWinAnsi = (ch: string) => {
  const c = ch.codePointAt(0) || 0;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch);
};

/**
 * Make text safe for PDF standard fonts (WinAnsi): transliterate Turkish
 * letters WinAnsi lacks (ğ ş ı İ; ç ö ü are covered), strip accents where that
 * yields a WinAnsi letter, and replace anything else with "?" instead of
 * emitting garbage glyphs. Only used when no Unicode TTF is available.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of Array.from(text.replace(/[\r\n\t]+/g, ' '))) {
    if (TR_TRANSLIT[ch]) { out += TR_TRANSLIT[ch]; continue; }
    if (isWinAnsi(ch)) { out += ch; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && Array.from(base).every(isWinAnsi) ? base : '?';
  }
  return out;
}

const PDF_CELL_MAX = 500;

export async function toPdf(
  rows: ExportOrderRow[],
  labels: ExportLabels,
  opts: { locale: ExportLocale; timeZone: string; now?: Date } ,
): Promise<{ buffer: Buffer; unicodeFont: boolean }> {
  const font = findUnicodeFont();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true, info: { Title: labels.pdf('title') } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let regular = 'Helvetica';
  let bold = 'Helvetica-Bold';
  if (font) {
    doc.registerFont('kx-regular', font.regular);
    doc.registerFont('kx-bold', font.bold);
    regular = 'kx-regular';
    bold = 'kx-bold';
  }
  const txt = (s: string) => {
    const clipped = s.length > PDF_CELL_MAX ? `${s.slice(0, PDF_CELL_MAX - 1)}…` : s;
    return font ? clipped.replace(/[\r\n\t]+/g, ' ') : toWinAnsi(clipped);
  };

  const left = 30;
  const pageWidth = doc.page.width;
  const usable = pageWidth - 60;
  const widths = [72, 72, 110, 105, 241, 70, 112];
  const scale = usable / widths.reduce((a, b) => a + b, 0);
  const cols = widths.map(w => w * scale);
  const headers = [
    labels.pdf('colOrder'), labels.pdf('colDate'), labels.pdf('colBuyer'), labels.pdf('colDestination'),
    labels.pdf('colItems'), labels.pdf('colTotal'), labels.pdf('colTracking'),
  ];
  const pad = 3;
  const fontSize = 7.5;
  const bottomLimit = () => doc.page.height - 40;

  const measure = (cells: string[], f: string) => {
    doc.font(f).fontSize(fontSize);
    return Math.max(...cells.map((c, i) => doc.heightOfString(c || ' ', { width: cols[i] - pad * 2 }))) + pad * 2;
  };

  const drawRow = (cells: string[], y: number, h: number, f: string, shade: boolean) => {
    if (shade) doc.save().rect(left, y, usable, h).fill('#f2f4f7').restore();
    doc.font(f).fontSize(fontSize).fillColor('#111111');
    let x = left;
    cells.forEach((c, i) => {
      doc.text(c, x + pad, y + pad, { width: cols[i] - pad * 2, lineBreak: true });
      x += cols[i];
    });
    doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.3).strokeColor('#c8ccd2').stroke();
  };

  const headerCells = headers.map(txt);
  const drawHeader = (y: number) => {
    const h = measure(headerCells, bold);
    doc.save().rect(left, y, usable, h).fill('#dfe3ea').restore();
    drawRow(headerCells, y, h, bold, false);
    return y + h;
  };

  // Title
  const now = opts.now || new Date();
  doc.font(bold).fontSize(13).fillColor('#111111').text(txt(labels.pdf('title')), left, 30);
  doc.font(regular).fontSize(8).fillColor('#555555')
    .text(txt(labels.pdf('generated', { date: formatReadableDate(now, opts.locale, opts.timeZone), count: rows.length })), left, doc.y + 2);
  let y = drawHeader(doc.y + 6);

  rows.forEach((r, idx) => {
    const cells = [
      r.orderNumber,
      r.orderDate,
      r.buyerName,
      [r.district, r.city, r.country].filter(Boolean).join(', '),
      r.itemsSummary,
      r.total !== null ? `${r.total.toFixed(2)} ${r.currency}`.trim() : '',
      [r.carrier, r.trackingNumber].filter(Boolean).join(' '),
    ].map(txt);
    const h = measure(cells, regular);
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = drawHeader(30);
    }
    drawRow(cells, y, h, regular, idx % 2 === 1);
    y += h;
  });

  // Page numbers (buffered pages). Zero the bottom margin so writing in the
  // footer area does not trigger an automatic page break.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(regular).fontSize(7.5).fillColor('#777777')
      .text(txt(labels.pdf('page', { page: i - range.start + 1, total: range.count })), left, doc.page.height - 22, { width: usable, align: 'right', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }

  doc.end();
  return { buffer: await done, unicodeFont: !!font };
}
