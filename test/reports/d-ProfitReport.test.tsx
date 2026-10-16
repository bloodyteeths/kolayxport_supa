// @vitest-environment jsdom
// M9 Group D render tests: Reports › Profit inside the real ReportsPage frame (Group C) with fetch stubbed by URL.
// Covers §2.2 (KPIs, P&L with coverage, banners, product table), §4.1 (state-driven primary), §4.6 (unit cost cell
// saves the dashboard currency, no marketplace write), §3 states (never synced + refresh POST, not supported,
// connect, locked / shopify_free neutral = no finance request) and EN/TR formatting.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import fixture from '@/__tests__/fixtures/reports/finance-dashboard.json';
import { D_EN, D_TR, FRAME_EN, FRAME_TR } from './d-messages';

const NOW = new Date('2026-10-15T08:00:00Z');

const h = vi.hoisted(() => ({
  router: {
    pathname: '/app/reports/profit',
    asPath: '/app/reports/profit',
    query: {} as Record<string, string>,
    isReady: true,
    push: (() => Promise.resolve(true)) as (...a: unknown[]) => Promise<boolean>,
    replace: (() => Promise.resolve(true)) as (...a: unknown[]) => Promise<boolean>,
    events: { on: () => undefined, off: () => undefined },
  },
  toast: { success: (() => '') as (...a: unknown[]) => string, error: (() => '') as (...a: unknown[]) => string, info: (() => '') as (...a: unknown[]) => string, dismiss: () => undefined },
  access: { value: 'allowed' },
  conn: { connections: null as Record<string, { connected: boolean; needsReauth: boolean; accounts: unknown[] }> | null },
}));
vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-apexcharts', () => ({ default: () => <div data-testid="apex" /> }));
vi.mock('@/components/ds/feedback/toast', async (orig) => ({ ...(await orig<object>()), useToast: () => h.toast }));
vi.mock('@/lib/billing/useFeatureAction', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useFeatureAccess: () => ({ access: h.access.value, entitlement: undefined }) };
});
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => {
    const c = h.conn.connections;
    return {
      connections: c, extension: null, isLoading: !c, isValidating: false, error: undefined,
      has: (p: string) => (c ? Boolean(c[p]?.connected) : undefined),
      get: (p: string) => c?.[p], anyMarketplace: c ? Object.values(c).some((e) => e.connected) : undefined,
      needsReauth: [], mutate: async () => undefined,
    };
  },
}));

import { ProfitReport } from '@/components/domain/reports/profit/ProfitReport';

type Obj = Record<string, unknown>;
const merge = (a: Obj, b: Obj): Obj => {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k] as Obj, v as Obj) : v;
  return out;
};
const MESSAGES = {
  en: merge(merge(en as Obj, FRAME_EN as Obj), D_EN as Obj),
  tr: merge(merge(tr as Obj, FRAME_TR as Obj), D_TR as Obj),
};

type Route = { status: number; body: unknown };
let dashboard: Route;
/** Dashboards per marketplace other than the default route; `'hang'` never resolves (a slow fetch). */
let dashboardFor: Record<string, Route | 'hang'> = {};
let savedCosts: unknown[] = [];
let onSync: (() => void) | null = null;
let calls: Array<{ url: string; method: string; body: Obj | null }> = [];
const entry = (connected: boolean) => ({ connected, needsReauth: false, accounts: [] });

function stubFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('/api/finance/dashboard')) {
      const mpq = new URL(url, 'http://x').searchParams.get('marketplace') ?? '';
      const r = dashboardFor[mpq];
      if (r === 'hang') return new Promise<Response>(() => undefined);
      const route = r ?? dashboard;
      return json(route.status, route.body);
    }
    if (url.startsWith('/api/finance/settlements') && method === 'POST') { onSync?.(); return json(200, { totalUpserted: 24 }); }
    if (url.startsWith('/api/finance/product-costs')) {
      if (method === 'POST') return json(200, { id: 'c1', marketplace: 'etsy', barcode: 'BB-01', productName: 'Blanket', costAmount: 12, costCurrency: 'USD' });
      if (method === 'PUT') return json(200, { id: 'c1', marketplace: 'etsy', barcode: 'BB-01', productName: 'Blanket', costAmount: 12, costCurrency: 'USD' });
      return json(200, url.includes('sold_products') ? { products: [] } : { costs: savedCosts, totalPages: 1 });
    }
    return json(404, {});
  }));
}

function renderProfit(locale: 'en' | 'tr' = 'en') {
  return render(tree(locale));
}
function tree(locale: 'en' | 'tr' = 'en') {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale] as never}
        timeZone="Europe/Istanbul"
        now={NOW}
        onError={(e) => { if (e.code === 'MISSING_MESSAGE') throw e; }}
      >
        <FormatProvider timeZone="Europe/Istanbul">
          <ThemeProvider theme={theme}>
            <ProfitReport now={NOW} />
          </ThemeProvider>
        </FormatProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const financeCalls = () => calls.filter((c) => c.url.startsWith('/api/finance/'));

beforeEach(() => {
  h.router.query = { mp: 'etsy', from: '2026-09-01', to: '2026-09-30', preset: 'custom' };
  h.access.value = 'allowed';
  h.conn.connections = { etsy: entry(true), ebay: entry(true), amazon: entry(false), trendyol: entry(false) };
  dashboard = { status: 200, body: JSON.parse(JSON.stringify(fixture)) };
  dashboardFor = {};
  savedCosts = [];
  onSync = null;
  h.router.replace = vi.fn(() => Promise.resolve(true));
  h.toast.success = vi.fn(() => '');
  h.toast.error = vi.fn(() => '');
  h.toast.info = vi.fn(() => '');
  stubFetch();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Profit tab, ready (EN)', () => {
  it('asks the dashboard for local days in the seller timezone with the previous period', async () => {
    renderProfit();
    await settle();
    const req = financeCalls().find((c) => c.url.startsWith('/api/finance/dashboard'));
    expect(req).toBeTruthy();
    const q = new URL(req!.url, 'http://x').searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ marketplace: 'etsy', from: '2026-09-01', to: '2026-09-30', tz: 'Europe/Istanbul', compare: 'previous', granularity: 'day' });
  });

  it('KPIs in the settlement currency, cost banner, coverage line, state-driven primary', async () => {
    renderProfit();
    await settle();
    const kpis = screen.getByTestId('profit-kpis');
    expect(within(screen.getByTestId('kpi-net-sales')).getByText('$14,212.30')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-costs')).getByText('$5,904.12')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-net-profit')).getByText('$8,308.18')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-net-profit')).getByText('Excludes product cost for 14 products')).toBeTruthy();
    expect(within(kpis).getByText('603 orders')).toBeTruthy();
    expect(screen.getByTestId('profit-banner-cost').textContent).toContain('Product cost is missing for 14 of 32 products');
    expect(screen.getByTestId('profit-banner-pending').textContent).toContain("9 orders aren't settled by Etsy yet.");
    expect(screen.getByTestId('profit-banner-pending').textContent).toContain('4 cancellations have no refund yet.');
    const statement = screen.getByTestId('profit-statement');
    expect(within(statement).getByText('Product cost (18 of 32)')).toBeTruthy();
    const fees = statement.querySelector('[data-line="fees"]')?.textContent ?? '';
    expect(fees).toMatch(/^Marketplace fees[-−]\$2,104\.22/);
    expect(screen.getAllByRole('button', { name: 'Add product costs' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Export CSV' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('profit-meta').textContent).toContain('Etsy payments ledger');
    expect(screen.getByTestId('profit-meta').textContent).toContain('Amounts in $');
  });

  it('product table: missing cost shows "Add cost"; no barcode/SKU is read-only; a cost saves in the dashboard currency', async () => {
    renderProfit();
    await settle();
    const table = screen.getByTestId('profit-products');
    expect(within(table).getByTestId('add-cost-NN-G')).toBeTruthy();
    expect(within(table).queryByTestId('add-cost-Mystery Item')).toBeNull();
    const edit = within(table).getAllByRole('button', { name: /Unit cost/ })[0];
    fireEvent.click(edit);
    const input = within(table).getByRole('textbox', { name: 'Unit cost' });
    fireEvent.change(input, { target: { value: '12.00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    const post = financeCalls().find((c) => c.method === 'POST' && c.url.startsWith('/api/finance/product-costs'));
    expect(post?.body).toMatchObject({ action: 'upsert_by_barcode', marketplace: 'etsy', barcode: 'BB-01', costAmount: 12, costCurrency: 'USD' });
    expect(h.toast.success).toHaveBeenCalledWith('Cost saved');
    // Nothing is written to a marketplace: only KolayXport finance endpoints were called.
    expect(calls.every((c) => c.url.startsWith('/api/finance/'))).toBe(true);
  });

  it('the delta label names the window the server compared against (Sep 1–30 → Aug 2–31, not Aug 1–31)', async () => {
    renderProfit();
    await settle();
    // The tile says "vs previous 30 days"; the exact server window is the tooltip (aria-label) of that line.
    const kpis = screen.getByTestId('profit-kpis').innerHTML;
    expect(kpis).toMatch(/Aug 2\s*[–-]\s*31/);
    expect(kpis).not.toMatch(/Aug 1\s*[–-]/);
  });

  it('a range starting on the 1st (Oct 1–15) is labelled with the server window Sep 16–30', async () => {
    h.router.query = { mp: 'etsy', from: '2026-10-01', to: '2026-10-15', preset: 'custom' };
    (dashboard.body as Obj).previous = { from: '2026-09-16', to: '2026-09-30' };
    renderProfit();
    await settle();
    const kpis = screen.getByTestId('profit-kpis').innerHTML;
    expect(kpis).toMatch(/Sep 16\s*[–-]\s*30/);
    expect(kpis).not.toMatch(/Sep 1\s*[–-]\s*15/);
  });

  it('switching marketplace never shows (or edits) the previous marketplace\'s numbers while the new one loads', async () => {
    dashboardFor = { ebay: 'hang' };
    const r = renderProfit();
    await settle();
    expect(screen.getByTestId('profit-body')).toBeTruthy();
    h.router.query = { ...h.router.query, mp: 'ebay' };
    r.rerender(tree());
    await settle();
    expect(screen.queryByTestId('profit-body')).toBeNull();
    expect(screen.queryByTestId('profit-products')).toBeNull();
    expect(screen.getByTestId('profit-skeleton')).toBeTruthy();
    expect(screen.queryByText('$14,212.30')).toBeNull();
  });

  it('a TRY cost with shipping is not re-labelled USD from the cell: nothing written, the panel opens', async () => {
    savedCosts = [{ id: 'c9', marketplace: 'etsy', barcode: 'BB-01', sku: 'SKU-REAL', productName: 'Blanket', costAmount: '300', costCurrency: 'TRY', shippingCost: '40' }];
    renderProfit();
    await settle();
    const table = screen.getByTestId('profit-products');
    fireEvent.click(within(table).getAllByRole('button', { name: /Unit cost/ })[0]);
    const input = within(table).getByRole('textbox', { name: 'Unit cost' });
    fireEvent.change(input, { target: { value: '12.00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(financeCalls().some((c) => c.url.startsWith('/api/finance/product-costs') && c.method !== 'GET')).toBe(false);
    expect(h.toast.error).toHaveBeenCalledWith('Shipping for this product is saved in TRY. Enter unit cost and shipping in USD in Product costs.');
    expect(screen.getByTestId('product-costs-panel')).toBeTruthy();
  });

  it('"One product" needs a barcode or SKU: no orphan cost is saved', async () => {
    renderProfit();
    await settle();
    // Open the panel at the product with no barcode/SKU: the name is prefilled, the code is empty.
    fireEvent.click(within(screen.getByTestId('profit-products')).getAllByText('Mystery Item')[0]);
    await settle();
    const panel = screen.getByTestId('product-costs-panel');
    expect((within(panel).getByTestId('costs-code').querySelector('input') as HTMLInputElement | null)?.value ?? '').toBe('');
    const unit = within(panel).getByTestId('costs-unit').querySelector('input') ?? within(panel).getByTestId('costs-unit');
    fireEvent.change(unit, { target: { value: '5' } });
    fireEvent.blur(unit);
    fireEvent.click(within(panel).getByRole('button', { name: 'Add cost' }));
    await settle();
    expect(within(panel).getByText('no barcode or SKU')).toBeTruthy();
    expect(financeCalls().some((c) => c.url.startsWith('/api/finance/product-costs') && c.method === 'POST')).toBe(false);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it('the product search is URL state `q`', async () => {
    h.router.query = { ...h.router.query, q: 'blanket' };
    renderProfit();
    await settle();
    const search = within(screen.getByTestId('profit-products-search')).getByTestId('search-field-input') as HTMLInputElement;
    expect(search.value).toBe('blanket');
    fireEvent.change(search, { target: { value: 'necklace' } });
    fireEvent.keyDown(search, { key: 'Enter' }); // SearchField commits on Enter (else after its debounce)
    expect(h.router.replace).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ q: 'necklace' }) }), undefined, expect.anything());
  });

  it('with every cost present the primary is Export CSV', async () => {
    const body = dashboard.body as Obj;
    body.costCoverage = { products: 32, productsWithCost: 32, unitsWithoutCost: 0 };
    // Coverage agrees with the rows (no row shows "Add cost").
    body.productBreakdown = (body.productBreakdown as Obj[]).map((p) => ({ ...p, unitCost: 1, cogs: Number(p.quantity) }));
    renderProfit();
    await settle();
    expect(screen.queryByTestId('profit-banner-cost')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add product costs' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Export CSV' }).length).toBeGreaterThan(0);
  });
});

describe('Profit tab, TR', () => {
  it('Turkish copy and number grouping', async () => {
    renderProfit('tr');
    await settle();
    expect(within(screen.getByTestId('kpi-net-sales')).getByText('Net satış')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-net-sales')).getByText('$14.212,30')).toBeTruthy();
    expect(screen.getByTestId('profit-banner-cost').textContent).toContain('32 ürünün 14 tanesinde maliyet eksik');
    expect(within(screen.getByTestId('profit-statement')).getByText('Ürün maliyeti (32 üründen 18)')).toBeTruthy();
  });
});

describe('Profit tab, states', () => {
  it('never synced: one "Refresh from Etsy" action that runs the ledger sync and toasts new rows', async () => {
    dashboard = { status: 200, body: { marketplace: 'etsy', summary: { currency: 'USD' }, lastSyncedAt: null, timeSeries: [], productBreakdown: [], transactionTypeSummary: {}, disbursements: [] } };
    // The sync stores 24 rows: the toast counts the ledger rows that appeared, not `totalUpserted`.
    onSync = () => {
      dashboard = { status: 200, body: { ...JSON.parse(JSON.stringify(fixture)), transactionTypeSummary: [{ type: 'Sale', category: 'revenue', total: 100, count: 20 }, { type: 'Fee', category: 'commission', total: -5, count: 4 }] } };
    };
    renderProfit();
    await settle();
    expect(screen.getByTestId('profit-never').textContent).toContain('Get your Etsy payments');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    fireEvent.click(within(screen.getByTestId('profit-never')).getByRole('button', { name: 'Refresh from Etsy' }));
    await settle();
    const sync = financeCalls().find((c) => c.method === 'POST' && c.url.startsWith('/api/finance/settlements'));
    expect(sync?.body).toMatchObject({ action: 'sync', marketplace: 'etsy' });
    expect(h.toast.info).toHaveBeenCalledWith('24 new transactions from Etsy');
  });

  it('a refresh that only re-upserts stored rows shows no "new transactions" toast', async () => {
    renderProfit();
    await settle();
    fireEvent.click(within(screen.getByTestId('profit-meta')).getByRole('button', { name: /Refresh|Etsy/ }));
    await settle();
    expect(financeCalls().some((c) => c.method === 'POST' && c.url.startsWith('/api/finance/settlements'))).toBe(true);
    expect(h.toast.info).not.toHaveBeenCalled();
  });

  it('a deep link to an unsupported marketplace explains which ones are supported and fetches nothing', async () => {
    h.router.query = { mp: 'wix' };
    renderProfit();
    await settle();
    expect(screen.getByTestId('profit-not-supported').textContent).toContain('Profit reports are available for Etsy, eBay, Amazon and Trendyol.');
    expect(financeCalls()).toHaveLength(0);
  });

  it('not connected: ConnectState, no request', async () => {
    h.router.query = { mp: 'amazon' };
    renderProfit();
    await settle();
    expect(screen.getByTestId('profit-connect').textContent).toContain('Connect Amazon to see your profit');
    expect(financeCalls()).toHaveLength(0);
  });

  it('locked (Stripe) and shopify_free (neutral): no finance request, no header actions', async () => {
    for (const access of ['locked', 'neutral'] as const) {
      h.access.value = access;
      stubFetch();
      const r = renderProfit();
      await settle();
      expect(financeCalls()).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Add product costs' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
      if (access === 'neutral') {
        expect(screen.queryByText(/See plans/)).toBeNull();
        expect(document.body.innerHTML).not.toContain('/fiyatlandirma');
      }
      r.unmount();
    }
  });

  it('a failed dashboard load shows the page error with retry', async () => {
    dashboard = { status: 500, body: { error: 'boom' } };
    renderProfit();
    await settle();
    expect(screen.getByTestId('profit-error').textContent).toContain("Couldn't load Etsy payments");
  });
});
