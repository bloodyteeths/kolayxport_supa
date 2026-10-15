// @vitest-environment jsdom
// M2 shell group E: components/ds/shell/CommandPalette.tsx, lib/ds/useCommand.ts, lib/ds/usePageActions.ts,
// lib/nav/useGoShortcuts.ts (shell-nav §3.6, §7, §13).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import enMessages from '../../messages/en.json';
import trMessages from '../../messages/tr.json';

const router = { pathname: '/app/analytics', asPath: '/app/analytics', push: vi.fn(() => Promise.resolve(true)), query: {} };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: () => null }));

import {
  CommandPalette,
  GoShortcutHint,
  buildPaletteSections,
  nextEnabledIndex,
} from '@/components/ds/shell/CommandPalette';
import {
  RECENT_KEY,
  RECENT_LIMIT,
  __resetCommandsForTests,
  addRecent,
  readRecent,
  registerCommand,
  useCommand,
  useRegisteredCommands,
  type Command,
} from '@/lib/ds/useCommand';
import { actionToCommand, actionsToCommands, usePageActions } from '@/lib/ds/usePageActions';
import { goShortcutMap, isGoStart, useGoShortcuts } from '@/lib/nav/useGoShortcuts';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetShellStoreForTests, useShellStore } from '@/lib/nav/useShellStore';
import { ShellProvider, usePageMetaSink } from '@/lib/nav/ShellContext';
import type { NavDestination } from '@/lib/nav/useNavModel';
import type { ActionSpec } from '@/components/ds/types/actions';
import { icons } from '@/lib/ds/icons';

// shell.palette / shell.shortcuts keys are returned as newI18nKeys (the integrator writes the message files);
// the fixture layers them over the real messages so these tests pin the strings.
const SHELL = {
  en: {
    palette: {
      onThisPage: 'On this page', recent: 'Recent', searchError: "Couldn't search orders", noOrders: 'No orders match “{query}”', cancel: 'Cancel',
      retry: 'Retry', refreshing: 'Refreshing orders…', refreshed: 'Orders refreshed',
    },
    shortcuts: { goHint: 'g …' },
  },
  tr: {
    palette: {
      onThisPage: 'Bu sayfada', recent: 'Son kullanılanlar', searchError: 'Siparişler aranamadı', noOrders: '“{query}” ile eşleşen sipariş yok', cancel: 'Vazgeç',
      retry: 'Tekrar dene', refreshing: 'Siparişler yenileniyor…', refreshed: 'Siparişler yenilendi',
    },
    shortcuts: { goHint: 'g …' },
  },
};
// shell-nav §10 changed values (CRITIQUE C12), also returned as newI18nKeys.
const PALETTE_CHANGED = {
  en: { syncOrders: 'Refresh orders', syncOrdersHint: 'Get the latest orders from your connected stores' },
  tr: { syncOrders: 'Siparişleri yenile', syncOrdersHint: 'Bağlı mağazalarınızdaki son siparişleri getir' },
};
function messagesFor(locale: 'en' | 'tr') {
  const real = (locale === 'en' ? enMessages : trMessages) as unknown as Record<string, Record<string, unknown>>;
  return {
    ...real,
    commandPalette: { ...(real.commandPalette ?? {}), ...PALETTE_CHANGED[locale] },
    shell: { ...(real.shell ?? {}), ...SHELL[locale] },
  };
}

function setMatchMedia(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile ? /max-width/.test(query) : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function Providers({ locale = 'en', children }: { locale?: 'en' | 'tr'; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Istanbul" onError={() => {}}>
      <ThemeProvider theme={theme}>
        <ShellProvider documentTitle={false}>{children}</ShellProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

const DEST: NavDestination[] = [
  { id: 'home', href: '/app/analytics', label: 'Home', iconKey: 'overview', icon: icons.overview, gKey: 'h', keywords: ['analytics'] },
  { id: 'orders', href: '/app/labels', label: 'Orders', iconKey: 'order', icon: icons.order, gKey: 'o', keywords: ['labels'] },
  { id: 'listings-etsy', href: '/app/etsy-listings', label: 'Etsy listings', section: 'Listings', brand: 'etsy', keywords: ['etsy'] },
  { id: 'etsy-activity', href: '/app/etsy-aktivite', label: 'Etsy activity', section: 'Listings', iconKey: 'etsyActivity', icon: icons.etsyActivity, keywords: ['etsy', 'aktivite'] },
];

/** A page that hands its header actions to the shell the way `<Page>` does (group F). */
function FakePage({ actions }: { actions: ActionSpec[] }) {
  const sink = usePageMetaSink();
  React.useLayoutEffect(() => {
    sink?.({ title: 'Etsy listings', width: 'list', mobileOverflow: [], headerActions: actions });
  });
  return null;
}

function openPalette() {
  act(() => useShellStore.getState().setPaletteOpen(true));
}

function sectionTitles(): string[] {
  const list = screen.getByRole('listbox');
  return within(list)
    .getAllByRole('group')
    .map((g) => {
      const id = g.getAttribute('aria-labelledby');
      return id ? document.getElementById(id)?.textContent ?? '' : '';
    });
}

const fetchMock = vi.fn();

beforeEach(() => {
  __resetShellStoreForTests();
  __resetShortcutsForTests();
  __resetCommandsForTests();
  window.localStorage.clear();
  router.pathname = '/app/analytics';
  router.push.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ orders: [] }) });
  vi.stubGlobal('fetch', fetchMock);
  setMatchMedia(false);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── pure ─────────────────────────────────────────────────────────────────────

describe('actionToCommand / actionsToCommands', () => {
  it('maps paletteGroup, disabled and loading; skips no-op and duplicate actions', () => {
    const run = vi.fn();
    const send = actionToCommand({ id: 'send', label: 'Send 7 changes to Etsy', onClick: run, shortcut: 'mod+enter' });
    expect(send).toMatchObject({ id: 'page:send', group: 'actions', onThisPage: true, shortcut: 'mod+enter', disabled: false });
    send.run?.();
    expect(run).toHaveBeenCalledTimes(1);
    expect(actionToCommand({ id: 'a', label: 'A', href: '/x', paletteGroup: 'goto' })).toMatchObject({ group: 'goto', onThisPage: false, href: '/x', run: undefined });
    expect(actionToCommand({ id: 'b', label: 'B', onClick: run, disabled: true, disabledReason: 'Connect Etsy first' })).toMatchObject({ disabled: true, disabledReason: 'Connect Etsy first' });
    expect(actionToCommand({ id: 'c', label: 'C', onClick: run, loading: true, loadingLabel: 'Sending…' })).toMatchObject({ disabled: true, disabledReason: 'Sending…' });
    const list = actionsToCommands([null, { id: 'x', label: 'X' }, { id: 'y', label: 'Y', onClick: run }, { id: 'y', label: 'Y2', onClick: run }, false]);
    expect(list.map((c) => c.label)).toEqual(['Y']);
  });
});

describe('Recent', () => {
  it('keeps the last 5, newest first, without duplicates; survives garbage and blocked storage', () => {
    let list = [] as ReturnType<typeof addRecent>;
    for (let i = 0; i < 7; i++) list = addRecent(list, { id: `c${i}`, label: `C${i}` });
    list = addRecent(list, { id: 'c4', label: 'C4' });
    expect(list.map((e) => e.id)).toEqual(['c4', 'c6', 'c5', 'c3', 'c2']);
    expect(list).toHaveLength(RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, '{nope');
    expect(readRecent()).toEqual([]);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: 'ok', label: 'Ok' }, { id: 3 }, 'x']));
    expect(readRecent()).toEqual([{ id: 'ok', label: 'Ok' }]);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecent()).toEqual([]);
    spy.mockRestore();
  });
});

describe('buildPaletteSections', () => {
  const builtins: Command[] = [{ id: 'orders.refresh', label: 'Refresh orders', group: 'actions', run: () => {} }];
  const page: Command[] = [{ id: 'page:send', label: 'Send 7 changes to Etsy', group: 'actions', onThisPage: true, run: () => {} }];

  it('orders groups On this page → Recent → Actions → Go to, and resolves Recent to live rows', () => {
    const s = buildPaletteSections({
      query: '',
      locale: 'en',
      commands: page,
      builtins,
      destinations: DEST,
      recent: [{ id: 'nav:/app/labels', label: 'Orders', href: '/app/labels' }, { id: 'nav:/gone', label: 'Old page', href: '/gone' }, { id: 'cmd:missing', label: 'Missing' }],
    });
    expect(s.map((x) => x.id)).toEqual(['page', 'recent', 'actions', 'goto']);
    // Stale entries (a hidden destination, a missing command) are dropped, never navigated by stored href.
    expect(s[1].entries.map((e) => e.label)).toEqual(['Orders']);
    // A recent row is not listed twice.
    expect(s[3].entries.map((e) => e.label)).toEqual(['Home', 'Etsy listings', 'Etsy activity']);
    expect(s[3].entries[0].shortcut).toBe('g h');
  });

  it('hides a built-in when the page header has the same action', () => {
    const s = buildPaletteSections({
      query: '',
      locale: 'en',
      commands: [{ id: 'page:refresh', label: 'Refresh orders', group: 'actions', onThisPage: true, run: () => {} }],
      builtins,
      destinations: [],
      recent: [],
    });
    expect(s.map((x) => x.id)).toEqual(['page']);
  });

  it('ranks every group by the query and drops Recent', () => {
    const s = buildPaletteSections({ query: 'etsy', locale: 'en', commands: page, builtins, destinations: DEST, recent: [{ id: 'nav:/app/labels', label: 'Orders', href: '/app/labels' }] });
    expect(s.map((x) => x.id)).toEqual(['page', 'goto']);
    expect(s[1].entries.map((e) => e.label)).toEqual(['Etsy listings', 'Etsy activity']);
  });

  it('nextEnabledIndex skips disabled rows and wraps', () => {
    const rows = [{ disabled: false }, { disabled: true }, { disabled: false }];
    expect(nextEnabledIndex(rows, 0, 1)).toBe(2);
    expect(nextEnabledIndex(rows, 2, 1)).toBe(0);
    expect(nextEnabledIndex(rows, 0, -1)).toBe(2);
    expect(nextEnabledIndex([{ disabled: true }], 0, 1)).toBe(-1);
    expect(nextEnabledIndex([], 0, 1)).toBe(-1);
  });
});

describe('go shortcuts (pure)', () => {
  it('builds `g x` bindings, lowercased, first wins', () => {
    const nav = vi.fn();
    const map = goShortcutMap([{ key: 'O', href: '/app/labels', label: 'Orders' }, { key: 'o', href: '/dup', label: 'Dup' }, { key: '', href: '/x', label: 'X' }], nav);
    expect(Object.keys(map)).toEqual(['g o']);
    const b = map['g o'] as { handler: () => void };
    b.handler();
    expect(nav).toHaveBeenCalledWith('/app/labels');
  });
  it('a `g` chord starts only outside text fields and without modifiers', () => {
    const input = document.createElement('input');
    const base = { key: 'g', metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: document.body };
    expect(isGoStart(base)).toBe(true);
    expect(isGoStart({ ...base, key: 'G' })).toBe(true);
    expect(isGoStart({ ...base, target: input })).toBe(false);
    expect(isGoStart({ ...base, metaKey: true })).toBe(false);
    // Shift+G does not arm a chord (the binding requires no Shift), so no hint either.
    expect(isGoStart({ ...base, key: 'G', shiftKey: true })).toBe(false);
    // Inside a dialog / menu: no chord.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    expect(isGoStart({ ...base, target: btn })).toBe(false);
    dialog.remove();
  });

  it('page-scoped commands are never remembered in Recent', () => {
    const s = buildPaletteSections({
      query: '',
      locale: 'en',
      commands: [
        { id: 'page:send', label: 'Send', group: 'actions', onThisPage: true, run: () => {} },
        { id: 'page:export', label: 'Export', group: 'actions', run: () => {} },
      ],
      builtins: [],
      destinations: [],
      recent: [],
    });
    for (const sec of s) for (const e of sec.entries) expect(e.recent).toBeNull();
  });
});

// ── hooks ────────────────────────────────────────────────────────────────────

describe('useCommand / usePageActions', () => {
  it('registers while mounted, keeps the handler live, and unregisters on unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ run }) => {
        useCommand({ id: 'ov.refresh', label: 'Refresh', group: 'actions', run });
        usePageActions([{ id: 'exp', label: 'Export', onClick: run }]);
        return useRegisteredCommands();
      },
      { initialProps: { run: first } },
    );
    expect(result.current.map((c) => [c.id, c.source])).toEqual([['ov.refresh', 'app'], ['page:exp', 'page']]);
    rerender({ run: second });
    result.current[0].run?.();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unmount();
    const after = renderHook(() => useRegisteredCommands());
    expect(after.result.current).toEqual([]);
  });

  it('imperative registration dedupes by id (latest wins)', () => {
    const off1 = registerCommand({ id: 'x', label: 'One', group: 'actions' }, 'app', 'a');
    const off2 = registerCommand({ id: 'x', label: 'Two', group: 'actions' }, 'app', 'b');
    const { result } = renderHook(() => useRegisteredCommands());
    expect(result.current.map((c) => c.label)).toEqual(['Two']);
    act(() => off2());
    expect(result.current.map((c) => c.label)).toEqual(['One']);
    act(() => off1());
    expect(result.current).toEqual([]);
  });
});

describe('useGoShortcuts', () => {
  it('g then o navigates, shows the hint for the chord, and ignores text fields', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useGoShortcuts([{ key: 'o', href: '/app/labels', label: 'Orders' }], { navigate }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    expect(result.current.pending).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    });
    expect(navigate).toHaveBeenCalledWith('/app/labels');
    expect(result.current.pending).toBe(false);

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('does nothing while a MUI modal (dialog, drawer, menu) is open', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useGoShortcuts([{ key: 'o', href: '/app/labels', label: 'Orders' }], { navigate }));
    const modal = document.createElement('div');
    modal.className = 'MuiModal-root';
    document.body.appendChild(modal);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    expect(result.current.pending).toBe(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    });
    expect(navigate).not.toHaveBeenCalled();
    // A closed keepMounted modal does not block.
    modal.classList.add('MuiModal-hidden');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    });
    expect(navigate).toHaveBeenCalledWith('/app/labels');
    modal.remove();
  });

  it('works on a Turkish layout (uppercase / key-based) and times out after 1s', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const { result } = renderHook(() => useGoShortcuts([{ key: 'f', href: '/finans', label: 'Finance' }], { navigate }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    expect(result.current.pending).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.pending).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('GoShortcutHint renders only while pending', () => {
    const { rerender } = render(<Providers><GoShortcutHint visible={false} /></Providers>);
    expect(screen.queryByTestId('go-shortcut-hint')).toBeNull();
    rerender(<Providers><GoShortcutHint visible /></Providers>);
    expect(screen.getByTestId('go-shortcut-hint').getAttribute('aria-label')).toBe('g …');
  });
});

// ── component ────────────────────────────────────────────────────────────────

describe('CommandPalette', () => {
  it('⌘K / Ctrl+K toggles the palette, even from inside an input', () => {
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    expect(screen.queryByRole('listbox')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(useShellStore.getState().paletteOpen).toBe(true);
    expect(screen.getByRole('combobox')).toBeTruthy();
    act(() => {
      screen.getByRole('combobox').dispatchEvent(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, bubbles: true }));
    });
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });

  it('`/` opens it when no SearchField claimed the key', () => {
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    });
    expect(useShellStore.getState().paletteOpen).toBe(true);
  });

  it('`/` does not open it over an open dialog', () => {
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    const modal = document.createElement('div');
    modal.className = 'MuiModal-root';
    document.body.appendChild(modal);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    });
    expect(useShellStore.getState().paletteOpen).toBe(false);
    modal.remove();
  });

  it('the dialog has an accessible name', () => {
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    openPalette();
    const name = (enMessages as unknown as { commandPalette: { title: string } }).commandPalette.title;
    expect(screen.getByRole('dialog', { name })).toBeTruthy();
  });

  it('running a page action does not use a Recent slot', () => {
    const send = vi.fn();
    render(
      <Providers>
        <FakePage actions={[{ id: 'send', label: 'Send 7 changes to Etsy', onClick: send }]} />
        <CommandPalette destinations={DEST} />
      </Providers>,
    );
    openPalette();
    fireEvent.click(screen.getByText('Send 7 changes to Etsy'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it('keeps the highlighted row when order hits arrive after the user moved', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ orders: [{ id: 'o1', orderNumber: 'ET-1', customerName: 'Sam', marketplace: 'etsy' }] }) });
    render(
      <Providers>
        <FakePage actions={[{ id: 'send', label: 'Send to Etsy', onClick: vi.fn() }]} />
        <CommandPalette destinations={DEST} />
      </Providers>,
    );
    openPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'et' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const chosen = input.getAttribute('aria-activedescendant');
    const chosenLabel = chosen ? document.getElementById(chosen)?.textContent : null;
    expect(chosenLabel).toBeTruthy();
    await waitFor(() => expect(screen.getByText('ET-1 · Sam')).toBeTruthy(), { timeout: 2000 });
    const now = input.getAttribute('aria-activedescendant');
    expect(now ? document.getElementById(now)?.textContent : null).toBe(chosenLabel);
  });

  it('lists On this page (header actions) → Actions → Go to; selecting runs and closes', () => {
    const send = vi.fn();
    render(
      <Providers>
        <FakePage actions={[{ id: 'send', label: 'Send 7 changes to Etsy', onClick: send, shortcut: 'mod+enter' }, { id: 'pull', label: 'Refresh from Etsy', onClick: vi.fn() }]} />
        <CommandPalette destinations={DEST} canCreateEtsyListing />
      </Providers>,
    );
    openPalette();
    expect(sectionTitles()).toEqual(['On this page', 'Actions', 'Go to']);
    expect(screen.getByText('Refresh orders')).toBeTruthy();
    expect(screen.getByText('New Etsy listing')).toBeTruthy();
    // Brand destination renders the mark.
    const etsyRow = screen.getByText('Etsy listings').closest('[role="option"]') as HTMLElement;
    expect(etsyRow.querySelector('[data-brand="etsy"]')).toBeTruthy();
    // First row is active; Enter runs it.
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });

  it('a disabled action shows its reason, is skipped by arrows and never runs', () => {
    const run = vi.fn();
    render(
      <Providers>
        <FakePage actions={[{ id: 'send', label: 'Send changes', onClick: run, disabled: true, disabledReason: 'Nothing to send' }]} />
        <CommandPalette destinations={DEST} />
      </Providers>,
    );
    openPalette();
    const row = screen.getByText('Send changes').closest('[role="option"]') as HTMLElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(within(row).getByText('Nothing to send')).toBeTruthy();
    fireEvent.click(row);
    expect(run).not.toHaveBeenCalled();
    const input = screen.getByRole('combobox');
    // The active row is the first enabled one, not the disabled header action.
    expect(input.getAttribute('aria-activedescendant')).not.toBe(row.id);
  });

  it('navigates a Go to row, remembers it in Recent, and shows Recent on the next open', () => {
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    openPalette();
    fireEvent.click(screen.getByText('Etsy activity'));
    expect(router.push).toHaveBeenCalledWith('/app/etsy-aktivite');
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')[0]).toMatchObject({ id: 'nav:/app/etsy-aktivite', href: '/app/etsy-aktivite' });
    openPalette();
    expect(sectionTitles()).toEqual(['Recent', 'Actions', 'Go to']);
  });

  it('searches orders from 2 characters; a hit routes to Orders with q', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ orders: [{ id: 'o1', orderNumber: '3891', customerName: 'Sarah M.', marketplace: 'etsy' }] }) });
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    openPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '38' } });
    await waitFor(() => expect(screen.getByText('3891 · Sarah M.')).toBeTruthy(), { timeout: 2000 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orders?search=38&searchType=all&page=1&limit=5');
    expect(screen.getByText('Search orders for “38”')).toBeTruthy();
    fireEvent.click(screen.getByText('3891 · Sarah M.'));
    expect(router.push).toHaveBeenCalledWith('/app/labels?q=3891');
    // Order hits are not remembered.
    expect(window.localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it('on the Orders route an order hit does a full navigation instead of router.push (until M3)', async () => {
    router.pathname = '/app/labels';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    openPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zz' } });
    await waitFor(() => expect(screen.getByText('No orders match “zz”')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByText('Search orders for “zz”'));
    expect(router.push).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('shows a search error line when the orders API fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    openPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'abc' } });
    expect(screen.getByText('Searching…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Couldn't search orders")).toBeTruthy(), { timeout: 2000 });
    const calls = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ orders: [{ id: 'o9', orderNumber: 'abc1', customerName: 'Ann', marketplace: 'etsy' }] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('abc1 · Ann')).toBeTruthy(), { timeout: 2000 });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it('Refresh orders stays listed but disabled, with the reason, while it runs', async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      url === '/api/orders/sync' ? new Promise((r) => { resolve = r; }) : Promise.resolve({ ok: true, json: async () => ({ orders: [] }) }),
    );
    render(<Providers><CommandPalette destinations={DEST} /></Providers>);
    openPalette();
    fireEvent.click(screen.getByText('Refresh orders'));
    openPalette();
    await waitFor(() => {
      const row = screen.getByText('Refresh orders').closest('[role="option"]') as HTMLElement;
      expect(row.getAttribute('aria-disabled')).toBe('true');
      expect(within(row).getByText('Refreshing orders…')).toBeTruthy();
    });
    // The sync module is imported lazily: wait for the request before settling it.
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/orders/sync')).toBe(true));
    await act(async () => {
      resolve({ ok: true, json: async () => ({}) });
    });
    await waitFor(() => {
      const row = screen.getByText('Refresh orders').closest('[role="option"]') as HTMLElement;
      expect(row.getAttribute('aria-disabled')).toBeNull();
    });
  });

  it('useCommand registrations appear under Actions', () => {
    function Overview() {
      useCommand({ id: 'overview.export', label: 'Export summary', group: 'actions', icon: icons.download, run: () => {} });
      return null;
    }
    render(<Providers><Overview /><CommandPalette destinations={[]} /></Providers>);
    openPalette();
    expect(sectionTitles()).toEqual(['Actions']);
    expect(screen.getByText('Export summary')).toBeTruthy();
  });

  it('Turkish: section titles and the mobile Cancel button are translated', () => {
    setMatchMedia(true);
    render(
      <Providers locale="tr">
        <FakePage actions={[{ id: 'x', label: 'Değişiklikleri gönder', onClick: vi.fn() }]} />
        <CommandPalette destinations={DEST} />
      </Providers>,
    );
    openPalette();
    expect(sectionTitles()).toEqual(['Bu sayfada', 'İşlemler', 'Git']);
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });

  it('controlled mode uses open / onOpenChange instead of the store', () => {
    const onOpenChange = vi.fn();
    render(<Providers><CommandPalette destinations={DEST} open onOpenChange={onOpenChange} /></Providers>);
    expect(screen.getByRole('combobox')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });
});
