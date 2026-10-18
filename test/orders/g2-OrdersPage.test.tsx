// @vitest-environment jsdom
// orders G2 render tests (orders §13): each view's empty state, the primary rule (§1.4), selection → bulk bar,
// legacy query migration on mount, and the panels mounted by their frozen props.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { toOrderRows } from '@/lib/orders/toOrderRows';
import type { OrderRow } from '@/lib/orders/types';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { setViewport } from '../ds/m1e-helpers';
import { G2_EN, G2_TR } from './g2-messages';
import { ALL_FIXTURES, NOW, amazonFba, manualLabeled } from './g1-fixtures';

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/labels',
  asPath: '/app/labels',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (url: { query: Record<string, string | string[]> }) => {
    router.query = url.query;
    return true;
  }),
  push: vi.fn(async (url: { query: Record<string, string | string[]> }) => {
    router.query = url.query;
    return true;
  }),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

type ListMock = {
  rows: OrderRow[];
  total: number;
  state: string;
  counts?: Record<string, number>;
};
const list: ListMock = { rows: [], total: 0, state: 'ready' };
const lastQuery: { current: unknown } = { current: null };
vi.mock('@/lib/hooks/useOrdersList', () => ({
  useOrdersList: (q: unknown) => {
    lastQuery.current = q;
    return {
      rows: list.rows,
      total: list.total,
      counts: list.counts,
      lastPulledAt: undefined,
      state: list.state,
      mutate: vi.fn(async () => undefined),
      pull: vi.fn(async () => undefined),
      pulling: false,
      pullState: 'idle',
      pullError: null,
      isValidating: false,
      page: 1,
      pageSize: 50,
    };
  },
  useOrder: () => ({ row: undefined, state: 'empty', mutate: vi.fn() }),
}));
const connected = { trendyol: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ anyMarketplace: true, has: (p: string) => (p === 'trendyol' ? connected.trendyol : false) }),
}));
vi.mock('@/lib/hooks/useMarketplaceOptions', () => ({
  useMarketplaceOptions: () => ({ marketplaceOptions: [{ value: 'Etsy', label: 'Etsy', count: 3 }], isLoading: false, isError: false }),
}));
vi.mock('@/components/orders-live/useOrderLifecycleFlags', () => ({ useOrderLifecycleFlags: () => ({ flags: {}, mutate: vi.fn() }) }));
vi.mock('@/components/orders-live/OrderLifecycleBadges', () => ({ default: () => null }));

const panelProps: Record<string, Record<string, unknown>> = {};
vi.mock('@/components/domain/orders/panel/OrderPanel', () => ({
  OrderPanel: (p: Record<string, unknown>) => {
    panelProps.order = p;
    return p.orderId ? <div data-testid="stub-order-panel">{String(p.orderId)}</div> : null;
  },
}));
vi.mock('@/components/domain/shipping/CreateLabelPanel', () => ({
  CreateLabelPanel: (p: Record<string, unknown>) => {
    panelProps.label = p;
    return p.open ? <div data-testid="stub-label-panel" /> : null;
  },
}));
vi.mock('@/components/domain/shipping/BulkCreateLabelsPanel', () => ({
  BulkCreateLabelsPanel: (p: Record<string, unknown>) => {
    panelProps.bulk = p;
    return p.open ? <div data-testid="stub-bulk-panel">{(p.orders as OrderRow[]).length}</div> : null;
  },
}));
vi.mock('@/components/domain/orders/ManualOrderPanel', () => ({
  ManualOrderPanel: (p: Record<string, unknown>) => {
    panelProps.manual = p;
    return p.open ? <div data-testid="stub-manual-panel" /> : null;
  },
}));

import { OrdersPage } from '@/components/domain/orders/OrdersPage';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G2_EN as unknown as Obj), tr: deepMerge(tr as Obj, G2_TR as unknown as Obj) };
const ROWS = toOrderRows(ALL_FIXTURES, { now: NOW });

function renderPage(locale: 'en' | 'tr' = 'en') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <OrdersPage now={NOW} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  connected.trendyol = false;
  list.rows = [];
  list.total = 0;
  list.state = 'ready';
  list.counts = { to_ship: 4, overdue: 0, label_created: 1, problems: 3 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/user/settings')) {
        return new Response(JSON.stringify({ subscription: { billingProvider: 'stripe' }, shippingSettings: { etgbEnabled: true, etgbRecipientEmail: 'etgb@example.com' } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────
describe('legacy query migration on mount', () => {
  it('rewrites ?label=unlabeled&mp=Etsy once, with replace (no history entry)', async () => {
    router.query = { label: 'unlabeled', mp: 'Etsy' };
    renderPage();
    await act(async () => {});
    expect(router.replace).toHaveBeenCalledTimes(1);
    const arg = router.replace.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(arg.query).toMatchObject({ view: 'to_ship', store: 'Etsy' });
    expect(arg.query).not.toHaveProperty('label');
    expect(router.push).not.toHaveBeenCalled();
  });
  it('the live new-order link ?highlight=<id> opens that order', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    router.query = { highlight: 'o-ty' };
    const view = renderPage();
    await act(async () => {});
    view.rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="en" messages={MESSAGES.en} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
          <ThemeProvider theme={theme}>
            <OrdersPage now={NOW} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </SWRConfig>,
    );
    expect(screen.getByTestId('stub-order-panel').textContent).toBe('o-ty');
  });
});

describe('primary rule (orders §1.4)', () => {
  it('labelable rows on the page → "Create N labels" opens the bulk panel with exactly those rows', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage();
    await act(async () => {});
    const header = screen.getByTestId('orders-header');
    const labelable = ROWS.filter((r) => r.canLabel).length;
    const btn = within(header).getByRole('button', { name: `Create ${labelable} labels` });
    fireEvent.click(btn);
    expect(router.push).toHaveBeenCalled();
    expect((router.push.mock.calls.at(-1)![0] as { query: Obj }).query).toMatchObject({ panel: 'bulk-label' });
  });
  it('no labelable row → "Add manual order" is the primary', async () => {
    list.rows = ROWS.filter((r) => r.id === amazonFba.id || r.id === manualLabeled.id);
    list.total = 2;
    renderPage();
    await act(async () => {});
    const header = screen.getByTestId('orders-header');
    expect(within(header).getByRole('button', { name: 'Add manual order' })).toBeTruthy();
    expect(within(header).queryByRole('button', { name: /^Create \d+ labels?$/ })).toBeNull();
  });
  it('TR: the primary reads "N etiket oluştur"', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage('tr');
    await act(async () => {});
    const labelable = ROWS.filter((r) => r.canLabel).length;
    expect(within(screen.getByTestId('orders-header')).getByRole('button', { name: `${labelable} etiket oluştur` })).toBeTruthy();
  });
});

describe('selection → bulk bar', () => {
  it('selecting rows replaces the toolbar with the bulk bar; its primary counts labelable rows only', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage();
    await act(async () => {});
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    // First two rows: Etsy without address (not labelable) + Amazon FBA (not labelable) + an open Amazon order.
    const idx = (id: string) => ROWS.findIndex((r) => r.id === id);
    fireEvent.click(boxes[idx('o-etsy')]);
    fireEvent.click(boxes[idx('o-amz-open')]);
    await act(async () => {});
    const bar = screen.getByTestId('orders-bulk-bar');
    expect(within(bar).getByTestId('bulk-count').textContent).toContain('2');
    expect(within(bar).getByTestId('orders-bulk-create-labels').textContent).toBe('Create 1 label');
    // header primary demoted: no "Create N labels" primary in the header beyond the secondary
    fireEvent.click(within(bar).getByTestId('orders-bulk-create-labels'));
    expect((router.push.mock.calls.at(-1)![0] as { query: Obj }).query).toMatchObject({ panel: 'bulk-label' });
  });
  it('a selection with no labelable row offers Print ▾ as the bulk primary', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage();
    await act(async () => {});
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    fireEvent.click(boxes[ROWS.findIndex((r) => r.id === manualLabeled.id)]);
    await act(async () => {});
    const bar = screen.getByTestId('orders-bulk-bar');
    expect(within(bar).queryByTestId('orders-bulk-create-labels')).toBeNull();
    expect(within(bar).getByTestId('orders-bulk-print-primary')).toBeTruthy();
  });
});

describe('empty state per view (orders §7.1)', () => {
  const cases: [string, string][] = [
    ['to_ship', 'Every order has a label'],
    ['overdue', 'Nothing is overdue'],
    ['problems', 'No problems to fix'],
    ['label_created', 'No labels waiting to ship'],
    ['shipped', 'No orders match these filters'],
    ['all', 'No orders match these filters'],
  ];
  it.each(cases)('%s', async (view, text) => {
    list.state = 'empty';
    router.query = { view };
    renderPage();
    await act(async () => {});
    expect(screen.getByText(text)).toBeTruthy();
  });
  it('filters that match nothing → "No orders match these filters" + Clear filters (resets to the view)', async () => {
    list.state = 'empty';
    router.query = { view: 'overdue', store: 'Etsy' };
    renderPage();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    const q = (router.replace.mock.calls.at(-1)![0] as { query: Obj }).query;
    expect(q.view).toBe('overdue');
    expect(q.store).toBeUndefined();
  });
  it('a search that matches nothing names the query and says search covers all dates', async () => {
    list.state = 'empty';
    router.query = { q: 'zzz' };
    renderPage();
    await act(async () => {});
    expect(screen.getByText('No orders match "zzz"')).toBeTruthy();
    expect(screen.getAllByText('Search covers all dates').length).toBeGreaterThan(0);
  });
});

describe('panels by URL (one at a time)', () => {
  it('?open=<id> mounts the OrderPanel; ?panel=manual the manual order panel', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    router.query = { open: 'o-wix' };
    const first = renderPage();
    await act(async () => {});
    expect(screen.getByTestId('stub-order-panel').textContent).toBe('o-wix');
    expect(screen.queryByTestId('stub-label-panel')).toBeNull();
    first.unmount();
    router.query = { panel: 'manual' };
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('stub-manual-panel')).toBeTruthy();
    expect(screen.queryByTestId('stub-order-panel')).toBeNull();
  });
  it('?open=<id>&panel=label mounts the CreateLabelPanel with that order', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    router.query = { open: 'o-ty', panel: 'label' };
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('stub-label-panel')).toBeTruthy();
    expect((panelProps.label.order as OrderRow).id).toBe('o-ty');
    expect(screen.queryByTestId('stub-order-panel')).toBeNull();
  });
});

function pageTree() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="en" messages={MESSAGES.en} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <OrdersPage now={NOW} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
}

describe('panels keep the list page', () => {
  it('opening, navigating and closing a panel on page 3 stays on page 3', async () => {
    list.rows = ROWS;
    list.total = 400;
    router.query = { page: '3', open: 'o-wix' };
    renderPage();
    await act(async () => {});
    // The router mock writes each navigation's query back to `router.query`.
    const last = () => router.query as Obj;
    await act(async () => (panelProps.order.onNavigate as (id: string) => void)('o-ty'));
    expect(last()).toMatchObject({ page: '3', open: 'o-ty' });
    await act(async () => (panelProps.order.onCreateLabel as (r: OrderRow) => void)(ROWS[0]));
    expect(last()).toMatchObject({ page: '3', panel: 'label' });
    await act(async () => (panelProps.order.onClose as () => void)());
    expect(last()).toMatchObject({ page: '3' });
    expect(last()).not.toHaveProperty('open');
    expect(last()).not.toHaveProperty('panel');
  });
});

describe('live toast "Open" while the page is mounted', () => {
  it('a later ?highlight=<id> opens that order and restores the view/filters the push dropped', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    router.query = { view: 'shipped', store: 'Etsy' };
    const view = renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('stub-order-panel')).toBeNull();
    // LiveToast: Router.push('/app/labels?highlight=o-ty')
    router.query = { highlight: 'o-ty' };
    await act(async () => view.rerender(pageTree()));
    await act(async () => view.rerender(pageTree()));
    const arg = router.replace.mock.calls.at(-1)![0] as { query: Obj };
    expect(arg.query).toMatchObject({ view: 'shipped', store: ['Etsy'], open: 'o-ty' });
    expect(arg.query).not.toHaveProperty('highlight');
    expect(screen.getByTestId('stub-order-panel').textContent).toBe('o-ty');
  });
});

describe('banner zone', () => {
  it('stale list shows the stale banner (one banner at most)', async () => {
    list.rows = ROWS;
    list.total = ROWS.length;
    list.state = 'stale';
    renderPage();
    await act(async () => {});
    expect(screen.getAllByTestId('orders-stale')).toHaveLength(1);
  });
});

describe('Trendyol bulk labels', () => {
  function withTrendyolCount(eligible: number) {
    connected.trendyol = true;
    const base = (globalThis.fetch as any).getMockImplementation();
    (globalThis.fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === '/api/trendyol/cargo-bulk' && !init?.method) {
        return new Response(JSON.stringify({ eligible, skippedNoCargoNumber: 1 }), { status: 200 });
      }
      return base(url, init);
    });
  }

  it('desktop: "Trendyol labels (N)" sits in the header next to Create N labels, PDF / ZPL in its menu', async () => {
    withTrendyolCount(3);
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage();
    await act(async () => {});
    const header = screen.getByTestId('orders-header');
    expect(within(header).getByRole('button', { name: 'Trendyol labels (3)' })).toBeTruthy();
    fireEvent.click(within(header).getByRole('button', { name: 'Trendyol label format' }));
    expect(screen.getByRole('menuitem', { name: 'PDF · every carrier' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'ZPL (thermal printer) · Trendyol Express / Aras only' })).toBeTruthy();
  });

  it('hidden when nothing is left to print or Trendyol is not connected', async () => {
    withTrendyolCount(0);
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('orders-trendyol-labels')).toBeNull();
    cleanup();
    connected.trendyol = false;
    renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('orders-trendyol-labels')).toBeNull();
  });

  it('phone (TR): both buttons stacked in one sticky bar; the header no longer renders its own', async () => {
    setViewport('mobile');
    withTrendyolCount(18);
    list.rows = ROWS;
    list.total = ROWS.length;
    renderPage('tr');
    await act(async () => {});
    const bars = screen.getAllByTestId('orders-mobile-labels-bar');
    expect(bars).toHaveLength(1);
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
    const labelable = ROWS.filter((r) => r.canLabel).length;
    expect(within(bars[0]).getByRole('button', { name: 'Trendyol etiketleri (18)' })).toBeTruthy();
    expect(within(bars[0]).getByRole('button', { name: `${labelable} etiket oluştur` })).toBeTruthy();
  });
});
