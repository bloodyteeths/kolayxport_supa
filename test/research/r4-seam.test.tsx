// @vitest-environment jsdom
// R3/R4 integrator seams: Product finder mounts the Price gap source segment and body (`?source=trendyol`, research.md
// §9) behind the arbitrage FeatureGate, and runs no Etsy search while the Price gap is shown; shopify_free sees no
// segment and a neutral locked state by URL.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import en from '@/messages/en.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { useFeatureLockStore } from '@/lib/http/limitInterceptor';
import { F } from '../billing/d-fixtures';
import { R1C_EN } from './r1c-messages';
import { R4_EN } from './r4-messages';
import { productsResponse } from './r1c-fixtures';

const router = {
  pathname: '/app/research/products',
  asPath: '/app/research/products',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (url: { query: Record<string, string | string[]> }) => {
    router.query = url.query;
    return true;
  }),
  push: vi.fn(async () => true),
  events: { on: () => undefined, off: () => undefined },
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ has: (p: string) => p === 'etsy' || p === 'trendyol', connections: {}, isLoading: false }),
}));

import { ProductFinder } from '@/components/domain/research/products/ProductFinder';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = deepMerge(deepMerge(en as Obj, R1C_EN as unknown as Obj), R4_EN as unknown as Obj);

let entitlement: unknown = F.pro();
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  void init;
  const u = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (u.startsWith('/api/billing/entitlement')) return new Response(JSON.stringify(entitlement), { status: 200 });
  if (u.startsWith('/api/research/products')) return new Response(JSON.stringify(productsResponse()), { status: 200 });
  return new Response('{}', { status: 404 });
});
const callsTo = (prefix: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(prefix));

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <NextIntlClientProvider locale="en" messages={MESSAGES as never} timeZone="Europe/Istanbul" onError={() => {}}>
        <FormatProvider timeZone="Europe/Istanbul">
          <ThemeProvider theme={theme}>
            <ProductFinder />
          </ThemeProvider>
        </FormatProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  useFeatureLockStore.getState().clear();
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  entitlement = F.pro();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Product finder × Price gap seam', () => {
  it('Trendyol is a marketplace chip next to the search; picking it sets ?source=trendyol (no separate segment)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-mkt-trendyol')).toBeTruthy());
    expect(screen.queryByTestId('price-gap-source')).toBeNull();
    expect(screen.getByTestId('research-products-search')).toBeTruthy();
    fireEvent.click(screen.getByTestId('research-mkt-trendyol'));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const last = router.replace.mock.calls.at(-1)?.[0] as { query: Record<string, string> };
    expect(last.query.source).toBe('trendyol');
  });

  it('source=trendyol: Price gap body, no search box, no Etsy search even with ?q=', async () => {
    router.query = { source: 'trendyol', q: 'halloween decor' };
    renderPage();
    await waitFor(() => expect(callsTo('/api/research/price-gap').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('research-products-search')).toBeNull();
    expect(callsTo('/api/research/products')).toHaveLength(0);
  });

  it('Growth by URL: locked state in the region, no price-gap request', async () => {
    entitlement = F.growth();
    router.query = { source: 'trendyol' };
    renderPage();
    expect(await screen.findByTestId('feature-locked-arbitrage')).toBeTruthy();
    expect(callsTo('/api/research/price-gap')).toHaveLength(0);
  });

  it('shopify_free: no Trendyol chip in search mode; by URL a neutral locked state with no Stripe link', async () => {
    entitlement = F.shopify();
    renderPage();
    await waitFor(() => expect(callsTo('/api/billing/entitlement').length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByTestId('price-gap-source')).toBeNull();
    // Plan-locked features are never offered to shopify_free: no Trendyol chip either.
    expect(screen.queryByTestId('research-mkt-trendyol')).toBeNull();
    cleanup();
    router.query = { source: 'trendyol' };
    renderPage();
    await screen.findByTestId('feature-locked-arbitrage');
    expect(document.body.innerHTML).not.toContain('/fiyatlandirma');
    expect(callsTo('/api/research/price-gap')).toHaveLength(0);
  });
});
