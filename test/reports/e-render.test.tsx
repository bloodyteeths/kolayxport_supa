// @vitest-environment jsdom
// M9 Group E render tests: Reports › Payouts and Reports › Transactions inside the real ReportsPage frame (Group C)
// and data layer (Group D `useFinanceReport`, Group E `useTransactions`), with fetch stubbed by URL.
// Covers §3 states (ready, locked = no fetch, not connected, never synced, error), §2.3 tiles, the B16 raw type
// tooltip, the category filter param, the refresh POST, and EN/TR.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import fixture from '@/__tests__/fixtures/reports/transactions.json';
import { toastController } from '@/components/ds/feedback/toast';
import { E_EN, E_TR } from './e-messages';

const NOW = new Date('2026-10-15T08:00:00Z');

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/reports/payouts',
  asPath: '/app/reports/payouts',
  query: {} as Record<string, string>,
  isReady: true,
  push: vi.fn(async () => true),
  replace: vi.fn(async () => true),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-apexcharts', () => ({ default: () => <div data-testid="apex" /> }));

const accessState: { value: string } = { value: 'allowed' };
vi.mock('@/lib/billing/useFeatureAction', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useFeatureAccess: () => ({ access: accessState.value, entitlement: undefined }) };
});

type Entry = { connected: boolean; needsReauth: boolean; accounts: { id: string; name: string; externalId: null }[] };
const conn: { connections: Record<string, Entry> | null } = { connections: null };
const entry = (connected: boolean): Entry => ({ connected, needsReauth: false, accounts: connected ? [{ id: 'a', name: 'Shop', externalId: null }] : [] });
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => {
    const c = conn.connections;
    return {
      connections: c,
      extension: null,
      isLoading: !c,
      isValidating: false,
      error: undefined,
      has: (p: string) => (c ? Boolean(c[p]?.connected) : undefined),
      get: (p: string) => c?.[p],
      anyMarketplace: c ? Object.values(c).some((e) => e.connected) : undefined,
      needsReauth: [],
      mutate: vi.fn(),
    };
  },
}));

import { PayoutsReport } from '@/components/domain/reports/payouts/PayoutsReport';
import { TransactionsReport } from '@/components/domain/reports/transactions/TransactionsReport';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, E_EN as unknown as Obj), tr: deepMerge(tr as Obj, E_TR as unknown as Obj) };

type Route = { status: number; body: unknown };
const routes: { dashboard: Route; settlements: Route; sync: Route } = {
  dashboard: { status: 200, body: fixture.dashboard },
  settlements: { status: 200, body: fixture.settlements },
  sync: { status: 200, body: { totalUpserted: 0 } },
};
const calls: Array<{ url: string; method: string; body?: string }> = [];

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    const r = url.startsWith('/api/finance/dashboard')
      ? routes.dashboard
      : url.startsWith('/api/finance/settlements')
        ? (method === 'POST' ? routes.sync : routes.settlements)
        : { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

function tabTree(tab: 'payouts' | 'transactions', locale: 'en' | 'tr' = 'en') {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          {tab === 'payouts' ? <PayoutsReport now={NOW} /> : <TransactionsReport now={NOW} />}
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
}

function renderTab(tab: 'payouts' | 'transactions', locale: 'en' | 'tr' = 'en') {
  router.pathname = `/app/reports/${tab}`;
  router.asPath = `/app/reports/${tab}`;
  return render(tabTree(tab, locale));
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const financeCalls = () => calls.filter((c) => c.url.startsWith('/api/finance/'));

beforeEach(() => {
  router.query = { mp: 'etsy' };
  accessState.value = 'allowed';
  conn.connections = { etsy: entry(true), ebay: entry(true), amazon: entry(false), trendyol: entry(false) };
  routes.dashboard = { status: 200, body: fixture.dashboard };
  routes.settlements = { status: 200, body: fixture.settlements };
  routes.sync = { status: 200, body: { totalUpserted: 0 } };
  calls.length = 0;
  try { window.localStorage.clear(); } catch { /* ignore */ }
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Payouts ─────────────────────────────────────────────────────────────────────────────────────────────
describe('PayoutsReport', () => {
  it('ready: paid / estimated balance tiles, no held tile for Etsy, chart, newest-first table, Export CSV, meta', async () => {
    renderTab('payouts');
    await settle();
    const paid = screen.getByTestId('payouts-kpi-paid');
    expect(paid.textContent).toContain('Paid to bank');
    expect(paid.textContent).toContain('$9,120.00');
    expect(paid.textContent).toContain('4 payouts');
    const balance = screen.getByTestId('payouts-kpi-balance');
    expect(balance.textContent).toContain('Balance on Etsy');
    expect(within(balance).getByTestId('payouts-balance-estimate').textContent).toContain('$1,204.55');
    expect(screen.queryByTestId('payouts-kpi-held')).toBeNull();
    expect(screen.getByTestId('payouts-chart')).toBeTruthy();
    const table = screen.getByTestId('payouts-table');
    expect(table.textContent).toContain('$2,300.00');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    const meta = screen.getByTestId('finance-meta');
    expect(meta.textContent).toContain('Etsy payments ledger');
    expect(meta.textContent).toContain('Amounts in $');
    const dash = financeCalls().find((c) => c.url.startsWith('/api/finance/dashboard'));
    expect(dash?.url).toContain('marketplace=etsy');
    expect(dash?.url).toContain('compare=previous');
  });

  it('eBay with held funds: third tile, balance is measured (no "~" estimate)', async () => {
    router.query = { mp: 'ebay' };
    routes.dashboard = {
      status: 200,
      body: { ...fixture.dashboard, marketplace: 'ebay', summary: { ...fixture.dashboard.summary, heldFunds: 310 } },
    };
    renderTab('payouts');
    await settle();
    expect(screen.getByTestId('payouts-kpi-held').textContent).toContain('Held by eBay');
    expect(screen.queryByTestId('payouts-balance-estimate')).toBeNull();
  });

  it('no balance reported: "—" with the reason', async () => {
    routes.dashboard = { status: 200, body: { ...fixture.dashboard, summary: { ...fixture.dashboard.summary, currentBalance: null } } };
    renderTab('payouts');
    await settle();
    expect(screen.getByTestId('payouts-balance-none').textContent).toBe('—');
  });

  it('locked (financials not in plan): locked body, no finance request, no Export CSV', async () => {
    accessState.value = 'locked';
    renderTab('payouts');
    await settle();
    expect(screen.getByTestId('reports-gate-payouts').textContent).toContain('See plans');
    expect(financeCalls()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });

  it('marketplace not connected: ConnectState, no finance request', async () => {
    router.query = { mp: 'amazon' };
    renderTab('payouts');
    await settle();
    expect(screen.getByTestId('finance-connect').textContent).toContain('Connect Amazon to see your payouts');
    expect(financeCalls()).toHaveLength(0);
  });

  it('unsupported deep link (Wix): not-supported empty state', async () => {
    router.query = { mp: 'wix' };
    renderTab('payouts');
    await settle();
    expect(screen.getByTestId('finance-not-supported').textContent).toContain('Finance reports are available for Etsy, eBay, Amazon and Trendyol.');
  });

  it('no payouts in range: tiles stay, quiet empty state, Export CSV disabled with a reason', async () => {
    routes.dashboard = { status: 200, body: { ...fixture.dashboard, disbursements: [], summary: { ...fixture.dashboard.summary, banked: 0, disbursementCount: 0 } } };
    renderTab('payouts');
    await settle();
    expect(screen.getByTestId('payouts-kpi-paid')).toBeTruthy();
    expect(screen.getByTestId('payouts-empty').textContent).toContain('No payouts in this period');
    const btn = screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement;
    expect(btn.disabled || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('no lastSyncedAt: tiles say the ledger was not refreshed, never "{ledger} · now" (P6)', async () => {
    routes.dashboard = { status: 200, body: { ...fixture.dashboard, lastSyncedAt: null } };
    renderTab('payouts');
    await settle();
    const paid = screen.getByTestId('payouts-kpi-paid');
    expect(paid.textContent).toContain('Etsy payments ledger (not refreshed yet)');
  });

  it('⟳: one "new transactions" toast when the ledger grew; none on a later range change', async () => {
    const enqueue = vi.spyOn(toastController, 'enqueue');
    const grown = (n: number) => ({
      ...fixture.dashboard,
      transactionTypeSummary: { ...fixture.dashboard.transactionTypeSummary, Sale: { ...fixture.dashboard.transactionTypeSummary.Sale, count: 603 + n } },
    });
    renderTab('payouts');
    await settle();
    routes.dashboard = { status: 200, body: grown(3) };
    fireEvent.click(screen.getByTestId('sync-meta-pull'));
    await settle();
    const newTx = () => enqueue.mock.calls.filter(([i]) => /new transactions from Etsy/.test(String(i.message)));
    expect(newTx()).toHaveLength(1);
    expect(String(newTx()[0][0].message)).toContain('3 new transactions');
    enqueue.mockRestore();
  });

  it('TR: Turkish labels and locale money', async () => {
    renderTab('payouts', 'tr');
    await settle();
    const paid = screen.getByTestId('payouts-kpi-paid');
    expect(paid.textContent).toContain('Bankaya ödenen');
    expect(paid.textContent).toContain('$9.120,00');
    expect(screen.getByTestId('finance-meta').textContent).toContain('Etsy ödeme kayıtları');
  });
});

// ── Transactions ────────────────────────────────────────────────────────────────────────────────────────
describe('TransactionsReport', () => {
  it('ready: translated categories with the raw type behind them, copyable order, signed tone, count, paged request', async () => {
    renderTab('transactions');
    await settle();
    const table = screen.getByTestId('transactions-table');
    const types = within(table).getAllByTestId('tx-type');
    expect(types.map((n) => n.textContent)).toEqual(['Sale', 'Fee', 'Payout']);
    expect(types.map((n) => n.getAttribute('data-raw'))).toEqual(['Sale', 'EtsyFee', 'Disbursement']);
    expect(table.textContent).toContain('Personalized Baby Blanket');
    expect(table.textContent).toContain('3891204455');
    expect(table.querySelectorAll('[data-tone="success"]').length).toBe(1);
    expect(table.querySelectorAll('[data-tone="danger"]').length).toBe(2);
    expect(screen.getByTestId('transactions-report').textContent).toContain('1,284 transactions');
    const list = financeCalls().find((c) => c.url.startsWith('/api/finance/settlements') && c.method === 'GET');
    const u = new URL(list!.url, 'https://x');
    expect(u.searchParams.get('marketplace')).toBe('etsy');
    expect(u.searchParams.get('from')).toBe('2026-09-16');
    expect(u.searchParams.get('to')).toBe('2026-10-15');
    expect(u.searchParams.get('tz')).toBe('Europe/Istanbul');
    expect(u.searchParams.get('page')).toBe('0');
  });

  it('Type and page from the URL: category param and 0-based API page', async () => {
    router.query = { mp: 'etsy', type: 'disbursement', page: '2' };
    renderTab('transactions');
    await settle();
    const list = financeCalls().find((c) => c.url.startsWith('/api/finance/settlements') && c.method === 'GET');
    const u = new URL(list!.url, 'https://x');
    expect(u.searchParams.get('category')).toBe('disbursement');
    expect(u.searchParams.get('page')).toBe('1');
  });

  it('never synced: "Get your Etsy payments" with Refresh from Etsy, which POSTs a sync for the range', async () => {
    routes.settlements = { status: 200, body: fixture.settlementsEmptyNever };
    renderTab('transactions');
    await settle();
    const never = screen.getByTestId('finance-never');
    expect(never.textContent).toContain('Get your Etsy payments');
    fireEvent.click(within(never).getByRole('button', { name: 'Refresh from Etsy' }));
    await settle();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/finance/settlements');
    expect(JSON.parse(post!.body!)).toMatchObject({ action: 'sync', marketplace: 'etsy' });
  });

  it('a failed list request is an error, never "No transactions" (B14)', async () => {
    routes.settlements = { status: 400, body: { error: 'bad' } };
    renderTab('transactions');
    await settle();
    expect(screen.getByTestId('transactions-error').textContent).toContain("Couldn't load transactions");
    expect(screen.queryByTestId('transactions-empty')).toBeNull();
  });

  it('empty range with a Type filter offers Clear filters', async () => {
    router.query = { mp: 'etsy', type: 'adspend' };
    routes.settlements = { status: 200, body: { ...fixture.settlementsEmptyNever, syncCursor: fixture.settlements.syncCursor } };
    renderTab('transactions');
    await settle();
    const empty = screen.getByTestId('transactions-empty');
    expect(empty.textContent).toContain('No transactions in this period');
    expect(within(empty).getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('Export CSV downloads the server-side format=csv file for the whole range and type', async () => {
    router.query = { mp: 'etsy', type: 'revenue' };
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderTab('transactions');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await settle();
    const csv = calls.find((c) => c.url.includes('format=csv'));
    const u = new URL(csv!.url, 'https://x');
    expect(u.searchParams.get('category')).toBe('revenue');
    expect(u.searchParams.has('page')).toBe(false);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('⟳ with new rows: one "{count} new transactions" toast from the fresh total', async () => {
    const enqueue = vi.spyOn(toastController, 'enqueue');
    renderTab('transactions');
    await settle();
    routes.settlements = { status: 200, body: { ...fixture.settlements, total: (fixture.settlements.total as number) + 5 } };
    fireEvent.click(screen.getByTestId('sync-meta-pull'));
    await settle();
    const newTx = enqueue.mock.calls.filter(([i]) => /new transactions from Etsy/.test(String(i.message)));
    expect(newTx).toHaveLength(1);
    expect(String(newTx[0][0].message)).toContain('5 new transactions');
    enqueue.mockRestore();
  });

  it('a no-op ⟳ then a Type change shows no "new transactions" toast', async () => {
    const enqueue = vi.spyOn(toastController, 'enqueue');
    router.query = { mp: 'etsy', type: 'disbursement' };
    routes.settlements = { status: 200, body: { ...fixture.settlements, total: 3 } };
    const view = renderTab('transactions');
    await settle();
    fireEvent.click(screen.getByTestId('sync-meta-pull'));
    await settle();
    routes.settlements = { status: 200, body: { ...fixture.settlements, total: 240 } };
    router.query = { mp: 'etsy' };
    view.rerender(tabTree('transactions'));
    await settle();
    expect(enqueue.mock.calls.some(([i]) => /new transactions/.test(String(i.message)))).toBe(false);
    enqueue.mockRestore();
  });

  it('a page past the end clamps to the last page instead of "No transactions" (B14)', async () => {
    router.query = { mp: 'etsy', page: '50' };
    routes.settlements = { status: 200, body: { ...fixture.settlements, total: 120, page: 49, transactions: [] } };
    renderTab('transactions');
    await settle();
    expect(screen.queryByTestId('transactions-empty')).toBeNull();
    const replaced = [...router.replace.mock.calls, ...router.push.mock.calls].map((c) => JSON.stringify(c[0]));
    expect(replaced.some((u) => /page[^0-9]+3\b|page=3\b/.test(u))).toBe(true);
  });

  it('TR: category labels in Turkish (no raw "Sale" text in the cell)', async () => {
    renderTab('transactions', 'tr');
    await settle();
    const types = within(screen.getByTestId('transactions-table')).getAllByTestId('tx-type');
    expect(types.map((n) => n.textContent)).toEqual(['Satış', 'Kesinti', 'Ödeme']);
  });
});
