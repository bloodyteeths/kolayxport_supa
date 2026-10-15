// @vitest-environment jsdom
// research R1-C Product finder (research.md §5, §16): states (first use, results, 0 results, budget, error), EN/TR,
// mobile sticky primary, the TR translate offer, and "Draft a listing" writing a prefill without any marketplace
// write (fetch spy: no POST to /api/clawd/etsy, no etsy-drafts sync).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { LISTING_PREFILL_KEY } from '@/lib/listings/listingPrefill';
import { setViewport } from '../ds/m1e-helpers';
import { R1C_EN, R1C_TR } from './r1c-messages';
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
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ has: (p: string) => p === 'etsy', connections: {}, isLoading: false }),
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
// R1-A's server keys used by the fixture facts.
const SERVER_EN = { research: { evidence: { priceBand: 'Most sell between {p25} and {p75} (median {median})', competing: '{count} competing listings' }, source: { etsySearchName: 'Etsy search' } } };
const SERVER_TR = { research: { evidence: { priceBand: 'Çoğu {p25} ile {p75} arasında satılıyor (medyan {median})', competing: '{count} rakip ilan' }, source: { etsySearchName: 'Etsy araması' } } };
const MESSAGES = {
  en: deepMerge(deepMerge(en as Obj, R1C_EN as unknown as Obj), SERVER_EN),
  tr: deepMerge(deepMerge(tr as Obj, R1C_TR as unknown as Obj), SERVER_TR),
};
const NOW = new Date('2026-10-15T12:00:00Z');

let productsBody: unknown = productsResponse();
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  void init;
  if (u.startsWith('/api/research/products')) return new Response(JSON.stringify(productsBody), { status: 200 });
  if (u.startsWith('/api/listings')) return new Response(JSON.stringify({ rows: [], store: { id: 's1', name: 'Shop', currency: 'USD', lastPulledAt: null } }), { status: 200 });
  return new Response('{}', { status: 200 });
});

function renderPage(locale: 'en' | 'tr' = 'en') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ProductFinder />
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
  productsBody = productsResponse();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function marketplaceWrites() {
  return fetchMock.mock.calls.filter(([u, init]) => {
    const url = String(u);
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    return (url.startsWith('/api/clawd/etsy') && method !== 'GET') || /etsy-drafts\/.*sync|ebay-drafts\/.*sync/.test(url);
  });
}

describe('Product finder states', () => {
  it('no query: first-use empty state with the question chips, no request', async () => {
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('research-products-empty')).toBeTruthy();
    expect(screen.getByText('Search an idea to see prices, competition and buyer words')).toBeTruthy();
    expect(screen.getByTestId('research-q-niche')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/research/products'))).toBe(false);
  });

  it('results: evidence, four cards, buyer words, top listings, source notes; robust median, no "avg"', async () => {
    router.query = { q: 'halloween decor' };
    const view = renderPage();
    await waitFor(() => expect(screen.getByTestId('research-cards')).toBeTruthy());
    expect(screen.getByText('Most sell between $24.00 and $58.00 (median $38.00)')).toBeTruthy();
    expect(screen.getByTestId('research-card-price').textContent).toContain('$38.00');
    expect(screen.getByTestId('research-products-source').textContent).toMatch(/287 of 300 listings used · 13 excluded/);
    expect(screen.getByText('Spooky & Cute Halloween Sign')).toBeTruthy();
    expect(screen.getByText('1,204 (all time)')).toBeTruthy();
    expect(view.container.textContent ?? '').not.toMatch(/\bavg\b|average/i);
    expect(screen.getByTestId('research-add-tags').textContent).toBe('Add 5 tags to…');
  });

  it('budget breaker: cached results stay with the info banner', async () => {
    router.query = { q: 'halloween decor' };
    productsBody = productsResponse({}, { errors: [{ section: 'all', key: 'research.error.budget' }] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-budget')).toBeTruthy());
    expect(screen.getByText("Showing cached results: Etsy's daily limit is close")).toBeTruthy();
    expect(screen.getByTestId('research-cards')).toBeTruthy();
  });

  it('0 results: no-results state with "Try a broader phrase" removing the last word', async () => {
    router.query = { q: 'tiny glass gnome' };
    productsBody = productsResponse({ top: [], price: { ...productsResponse().data!.price, sampled: 0, n: 0, quality: 'insufficient' } });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-products-noresults')).toBeTruthy());
    expect(screen.getByText('No Etsy listings match "tiny glass gnome"')).toBeTruthy();
    fireEvent.click(screen.getByText('Try a broader phrase'));
    await act(async () => {});
    const last = router.replace.mock.calls.at(-1)?.[0] as { query: Record<string, string> };
    expect(last.query.q).toBe('tiny glass');
  });

  it('whole-tool failure (data null) renders an inline error with the cause, not an empty page', async () => {
    router.query = { q: 'x', mkt: 'ebay' };
    productsBody = { data: null, source: productsResponse().source, errors: [{ section: 'all', key: 'research.error.ebay' }] };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-products-error')).toBeTruthy());
    expect(screen.getByText("Couldn't reach eBay")).toBeTruthy();
  });

  it('Turkish input offers the translate action (1 credit)', async () => {
    router.query = { q: 'ahşap anı kutusu' };
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('research-translate').textContent).toBe('Translate to English keywords · 1 credit');
  });

  it('TR locale renders Turkish labels', async () => {
    router.query = { q: 'halloween decor' };
    renderPage('tr');
    await waitFor(() => expect(screen.getByTestId('research-cards')).toBeTruthy());
    expect(screen.getAllByText('Ürün bulucu').length).toBeGreaterThan(0);
    expect(screen.getByText('Talep sinyali')).toBeTruthy();
  });
});

describe('Draft a listing (primary) writes a prefill, never a marketplace', () => {
  it('desktop header primary → sessionStorage prefill + creator route (the new editor)', async () => {
    router.query = { q: 'halloween decor' };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-cards')).toBeTruthy());
    fireEvent.click(screen.getByText('Draft a listing'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/app/etsy-listings/new?prefill=session'));
    const prefill = JSON.parse(window.sessionStorage.getItem(LISTING_PREFILL_KEY) ?? '{}');
    expect(prefill).toMatchObject({ v: 1, target: 'etsy', source: 'etsy-research', price: 38, currency: 'USD', tags: ['halloween decor', 'spooky decor', 'fall decor'] });
    expect(prefill.title).toBeUndefined();
    expect(marketplaceWrites()).toEqual([]);
  });

  it('mobile: the primary is a sticky action bar once results exist', async () => {
    setViewport('mobile');
    router.query = { q: 'halloween decor' };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-cards')).toBeTruthy());
    expect(screen.getAllByText('Draft a listing').length).toBeGreaterThan(0);
    expect(marketplaceWrites()).toEqual([]);
  });
});

describe('compare mode', () => {
  it('?compare=a|b renders one table with a column per query (one request, q repeated)', async () => {
    router.query = { compare: 'halloween decor|fall decor' };
    const second = { ...productsResponse().data!, query: 'fall decor' };
    productsBody = { ...productsResponse(), data: { ...productsResponse().data!, compare: [productsResponse().data!, second] } };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-compare')).toBeTruthy());
    const calls = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/research/products'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('q=halloween+decor&q=fall+decor');
    expect(screen.getAllByText('Median price').length).toBeGreaterThan(0);
  });
});

describe('review fixes', () => {
  it('Trendyol (not served yet) is an info state, never an error page', async () => {
    router.query = { q: 'kolye', mkt: 'trendyol' };
    productsBody = { data: null, errors: [{ section: 'marketplace', key: 'research.products.trendyolLater' }] };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-products-notice')).toBeTruthy());
    expect(screen.queryByTestId('research-products-error')).toBeNull();
  });

  it('budget with nothing cached: one info state, no error, no duplicate banner', async () => {
    router.query = { q: 'halloween decor' };
    productsBody = { data: null, errors: [{ section: 'all', key: 'research.error.budget' }] };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-products-notice')).toBeTruthy());
    expect(screen.queryByTestId('research-products-error')).toBeNull();
    expect(screen.queryByTestId('research-budget')).toBeNull();
  });

  it('compare: a budget-dropped query keeps its own column (no shift) and says why', async () => {
    router.query = { compare: 'halloween decor|xmas decor|fall decor' };
    const third = { ...productsResponse().data!, query: 'fall decor', price: { ...productsResponse().data!.price, median: 77 } };
    productsBody = {
      ...productsResponse(),
      data: { ...productsResponse().data!, compare: [productsResponse().data!, third] },
      errors: [{ section: 'compare', key: 'research.error.budget' }],
    };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('research-compare')).toBeTruthy());
    expect(screen.getByTestId('research-compare-budget')).toBeTruthy();
    expect(screen.getByText("Not loaded: Etsy's daily limit is close")).toBeTruthy();
  });

  it('a pasted listing link without a readable title explains itself', async () => {
    router.query = { compareListing: '123456' };
    renderPage();
    await act(async () => {});
    expect(screen.getByText("Couldn't read a title from this link: type what it sells")).toBeTruthy();
  });
});
