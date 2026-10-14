/**
 * Order change detection (W4 T3). Pure.
 *
 *  orderHash = sha1(status, externalStatus, total, tracking, shipBy)
 *  itemsHash = sha1(lines sorted by line key: key, qty, unit price, sku, image present)
 *
 * The same normalisation is applied to an incoming marketplace order and to
 * the stored DB row, so a NULL stored hash (rows written before W4) can be
 * computed from the row itself and compared — the first sync after deploy
 * then writes the hashes without rewriting unchanged items.
 */
import { createHash } from 'crypto';

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function s(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function money(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

function minuteIso(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  const t = d.getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(Math.floor(t / 60000) * 60000).toISOString();
}

export type OrderHashInput = {
  status?: string | null;
  externalStatus?: string | null;
  totalPrice?: number | string | { toString(): string } | null;
  trackingNumber?: string | null;
  shipByAt?: Date | string | null;
};

export function computeOrderHash(o: OrderHashInput): string {
  return sha1(
    [
      s(o.status).toUpperCase(),
      s(o.externalStatus).toUpperCase(),
      money(o.totalPrice as any),
      s(o.trackingNumber),
      minuteIso(o.shipByAt),
    ].join('\u0001'),
  );
}

export type ItemHashLine = {
  lineKey: string;
  quantity?: number | null;
  unitPrice?: number | string | { toString(): string } | null;
  sku?: string | null;
  image?: string | null;
};

export function computeItemsHash(lines: ItemHashLine[]): string {
  const rows = (lines || [])
    .map((l) => [s(l.lineKey), String(Math.trunc(Number(l.quantity) || 1)), money(l.unitPrice as any), s(l.sku), l.image ? '1' : '0'].join('\u0002'))
    .sort();
  return sha1(rows.join('\u0001'));
}

/** Line key used everywhere: marketplace line id, else `${orderKey}-${index}` (same as the legacy writer). */
export function lineKeyFor(itemId: unknown, orderMarketplaceKey: string, index: number): string {
  const id = s(itemId);
  return id || `${orderMarketplaceKey}-${index}`;
}

/** Hash lines from a stored OrderItem row set. */
export function itemsHashFromDbRows(
  rows: Array<{ uniqueLineKey?: string | null; remoteLineId?: string | null; marketplaceKey?: string | null; id?: string; quantity?: number | null; unitPrice?: any; sku?: string | null; image?: string | null }>,
): string {
  return computeItemsHash(
    rows.map((r) => ({
      lineKey: s(r.uniqueLineKey) || s(r.remoteLineId) || s(r.marketplaceKey) || s(r.id),
      quantity: r.quantity,
      unitPrice: r.unitPrice === null || r.unitPrice === undefined ? null : Number(r.unitPrice.toString()),
      sku: r.sku,
      image: r.image,
    })),
  );
}
