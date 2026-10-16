// orders G2: pure parts of the list page — URL/view rules (§1.2, §1.3), legacy query migration on mount,
// the one-primary rule (§1.4), row inline actions (§4.3), bulk selection summary, TSV, print pages, empty kinds.
import { describe, expect, it, vi } from 'vitest';
import { parseUrlState } from '@/lib/ds/useUrlState';
import { toOrderRows } from '@/lib/orders/toOrderRows';
import type { OrderRow } from '@/lib/orders/types';
import {
  ORDERS_URL_SCHEMA,
  VIEW_DEFAULTS,
  applyViewPatch,
  builtInViews,
  effectiveSort,
  fromFilterValues,
  hasActiveFilters,
  migrateOrdersQuery,
  savedViewQuery,
  toFilterValues,
  toOrdersQuery,
  type OrdersUrlState,
} from '@/components/domain/orders/ordersFilters';
import { isLabelable, notLabelableReason, orderInlineAction, orderRowActions, pagePrimaryKind, type OrderRowHandlers } from '@/components/domain/orders/orderColumns';
import { buildAddressesTsv, summarizeSelection } from '@/components/domain/orders/OrdersBulkActions';
import { ordersEmptyKind } from '@/components/domain/orders/OrdersEmptyState';
import { fetchMatchingIds } from '@/components/domain/orders/OrdersExportMenu';
import { openPrintPage, printPageUrl, PRINT_MAX_IDS } from '@/lib/print/openPrintPage';
import { ALL_FIXTURES, NOW, amazonFba, amazonOpen, etsyNoAddress, manualLabeled, trendyolCargo, veeqoSellable, voidedLabel } from './g1-fixtures';

vi.mock('@/components/orders-live/OrderLifecycleBadges', () => ({ default: () => null }));

const state = (q: Record<string, string | string[]> = {}): OrdersUrlState => parseUrlState(ORDERS_URL_SCHEMA, q);
const rows = toOrderRows(ALL_FIXTURES, { now: NOW });
const byId = (id: string) => rows.find((r) => r.id === id) as OrderRow;
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function handlers(): OrderRowHandlers & Record<string, ReturnType<typeof vi.fn>> {
  const names = ['open', 'createLabel', 'fixAddress', 'printLabel', 'copyTracking', 'addTracking', 'copyAddress', 'openOnMarketplace', 'printPackingSlip', 'messageBuyer', 'deleteLabel', 'deleteOrder'];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as never;
}

describe('legacy query migration on mount (orders §1.2)', () => {
  it('rewrites label=unlabeled, mp and qt', () => {
    const next = migrateOrdersQuery({ label: 'unlabeled', mp: 'Etsy', qt: 'sku', q: 'BB' });
    expect(next).toMatchObject({ view: 'to_ship', store: 'Etsy', in: 'sku', q: 'BB' });
    expect(next).not.toHaveProperty('label');
    expect(next).not.toHaveProperty('mp');
  });
  it('maps the live new-order link ?highlight=<id> to ?open=<id>', () => {
    const next = migrateOrdersQuery({ highlight: 'o-etsy' });
    expect(next?.open).toBe('o-etsy');
    expect(next).not.toHaveProperty('highlight');
  });
  it('returns null for a current query (no rewrite, no navigation)', () => {
    expect(migrateOrdersQuery({ view: 'shipped', store: 'Etsy' })).toBeNull();
  });
  it('label=failed → problems, label=labeled → label_created', () => {
    expect(migrateOrdersQuery({ label: 'failed' })?.view).toBe('problems');
    expect(migrateOrdersQuery({ label: 'labeled' })?.view).toBe('label_created');
  });
});

describe('views and the server query (orders §1.3)', () => {
  it('defaults to All orders, newest first (founder 2026-10-16); To ship stays undated, ship-by ascending', () => {
    expect(toOrdersQuery(state(), NOW)).toMatchObject({ view: 'all', sort: 'orderedAt', dir: 'desc', page: 1, size: 50 });
    const q = toOrdersQuery(state({ view: 'to_ship' }), NOW);
    expect(q).toMatchObject({ view: 'to_ship', sort: 'shipBy', dir: 'asc', page: 1, size: 50 });
    expect(q.from).toBeUndefined();
    expect(q.preset).toBeUndefined();
  });
  it('Shipped and All default to the last 30 days (explicit from/to)', () => {
    for (const view of ['shipped', 'all']) {
      const q = toOrdersQuery(state({ view }), NOW);
      expect(q.from).toBeDefined();
      expect(q.to).toBeDefined();
      expect(q.sort).toBe('orderedAt');
      expect(VIEW_DEFAULTS[view as 'shipped'].preset).toBe('last30');
    }
  });
  it('a cleared date on a dated view sends preset "any" so the default does not come back', () => {
    const patch = fromFilterValues({ store: [], status: [], date: undefined }, state({ view: 'all', preset: 'last7' }), NOW);
    expect(patch.preset).toBe('any');
    const q = toOrdersQuery(state({ view: 'all', preset: 'any' }), NOW);
    expect(q.preset).toBe('any');
    expect(q.from).toBeUndefined();
  });
  it('a search ignores dates (search covers all dates)', () => {
    const q = toOrdersQuery(state({ view: 'shipped', q: '3891' }), NOW);
    expect(q.q).toBe('3891');
    expect(q.from).toBeUndefined();
    expect(q.preset).toBe('any');
  });
  it('column sort overrides the view sort', () => {
    expect(effectiveSort(state({ sort: 'total', dir: 'desc' }))).toEqual({ key: 'total', dir: 'desc' });
  });
  it('built-in views carry counts only where the view shows one, overdue in danger tone', () => {
    const views = builtInViews((k) => k, { to_ship: 12, overdue: 1, label_created: 3, problems: 2 });
    expect(views.map((v) => v.id)).toEqual(['to_ship', 'overdue', 'label_created', 'shipped', 'problems', 'all']);
    expect(views.find((v) => v.id === 'to_ship')?.count).toBe(12);
    expect(views.find((v) => v.id === 'shipped')?.count).toBeUndefined();
    expect(views.find((v) => v.id === 'overdue')?.countTone).toBe('danger');
  });
  it('a user view stores its base + filters and restores them', () => {
    const s = state({ view: 'shipped', store: ['Etsy'], status: ['delivered'], q: 'mug' });
    const query = savedViewQuery(s);
    expect(query).toMatchObject({ base: 'shipped', store: ['Etsy'], status: ['delivered'], q: 'mug' });
    const patch = applyViewPatch('u_1', [{ id: 'u_1', label: 'Mine', query, builtIn: false }]);
    expect(patch).toMatchObject({ view: 'u_1', base: 'shipped', store: ['Etsy'], status: ['delivered'], q: 'mug', page: 1 });
  });
  it('a built-in view resets every filter', () => {
    expect(applyViewPatch('overdue', [])).toMatchObject({ view: 'overdue', store: [], status: [], q: undefined, preset: undefined });
  });
  it('filter values round-trip and only explicit dates make a chip', () => {
    expect(toFilterValues(state({ view: 'all' }), NOW).date).toBeUndefined();
    const v = toFilterValues(state({ preset: 'last7', store: ['Trendyol'] }), NOW);
    expect(v.store).toEqual(['Trendyol']);
    expect((v.date as { preset?: string }).preset).toBe('last7');
    expect(fromFilterValues(v, state())).toMatchObject({ preset: 'last7', store: ['Trendyol'] });
    expect(hasActiveFilters(state())).toBe(false);
    expect(hasActiveFilters(state({ store: ['Etsy'] }))).toBe(true);
  });
  it('a store change on a dated view (Shipped/All) keeps the view default range (no preset=any)', () => {
    for (const view of ['shipped', 'all']) {
      const s = state({ view });
      const patch = fromFilterValues({ ...toFilterValues(s, NOW), store: ['Etsy'] }, s, NOW);
      expect(patch.store).toEqual(['Etsy']);
      expect(patch).not.toHaveProperty('preset');
      expect(patch).not.toHaveProperty('from');
      expect(patch).not.toHaveProperty('to');
    }
  });
  it('an explicit date survives a status change, and "Any date" on a dated view is kept', () => {
    const s = state({ view: 'shipped', preset: 'last7' });
    expect(fromFilterValues({ ...toFilterValues(s, NOW), status: ['delivered'] }, s, NOW)).not.toHaveProperty('preset');
    const any = state({ view: 'all', preset: 'any' });
    expect(fromFilterValues({ ...toFilterValues(any, NOW), store: ['Etsy'] }, any, NOW)).not.toHaveProperty('preset');
  });
  it('"All matching" export ids come from /api/orders with the list query (every page, capped)', async () => {
    const query = toOrdersQuery(state({ view: 'shipped', status: ['delivered'], store: ['Etsy'] }), NOW);
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url);
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      const n = page === 1 ? 250 : 10;
      const orders = Array.from({ length: n }, (_, i) => ({ id: `p${page}-${i}` }));
      return new Response(JSON.stringify({ orders, total: 260 }), { status: 200 });
    });
    const ids = await fetchMatchingIds(query, 1000, fetcher as unknown as typeof fetch);
    expect(ids).toHaveLength(260);
    expect(calls).toHaveLength(2);
    const sp = new URL(calls[0], 'http://x').searchParams;
    expect(sp.get('view')).toBe('shipped');
    expect(sp.getAll('status')).toEqual(['delivered']);
    expect(sp.getAll('marketplace')).toEqual(['Etsy']);
    expect(sp.get('limit')).toBe('250');
    expect(sp.has('include')).toBe(false);
    expect(await fetchMatchingIds(query, 100, fetcher as unknown as typeof fetch)).toHaveLength(100);
    const failing = vi.fn(async () => new Response('{}', { status: 500 }));
    expect(await fetchMatchingIds(query, 1000, failing as unknown as typeof fetch)).toBeNull();
  });
});

describe('labelable rows and the one primary (orders §1.4)', () => {
  it('FBA, shipped, labeled and address-less orders are not labelable', () => {
    expect(isLabelable(byId(amazonFba.id))).toBe(false);
    expect(notLabelableReason(byId(amazonFba.id))).toBe('fba');
    expect(isLabelable(byId(manualLabeled.id))).toBe(false);
    expect(isLabelable(byId(etsyNoAddress.id))).toBe(false);
    expect(notLabelableReason(byId(etsyNoAddress.id))).toBe('address');
    expect(isLabelable(byId(amazonOpen.id))).toBe(true);
  });
  it('page primary: Create N labels when a row is labelable, else Add manual order; none while selecting', () => {
    expect(pagePrimaryKind(rows, 0)).toBe('createLabels');
    expect(pagePrimaryKind([byId(amazonFba.id), byId(manualLabeled.id)], 0)).toBe('addManualOrder');
    expect(pagePrimaryKind(rows, 2)).toBe('none');
  });
  it('selection summary counts only labelable rows and names the main skip reason', () => {
    const s = summarizeSelection([byId(amazonOpen.id), byId(amazonFba.id), byId(trendyolCargo.id), byId(manualLabeled.id)]);
    expect(s.labelable.map((r) => r.id).sort()).toEqual([amazonOpen.id, trendyolCargo.id].filter((id) => isLabelable(byId(id))).sort());
    expect(s.skipped.length).toBe(4 - s.labelable.length);
    expect(s.printable.map((r) => r.id)).toEqual([manualLabeled.id]);
    expect(s.mainReason).not.toBeNull();
  });
});

describe('row inline action and ⋯ (orders §4.3)', () => {
  it('to ship → Create label; label created with URL → Print label; FBA → none', () => {
    const h = handlers();
    expect(orderInlineAction(byId(amazonOpen.id), h, t)?.id).toBe('createLabel');
    expect(orderInlineAction(byId(amazonFba.id), h, t)).toBeNull();
    const manual = byId(manualLabeled.id);
    expect(manual.status).toMatchObject({ domain: 'order', key: 'label_created' });
    expect(orderInlineAction(manual, h, t)?.id).toBe('printLabel');
  });
  it('address problem → Fix address; label failed → Create label (retry)', () => {
    const h = handlers();
    expect(orderInlineAction(byId(etsyNoAddress.id), h, t)?.id).toBe('fixAddress');
    const failed = byId(veeqoSellable.id);
    expect(failed.status.domain).toBe('label');
    expect(orderInlineAction(failed, h, t)?.id).toBe('createLabel');
  });
  it('voided label counts as no label (its missing postal code makes it Fix address, not Print)', () => {
    const r = byId(voidedLabel.id);
    expect(r.label).toBeNull();
    expect(orderInlineAction(r, handlers(), t)?.id).toBe('fixAddress');
  });
  it('⋯ puts delete actions last as danger; Delete label only with a shipment id; Amazon gets Message buyer', () => {
    const h = handlers();
    const manual = orderRowActions(byId(manualLabeled.id), h, t);
    expect(manual.slice(-2).map((a) => [a.id, a.tone])).toEqual([
      ['deleteLabel', 'danger'],
      ['deleteOrder', 'danger'],
    ]);
    expect(orderRowActions(byId(amazonOpen.id), h, t).some((a) => a.id === 'messageBuyer')).toBe(true);
    expect(orderRowActions(byId(amazonOpen.id), h, t).some((a) => a.id === 'deleteLabel')).toBe(false);
    orderRowActions(byId(amazonOpen.id), h, t).find((a) => a.id === 'addTracking')?.onClick?.();
    expect(h.addTracking).toHaveBeenCalled();
  });
});

describe('bulk helpers', () => {
  it('builds the address TSV with the legacy column order and strips tabs/newlines', () => {
    const tsv = buildAddressesTsv([byId(amazonOpen.id)], ['No', 'Name', 'L1', 'L2', 'City', 'State', 'Postal', 'Country', 'Phone', 'Email']);
    const [header, line] = tsv.split('\n');
    expect(header.split('\t')).toHaveLength(10);
    expect(line.split('\t')[0]).toBe(amazonOpen.orderNumber);
    expect(line).toContain('1 Main St');
  });
  it('opens print pages with unique ids, capped at PRINT_MAX_IDS, and reports blocked pop-ups', () => {
    const win = { opener: {} } as unknown as Window;
    const opener = vi.fn(() => win);
    const many = Array.from({ length: PRINT_MAX_IDS + 5 }, (_, i) => `id${i}`);
    const res = openPrintPage('pick-list', [...many, 'id0'], opener);
    expect(res).toEqual({ ok: true, truncated: true, opened: PRINT_MAX_IDS, max: PRINT_MAX_IDS });
    expect(win.opener).toBeNull();
    expect(openPrintPage('packing-slips', ['a'], () => null)).toEqual({ ok: false, reason: 'blocked' });
    expect(openPrintPage('packing-slips', [])).toEqual({ ok: false, reason: 'empty' });
    expect(printPageUrl('packing-slips', ['a', 'b', 'a'])).toBe('/app/print/packing-slips?ids=a%2Cb');
  });
});

describe('empty states (orders §7.1)', () => {
  it('filters → no-results; no store connected → first-use; otherwise the view is done', () => {
    expect(ordersEmptyKind({ view: 'to_ship', empty: false, filtered: false, anyStoreConnected: true })).toBeNull();
    expect(ordersEmptyKind({ view: 'to_ship', empty: true, filtered: true, anyStoreConnected: false })).toBe('no-results');
    expect(ordersEmptyKind({ view: 'to_ship', empty: true, filtered: false, anyStoreConnected: false })).toBe('first-use');
    expect(ordersEmptyKind({ view: 'to_ship', empty: true, filtered: false, anyStoreConnected: undefined })).toBe('view-done');
  });
});
