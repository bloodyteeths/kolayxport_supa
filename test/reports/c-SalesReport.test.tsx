// @vitest-environment jsdom
// M9 Group C render tests: Reports frame (tabs, Home link, Pro gating of tabs) and Reports › Sales states (§3):
// ready (EN/TR), connections unknown, no store, zero orders, whole error, stale-rate banners, null delta.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { normalizeSalesReport, type SalesReport as SalesReportData } from '@/lib/reports/useSalesReport';
import fixture from '../../__tests__/fixtures/reports/sales.json';
import { setViewport } from '../ds/m1e-helpers';
import { C_EN, C_TR } from './c-messages';

const NOW = new Date('2026-10-15T07:45:00Z');

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/reports',
  asPath: '/app/reports',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  push: vi.fn(async () => true),
  replace: vi.fn(async () => true),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-apexcharts', () => ({ default: () => <div data-testid="apex" /> }));

type Entry = { connected: boolean; needsReauth: boolean; accounts: { id: string; name: string; externalId: null }[] };
const conn: { connections: Record<string, Entry> | null; error?: Error } = { connections: null };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => {
    const c = conn.connections;
    return {
      connections: c,
      extension: null,
      isLoading: !c && !conn.error,
      isValidating: false,
      error: conn.error,
      has: (p: string) => (c ? Boolean(c[p]?.connected) : undefined),
      get: (p: string) => c?.[p],
      anyMarketplace: c ? ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada'].some((p) => c[p]?.connected) : undefined,
      needsReauth: [],
      mutate: vi.fn(),
    };
  },
}));

const gate: { access: string } = { access: 'allowed' };
vi.mock('@/lib/billing/useFeatureAction', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useFeatureAccess: () => ({ access: gate.access, entitlement: undefined }) };
});

const sales: { data?: SalesReportData; error?: Error & { requestId?: string | null }; isLoading: boolean; isValidating: boolean } = {
  isLoading: true,
  isValidating: false,
};
const mutate = vi.fn(async () => undefined);
vi.mock('@/lib/reports/useSalesReport', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useSalesReport: () => ({
      data: sales.data,
      error: sales.error,
      isLoading: sales.isLoading,
      isValidating: sales.isValidating,
      isPrevious: false,
      mutate,
      url: '/api/analytics',
    }),
  };
});

import { SalesReport } from '@/components/domain/reports/sales/SalesReport';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, C_EN as unknown as Obj), tr: deepMerge(tr as Obj, C_TR as unknown as Obj) };

async function renderSales(locale: 'en' | 'tr' = 'en') {
  const r = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <SalesReport now={NOW} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  await act(async () => {});
  return r;
}

const entry = (connected: boolean, name = ''): Entry => ({ connected, needsReauth: false, accounts: connected ? [{ id: `${name}-1`, name, externalId: null }] : [] });
const ready = () => {
  sales.data = normalizeSalesReport(fixture);
  sales.isLoading = false;
};

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  router.query = {};
  router.replace.mockClear();
  conn.connections = { etsy: entry(true, 'BelleCoutureGifts'), trendyol: entry(true, 'Trendyol'), ebay: entry(false) };
  conn.error = undefined;
  gate.access = 'allowed';
  sales.data = undefined;
  sales.error = undefined;
  sales.isLoading = true;
  sales.isValidating = false;
  mutate.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────
describe('Reports frame', () => {
  it('four route tabs; Sales links Home (/app/analytics) and keeps the shared range', async () => {
    ready();
    router.query = { preset: 'last7', stores: 'trendyol' };
    await renderSales();
    const tabs = screen.getByTestId('reports-tabs');
    const links = within(tabs).getAllByRole('tab');
    expect(links.map((l) => l.textContent)).toEqual(['Sales', 'Profit', 'Payouts', 'Transactions']);
    expect(links[0].getAttribute('href')).toBe('/app/analytics?preset=last7');
    expect(links[1].getAttribute('href')).toBe('/app/reports/profit?preset=last7');
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeTruthy();
  });

  it('neutral account (shopify_free): no gated tabs, so no Tabs row and no Pro wording', async () => {
    ready();
    gate.access = 'neutral';
    await renderSales();
    expect(screen.queryByTestId('reports-tabs')).toBeNull();
    expect(screen.queryByText(/^Pro$/)).toBeNull();
  });

  it('while the entitlement loads the gated tabs are held back (no flash) and the row space is reserved', async () => {
    ready();
    gate.access = 'loading';
    await renderSales();
    expect(screen.queryByTestId('reports-tabs')).toBeNull();
    expect(screen.getByTestId('reports-tabs-pending')).toBeTruthy();
  });

  it('a resolved neutral account drops the reserved row too', async () => {
    ready();
    gate.access = 'neutral';
    await renderSales();
    expect(screen.queryByTestId('reports-tabs-pending')).toBeNull();
  });
});

describe('Sales states', () => {
  it('ready (EN): KPIs with ≈, excluded orders caption, no-baseline delta, tables, banners, Export CSV', async () => {
    ready();
    await renderSales();
    const revenue = screen.getByTestId('kpi-revenue');
    expect(revenue.textContent).toContain('≈');
    expect(revenue.textContent).toContain('Excludes 12 orders');
    expect(revenue.textContent).toContain('vs');
    expect(within(screen.getByTestId('kpi-units')).getByTestId('kpi-no-baseline')).toBeTruthy();
    expect(screen.getByTestId('sales-banner-unconverted').textContent).toContain('12 orders in CAD left out of totals');
    expect(screen.getByText('Sales by store')).toBeTruthy();
    expect(screen.getAllByText('BelleCoutureGifts').length).toBeGreaterThan(0);
    // Shop rows link with their exact raw value; a merged marketplace bucket without `rawMarketplaces` is plain text.
    expect(screen.getByTestId('store-link-etsy:bellecouturegifts').getAttribute('href')).toMatch(/=BelleCoutureGifts(&|$)/);
    expect(screen.queryByTestId('store-link-trendyol')).toBeNull();
    // Amazon's CAD orders had no rate: the row says so instead of passing a partial total as converted.
    expect(screen.getByTestId('store-excluded-amazon').textContent).toBe('Excludes 12 orders');
    expect(screen.getByText('Personalized Baby Blanket')).toBeTruthy();
    expect(screen.getByTestId('status-row-shipped').textContent).toContain('1,120');
    expect(screen.getByTestId('sales-fx-meta').textContent).toContain('exchangerate-api.com');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    expect(screen.getByTestId('sales-trend-chart')).toBeTruthy();
  });

  it('ready (TR): Turkish copy and TR money grouping, never "TRY 1,070…"', async () => {
    ready();
    await renderSales('tr');
    expect(screen.getByRole('heading', { level: 1, name: 'Raporlar' })).toBeTruthy();
    const revenue = screen.getByTestId('kpi-revenue').textContent ?? '';
    expect(revenue).toContain('Ciro');
    expect(revenue).toContain('₺');
    expect(revenue).not.toContain('TRY');
    expect(screen.getByTestId('status-row-shipped').textContent).toContain('1.120');
  });

  it('connections unknown → skeleton, never the connect screen', async () => {
    conn.connections = null;
    await renderSales();
    expect(screen.getByTestId('sales-loading')).toBeTruthy();
    expect(screen.queryByTestId('sales-connect')).toBeNull();
  });

  it('no store connected → the 3-step connect checklist with store tiles, no Export, no toolbar', async () => {
    conn.connections = { etsy: entry(false), trendyol: entry(false) };
    sales.isLoading = false;
    await renderSales();
    expect(screen.getByTestId('sales-connect').textContent).toContain('Set up KolayXport in 3 steps');
    expect(screen.getByTestId('checklist-store-etsy').getAttribute('href')).toBe('/api/integrations/etsy/connect');
    expect(screen.getByTestId('checklist-store-trendyol').getAttribute('href')).toBe('/ayarlar?tab=connections&provider=trendyol');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.queryByTestId('reports-toolbar')).toBeNull();
  });

  it('zero orders → "No orders in this period" + Show last 90 days (writes preset=last90)', async () => {
    const empty = normalizeSalesReport({ ...fixture, totals: { ...fixture.totals, orders: 0, revenue: 0 }, stores: [], products: [], statuses: [] });
    sales.data = empty;
    sales.isLoading = false;
    await renderSales();
    expect(screen.getByTestId('sales-empty').textContent).toContain('No orders in this period');
    fireEvent.click(screen.getByRole('button', { name: 'Show last 90 days' }));
    expect(router.replace).toHaveBeenCalled();
    const arg = router.replace.mock.calls.at(-1)?.[0] as { query: Record<string, string> };
    expect(arg.query.preset).toBe('last90');
    // Export is disabled with its reason (P1).
    expect(screen.getByRole('button', { name: 'Export CSV' }).hasAttribute('disabled') || screen.getByRole('button', { name: 'Export CSV' }).getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('zero orders with a Store filter → No stores match + Clear filters', async () => {
    router.query = { stores: 'amazon' };
    sales.data = normalizeSalesReport({ ...fixture, totals: { ...fixture.totals, orders: 0 }, stores: [] });
    sales.isLoading = false;
    await renderSales();
    expect(screen.getByTestId('sales-empty-filtered').textContent).toContain('No stores match this filter');
  });

  it('rawMarketplaces from the API → the store links with the exact raw value', async () => {
    sales.data = normalizeSalesReport({ ...fixture, stores: fixture.stores.map((st) => (st.key === 'trendyol' ? { ...st, rawMarketplaces: ['trendyol'] } : st)) });
    sales.isLoading = false;
    await renderSales();
    const href = screen.getByTestId('store-link-trendyol').getAttribute('href') ?? '';
    expect(href).toContain('/app/labels');
    expect(href).toMatch(/=trendyol(&|$)/);
  });

  it('400 range_too_long → explains the limit, no retrying page error', async () => {
    sales.isLoading = false;
    sales.error = Object.assign(new Error('x'), { status: 400, requestId: null });
    await renderSales();
    expect(screen.getByTestId('sales-range-too-long').textContent).toContain('Choose a range of up to 2 years');
    expect(screen.queryByTestId('sales-error')).toBeNull();
  });

  it('whole error → page ErrorState with retry', async () => {
    sales.isLoading = false;
    sales.error = Object.assign(new Error('x'), { requestId: 'req-1' });
    await renderSales();
    expect(screen.getByTestId('sales-error').textContent).toContain("Couldn't load your sales");
  });

  it('stale exchange rates → warning banner naming the rates date', async () => {
    const data = normalizeSalesReport({ ...fixture, fx: { ...fixture.fx, stale: true, excluded: [] } });
    sales.data = data;
    sales.isLoading = false;
    await renderSales();
    expect(screen.getByTestId('sales-banner-stale-rates').textContent).toContain("Exchange rates couldn't be updated");
    expect(screen.queryByTestId('sales-banner-unconverted')).toBeNull();
  });
});
