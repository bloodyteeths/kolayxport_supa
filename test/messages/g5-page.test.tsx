// @vitest-environment jsdom
// messages G5 MessagesPage: desktop auto-open of the newest needs-reply row, j/k, no-store empty state,
// done-empty, platform banner + healthy rows; G6/G3 components stubbed by their published props.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import type { UnifiedConversation } from '@/types/messages';
import { setViewport } from '../ds/m1e-helpers';
import { G5_EN } from './g5-messages';

const router = {
  pathname: '/app/mesajlar',
  asPath: '/app/mesajlar',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (url: { query: Record<string, string | string[]> }) => {
    router.query = url.query;
    return true;
  }),
  push: vi.fn(async () => true),
  events: { on: vi.fn(), off: vi.fn() },
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const connected = { wix: true as boolean | undefined, trendyol: true as boolean | undefined };
vi.mock('@/lib/hooks/useConnections', () => ({ useConnections: () => ({ has: (p: 'wix' | 'trendyol') => connected[p] }) }));

const paneProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock('@/components/domain/messages/ThreadPane', () => ({
  ThreadPane: (p: Record<string, unknown>) => {
    paneProps.current = p;
    return <div data-testid="stub-thread">{(p.conversation as UnifiedConversation).id}</div>;
  },
  ThreadSheet: (p: Record<string, unknown>) => <div data-testid="stub-sheet">{(p.conversation as UnifiedConversation).id}</div>,
}));
vi.mock('@/components/domain/messages/ContextRail', () => ({ ContextRail: () => <div data-testid="stub-rail" /> }));
vi.mock('@/components/domain/messages/SavedRepliesPanel', () => ({ SavedRepliesPanel: (p: { open: boolean }) => (p.open ? <div data-testid="stub-saved" /> : null) }));

import { MessagesPage } from '@/components/domain/messages/MessagesPage';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  return out;
}
const MESSAGES = deepMerge(en as Obj, G5_EN as Obj);
const NOW = new Date('2026-10-15T12:00:00.000Z');

function conv(p: Partial<UnifiedConversation> & { id: string }): UnifiedConversation {
  return {
    platform: 'wix', status: 'unanswered', needsReply: true, unread: true, customerName: 'Ayşe', subject: '', lastMessageText: 'Hi',
    lastMessageAt: '2026-10-15T10:00:00.000Z', lastMessageDate: '', lastFromCustomer: true, unreadCount: 1, messages: [], ...p,
  };
}

let listBody: Record<string, unknown> = {};
beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  router.replace.mockClear();
  paneProps.current = null;
  connected.wix = true;
  connected.trendyol = true;
  listBody = { conversations: [], enabledPlatforms: ['wix', 'trendyol'], platformErrors: [], nextCursor: null, fetchedAt: NOW.toISOString() };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('action=counts') ? { wix: 1, trendyol: 1, total: 2 } : listBody;
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <MessagesPage now={NOW} pollMs={0} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe('MessagesPage', () => {
  it('auto-opens the newest needs-reply conversation on desktop and wires the thread', async () => {
    listBody.conversations = [
      conv({ id: 'answered', needsReply: false, unread: false, lastMessageAt: '2026-10-15T11:00:00.000Z' }),
      conv({ id: 'newest', platform: 'trendyol', lastMessageAt: '2026-10-15T10:30:00.000Z' }),
      conv({ id: 'older' }),
    ];
    renderPage();
    await waitFor(() => expect(router.query.open).toBe('trendyol:newest'));
    expect(await screen.findByTestId('stub-thread')).toBeTruthy();
    expect(typeof paneProps.current?.onSent).toBe('function');
    expect(typeof paneProps.current?.onNext).toBe('function');
    expect((paneProps.current?.nextUp as { name: string }).name).toBe('Ayşe');
    // j moves to the next row
    act(() => {
      fireEvent.keyDown(document, { key: 'j' });
    });
    await waitFor(() => expect(router.query.open).toBe('wix:older'));
  });

  it('no store connected → first-use empty state replaces the body', async () => {
    connected.wix = false;
    connected.trendyol = false;
    listBody.enabledPlatforms = [];
    renderPage();
    expect(await screen.findByTestId('messages-no-store')).toBeTruthy();
    expect(screen.getByText('Connect a store').closest('a')?.getAttribute('href')).toBe('/ayarlar?tab=connections');
  });

  it('needs-reply view with no rows and no failures → done state', async () => {
    renderPage();
    expect(await screen.findByText('Every message has a reply')).toBeTruthy();
    expect(screen.queryByTestId('platform-banners')).toBeNull();
  });

  it('one platform failed, healthy one empty → banner and no "done" claim', async () => {
    listBody.platformErrors = [{ platform: 'wix', code: 'permission', detail: '' }];
    renderPage();
    expect(await screen.findByText('No messages yet')).toBeTruthy();
    expect(screen.queryByText('Every message has a reply')).toBeNull();
    expect(screen.getByText('Wix inbox access is missing. Reconnect Wix to allow messages.')).toBeTruthy();
    expect(screen.queryByTestId('stub-thread')).toBeNull();
  });

  it('every platform failed with nothing cached → page ErrorState with the cause from the codes', async () => {
    connected.trendyol = false;
    listBody.enabledPlatforms = ['wix'];
    listBody.platformErrors = [{ platform: 'wix', code: 'auth', detail: '' }];
    renderPage();
    expect(await screen.findByText("Couldn't load messages")).toBeTruthy();
    expect(screen.queryByText('Every message has a reply')).toBeNull();
    expect(screen.getAllByText('Wix connection expired.').length).toBeGreaterThan(0);
  });

  it('a stale ?open= that is not listed is dropped, not replaced by another conversation', async () => {
    router.query = { open: 'wix:gone' };
    listBody.conversations = [conv({ id: 'other' })];
    renderPage();
    await waitFor(() => expect(router.query.open).toBeUndefined());
    expect(screen.queryByTestId('stub-thread')).toBeNull();
  });

  it('a listed ?open= is restored on reload', async () => {
    router.query = { open: 'wix:older' };
    listBody.conversations = [conv({ id: 'newest', lastMessageAt: '2026-10-15T11:00:00.000Z' }), conv({ id: 'older' })];
    renderPage();
    expect((await screen.findByTestId('stub-thread')).textContent).toBe('older');
    expect(router.query.open).toBe('wix:older');
  });
});
