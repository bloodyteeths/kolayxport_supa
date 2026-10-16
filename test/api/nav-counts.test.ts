import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRaw = vi.fn();
const etsyCount = vi.fn();
const ebayCount = vi.fn();
const authUser = vi.fn();
vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => queryRaw(...a),
    etsyListingDraft: { findMany: (...a: any[]) => etsyCount(...a) },
    ebayListingDraft: { findMany: (...a: any[]) => ebayCount(...a) },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));

import handler, { UNSENT_DRAFT_STATUSES } from '@/pages/api/nav/counts';
import {
  CLOSED_ORDER_STATUSES,
  TO_SHIP_COUNTS_SQL,
  TO_SHIP_SQL,
  HAS_LABEL_SQL,
  FBA_SQL,
  EFFECTIVE_SHIP_BY_SQL,
  countToShip,
  effectiveShipBy,
  isToShipOrder,
  isOverdueOrder,
  orderHasLabel,
  isFbaOrder,
  type OrderViewRow,
} from '@/lib/orders/views';
import { orderStatus, isClosedOrderStatus } from '@/lib/ds/status/orders';
import { normalizeRaw } from '@/lib/ds/status/vocabulary';

function run(method = 'GET') {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return handler({ method, headers: {}, query: {} } as any, res).then(() => res);
}

const NOW = new Date('2026-10-15T12:00:00Z');
const YESTERDAY = new Date('2026-10-14T12:00:00Z');
const TOMORROW = new Date('2026-10-16T12:00:00Z');

/** shell-nav §13 fixture. */
const FIXTURE: OrderViewRow[] = [
  // shipped Amazon order (unlabeled in KolayXport, shipped on Amazon) → not to ship
  { status: 'Shipped', marketplace: 'Amazon', items: [{ shipBy: YESTERDAY }] },
  // cancelled → not to ship
  { status: 'cancelled', marketplace: 'Etsy', items: [{ shipBy: YESTERDAY }] },
  // labeled → not to ship
  { status: 'paid', marketplace: 'Etsy', trackingNumber: '1Z999', items: [{ shipBy: YESTERDAY }] },
  // unlabeled, ship-by passed → to ship + overdue
  { status: 'paid', marketplace: 'Etsy', items: [{ shipBy: YESTERDAY }] },
];

describe('lib/orders/views — pure rules', () => {
  it('shell-nav §13 fixture: { toShip: 1, overdue: 1 }', () => {
    expect(countToShip(FIXTURE, NOW)).toEqual({ toShip: 1, overdue: 1 });
  });

  it('every CLOSED_ORDER_STATUSES entry maps to a closed key in lib/ds/status/orders', () => {
    for (const s of CLOSED_ORDER_STATUSES) expect(isClosedOrderStatus(orderStatus(s)), s).toBe(true);
    // marketplace spellings normalise into the list
    for (const raw of ['Shipped', 'PartiallyShipped', 'Delivered', 'Cancelled', 'CANCELED', 'Kargolandı', 'Teslim Edildi', 'İptal Edildi', 'is-shipped']) {
      expect((CLOSED_ORDER_STATUSES as readonly string[]).includes(normalizeRaw(raw)), raw).toBe(true);
    }
    // live states stay open
    for (const raw of ['paid', 'Pending', 'Created', 'Picking', 'Invoiced', 'awaiting_shipment', 'UnDelivered', 'on_hold']) {
      expect(isClosedOrderStatus(orderStatus(raw)), raw).toBe(false);
    }
  });

  it('unpaid and NULL statuses are not listed, Amazon Pending is', () => {
    expect(isToShipOrder({ status: 'awaiting_payment', marketplace: 'Shopify' })).toBe(false);
    expect(isToShipOrder({ status: 'Pending_Payment', marketplace: 'Shopify' })).toBe(false);
    expect(isToShipOrder({ status: null, marketplace: 'Etsy' })).toBe(false);
    expect(isToShipOrder({ status: 'Pending', marketplace: 'Amazon' })).toBe(true);
  });

  it('voided label = no label; Trendyol pre-assigned cargo number is not a label', () => {
    expect(orderHasLabel({ status: 'paid', marketplace: 'Etsy', labelStatus: 'voided', trackingNumber: '1Z' })).toBe(false);
    expect(orderHasLabel({ status: 'paid', marketplace: 'Etsy', labelStatus: 'created' })).toBe(true);
    expect(orderHasLabel({ status: 'Created', marketplace: 'Trendyol', rawData: { cargoTrackingNumber: 7330012345 } })).toBe(false);
    expect(orderHasLabel({ status: 'paid', marketplace: 'Etsy', shipments: [{ status: 'created', trackingNumber: null, pdfUrl: '/x.pdf' }] })).toBe(true);
    expect(orderHasLabel({ status: 'paid', marketplace: 'Etsy', shipments: [{ status: 'voided', trackingNumber: '1Z' }] })).toBe(false);
    expect(orderHasLabel({ status: 'paid', marketplace: 'Etsy', items: [{ labelJobs: [{ status: 'created' }] }] })).toBe(true);
    expect(orderHasLabel({ status: 'paid', marketplace: 'Etsy', items: [{ labelJobs: [{ status: 'failed' }] }] })).toBe(false);
  });

  it('FBA / MCF are never to ship (both rawData shapes)', () => {
    expect(isFbaOrder({ marketplace: 'amazon', rawData: { rows: [{ 'fulfillment-channel': 'AFN' }] } })).toBe(true);
    expect(isFbaOrder({ marketplace: 'Amazon', rawData: JSON.stringify({ channel: { name: 'Amazon FBA US' } }) })).toBe(true);
    expect(isFbaOrder({ marketplace: 'Amazon', rawData: { channel: { with_fba: true } } })).toBe(true);
    expect(isFbaOrder({ marketplace: 'Amazon', rawData: { channel: { type_code: 'amazon_fba' } } })).toBe(true);
    expect(isFbaOrder({ marketplace: 'Amazon', rawData: { rows: [{ 'fulfillment-channel': 'MFN' }] } })).toBe(false);
    expect(isFbaOrder({ marketplace: 'Etsy', rawData: { channel: { name: 'FBA' } } })).toBe(false);
    expect(isOverdueOrder({ status: 'Unshipped', marketplace: 'Amazon', rawData: { rows: [{ 'fulfillment-channel': 'AFN' }] }, items: [{ shipBy: YESTERDAY }] }, NOW)).toBe(false);
  });

  it('effective ship-by: item min, then shipByAt, then rawData due_date / ship_by_date, then Etsy transactions', () => {
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Etsy', items: [{ shipBy: TOMORROW }, { shipBy: YESTERDAY }], shipByAt: TOMORROW })).toEqual(YESTERDAY);
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Etsy', items: [{ shipBy: null }], shipByAt: YESTERDAY })).toEqual(YESTERDAY);
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Veeqo', rawData: { due_date: '2026-10-14T12:00:00Z' } })).toEqual(YESTERDAY);
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Veeqo', rawData: { due_date: 'Ship by tomorrow', ship_by_date: '2026-10-16T12:00:00Z' } })).toEqual(TOMORROW);
    const t1 = Math.floor(YESTERDAY.getTime() / 1000);
    const t2 = Math.floor(TOMORROW.getTime() / 1000);
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Etsy', rawData: { transactions: [{ expected_ship_date: t2 }, { expected_ship_date: t1 }, { expected_ship_date: 0 }] } })).toEqual(YESTERDAY);
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Etsy', rawData: 'not json' })).toBeNull();
  });

  it('calendar-invalid rawData dates are skipped (the same values the SQL guard skips)', () => {
    const ship = (due_date: unknown) => effectiveShipBy({ status: 'paid', marketplace: 'Veeqo', rawData: { due_date } });
    for (const bad of ['2026-02-30', '2026-04-31', '2025-02-29', '1900-02-29', '2026-01-01T99:00', '2026-01-01T23:60', '2026-01-01T10:00:61', '2026-01-01T10:00+99:00', '0000-01-01']) {
      expect(ship(bad)).toBeNull();
    }
    expect(ship('2024-02-29')).toEqual(new Date('2024-02-29'));
    expect(ship('2000-02-29')).toEqual(new Date('2000-02-29'));
    expect(ship('2026-01-31T23:59:59.5+03:00')).toEqual(new Date('2026-01-31T23:59:59.5+03:00'));
    // Epoch seconds: at most 11 integer digits, so to_timestamp cannot overflow.
    expect(effectiveShipBy({ status: 'paid', marketplace: 'Etsy', rawData: { transactions: [{ expected_ship_date: '1'.repeat(12) }] } })).toBeNull();
  });

  it('future ship-by is to ship but not overdue', () => {
    expect(countToShip([{ status: 'paid', marketplace: 'Etsy', items: [{ shipBy: TOMORROW }] }, { status: 'paid', marketplace: 'Etsy' }], NOW)).toEqual({ toShip: 2, overdue: 0 });
  });
});

describe('lib/orders/views — SQL fragments', () => {
  it('TO_SHIP_SQL composes listed + open + unlabeled + not FBA', () => {
    expect(TO_SHIP_SQL).toContain(`LOWER(o."status") NOT IN ('awaiting_payment', 'pending_payment')`);
    for (const s of CLOSED_ORDER_STATUSES) expect(TO_SHIP_SQL).toContain(`'${s}'`);
    expect(TO_SHIP_SQL).toContain(`NOT ${HAS_LABEL_SQL}`);
    expect(TO_SHIP_SQL).toContain(`NOT ${FBA_SQL}`);
  });

  it('label clause honours voided, Shipment and LabelJob; never reads cargoTrackingNumber', () => {
    expect(HAS_LABEL_SQL).toContain(`<> 'voided'`);
    expect(HAS_LABEL_SQL).toContain('"Shipment" s');
    expect(HAS_LABEL_SQL).toContain('"LabelJob" lj');
    expect(TO_SHIP_COUNTS_SQL).not.toContain('cargoTrackingNumber');
  });

  it('ship-by SQL reads the stored, indexed Order.shipByAt only (no per-row OrderItem/rawData parsing: ~6 s → fast)', () => {
    expect(EFFECTIVE_SHIP_BY_SQL.trim()).toBe('o."shipByAt"');
  });

  it('the counts query is user-scoped with one bind parameter', () => {
    expect(TO_SHIP_COUNTS_SQL).toContain('WHERE o."userId" = $1 AND');
    expect(TO_SHIP_COUNTS_SQL).not.toMatch(/\$2/);
    expect(TO_SHIP_COUNTS_SQL).toContain('COUNT(*) FILTER (WHERE');
    // balanced parentheses
    let depth = 0;
    for (const ch of TO_SHIP_COUNTS_SQL.replace(/'[^']*'/g, "''")) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});

describe('GET /api/nav/counts', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    etsyCount.mockReset();
    ebayCount.mockReset();
    authUser.mockReset();
    authUser.mockResolvedValue({ id: 'u1' });
    queryRaw.mockResolvedValue([{ toShip: BigInt(12), overdue: '1' }]);
    const staged = { status: 'draft', fieldPatch: { title: 'x' }, queuedActions: [], _count: { media: 0 } };
    // The 4th Etsy draft had every change undone (empty): not an unsent change.
    const empty = { status: 'draft', fieldPatch: {}, taxonomyPatch: null, inventoryPatch: null, variationImagesPatch: null, personalizationPatch: null, queuedActions: [], _count: { media: 0 }, scheduledSendAt: null };
    etsyCount.mockResolvedValue([staged, staged, staged, empty]);
    ebayCount.mockResolvedValue([]);
  });

  it('returns the documented shape', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.orders).toEqual({ toShip: 12, overdue: 1 });
    expect(res.body.drafts).toEqual({ etsy: 3, ebay: 0 });
    expect(Number.isFinite(Date.parse(res.body.generatedAt))).toBe(true);
    expect(res.headers['Cache-Control']).toMatch(/private/);
  });

  it('eBay drafts of legacy listings (created on eBay, `legacy-<itemId>`) are not unsent changes', async () => {
    const staged = { sku: 'SKU-1', status: 'draft', inventoryPatch: { product: { title: 'x' } }, offerPatch: {}, variationPatch: null, queuedActions: [], _count: { media: 0 } };
    ebayCount.mockResolvedValue([staged, { ...staged, sku: 'legacy-198020866463' }, { ...staged, sku: 'legacy-197008549496', status: 'failed' }]);
    const res = await run();
    expect(res.body.drafts.ebay).toBe(1);
    // the eBay select reads the SKU for that check
    expect(ebayCount.mock.calls[0][0].select).toMatchObject({ sku: true });
  });

  it('scopes every query to the session user', async () => {
    await run();
    expect(queryRaw).toHaveBeenCalledWith(TO_SHIP_COUNTS_SQL, 'u1');
    const where = { userId: 'u1', status: { in: [...UNSENT_DRAFT_STATUSES] } };
    expect(etsyCount).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(ebayCount).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(UNSENT_DRAFT_STATUSES).toEqual(['draft', 'failed', 'conflict']);
  });

  it('is session-only (no Bearer path)', async () => {
    await run();
    expect(authUser.mock.calls[0][2]).toEqual({ allowBearer: false });
  });

  it('401 without a session, 405 on other methods', async () => {
    authUser.mockResolvedValue(null);
    expect((await run()).statusCode).toBe(401);
    authUser.mockResolvedValue({ id: 'u1' });
    const res = await run('POST');
    expect(res.statusCode).toBe(405);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('empty result → zeros; DB error → 500 without leaking SQL', async () => {
    queryRaw.mockResolvedValue([]);
    expect((await run()).body.orders).toEqual({ toShip: 0, overdue: 0 });
    queryRaw.mockRejectedValue(new Error('relation "Order" … SELECT secret'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await run();
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });
});
