import { describe, it, expect } from 'vitest';
import {
  CLOSED_ORDER_STATUSES,
  COUNTED_VIEW_KEYS,
  ORDER_VIEWS,
  ORDER_VIEW_KEYS,
  PROBLEMS_SQL,
  LABEL_CREATED_SQL,
  ADDRESS_INCOMPLETE_SQL,
  LABEL_FAILED_SQL,
  TRACKING_PUSH_FAILED_SQL,
  TO_SHIP_SQL,
  OVERDUE_SQL,
  VIEW_COUNTS_SQL,
  countViews,
  countToShip,
  matchesOrderView,
  viewWhereSql,
} from '@/lib/orders/views';
import { toOrderRow, viewFactsOf } from '@/lib/orders/toOrderRows';
import { NOW, ALL_FIXTURES, etsyNoAddress, amazonFba, veeqoSellable, manualLabeled, voidedLabel, trendyolCargo, amazonOpen, wixNested } from './g1-fixtures';

const ctx = { now: NOW, etsyShopNames: ['BelleCoutureGifts'] };
const facts = (o: (typeof ALL_FIXTURES)[number]) => viewFactsOf(o, toOrderRow(o, ctx).shipTo.missing.length > 0);

/** Parentheses balance outside string literals. */
function balanced(sql: string): boolean {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") inStr = !inStr;
    else if (!inStr && c === '(') depth++;
    else if (!inStr && c === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0 && !inStr;
}

describe('views — registry (orders §1.3)', () => {
  it('six built-in views; four counted; Shipped and All default to the last 30 days', () => {
    expect(ORDER_VIEW_KEYS).toEqual(['to_ship', 'overdue', 'label_created', 'shipped', 'problems', 'all']);
    expect(COUNTED_VIEW_KEYS.every((k) => ORDER_VIEWS[k].counted)).toBe(true);
    expect(ORDER_VIEWS.shipped.defaultPreset).toBe('last30');
    expect(ORDER_VIEWS.all.defaultPreset).toBe('last30');
    expect(ORDER_VIEWS.to_ship).toMatchObject({ defaultPreset: 'any', sort: 'shipBy', dir: 'asc' });
  });
});

describe('views — pure twins over the marketplace fixtures', () => {
  it('membership per view', () => {
    const by = (view: (typeof ORDER_VIEW_KEYS)[number]) => ALL_FIXTURES.filter((o) => matchesOrderView(facts(o), view, NOW)).map((o) => o.id);
    expect(by('to_ship')).toEqual(['o-etsy', 'o-amz-open', 'o-ty', 'o-wix', 'o-veeqo', 'o-void']);
    expect(by('overdue')).toEqual(['o-etsy']);
    expect(by('label_created')).toEqual([]);
    expect(by('shipped')).toEqual(['o-amz']);
    expect(by('problems')).toEqual(['o-etsy', 'o-veeqo', 'o-manual', 'o-void']);
    expect(by('all')).toHaveLength(ALL_FIXTURES.length);
  });

  it('countViews equals per-view membership; To ship/Overdue equal the sidebar counter', () => {
    const rows = ALL_FIXTURES.map(facts);
    expect(countViews(rows, NOW)).toEqual({ to_ship: 6, overdue: 1, label_created: 0, problems: 4 });
    const nav = countToShip(rows, NOW);
    expect(nav).toEqual({ toShip: 6, overdue: 1 });
  });

  it('pill and view agree: a row in Label created has the label_created pill, FBA is never To ship', () => {
    const labeled = { ...manualLabeled, id: 'ok', trackingSubmissions: [] };
    expect(matchesOrderView(facts(labeled), 'label_created', NOW)).toBe(true);
    expect(toOrderRow(labeled, ctx).status.key).toBe('label_created');
    expect(matchesOrderView(facts(amazonFba), 'to_ship', NOW)).toBe(false);
    for (const o of [etsyNoAddress, veeqoSellable, voidedLabel, trendyolCargo, amazonOpen, wixNested]) {
      const r = toOrderRow(o, ctx);
      // labelable rows are always in To ship
      if (r.canLabel) expect(matchesOrderView(facts(o), 'to_ship', NOW)).toBe(true);
    }
  });
});

describe('views — SQL text (no DB in unit tests; see G0 verification)', () => {
  it('every view clause is balanced and bound to alias o', () => {
    for (const v of ORDER_VIEW_KEYS) {
      const sql = viewWhereSql(v);
      expect(balanced(sql), v).toBe(true);
      expect(sql).toContain('o."status"');
    }
    for (const sql of [PROBLEMS_SQL, LABEL_CREATED_SQL, ADDRESS_INCOMPLETE_SQL, LABEL_FAILED_SQL, TRACKING_PUSH_FAILED_SQL, VIEW_COUNTS_SQL]) {
      expect(balanced(sql)).toBe(true);
    }
  });

  it('view clauses reuse the M2 definitions', () => {
    expect(viewWhereSql('to_ship')).toBe(TO_SHIP_SQL);
    expect(viewWhereSql('overdue')).toContain(OVERDUE_SQL);
    expect(PROBLEMS_SQL).toContain(TO_SHIP_SQL);
    expect(PROBLEMS_SQL).toContain(ADDRESS_INCOMPLETE_SQL);
    expect(LABEL_CREATED_SQL).toContain('NOT ' + TRACKING_PUSH_FAILED_SQL);
  });

  it('counts: one query, four FILTERs, $1 = userId, no other params', () => {
    expect(VIEW_COUNTS_SQL.match(/FILTER \(WHERE/g)).toHaveLength(4);
    expect(VIEW_COUNTS_SQL).toContain('o."userId" = $1');
    expect(VIEW_COUNTS_SQL).not.toMatch(/\$2/);
    for (const k of COUNTED_VIEW_KEYS) expect(VIEW_COUNTS_SQL).toContain(`AS "${k}"`);
  });

  it('address SQL reads the same sources as the client extraction and honors EtsyAddress', () => {
    for (const key of ["'street1'", "'city'", "'postal'", "'country'", "'shipmentAddress'", "'shippingDestination'", "'to_address'", "'deliver_to'"]) {
      expect(ADDRESS_INCOMPLETE_SQL).toContain(key);
    }
    expect(ADDRESS_INCOMPLETE_SQL).toContain('"EtsyAddress"');
    expect(ADDRESS_INCOMPLETE_SQL).toContain("NOT ILIKE '%anonymized%'");
  });

  it('closed raw statuses are unchanged by G1', () => {
    expect(CLOSED_ORDER_STATUSES).toContain('kargolandi');
  });
});
