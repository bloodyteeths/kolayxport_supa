// @vitest-environment jsdom
// overview G6 render tests (§8): loading / done / partial / whole-error / not-connected / setup states, the
// primary rule (§1), messages failure shows "—" (never 0), mobile sticky primary, EN and TR.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import type { OverviewSummary } from '@/lib/overview/types';
import { setViewport } from '../ds/m1e-helpers';
import { G6_EN, G6_TR } from './g6-messages';
import { NOW, baseSummary, busySummary } from './g6-fixtures';

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = { pathname: '/app', asPath: '/app', query: {} as Record<string, string>, isReady: true, push: vi.fn(async () => true), replace: vi.fn(async () => true) };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-apexcharts', () => ({ default: () => <div data-testid="apex" /> }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'tamer@example.com', user_metadata: { full_name: 'Tamer Sar' } }, isLoading: false }),
}));

type OvState = { summary?: OverviewSummary & { receivedAt: number }; error?: Error; isValidating?: boolean };
const ov: OvState = {};
const refresh = vi.fn(async () => undefined);
vi.mock('@/lib/hooks/useOverviewSummary', () => ({
  useOverviewSummary: () => ({
    summary: ov.summary,
    error: ov.error,
    isLoading: !ov.summary && !ov.error,
    isValidating: Boolean(ov.isValidating),
    isStale: Boolean(ov.error && ov.summary),
    isError: Boolean(ov.error && !ov.summary),
    refresh,
    key: '/api/overview/summary?tz=Europe%2FIstanbul&currency=TRY',
    tz: 'Europe/Istanbul',
    currency: 'TRY',
  }),
}));
const sync = vi.fn(async () => ({ ok: true }));
const syncState: { lastResult: null | { ok: false; reason: string; status: number | null } } = { lastResult: null };
vi.mock('@/lib/hooks/useSyncOrders', () => ({ useSyncOrders: () => ({ sync, syncing: false, lastSucceededAt: null, lastResult: syncState.lastResult }) }));

type Entry = { connected: boolean; needsReauth: boolean; reason?: string; accounts: { id: string; name: string; externalId: null; lastSyncAt?: string | null; needsReauth?: boolean }[] };
const conn: { connections: Record<string, Entry> | null; error?: Error; extension: { detected: boolean; lastActivityAt: null } | null } = { connections: null, extension: null };
const entry = (connected: boolean, name?: string, needsReauth = false, reason?: string): Entry => ({
  connected,
  needsReauth,
  reason,
  accounts: connected ? [{ id: `${name}-1`, name: name ?? '', externalId: null, lastSyncAt: '2026-10-15T07:40:00Z', needsReauth }] : [],
});
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => {
    const c = conn.connections;
    const has = (p: string) => (c ? Boolean(c[p]?.connected) : undefined);
    return {
      connections: c,
      extension: conn.extension,
      isLoading: !c && !conn.error,
      isValidating: false,
      error: conn.error,
      has,
      get: (p: string) => c?.[p],
      anyMarketplace: c ? ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo'].some((p) => c[p]?.connected) : undefined,
      needsReauth: c ? Object.keys(c).filter((p) => c[p].connected && c[p].needsReauth) : [],
      mutate: vi.fn(),
    };
  },
}));
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ items: [], unreadCount: 0, isLoading: false, error: undefined, markRead: vi.fn(), markAllRead: vi.fn(), refresh: vi.fn() }),
}));

import { OverviewPage, overviewPrimary } from '@/components/domain/overview/OverviewPage';
import { shouldShowSetup } from '@/components/domain/overview/SetupChecklist';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G6_EN as unknown as Obj), tr: deepMerge(tr as Obj, G6_TR as unknown as Obj) };

function renderPage(locale: 'en' | 'tr' = 'en') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <OverviewPage now={NOW} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

const withReceived = (s: OverviewSummary) => ({ ...s, receivedAt: NOW.getTime() - 60_000 });
const connectedEtsy = () => ({ etsy: entry(true, 'BelleCoutureGifts'), ebay: entry(false), fedex: entry(true, 'FedEx') });

beforeEach(() => {
  __resetShortcutsForTests();
  setViewport('desktop');
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  ov.summary = undefined;
  ov.error = undefined;
  ov.isValidating = false;
  conn.connections = connectedEtsy();
  conn.error = undefined;
  conn.extension = { detected: true, lastActivityAt: null };
  useMessageCountStore.setState({ counts: { wix: 0, trendyol: 0, total: 0 }, fetchedAt: null, failed: false, loading: false });
  sync.mockClear();
  syncState.lastResult = null;
  refresh.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────
describe('OverviewPage states', () => {
  it('loading: KPI skeleton, skeleton queue rows, client-cache reconnect row already shown, no primary yet', async () => {
    conn.connections = { ...connectedEtsy(), ebay: entry(true, 'eBay store', true, 'refresh_token_expired') };
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('attention-loading')).toBeTruthy();
    expect(screen.getByTestId('attention-row-reconnect:ebay')).toBeTruthy();
    expect(screen.getByText('Authorization expired')).toBeTruthy();
    const header = screen.getByTestId('page-header');
    expect(within(header).queryByRole('link', { name: 'Go to orders' })).toBeNull();
    // The primary slot stays empty until the summary decides (New listing may show as a secondary).
    expect(header.querySelector('[data-variant="primary"]')).toBeNull();
  });

  it('loading past 15 s shows "Still loading… Retry", past 30 s the whole-error state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    try {
      const view = renderPage();
      await act(async () => {});
      expect(screen.getByTestId('attention-loading')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(15_100);
      });
      expect(screen.getByTestId('attention-slow')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(15_100);
      });
      expect(screen.getByTestId('attention-error')).toBeTruthy();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('done: "All caught up", KPI row, chart, best sellers, stores; New listing is the primary', async () => {
    ov.summary = withReceived(baseSummary());
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('attention-done').textContent).toContain('All caught up');
    expect(screen.getByTestId('overview-kpis')).toBeTruthy();
    expect(screen.getByTestId('overview-chart')).toBeTruthy();
    expect(screen.getByText('Personalized Baby Blanket')).toBeTruthy();
    expect(screen.getByTestId('store-chip-etsy').textContent).toContain('BelleCoutureGifts');
    expect(screen.getByText('Good morning, Tamer')).toBeTruthy();
    const header = screen.getByTestId('page-header');
    const primary = header.querySelector('[data-variant="primary"]');
    expect(primary?.textContent).toBe('New listing');
    expect(primary?.getAttribute('href')).toBe('/app/etsy-listings/new');
  });

  it('busy: Go to orders is the primary, queue rows render with secondary CTAs, "Show N more"', async () => {
    ov.summary = withReceived(busySummary());
    renderPage();
    await act(async () => {});
    const header = screen.getByTestId('page-header');
    // Default build (M10: every surface on) → the new Orders "To ship" view.
    expect(within(header).getByRole('link', { name: 'Go to orders' }).getAttribute('href')).toBe('/app/labels?view=to_ship');
    expect(screen.getByTestId('attention-row-labelsFailed').textContent).toContain('#3891 Baby Blanket');
    expect(screen.getByTestId('attention-row-labelsFailed').textContent).toContain('+1 more');
    expect(screen.getByTestId('attention-cta-overdue').textContent).toBe('Create label');
    expect(screen.getByTestId('attention-row-notSent:etsy').textContent).toContain('7 listings with changes not sent to Etsy');
    expect(screen.queryByTestId('attention-done')).toBeNull();
    expect(screen.getByTestId('kpi-overdue').textContent).toContain('#114-0098');
  });

  it('busy with the orders flag off (NEXT_PUBLIC_UI_V2=none): Go to orders keeps the legacy labels filter', async () => {
    vi.stubEnv('NEXT_PUBLIC_UI_V2', 'none');
    try {
      ov.summary = withReceived(busySummary());
      renderPage();
      await act(async () => {});
      const header = screen.getByTestId('page-header');
      expect(within(header).getByRole('link', { name: 'Go to orders' }).getAttribute('href')).toBe('/app/labels?label=unlabeled&status=onaylandi&sort=shipBy&from=all');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('partial: a failed section adds one "Couldn\'t check" row with the error id, never "All caught up"', async () => {
    ov.summary = withReceived(baseSummary({ drafts: null, errors: ['drafts'] }));
    renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('attention-done')).toBeNull();
    expect(screen.getByTestId('attention-done-errors').textContent).toContain('1 check failed');
    expect(screen.getByTestId('attention-partial').textContent).toContain("Couldn't check listing drafts");
  });

  it('whole error: client-cache rows stay, "Couldn\'t load your overview" with retry', async () => {
    ov.error = new Error('boom');
    conn.connections = { ...connectedEtsy(), ebay: entry(true, 'eBay', true, 'reauth_required') };
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('attention-row-reconnect:ebay')).toBeTruthy();
    expect(screen.getByTestId('attention-error').textContent).toContain("Couldn't load your overview");
    // DS P6: never a stuck skeleton — the KPI tiles show — with a retry.
    expect(screen.queryByTestId('skeleton-kpi')).toBeNull();
    expect(screen.getByTestId('kpi-to-ship').textContent).toContain('—');
    expect(screen.getByTestId('kpi-revenue').textContent).toContain('—');
    expect(screen.getAllByTestId('kpi-retry').length).toBeGreaterThan(0);
  });

  it('whole error with Wix connected: Needs reply still renders from the message store', async () => {
    ov.error = new Error('boom');
    conn.connections = { ...connectedEtsy(), wix: entry(true, 'Wix site') };
    useMessageCountStore.setState({ counts: { wix: 2, trendyol: 0, total: 2 }, fetchedAt: NOW.getTime(), failed: false });
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('kpi-needs-reply').textContent).toContain('2');
  });

  it('trial with labels used up but order syncs left: refresh stays enabled, row says labels are paused', async () => {
    ov.summary = withReceived(
      baseSummary({
        usage: {
          ...baseSummary().usage!,
          plan: 'trial',
          status: 'trialing',
          trialEndsAt: '2026-11-01T00:00:00Z',
          orderSync: { used: 5, limit: 50 },
          label: { used: 10, limit: 10 },
          blocked: 'trial',
        },
      }),
    );
    renderPage();
    await act(async () => {});
    expect((screen.getByTestId('sync-meta-pull') as HTMLButtonElement).disabled).toBe(false);
    const row = screen.getByTestId('attention-row-paused');
    expect(row.textContent).toContain('Labels are paused');
    expect(row.textContent).not.toContain('trial has ended');
  });

  it('order syncs used up: refresh is disabled', async () => {
    ov.summary = withReceived(baseSummary({ usage: { ...baseSummary().usage!, orderSync: { used: 200, limit: 200 }, blocked: 'planLimit' } }));
    renderPage();
    await act(async () => {});
    expect((screen.getByTestId('sync-meta-pull') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('attention-row-paused').textContent).toContain('Order syncs are paused');
  });

  it('a benign refresh result (tooSoon / nothingToSync) is not shown as failed; a real failure is', async () => {
    ov.summary = withReceived(baseSummary());
    syncState.lastResult = { ok: false, reason: 'tooSoon', status: 429 };
    const view = renderPage();
    await act(async () => {});
    expect(screen.getByTestId('sync-meta').getAttribute('data-state')).toBe('idle');
    view.unmount();
    syncState.lastResult = { ok: false, reason: 'failed', status: 500 };
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('sync-meta').getAttribute('data-state')).toBe('failed');
  });

  it('queue title shows the row count', async () => {
    ov.summary = withReceived(busySummary());
    renderPage();
    await act(async () => {});
    const count = Number(screen.getByTestId('attention-count').textContent);
    const toggle = screen.queryByTestId('attention-toggle');
    const hidden = toggle ? Number(/\d+/.exec(toggle.textContent ?? '')?.[0] ?? 0) : 0;
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(hidden + screen.getByRole('list', { name: 'Needs your attention' }).querySelectorAll(':scope > [role="listitem"]').length);
  });

  it('a failed KPI section shows — with a retry, the other tiles render', async () => {
    ov.summary = withReceived(baseSummary({ toShip: null, errors: ['toShip'] }));
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('kpi-to-ship').textContent).toContain('—');
    expect(screen.getAllByTestId('kpi-retry').length).toBeGreaterThan(0);
    expect(screen.getByTestId('kpi-revenue').textContent).toContain('≈');
    expect(screen.getByTestId('attention-partial')).toBeTruthy();
  });

  it('messages failure shows —, never 0', async () => {
    conn.connections = { ...connectedEtsy(), wix: entry(true, 'Wix site') };
    useMessageCountStore.setState({ counts: { wix: 0, trendyol: 0, total: 0 }, fetchedAt: null, failed: true });
    ov.summary = withReceived(baseSummary());
    renderPage();
    await act(async () => {});
    const tile = screen.getByTestId('kpi-needs-reply');
    expect(tile.textContent).toContain('—');
    expect(tile.textContent).toContain("Couldn't check messages");
    expect(tile.textContent).not.toMatch(/Needs reply0/);
  });

  it('no store, setup visible: Connect a store is the primary, checklist replaces KPIs, chart hidden', async () => {
    conn.connections = { etsy: entry(false), ebay: entry(false) };
    ov.summary = withReceived(baseSummary({ setup: { hasOrders: false, senderComplete: false, hasLabel: false } }));
    renderPage();
    await act(async () => {});
    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('link', { name: 'Connect a store' })).toBeTruthy();
    expect(screen.getByTestId('overview-setup')).toBeTruthy();
    expect(screen.getByTestId('setup-progress').textContent).toBe('0 of 3 done');
    expect(screen.getByTestId('setup-cta-carrier')).toBeTruthy();
    expect(screen.queryByTestId('overview-kpis')).toBeNull();
    expect(screen.queryByTestId('overview-chart')).toBeNull();
    expect(screen.queryByTestId('overview-best')).toBeNull();
    // The setup card already says "connect": the queue is quiet.
    expect(screen.getByTestId('attention-done')).toBeTruthy();
  });

  it('no store, setup dismissed: queue shows the first-use "Connect a store" state', async () => {
    window.localStorage.setItem('kx.overview.setupDismissed:u1', '1');
    conn.connections = { etsy: entry(false) };
    ov.summary = withReceived(baseSummary({ setup: { hasOrders: false, senderComplete: false, hasLabel: false } }));
    renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('overview-setup')).toBeNull();
    expect(screen.getByTestId('attention-not-connected').textContent).toContain('Connect a store to see what needs your attention');
  });

  it('store connected but no orders: "No orders yet" + Refresh orders with the quota note (click only)', async () => {
    ov.summary = withReceived(baseSummary({ setup: { hasOrders: false, senderComplete: true, hasLabel: false } }));
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('attention-no-orders').textContent).toContain('Uses 1 of your 200 order syncs.');
    expect(sync).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByTestId('attention-refresh').click();
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('mobile: Go to orders moves to the sticky action bar', async () => {
    setViewport('mobile');
    ov.summary = withReceived(busySummary());
    renderPage();
    await act(async () => {});
    const bars = screen.getAllByRole('region').filter((r) => r.textContent?.includes('Go to orders'));
    expect(bars.length).toBeGreaterThan(0);
    // The sticky bar carries the to-ship count (§2.3).
    expect(bars.some((b) => b.textContent?.includes(`Go to orders (${busySummary().toShip!.count})`))).toBe(true);
    // Mobile rows are links themselves (no CTA button).
    expect(screen.queryByTestId('attention-cta-overdue')).toBeNull();
    expect(screen.getByTestId('attention-row-overdue').tagName).toBe('A');
  });

  it('TR renders the Turkish copy', async () => {
    ov.summary = withReceived(baseSummary());
    renderPage('tr');
    await act(async () => {});
    expect(screen.getByText('Günaydın, Tamer')).toBeTruthy();
    expect(screen.getByTestId('attention-done').textContent).toContain('Her şey yolunda');
    expect(screen.getByRole('heading', { name: 'Siparişler, son 14 gün' })).toBeTruthy();
  });
});

describe('overview pure helpers', () => {
  it('overviewPrimary: open orders win even with no store; nothing while the summary is unknown', () => {
    expect(overviewPrimary({ toShipCount: 3, summaryKnown: true, anyMarketplace: false, newListingHref: null })).toBe('goToOrders');
    expect(overviewPrimary({ toShipCount: 0, summaryKnown: true, anyMarketplace: false, newListingHref: null })).toBe('connectStore');
    expect(overviewPrimary({ toShipCount: null, summaryKnown: false, anyMarketplace: false, newListingHref: null })).toBeNull();
    expect(overviewPrimary({ toShipCount: null, summaryKnown: false, anyMarketplace: undefined, newListingHref: null })).toBeNull();
    expect(overviewPrimary({ toShipCount: 0, summaryKnown: true, anyMarketplace: true, newListingHref: '/x' })).toBe('newListing');
  });

  it('shouldShowSetup stays hidden until the dismiss flag has been read (no flash)', () => {
    const facts = { storeConnected: false, storeName: null, storeProvider: null, senderComplete: false, hasLabel: false, hasOrders: false, hasCarrier: false };
    expect(shouldShowSetup({ connectionsLoaded: true, facts, dismissed: null })).toBe(false);
    expect(shouldShowSetup({ connectionsLoaded: true, facts, dismissed: true })).toBe(false);
    expect(shouldShowSetup({ connectionsLoaded: true, facts, dismissed: false })).toBe(true);
  });
});
