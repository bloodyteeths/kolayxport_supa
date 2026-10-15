// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within, act } from '@testing-library/react';
import { renderB, intlErrors, LOCALES } from './b-harness';
import type { ConnectionsMap } from '@/lib/integrations/connectionStatus';
import type { CredentialsStore } from '@/components/domain/settings/connections/useIntegrationCredentials';

// ── mocks ──────────────────────────────────────────────────────────────────────────────────────────
const router = { isReady: true, query: {} as Record<string, string>, pathname: '/ayarlar', replace: vi.fn(async () => true), push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

const conn = {
  connections: null as Partial<ConnectionsMap> | null,
  extension: { detected: false, lastActivityAt: null } as { detected: boolean; lastActivityAt: string | null },
  isLoading: false,
  error: undefined as Error | undefined,
  mutate: vi.fn(async () => undefined),
};
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => {
    const c = conn.connections;
    const needsReauth = c ? (Object.keys(c) as (keyof ConnectionsMap)[]).filter((p) => c[p]?.connected && c[p]?.needsReauth) : [];
    return {
      connections: c, extension: conn.extension, isLoading: conn.isLoading, isValidating: false, error: conn.error,
      has: (p: keyof ConnectionsMap) => (c ? !!c[p]?.connected : undefined),
      get: (p: keyof ConnectionsMap) => c?.[p],
      anyMarketplace: undefined, needsReauth, mutate: conn.mutate,
    };
  },
}));

const ent = { data: undefined as unknown, fallback: false };
vi.mock('@/lib/billing/useEntitlement', () => ({ useEntitlement: () => ({ data: ent.data, fallback: ent.fallback, state: 'ready', mutate: vi.fn() }) }));

vi.mock('axios', () => {
  const get = vi.fn(async () => ({ data: { sellerId: null, marketplaces: [], availableMarketplaces: [], marketplaceIds: [] } }));
  return { default: { get, post: vi.fn(async () => ({ data: {} })), patch: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) } };
});

vi.mock('@/components/legacy/settings/ConnectionsPanelLegacy', () => ({ default: () => <div data-testid="legacy-connections" /> }));
vi.mock('@/components/legacy/settings/ApiKeysPanelLegacy', () => ({ default: () => <div data-testid="legacy-apikeys" /> }));

import { ConnectionsSection, CredentialsSection, ProviderCredentialsPanel, StoreLimitModal } from '@/components/domain/settings/connections';
import ConnectionsPanel from '@/components/settings/ConnectionsPanel';
import ApiKeysPanel from '@/components/settings/ApiKeysPanel';
import { SettingsShellContext, type SettingsShellValue } from '@/components/domain/settings/settingsNav';

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────
const recent = new Date(Date.now() - 5 * 60_000).toISOString();
const empty = { connected: false, accounts: [], needsReauth: false };
function baseConnections(): Partial<ConnectionsMap> {
  return {
    etsy: { connected: true, needsReauth: false, accounts: [{ id: 's1', name: 'BelleCoutureGifts', externalId: '12345678', lastSyncAt: recent }] },
    ebay: { ...empty },
    amazon: { connected: true, needsReauth: true, reason: 'refresh_token_expired', accounts: [{ id: 'credential', name: 'Amazon A1B2', externalId: 'A1B2', lastSyncAt: null, needsReauth: true, reason: 'refresh_token_expired' }] },
    shopify: { ...empty }, wix: { ...empty },
    trendyol: { connected: false, accounts: [], needsReauth: false, reason: 'incomplete_credentials' },
    hepsiburada: { ...empty }, veeqo: { ...empty }, shippo: { ...empty },
    fedex: { connected: true, needsReauth: false, accounts: [{ id: 'credential', name: 'FedEx ••••5678', externalId: '••••5678', lastSyncAt: null }] },
    ups: { ...empty }, mng: { ...empty }, parasut: { ...empty },
  };
}
function store(values: Record<string, string> = {}, save = vi.fn(async () => undefined)): CredentialsStore & { save: typeof save } {
  return { values, loaded: true, loadFailed: false, save, refetch: vi.fn(async () => undefined) };
}
const VALUES = { trendyolApiKey: '••••1234', trendyolApiSecret: '••••abcd', trendyolSupplierId: '', fedexApiKey: '••••9999', fedexApiSecret: '••••8888', fedexAccountNumber: '••••5678' };

const hrefs = () => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '');

beforeEach(() => {
  router.query = {};
  router.replace.mockClear();
  conn.connections = baseConnections();
  conn.extension = { detected: false, lastActivityAt: null };
  conn.isLoading = false;
  conn.error = undefined;
  ent.data = { plan: 'growth', stripeUpsell: true, meters: { connectedStores: { used: 4, limit: 5 } } };
  ent.fallback = false;
  intlErrors.length = 0;
});
afterEach(cleanup);

describe.each(LOCALES)('ConnectionsSection (%s)', (locale) => {
  it('renders every group and tile with the §4.2 states, no i18n errors', () => {
    renderB(<ConnectionsSection credentials={store(VALUES)} />, locale);
    for (const id of ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut', 'chrome']) {
      expect(screen.getByTestId(`tile-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('tile-etsy').getAttribute('data-status')).toBe('connected');
    expect(screen.getByTestId('tile-amazon').getAttribute('data-status')).toBe('needs_reconnect');
    expect(screen.getByTestId('tile-trendyol').getAttribute('data-status')).toBe('incomplete');
    // DHL eCommerce glossary name, Etsy connect href is the legacy OAuth entry point.
    expect(within(screen.getByTestId('tile-mng')).getByText('DHL eCommerce')).toBeTruthy();
    expect(hrefs()).toContain('/api/integrations/ebay/connect');
    // one reauth banner with the single action
    expect(screen.getByTestId('connections-reauth-banner')).toBeTruthy();
    expect(intlErrors).toEqual([]);
  });
});

describe('ConnectionsSection behaviour', () => {
  it('incomplete Trendyol names the missing field', () => {
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(within(screen.getByTestId('tile-trendyol')).getByText('Supplier ID missing')).toBeTruthy();
  });

  it('store meter line + Compare plans for a Stripe user', () => {
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(screen.getByText('Stores · 4 of 5 used')).toBeTruthy();
    expect(screen.getByTestId('connections-compare-plans')).toBeTruthy();
  });

  it('shopify_free never sees /fiyatlandirma or Compare plans (§11)', () => {
    ent.data = { plan: 'shopify_free', stripeUpsell: false, meters: { connectedStores: { used: 1, limit: 1 } } };
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(hrefs().some((h) => h.includes('/fiyatlandirma'))).toBe(false);
    expect(screen.queryByText('Compare plans')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Stripe|₺|\$\d/);
  });

  it('unknown provider (entitlement missing) renders no upsell either', () => {
    ent.data = undefined;
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(hrefs().some((h) => h.includes('/fiyatlandirma'))).toBe(false);
    expect(screen.queryByText(/Stores ·/)).toBeNull();
  });

  it('fallback entitlement has no store meter line', () => {
    ent.fallback = true;
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(screen.queryByText(/Stores ·/)).toBeNull();
    expect(screen.getByText('Stores')).toBeTruthy();
  });

  it('status request failed and nothing cached → page ErrorState, never "Not connected"', () => {
    conn.connections = null;
    conn.error = new Error('500');
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(screen.getByText("Couldn't check your connections")).toBeTruthy();
    expect(screen.queryByText('Not connected')).toBeNull();
  });

  it('failed re-check with cache → every tile shows check_failed', () => {
    conn.error = new Error('500');
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(screen.getByTestId('tile-etsy').getAttribute('data-status')).toBe('check_failed');
    expect(screen.getByTestId('tile-chrome').getAttribute('data-status')).toBe('check_failed');
  });

  it('first load → skeleton tiles without buttons', () => {
    conn.connections = null;
    conn.isLoading = true;
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    expect(screen.getByTestId('tile-etsy').getAttribute('data-status')).toBe('loading');
    expect(screen.queryByTestId('tile-etsy-action')).toBeNull();
  });

  it('&provider=trendyol opens the credentials panel; closing strips the param', async () => {
    router.query = { tab: 'connections', provider: 'trendyol' };
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    await waitFor(() => expect(screen.getByTestId('credentials-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('action-credentials-cancel'));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const [arg] = router.replace.mock.calls.at(-1) as unknown as [{ query: Record<string, string> }];
    expect(arg.query).toEqual({ tab: 'connections' });
  });

  it('&provider=etsy opens the Etsy shops panel with the restriction banner', async () => {
    router.query = { provider: 'etsy' };
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    await waitFor(() => expect(screen.getByTestId('etsy-shops-panel')).toBeTruthy());
    expect(screen.getByText('Etsy API Restriction')).toBeTruthy();
    expect(screen.getByTestId('etsy-shop-s1')).toBeTruthy();
  });

  it('&provider=ebay (no panel) rings the tile', async () => {
    router.query = { provider: 'ebay' };
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    await waitFor(() => expect(screen.getByTestId('tile-ebay').getAttribute('data-highlighted')).toBe('true'));
  });

  it('&limit=connectedStore opens the modal once and strips the param', async () => {
    router.query = { tab: 'connections', limit: 'connectedStore' };
    renderB(<ConnectionsSection credentials={store(VALUES)} />);
    await waitFor(() => expect(screen.getByTestId('store-limit-modal')).toBeTruthy());
    expect(screen.getByText("You've used all 5 store slots")).toBeTruthy();
    const [arg] = router.replace.mock.calls.at(-1) as unknown as [{ query: Record<string, string> }];
    expect(arg.query).toEqual({ tab: 'connections' });
  });

  it('reads provider / focus from the SettingsShellContext when present', async () => {
    const clearProvider = vi.fn();
    const shell: SettingsShellValue = {
      tab: 'connections', mobile: false, provider: 'shopify', clearProvider, focusProvider: null, focusNonce: 0,
      connectionsRefreshKey: 0, goToTab: vi.fn(async () => true), confirmDiscard: vi.fn(async () => true),
    };
    renderB(<SettingsShellContext.Provider value={shell}><ConnectionsSection credentials={store(VALUES)} /></SettingsShellContext.Provider>);
    await waitFor(() => expect(screen.getByTestId('shopify-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('action-shopify-cancel'));
    expect(clearProvider).toHaveBeenCalled();
  });
});

describe('StoreLimitModal gating', () => {
  it('neutral copy and a single OK for shopify_free', () => {
    renderB(<StoreLimitModal open onClose={() => undefined} allowance={{ stripeUpsell: false, plan: 'shopify_free', used: 1, limit: 1 }} />);
    expect(screen.getByText('Store limit reached')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.queryByText('Not now')).toBeNull();
    expect(hrefs().some((h) => h.includes('/fiyatlandirma'))).toBe(false);
  });
  it('plan copy for Growth', () => {
    renderB(<StoreLimitModal open onClose={() => undefined} allowance={{ stripeUpsell: true, plan: 'growth', used: 5, limit: 5 }} />, 'tr');
    expect(screen.getByText('5 mağaza hakkının tamamını kullandınız')).toBeTruthy();
    expect(screen.getByText(/Growth planı 5 bağlı mağaza içerir/)).toBeTruthy();
    expect(hrefs()).toContain('/fiyatlandirma?plan=pro');
  });
});

describe('ProviderCredentialsPanel', () => {
  const typeIn = (name: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  };

  it('required-together: Save shows errors + summary and does not PATCH', async () => {
    const s = store({});
    renderB(<ProviderCredentialsPanel open providerId="trendyol" onClose={() => undefined} store={s} />);
    typeIn('trendyolApiKey', 'key-1');
    fireEvent.click(screen.getByTestId('action-credentials-save'));
    await waitFor(() => expect(screen.getByTestId('credentials-fix-fields')).toBeTruthy());
    expect(screen.getByText('Fix 2 fields to continue')).toBeTruthy();
    expect(screen.getByText('Enter the API secret too')).toBeTruthy();
    expect(s.save).not.toHaveBeenCalled();
  });

  it('digits-only supplier ID', async () => {
    renderB(<ProviderCredentialsPanel open providerId="trendyol" onClose={() => undefined} store={store(VALUES)} />);
    typeIn('trendyolSupplierId', '12a');
    await waitFor(() => expect(screen.getByText('Use digits only')).toBeTruthy());
  });

  it('saves only that provider, masked secrets dropped, then onSaved + close', async () => {
    const s = store(VALUES);
    const onSaved = vi.fn(async () => undefined);
    const onClose = vi.fn();
    renderB(<ProviderCredentialsPanel open providerId="trendyol" onClose={onClose} onSaved={onSaved} store={s} />);
    typeIn('trendyolSupplierId', ' 123456 ');
    await act(async () => { fireEvent.click(screen.getByTestId('action-credentials-save')); });
    await waitFor(() => expect(s.save).toHaveBeenCalledTimes(1));
    expect(s.save).toHaveBeenCalledWith({ trendyolSupplierId: '123456' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it('save failure keeps the panel open with the danger banner', async () => {
    const s = store(VALUES, vi.fn(async () => { throw { response: { status: 500 } }; }));
    const onClose = vi.fn();
    renderB(<ProviderCredentialsPanel open providerId="trendyol" onClose={onClose} store={s} />);
    typeIn('trendyolSupplierId', '1');
    await act(async () => { fireEvent.click(screen.getByTestId('action-credentials-save')); });
    await waitFor(() => expect(screen.getByTestId('credentials-save-failed')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('402 shows the store-limit copy inline (neutral when stripeUpsell is false)', async () => {
    const s = store(VALUES, vi.fn(async () => { throw { response: { status: 402 } }; }));
    renderB(<ProviderCredentialsPanel open providerId="trendyol" onClose={() => undefined} store={s} allowance={{ stripeUpsell: false, plan: 'shopify_free', used: 1, limit: 1 }} />);
    typeIn('trendyolSupplierId', '1');
    await act(async () => { fireEvent.click(screen.getByTestId('action-credentials-save')); });
    await waitFor(() => expect(screen.getByTestId('credentials-store-limit')).toBeTruthy());
    expect(hrefs().some((h) => h.includes('/fiyatlandirma'))).toBe(false);
  });

  it('settings load failed → inline ErrorState with Retry instead of bones; Save disabled with a retry reason', async () => {
    const s = { ...store({}), values: null, loaded: false, loadFailed: true };
    renderB(<ProviderCredentialsPanel open providerId="trendyol" onClose={() => undefined} store={s} />);
    expect(screen.getByTestId('credentials-panel-load-failed')).toBeTruthy();
    expect(screen.queryByTestId('credentials-skeleton')).toBeNull();
    await act(async () => { fireEvent.click(within(screen.getByTestId('credentials-panel-load-failed')).getByRole('button')); });
    expect(s.refetch).toHaveBeenCalledTimes(1);
  });

  it('DHL eCommerce shows only customer number + password', () => {
    renderB(<ProviderCredentialsPanel open providerId="mng" onClose={() => undefined} store={store({})} />);
    const names = Array.from(document.querySelectorAll('input[name]')).map((i) => i.getAttribute('name'));
    expect(names).toEqual(['mngCustomerNumber', 'mngPassword']);
  });
});

describe.each(LOCALES)('CredentialsSection (%s)', (locale) => {
  it('lists the 7 credential providers in 3 groups with masked hints', () => {
    renderB(<CredentialsSection credentials={store(VALUES)} />, locale);
    for (const id of ['trendyol', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut']) expect(screen.getByTestId(`credentials-row-${id}`)).toBeTruthy();
    expect(screen.getByTestId('credentials-group-marketplaces')).toBeTruthy();
    expect(screen.getByTestId('credentials-group-shipping')).toBeTruthy();
    expect(screen.getByTestId('credentials-group-accounting')).toBeTruthy();
    const hint = locale === 'en' ? 'API key ••••1234' : 'API anahtarı ••••1234';
    expect(within(screen.getByTestId('credentials-row-trendyol')).getByText(hint)).toBeTruthy();
    expect(intlErrors).toEqual([]);
  });

  it('settings load failed → inline ErrorState with Retry, never an endless skeleton', async () => {
    const s = { ...store({}), values: null, loaded: false, loadFailed: true };
    renderB(<CredentialsSection credentials={s} />, locale);
    const err = screen.getByTestId('credentials-load-failed');
    expect(within(err).getByText(locale === 'en' ? "Couldn't load your saved keys" : 'Kayıtlı anahtarlarınız yüklenemedi')).toBeTruthy();
    expect(screen.queryByTestId('credentials-group-marketplaces')).toBeNull();
    await act(async () => { fireEvent.click(within(err).getByRole('button')); });
    expect(s.refetch).toHaveBeenCalledTimes(1);
    expect(intlErrors).toEqual([]);
  });

  it('non-secret identifiers are display-masked in row hints', () => {
    renderB(<CredentialsSection credentials={store({ ...VALUES, upsAccountNumber: 'A1B2C3' })} />, locale);
    const hint = locale === 'en' ? 'Account number ••••B2C3' : 'Hesap numarası ••••B2C3';
    expect(within(screen.getByTestId('credentials-row-ups')).getByText(hint)).toBeTruthy();
  });

  it('a row opens the shared credentials panel', async () => {
    renderB(<CredentialsSection credentials={store(VALUES)} />, locale);
    fireEvent.click(screen.getByTestId('credentials-row-fedex-action'));
    await waitFor(() => expect(screen.getByTestId('credentials-panel')).toBeTruthy());
  });
});

describe('legacy switch shims', () => {
  it('outside SettingsPage the legacy bodies render', () => {
    renderB(<><ConnectionsPanel refreshKey={0} /><ApiKeysPanel integrationSettings={{}} onChange={() => undefined} /></>);
    expect(screen.getByTestId('legacy-connections')).toBeTruthy();
    expect(screen.getByTestId('legacy-apikeys')).toBeTruthy();
  });
  it('inside SettingsPage (shell context) the DS sections render', () => {
    const shell: SettingsShellValue = {
      tab: 'connections', mobile: false, provider: null, clearProvider: vi.fn(), focusProvider: null, focusNonce: 0,
      connectionsRefreshKey: 0, goToTab: vi.fn(async () => true), confirmDiscard: vi.fn(async () => true),
    };
    renderB(
      <SettingsShellContext.Provider value={shell}>
        <ConnectionsPanel refreshKey={0} />
      </SettingsShellContext.Provider>,
    );
    expect(screen.queryByTestId('legacy-connections')).toBeNull();
    expect(screen.getByTestId('connections-section')).toBeTruthy();
  });
});
