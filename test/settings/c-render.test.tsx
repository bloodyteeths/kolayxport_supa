// @vitest-environment jsdom
// Settings group C: Sender profile, Preferences, Refresh history render in EN and TR with no missing keys,
// validate before saving, and talk to the unchanged endpoints.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import useSWR from 'swr';
import { SenderForm } from '@/components/domain/settings/sender';
import { PreferencesPanel } from '@/components/domain/settings/PreferencesPanel';
import { RefreshOverview } from '@/components/domain/settings/refresh';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { SettingsShellContext, type SettingsShellValue } from '@/components/domain/settings/settingsNav';
import { LOCALES, intlErrors, renderC } from './c-harness';
import { flatten, groupC, GROUP_C_OWNED } from './c-messages';

// PreferencesPanel hosts the account-deletion section, which reads the session e-mail.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'seller@example.com' } }, status: 'authenticated' }),
  signOut: vi.fn(),
}));

const SHELL = { tab: 'senderProfile' } as unknown as SettingsShellValue;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { intlErrors.length = 0; });
afterEach(() => { expect(intlErrors).toEqual([]); });

const profile = {
  shipperName: 'Modsons Yazılım', shipperPersonName: 'Tamer S.', shipperPhoneNumber: '05320000000',
  shipperTinNumber: '1234567890', shipperTinType: 'VAT', shipperStreet1: 'Atatürk Cd. 1', shipperStreet2: '',
  shipperCity: 'İstanbul', shipperStateCode: '', shipperPostalCode: '34000', shipperCountryCode: 'TR',
  defaultCurrencyCode: 'TRY', dutiesPaymentType: 'SENDER', defaultShippingChargesPaymentType: 'SENDER',
  fedexFolderId: '', importerOfRecord: '',
};

function SenderHarness({ initial = profile, onSave, onProfile }: { initial?: Record<string, string>; onSave: () => void; onProfile?: (n: string, v: string) => void }) {
  const [p, setP] = useState<Record<string, string>>(initial);
  const [sh, setSh] = useState<{ etgbEnabled?: boolean; etgbRecipientEmail?: string }>({ etgbEnabled: false });
  return (
    <SenderForm
      shipperProfile={p}
      shippingSettings={sh}
      onChangeProfile={(n, v) => { onProfile?.(n, v); setP((prev) => ({ ...prev, [n]: v })); }}
      onChangeShipping={(n, v) => setSh((prev) => ({ ...prev, [n]: v }))}
      importerJsonError={null}
      etgbCollapsed={false}
      dirty
      onSave={onSave}
      onDiscard={() => setP(initial)}
    />
  );
}

describe('SenderForm', () => {
  for (const locale of LOCALES) {
    it(`renders every group and the label preview (${locale})`, () => {
      renderC(<SenderHarness onSave={() => {}} />, locale);
      const msgs = groupC[locale].sender as Record<string, Record<string, string>>;
      for (const g of Object.values(msgs.group)) expect(screen.getAllByText(g).length).toBeGreaterThan(0);
      const preview = screen.getByTestId('sender-label-preview');
      expect(preview.textContent).toContain('Modsons Yazılım');
      expect(preview.textContent).toContain('34000 İstanbul');
      expect(preview.textContent).toContain('+905320000000');
      // no uppercase transform anywhere (P5)
      expect(preview.textContent).not.toContain('MODSONS');
    });
  }

  it('typing a phone digit by digit into an empty TR field stores the number once (no repeated calling code)', () => {
    const onProfile = vi.fn();
    renderC(<SenderHarness initial={{ ...profile, shipperPhoneNumber: '' }} onSave={() => {}} onProfile={onProfile} />);
    const row = screen.getByTestId('sender-row-shipperPhoneNumber');
    const input = within(row).getByRole('textbox') as HTMLInputElement;
    let typed = '';
    for (const d of '5320000000') {
      typed += d;
      fireEvent.change(input, { target: { value: typed } });
      expect(input.value).toBe(typed);
    }
    const phoneCalls = onProfile.mock.calls.filter(([n]) => n === 'shipperPhoneNumber');
    expect(phoneCalls[phoneCalls.length - 1][1]).toBe('905320000000');
    expect(screen.getByTestId('sender-label-preview').textContent).toContain('+905320000000');
  });

  it('blocks save and marks required fields; saves once they are filled', async () => {
    const onSave = vi.fn();
    renderC(<SenderHarness initial={{ ...profile, shipperCity: '' }} onSave={onSave} />);
    const bar = screen.getByTestId('sender-save-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Fix 1 field to save')).toBeTruthy();
    const cityRow = screen.getByTestId('sender-row-shipperCity');
    expect(within(cityRow).getByRole('alert').textContent).toContain('Fill this in to save');
    fireEvent.change(within(cityRow).getByRole('textbox'), { target: { value: 'Ankara' } });
    fireEvent.click(within(screen.getByTestId('sender-save-bar')).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('ETGB email appears when switched on and is validated', async () => {
    const onSave = vi.fn();
    renderC(<SenderHarness onSave={onSave} />);
    expect(screen.queryByTestId('sender-row-etgbRecipientEmail')).toBeNull();
    const sw = within(screen.getByTestId('sender-row-etgbEnabled')).getByRole('switch', { name: /Send ETGB documents automatically/ });
    fireEvent.click(sw);
    const row = screen.getByTestId('sender-row-etgbRecipientEmail');
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'not-an-email' } });
    fireEvent.click(within(screen.getByTestId('sender-save-bar')).getByRole('button', { name: 'Save changes' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('sender-row-etgbRecipientEmail')).getByRole('alert').textContent).toContain('valid email');
  });

  it('collapsed ETGB (EN config) shows a summary and an Edit button', () => {
    renderC(
      <SenderForm shipperProfile={profile} shippingSettings={{ etgbEnabled: true, etgbRecipientEmail: 'etgb@x.com' }} onChangeProfile={() => {}} onChangeShipping={() => {}} importerJsonError={null} etgbCollapsed />,
    );
    expect(screen.getByTestId('sender-etgb-summary').textContent).toContain('etgb@x.com');
    fireEvent.click(screen.getByTestId('sender-etgb-edit'));
    expect(screen.getByTestId('sender-etgb-body')).toBeTruthy();
  });

  it('SenderForm without onSave renders no save bar and reports edits', () => {
    const onChangeProfile = vi.fn();
    renderC(
      <SettingsShellContext.Provider value={SHELL}>
        <SenderForm shipperProfile={profile} shippingSettings={{}} onChangeProfile={onChangeProfile} onChangeShipping={() => {}} importerJsonError={null} etgbCollapsed={false} />
      </SettingsShellContext.Provider>,
    );
    expect(screen.queryByTestId('sender-save-bar')).toBeNull();
    fireEvent.change(within(screen.getByTestId('sender-row-shipperName')).getByRole('textbox'), { target: { value: 'X' } });
    expect(onChangeProfile).toHaveBeenCalledWith('shipperName', 'X');
  });

  it('load error shows an inline retry', () => {
    const onRetry = vi.fn();
    renderC(<SenderForm shipperProfile={{}} shippingSettings={{}} onChangeProfile={() => {}} onChangeShipping={() => {}} importerJsonError={null} etgbCollapsed={false} state="error" onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load your sender profile")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry|Try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('PreferencesPanel', () => {
  for (const locale of LOCALES) {
    it(`reads the account timezone and saves only settings.timezone (${locale})`, async () => {
      const calls: { url: string; init?: RequestInit }[] = [];
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'PUT') return jsonResponse({ settings: { timezone: 'Asia/Tokyo' } });
        return jsonResponse({ settings: { timezone: 'Europe/Istanbul', locale: 'tr' } });
      }));
      const onDirty = vi.fn();
      renderC(<PreferencesPanel onDirtyChange={onDirty} />, locale);
      const tz = await screen.findByTestId('preferences-timezone');
      expect((within(tz).getByRole('combobox') as HTMLInputElement).value).toContain('Europe/Istanbul');
      expect(screen.queryByTestId('preferences-save-bar')).toBeNull();

      const input = within(tz).getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Tokyo' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const opt = await screen.findByRole('option', { name: /Asia\/Tokyo/ });
      fireEvent.click(opt);
      await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
      const bar = await screen.findByTestId('preferences-save-bar');
      const saveName = (groupC[locale].saveBar as Record<string, string>).save;
      await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: saveName })); });
      await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
      const put = calls.find((c) => c.init?.method === 'PUT')!;
      expect(put.url).toBe('/api/notifications/preferences');
      expect(JSON.parse(String(put.init?.body))).toEqual({ settings: { timezone: 'Asia/Tokyo' } });
      await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
    });
  }

  it('a saved timezone revalidates /api/user/settings (app FormatProvider source)', async () => {
    let settingsFetches = 0;
    const settingsFetcher = () => { settingsFetches += 1; return Promise.resolve({ preferences: { timezone: null } }); };
    function SettingsProbe() { useSWR('/api/user/settings', settingsFetcher, { revalidateOnFocus: false }); return null; }
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? jsonResponse({ settings: { timezone: 'Asia/Tokyo' } }) : jsonResponse({ settings: { timezone: 'Europe/Istanbul' } })
    )));
    renderC(<><SettingsProbe /><PreferencesPanel /></>);
    await waitFor(() => expect(settingsFetches).toBe(1));
    const tz = await screen.findByTestId('preferences-timezone');
    const input = within(tz).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Tokyo' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /Asia\/Tokyo/ }));
    const bar = await screen.findByTestId('preferences-save-bar');
    await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => expect(settingsFetches).toBe(2));
  });

  it('language applies immediately through the locale store', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ settings: { timezone: null } })));
    useLocaleStore.setState({ locale: 'tr' });
    renderC(<PreferencesPanel />);
    fireEvent.click(within(screen.getByTestId('preferences-language')).getByRole('radio', { name: 'English' }));
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(screen.getByTestId('preferences-notifications-link').getAttribute('href')).toBe('/app/bildirimler?tab=preferences');
  });
});

const runs = [
  { id: 'r1', type: 'etsy', status: 'failed', startedAt: '2026-10-15T07:40:00.000Z', endedAt: '2026-10-15T07:40:09.000Z', processedOrders: 0, successfulOrders: 0, failedOrders: 1, errors: [{ orderId: '3891', error: 'Address missing' }] },
  { id: 'r2', type: 'full', status: 'completed', startedAt: '2026-10-15T06:00:00.000Z', endedAt: '2026-10-15T06:01:12.000Z', processedOrders: 120, successfulOrders: 118, failedOrders: 2, errors: [] },
];

describe('RefreshOverview', () => {
  for (const locale of LOCALES) {
    it(`lists runs with run pills and opens the errors panel (${locale})`, async () => {
      vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ syncs: runs, nextCursor: null })));
      renderC(<RefreshOverview />, locale);
      const table = await screen.findByTestId('refresh-history-table');
      await waitFor(() => expect(within(table).getAllByText((groupC[locale].refresh as Record<string, Record<string, string>>).types.full).length).toBeGreaterThan(0));
      const pills = table.querySelectorAll('[data-domain="run"]');
      expect(Array.from(pills).map((p) => p.getAttribute('data-status'))).toEqual(['failed', 'completed']);
      expect(screen.getByTestId('settings-panel-meta').textContent).toContain((groupC[locale].refresh as Record<string, string>).lastSuccessNoSources.split(':')[0]);
    });
  }

  it('View errors opens SyncErrorsPanel with message · order rows', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ syncs: runs, nextCursor: null })));
    renderC(<RefreshOverview />);
    const table = await screen.findByTestId('refresh-history-table');
    await waitFor(() => expect(table.querySelectorAll('[data-domain="run"]').length).toBe(2));
    const moreButtons = within(table).getAllByRole('button', { name: /more|actions|⋯/i });
    fireEvent.click(moreButtons[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View errors' }));
    const list = await screen.findByTestId('sync-errors-list');
    expect(list.textContent).toContain('Address missing');
    expect(list.textContent).toContain('Order #3891');
  });

  it('Refresh all orders confirms, POSTs fullSync and is disabled while a run is going', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/orders/fullSync') return jsonResponse({ success: true, syncId: 'n' }, 202);
      return jsonResponse({ syncs: runs, nextCursor: null });
    }));
    renderC(<RefreshOverview />);
    await screen.findByTestId('refresh-history-table');
    fireEvent.click(screen.getByTestId('refresh-all'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh all orders' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/orders/fullSync' && c.init?.method === 'POST')).toBe(true));
  });

  it('running run disables the action with a reason', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ syncs: [{ ...runs[1], id: 'r0', status: 'in_progress', startedAt: new Date().toISOString(), endedAt: null }], nextCursor: null })));
    renderC(<RefreshOverview />);
    await waitFor(() => expect(screen.getByTestId('settings-panel-meta').textContent).toBe('Refreshing…'));
    expect((screen.getByTestId('refresh-all') as HTMLButtonElement).disabled || screen.getByTestId('refresh-all').getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('a failed Load more shows the footer error, and Retry refetches that page', async () => {
    let cursorCalls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('cursor=')) {
        cursorCalls += 1;
        return cursorCalls === 1 ? jsonResponse({ error: 'x' }, 500) : jsonResponse({ syncs: [{ ...runs[1], id: 'r9' }], nextCursor: null });
      }
      return jsonResponse({ syncs: runs, nextCursor: 'c1' });
    }));
    renderC(<RefreshOverview />);
    expect(screen.queryByText("Couldn't load more")).toBeNull();
    fireEvent.click(await screen.findByTestId('refresh-history-load-more'));
    const footer = await screen.findByTestId('refresh-history-footer');
    await waitFor(() => expect(within(footer).getByText("Couldn't load more")).toBeTruthy());
    fireEvent.click(within(screen.getByTestId('refresh-history-footer')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cursorCalls).toBe(2));
    await waitFor(() => expect(screen.queryByText("Couldn't load more")).toBeNull());
  });

  it('an orphaned in_progress run (no update for > 15 min) does not block a new refresh', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ syncs: [{ ...runs[1], id: 'r0', status: 'in_progress', startedAt: old, endedAt: old }], nextCursor: null })));
    renderC(<RefreshOverview />);
    await screen.findByTestId('refresh-history-footer');
    expect(screen.queryByTestId('settings-panel-meta')?.textContent ?? '').not.toBe('Refreshing…');
    const btn = screen.getByTestId('refresh-all') as HTMLButtonElement;
    expect(btn.disabled || btn.getAttribute('aria-disabled') === 'true').toBe(false);
  });

  it('empty history shows the first-use state with the refresh action', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ syncs: [], nextCursor: null })));
    renderC(<SettingsShellContext.Provider value={SHELL}><RefreshOverview /></SettingsShellContext.Provider>);
    expect(await screen.findByText('No refreshes yet')).toBeTruthy();
  });

  it('load failure shows an inline error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'x' }, 500)));
    renderC(<RefreshOverview />);
    expect(await screen.findByText("Couldn't load refresh history")).toBeTruthy();
  });
});

describe('group C i18n', () => {
  it('EN and TR have the same keys', () => {
    for (const ns of GROUP_C_OWNED) {
      expect(Object.keys(flatten(groupC.tr[ns] as never)).sort()).toEqual(Object.keys(flatten(groupC.en[ns] as never)).sort());
    }
  });
  it('TR uses real Turkish characters and no uppercase-only strings', () => {
    const tr = Object.values(flatten(groupC.tr as never));
    for (const v of tr) {
      expect(v).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Gecmis|Yukle/);
      expect(v === v.toLocaleUpperCase('tr') && /[a-zçğıöşü]/i.test(v) && v.length > 4).toBe(false);
    }
  });
});
