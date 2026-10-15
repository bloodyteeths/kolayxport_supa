// @vitest-environment jsdom
// Settings Group A — SettingsPage shell: nav (desktop), index (mobile), tab routing through the guard,
// OAuth return, shopify_free wording (settings §1–§3, §11). Sections are stubbed: they belong to B/C/D.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { withGroupA } from './a-messages';

const h = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const router = {
    pathname: '/ayarlar',
    asPath: '/ayarlar',
    isReady: true,
    query: {} as Record<string, string>,
    events: {
      on: (e: string, fn: (...a: unknown[]) => void) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(fn); },
      off: (e: string, fn: (...a: unknown[]) => void) => { handlers.get(e)?.delete(fn); },
      emit: () => undefined,
    },
    push: vi.fn(() => Promise.resolve(true)),
    replace: vi.fn(() => Promise.resolve(true)),
    prefetch: vi.fn(() => Promise.resolve()),
  };
  return {
    router,
    handlers,
    entitlement: { data: undefined as unknown },
    connections: null as unknown,
    confirm: vi.fn(() => Promise.resolve(false)),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
    get: vi.fn(),
    patch: vi.fn(),
    senderProps: null as null | Record<string, unknown>,
    shell: null as unknown,
  };
});

vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('axios', () => ({ default: { get: h.get, patch: h.patch, isAxiosError: () => false } }));
vi.mock('@/lib/billing/useEntitlement', () => ({ useEntitlement: () => h.entitlement }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: h.connections,
    needsReauth: h.connections ? ['etsy'] : [],
    isLoading: false,
    mutate: vi.fn(() => Promise.resolve(undefined)),
  }),
}));
vi.mock('@/components/ds/feedback', async (orig) => ({ ...(await orig<object>()), useToast: () => h.toast }));
vi.mock('@/components/ds/overlay/ConfirmDialog', async (orig) => ({ ...(await orig<object>()), useConfirm: () => h.confirm }));

// Section stubs (Groups B/C/D own the real ones).
vi.mock('@/components/domain/settings/connections', async (orig) => {
  const { useSettingsShell } = await import('@/components/domain/settings/settingsNav');
  return {
    ...(await orig<object>()),
    ConnectionsSection: function Stub({ refreshKey }: { refreshKey: number }) {
      h.shell = useSettingsShell();
      return <div data-testid="stub-connections">{`refresh:${refreshKey}`}</div>;
    },
    CredentialsSection: () => <div data-testid="stub-apikeys" />,
  };
});
vi.mock('@/components/domain/billing/BillingPanel', () => ({ BillingPanel: () => <div data-testid="stub-billing" /> }));
vi.mock('@/components/domain/settings/refresh', async (orig) => ({ ...(await orig<object>()), RefreshOverview: () => <div data-testid="stub-sync" /> }));
vi.mock('@/components/domain/settings/PreferencesPanel', () => ({ default: () => <div data-testid="stub-preferences" /> }));
vi.mock('@/components/domain/settings/sender', async (orig) => ({
  ...(await orig<object>()),
  SenderForm: (props: Record<string, unknown>) => {
    h.senderProps = props;
    const onChangeProfile = props.onChangeProfile as (n: string, v: string) => void;
    return (
      <div data-testid="stub-sender" data-state={String(props.state)} data-dirty={String(props.dirty)}>
        <button type="button" onClick={() => onChangeProfile('shipperName', 'Changed')}>{'edit'}</button>
      </div>
    );
  },
}));

import SettingsPage from '@/components/domain/settings/SettingsPage';

function setViewport(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const max = /max-width:\s*([\d.]+)px/.exec(query);
      const min = /min-width:\s*([\d.]+)px/.exec(query);
      let matches = Boolean(max || min);
      if (max && width > Number(max[1])) matches = false;
      if (min && width < Number(min[1])) matches = false;
      return { matches, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false };
    },
  });
}

function renderPage(locale: 'en' | 'tr' = 'en', width = 1440) {
  setViewport(width);
  return render(
    <NextIntlClientProvider locale={locale} messages={withGroupA(locale)} timeZone="Europe/Istanbul" onError={() => undefined}>
      <ThemeProvider theme={theme}>
        <SettingsPage />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

function setQuery(q: Record<string, string>) {
  h.router.query = q;
  const qs = new URLSearchParams(q).toString();
  h.router.asPath = qs ? `/ayarlar?${qs}` : '/ayarlar';
}

const CONNECTIONS = Object.fromEntries(
  ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut'].map((p) => [
    p,
    { connected: ['etsy', 'ebay', 'fedex'].includes(p), accounts: [], needsReauth: p === 'etsy' },
  ]),
);

beforeEach(() => {
  setQuery({});
  h.router.push.mockClear();
  h.router.replace.mockClear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(false);
  Object.values(h.toast).forEach((f) => f.mockClear());
  h.entitlement = { data: undefined };
  h.connections = null;
  h.senderProps = null;
  h.get.mockReset();
  h.get.mockResolvedValue({ data: { shipperProfile: { shipperName: 'Modsons' }, shippingSettings: {}, integrationSettings: {}, subscription: null } });
  h.patch.mockReset();
  h.patch.mockResolvedValue({ data: {} });
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ syncs: [{ status: 'failed' }] }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(cleanup);

describe('SettingsPage desktop', () => {
  it('renders the grouped nav, Connections by default, one PageHeader title', async () => {
    renderPage('en');
    const nav = screen.getByTestId('settings-nav');
    expect(within(nav).getByText('Workspace')).toBeTruthy();
    expect(within(nav).getByText('Carriers & API keys')).toBeTruthy();
    expect(within(nav).getByText('Refresh history')).toBeTruthy();
    expect(screen.getByTestId('settings-nav-connections').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('stub-connections')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Connections, carriers, sender address and your plan')).toBeTruthy();
    // the last refresh failed → danger dot
    await waitFor(() => expect(screen.getByTestId('settings-nav-dot-syncAdvanced').getAttribute('data-dot')).toBe('danger'));
  });

  it('switches tabs with a shallow replace and exposes the shell context', async () => {
    setQuery({ tab: 'connections', provider: 'trendyol' });
    renderPage('en');
    const shell = h.shell as { provider: string; tab: string; mobile: boolean };
    expect(shell).toMatchObject({ provider: 'trendyol', tab: 'connections', mobile: false });
    fireEvent.click(screen.getByTestId('settings-nav-billing'));
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledWith({ pathname: '/ayarlar', query: { tab: 'billing' } }, undefined, { shallow: true }));
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('guards a dirty sender profile: Keep editing stays, Discard leaves', async () => {
    setQuery({ tab: 'senderProfile' });
    renderPage('en');
    await waitFor(() => expect(screen.getByTestId('stub-sender').getAttribute('data-state')).toBe('ready'));
    fireEvent.click(screen.getByText('edit'));
    await waitFor(() => expect(screen.getByTestId('stub-sender').getAttribute('data-dirty')).toBe('true'));
    expect(screen.getByTestId('settings-nav-dot-senderProfile').getAttribute('data-dot')).toBe('attention');

    fireEvent.click(screen.getByTestId('settings-nav-preferences'));
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(h.confirm).toHaveBeenCalledWith({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
    expect(h.router.replace).not.toHaveBeenCalled();

    h.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByTestId('settings-nav-preferences'));
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledWith({ pathname: '/ayarlar', query: { tab: 'preferences' } }, undefined, { shallow: true }));
    await waitFor(() => expect(screen.getByTestId('stub-sender').getAttribute('data-dirty')).toBe('false'));
  });

  it('sender save goes through saveSlice with only the sender slices and a DS toast', async () => {
    setQuery({ tab: 'senderProfile' });
    renderPage('en');
    await waitFor(() => expect(screen.getByTestId('stub-sender').getAttribute('data-state')).toBe('ready'));
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await (h.senderProps!.onSave as () => Promise<unknown>)(); });
    expect(Object.keys(h.patch.mock.calls[0][1] as object).sort()).toEqual(['shipperProfile', 'shippingSettings']);
    expect(h.toast.success).toHaveBeenCalledWith('Sender profile saved');
  });

  it('OAuth return: toast, refresh key bump, params stripped to tab=connections', async () => {
    setQuery({ tab: 'billing', success: 'etsy_connected' });
    renderPage('en');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    expect(h.router.replace).toHaveBeenCalledWith({ pathname: '/ayarlar', query: { tab: 'connections' } }, undefined, { shallow: true });
  });

  it('shopify_free: nav says "Plan", never "Plan & billing"', () => {
    h.entitlement = { data: { plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false, meters: {} } };
    renderPage('en');
    const nav = screen.getByTestId('settings-nav');
    expect(within(nav).getByText('Plan')).toBeTruthy();
    expect(within(nav).queryByText('Plan & billing')).toBeNull();
  });

  it('past due: billing danger dot', () => {
    h.entitlement = { data: { plan: 'growth', state: 'past_due_grace', stripeUpsell: true, meters: { orders: { used: 1, limit: 2000 } } } };
    renderPage('en');
    expect(screen.getByTestId('settings-nav-dot-billing').getAttribute('data-dot')).toBe('danger');
    expect(screen.getByTestId('settings-nav-billing').getAttribute('aria-label')).toBe('Plan & billing, Your plan needs attention');
  });
});

describe('SettingsPage mobile (390)', () => {
  it('index lists groups and summaries in Turkish; a row drills in with push', async () => {
    h.connections = CONNECTIONS;
    h.entitlement = { data: { plan: 'growth', state: 'active', stripeUpsell: true, meters: { orders: { used: 1440, limit: 2000 } } } };
    renderPage('tr', 390);
    const index = screen.getByTestId('settings-mobile-index');
    expect(within(index).getByText('Çalışma alanı')).toBeTruthy();
    expect(screen.getByTestId('settings-index-summary-connections').textContent).toBe('3 bağlı · 1 dikkat gerektiriyor');
    expect(screen.getByTestId('settings-index-summary-apiKeys').textContent).toBe('7 servisten 1 tanesi kurulu');
    expect(screen.getByTestId('settings-index-summary-billing').textContent).toBe('Growth · siparişlerin %72 kullanıldı');
    expect(screen.queryByTestId('settings-nav')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-index-billing'));
    await waitFor(() => expect(h.router.push).toHaveBeenCalledWith({ pathname: '/ayarlar', query: { tab: 'billing' } }, undefined, { shallow: true }));
  });

  it('a ?tab= deep link opens the drill-in section only', () => {
    setQuery({ tab: 'billing' });
    renderPage('en', 390);
    expect(screen.getByTestId('stub-billing')).toBeTruthy();
    expect(screen.queryByTestId('settings-mobile-index')).toBeNull();
    expect(screen.queryByTestId('settings-nav')).toBeNull();
  });
});
