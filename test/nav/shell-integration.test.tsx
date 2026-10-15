// @vitest-environment jsdom
// M2 group F (shell-nav §12): the switch-over wiring.
//   - which routes get the persistent AppShell (lib/nav/shellRoutes.ts);
//   - the AppLayout compat shim hands only its (suffix-stripped) title to ShellContext;
//   - <Page> registers itself with ShellContext inside the shell (meta, header actions, shellManaged) and
//     stays standalone outside it; Page meta wins over the shim title;
//   - lib/http/limitInterceptor.ts: the C6 opt-out (hook, header, route list) and the `featureLocked` 402
//     that never opens the global LimitReachedDialog.
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { isShellRoute } from '@/lib/nav/shellRoutes';
import { ShellProvider, usePageMeta, type ShellPageMeta } from '@/lib/nav/ShellContext';
import AppLayout from '@/components/AppLayout';
import { Page } from '@/components/ds/page/Page';
import { PageHeader } from '@/components/ds/page/PageHeader';
import { usePageContext } from '@/components/ds/page/PageContext';
import {
  LIMIT_UI_HEADER,
  installLimitInterceptor,
  limitDialogSkipped,
  optOutOfLimitDialog,
  parseFeatureLocked,
  useFeatureLockStore,
  useLimitDialogOptOut,
  useLimitReachedStore,
} from '@/lib/http/limitInterceptor';

vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

afterEach(cleanup);

function Intl({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en as never} timeZone="Europe/Istanbul" onError={() => {}}>
      {children}
    </NextIntlClientProvider>
  );
}

/** Renders `ui` inside the shell context and reports the merged meta after every commit. */
function renderInShell(ui: React.ReactElement) {
  const seen: { meta: ShellPageMeta | null } = { meta: null };
  function Probe() {
    seen.meta = usePageMeta();
    return null;
  }
  const utils = render(
    <Intl>
      <ShellProvider documentTitle={false}>
        {ui}
        <Probe />
      </ShellProvider>
    </Intl>,
  );
  return { ...utils, seen };
}

describe('isShellRoute', () => {
  it.each([
    ['/app/analytics', true],
    ['/app/labels', true],
    ['/app/etsy-listings/[id]', true],
    ['/app', true],
    ['/ayarlar', true],
    ['/faturalar', true],
    ['/app/print/pick-list', false],
    ['/app/print', false],
    ['/', false],
    ['/login', false],
    ['/fiyatlandirma', false],
    ['/404', false],
    ['/application', false],
    ['/ayarlar-eski', false],
  ])('%s → %s', (path, expected) => {
    expect(isShellRoute(path)).toBe(expected);
  });

  it('ignores query, hash and a trailing slash', () => {
    expect(isShellRoute('/ayarlar/?tab=billing')).toBe(true);
    expect(isShellRoute('/app/print/packing-slips#x')).toBe(false);
    expect(isShellRoute(null)).toBe(false);
  });
});

describe('AppLayout shim', () => {
  it('registers the stripped title with the shell and renders children only', () => {
    const { seen, getByText, container } = renderInShell(
      <AppLayout title="Etsy Listings - KolayXport">
        <p>body</p>
      </AppLayout>,
    );
    expect(getByText('body')).toBeTruthy();
    expect(container.querySelector('aside, nav, header')).toBeNull();
    expect(seen.meta).toMatchObject({ title: 'Etsy Listings', source: 'title' });
  });

  it('registers nothing for the legacy default title', () => {
    const { seen } = renderInShell(
      <AppLayout title="KolayXport Dashboard">
        <p>x</p>
      </AppLayout>,
    );
    expect(seen.meta).toBeNull();
  });

  it('renders outside the shell without crashing', () => {
    const { getByText } = render(
      <Intl>
        <AppLayout title="Settings">
          <p>alone</p>
        </AppLayout>
      </Intl>,
    );
    expect(getByText('alone')).toBeTruthy();
  });
});

describe('<Page> ↔ ShellContext (shell-nav §6.1)', () => {
  function ManagedProbe({ out }: { out: { managed?: boolean } }) {
    out.managed = usePageContext()?.shellManaged;
    return null;
  }

  it('inside the shell: emits its meta (title, width, header actions) and is shellManaged', async () => {
    const out: { managed?: boolean } = {};
    const onRefresh = vi.fn();
    const { seen } = renderInShell(
      <Page title="Finance" width="detail" backHref="/ayarlar">
        <PageHeader
          title="Finance"
          secondaryActions={[{ id: 'refresh', label: 'Refresh', onClick: onRefresh }]}
          overflowActions={[{ id: 'csv', label: 'Download CSV', onClick: () => {} }]}
        />
        <ManagedProbe out={out} />
      </Page>,
    );
    await waitFor(() => expect(seen.meta?.source).toBe('page'));
    expect(seen.meta).toMatchObject({ title: 'Finance', width: 'detail', backHref: '/ayarlar' });
    expect(seen.meta?.headerActions.map((a) => a.id)).toEqual(['refresh', 'csv']);
    expect(seen.meta?.mobileOverflow.map((a) => a.id)).toEqual(['refresh', 'csv']);
    expect(out.managed).toBe(true);
    // The palette / mobile ⋯ call the page's live handler.
    seen.meta?.headerActions[0].onClick?.();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('Page meta wins over an AppLayout shim title around it', async () => {
    const { seen } = renderInShell(
      <AppLayout title="Old title - KolayXport">
        <Page title="Orders" width="list">
          <p>x</p>
        </Page>
      </AppLayout>,
    );
    await waitFor(() => expect(seen.meta?.source).toBe('page'));
    expect(seen.meta?.title).toBe('Orders');
  });

  it('clears its meta when the page unmounts', async () => {
    function Host({ show }: { show: boolean }) {
      return show ? (
        <Page title="Settings" width="form">
          <p>x</p>
        </Page>
      ) : null;
    }
    const seen: { meta: ShellPageMeta | null } = { meta: null };
    function Probe() {
      seen.meta = usePageMeta();
      return null;
    }
    const tree = (show: boolean) => (
      <Intl>
        <ShellProvider documentTitle={false}>
          <Host show={show} />
          <Probe />
        </ShellProvider>
      </Intl>
    );
    const { rerender } = render(tree(true));
    await waitFor(() => expect(seen.meta?.title).toBe('Settings'));
    rerender(tree(false));
    await waitFor(() => expect(seen.meta).toBeNull());
  });

  it('outside the shell: not shellManaged, still renders', () => {
    const out: { managed?: boolean } = {};
    const { getByTestId } = render(
      <Intl>
        <Page title="Alone" width="form">
          <ManagedProbe out={out} />
        </Page>
      </Intl>,
    );
    expect(getByTestId('ds-page')).toBeTruthy();
    expect(out.managed).toBe(false);
  });

  it('an explicit shellManaged={false} still wins inside the shell', () => {
    const out: { managed?: boolean } = {};
    renderInShell(
      <Page title="X" width="form" shellManaged={false}>
        <ManagedProbe out={out} />
      </Page>,
    );
    expect(out.managed).toBe(false);
  });
});

describe('limitInterceptor (CRITIQUE C6, pro-gating §3.5)', () => {
  const limiterBody = { error: 'Payment Required', details: 'label limit reached for your plan.' };
  const lockedBody = { error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature: 'financials', neutral: false };
  let nextBody: unknown = limiterBody;

  beforeAll(() => {
    window.fetch = vi.fn(async () => new Response(JSON.stringify(nextBody), { status: 402, headers: { 'content-type': 'application/json' } })) as typeof window.fetch;
    installLimitInterceptor();
  });

  beforeEach(() => {
    useLimitReachedStore.setState({ current: null, snoozedUntil: {}, lastShownAt: 0 });
    useFeatureLockStore.getState().clear();
    nextBody = limiterBody;
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('parseFeatureLocked recognises only the entitlement 402', () => {
    expect(parseFeatureLocked(lockedBody, '/api/finance/dashboard')).toMatchObject({ feature: 'financials', neutral: false, url: '/api/finance/dashboard' });
    expect(parseFeatureLocked(limiterBody)).toBeNull();
    expect(parseFeatureLocked(null)).toBeNull();
    expect(parseFeatureLocked({ limitType: 'feature' })?.feature).toBe('unknown');
  });

  it('limitDialogSkipped: header, imperative opt-out (counted), no route list in M2', () => {
    expect(limitDialogSkipped({ pagePath: '/app/labels' })).toBe(false);
    expect(limitDialogSkipped({ inlineHeader: true, pagePath: '/app/labels' })).toBe(true);
    const a = optOutOfLimitDialog();
    const b = optOutOfLimitDialog();
    a();
    a(); // releasing twice is a no-op
    expect(limitDialogSkipped({ pagePath: '/app/labels' })).toBe(true);
    b();
    expect(limitDialogSkipped({ pagePath: '/app/labels' })).toBe(false);
  });

  it('a plain limiter 402 still opens the global dialog', async () => {
    await window.fetch('/api/labels/ups');
    await settle();
    expect(useLimitReachedStore.getState().current).toMatchObject({ limitType: 'label', reason: 'planLimit' });
  });

  it(`a request with ${LIMIT_UI_HEADER}: inline is handled by the caller`, async () => {
    const res = await window.fetch('/api/labels/ups', { headers: { [LIMIT_UI_HEADER]: 'inline' } });
    await settle();
    expect(res.status).toBe(402);
    expect(useLimitReachedStore.getState().current).toBeNull();
  });

  it('useLimitDialogOptOut silences the dialog only while mounted', async () => {
    const { unmount } = renderHook(() => useLimitDialogOptOut());
    await window.fetch('/api/orders/sync');
    await settle();
    expect(useLimitReachedStore.getState().current).toBeNull();
    unmount();
    await window.fetch('/api/orders/sync');
    await settle();
    expect(useLimitReachedStore.getState().current).not.toBeNull();
  });

  it('featureLocked never opens the dialog and is recorded for the gate', async () => {
    nextBody = lockedBody;
    await act(async () => {
      await window.fetch('/api/finance/dashboard');
      await settle();
    });
    expect(useLimitReachedStore.getState().current).toBeNull();
    expect(useFeatureLockStore.getState().locked.financials).toMatchObject({ feature: 'financials', url: '/api/finance/dashboard' });
    useFeatureLockStore.getState().clear('financials');
    expect(useFeatureLockStore.getState().locked.financials).toBeUndefined();
  });
});
