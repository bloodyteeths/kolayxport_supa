// @vitest-environment jsdom
// research R2-B Keyword explorer (research.md §6, §16): first use, progressive rows (cursor polling), demand guard,
// budget banner, Tracked view (empty + rows, "Not in top 500"), mobile cards, EN/TR, "Add N tags to…" staging a
// draft with auto-track (never a marketplace write: fetch spy), the over-13 replace step, and the panel variant
// returning tags to the caller via `onApply`.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { setViewport } from '../ds/m1e-helpers';
import { R2B_EN, R2B_TR } from './r2b-messages';
import { keywordRow, keywordsData, response, trackedRow } from './r2b-fixtures';

const router = {
  pathname: '/app/research/keywords',
  asPath: '/app/research/keywords',
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
const stage = vi.fn(async () => undefined);
vi.mock('@/components/domain/listings/useStagedChanges', () => ({
  createStagingAdapter: () => ({ stage }),
}));

const toastInfo = vi.fn();
vi.mock('@/components/ds/feedback/toast', async (orig) => {
  const actual = await orig<typeof import('@/components/ds/feedback/toast')>();
  return { ...actual, useToast: () => ({ success: vi.fn(), error: vi.fn(), info: toastInfo, dismiss: vi.fn() }) };
});

import { KeywordExplorer } from '@/components/domain/research/keywords/KeywordExplorer';
import { AddTagsAction } from '@/components/domain/research/keywords/AddTagsAction';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const SERVER = {
  en: { research: { sourceName: { etsyKeywords: 'Etsy search' }, tabs: { keywords: 'Keyword explorer' } } },
  tr: { research: { sourceName: { etsyKeywords: 'Etsy araması' }, tabs: { keywords: 'Anahtar kelime gezgini' } } },
};
const MESSAGES = {
  en: deepMerge(deepMerge(en as Obj, R2B_EN as unknown as Obj), SERVER.en),
  tr: deepMerge(deepMerge(tr as Obj, R2B_TR as unknown as Obj), SERVER.tr),
};
const NOW = new Date('2026-10-15T12:00:00Z');

let keywordsHandler: (url: URL) => unknown = () => response(keywordsData());
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const u = new URL(String(input), 'http://localhost');
  const method = init?.method ?? 'GET';
  if (u.pathname === '/api/research/keywords/track') return new Response(JSON.stringify({ data: { tracked: 2, ids: [], checked: [] } }), { status: 200 });
  if (u.pathname === '/api/research/keywords' && method === 'GET') {
    const body = keywordsHandler(u) as { __status?: number };
    if (body && typeof body.__status === 'number') return new Response(JSON.stringify({ error: 'not_found' }), { status: body.__status });
    return new Response(JSON.stringify(body), { status: 200 });
  }
  if (u.pathname === '/api/listings/export') {
    return new Response('id,title,tags\n111,Handmade Wooden Case,"walnut box,gift for her"\n', { status: 200 });
  }
  if (u.pathname === '/api/listings') {
    return new Response(
      JSON.stringify({ rows: [{ id: '111', title: 'Handmade Wooden Case', thumbUrl: null, price: { amount: 49, currency: 'USD' }, editable: { price: true, qty: true }, sync: null }], store: { id: '7', name: 'Shop', currency: 'USD', lastPulledAt: null } }),
      { status: 200 },
    );
  }
  return new Response('{}', { status: 200 });
});

function wrap(node: React.ReactNode, locale: 'en' | 'tr' = 'en') {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>{node}</ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
}
const renderPage = (locale: 'en' | 'tr' = 'en') => render(wrap(<KeywordExplorer />, locale));

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  stage.mockClear();
  toastInfo.mockClear();
  keywordsHandler = () => response(keywordsData());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const keywordCalls = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/research/keywords?'));
function marketplaceWrites() {
  return fetchMock.mock.calls.filter(([u, init]) => {
    const url = String(u);
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    return (url.startsWith('/api/clawd/etsy') && method !== 'GET') || /etsy-drafts\/.*sync|ebay-drafts\/.*sync|catalog-drafts\/send/.test(url);
  });
}

describe('Keyword explorer page', () => {
  it('no query and no listing: first-use state, no request', async () => {
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId('kw-first-use')).toBeTruthy();
    expect(screen.getByText('Type a keyword or pick one of your listings')).toBeTruthy();
    expect(keywordCalls()).toEqual([]);
  });

  it('results: rows, Top-48 use, guarded demand, source note and the demand note', async () => {
    router.query = { q: 'wooden jewelry box' };
    renderPage();
    await waitFor(() => expect(screen.getByText('engraved jewelry box')).toBeTruthy());
    expect(keywordCalls()[0]).toBe('/api/research/keywords?q=wooden+jewelry+box&mkt=etsy&view=suggested');
    expect(screen.getByText('18 of 48')).toBeTruthy();
    expect(screen.getByTestId('kw-demand-none').textContent).toBe('Not enough signal');
    expect(screen.getByTestId('kw-source').textContent).toMatch(/Etsy search/);
    expect(screen.getByTestId('kw-demand-note').textContent).toMatch(/Etsy doesn't share search volume/);
    // Etsy volume column hidden until BR-1b (`volumeAvailable: false`)
    expect(screen.queryByText('Etsy volume')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bavg\b/i);
  });

  it('progressive: polls with cursor=next and replaces the rows; shows "Checking N of M"', async () => {
    router.query = { q: 'wooden jewelry box' };
    let calls = 0;
    keywordsHandler = (u) => {
      calls += 1;
      if (!u.searchParams.get('cursor')) {
        return response(keywordsData({ rows: [keywordRow({ keyword: 'engraved jewelry box' })], next: 'c1', progress: { done: 4, total: 40 } }));
      }
      return response(keywordsData({ rows: [keywordRow({ keyword: 'engraved jewelry box' }), keywordRow({ keyword: 'walnut keepsake box' })] }));
    };
    renderPage();
    await waitFor(() => expect(screen.getByText('engraved jewelry box')).toBeTruthy());
    expect(screen.getByTestId('kw-source').textContent).toMatch(/Checking 4 of 40 keywords…/);
    await waitFor(() => expect(screen.getByText('walnut keepsake box')).toBeTruthy(), { timeout: 3000 });
    expect(keywordCalls().some((u) => u.includes('cursor=c1'))).toBe(true);
    expect(calls).toBe(2);
  });

  it('budget breaker: info banner, rows still shown', async () => {
    router.query = { q: 'x' };
    keywordsHandler = () => response(keywordsData(), { errors: [{ section: 'all', key: 'research.error.budget' }] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('kw-budget')).toBeTruthy());
    expect(screen.getByText('engraved jewelry box')).toBeTruthy();
  });

  it('Tracked view: empty state, then rows with "Not in top 500" (never 0)', async () => {
    router.query = { view: 'tracked' };
    keywordsHandler = () => response(keywordsData({ view: 'tracked', rows: [], tracked: [] }));
    const view = renderPage();
    await waitFor(() => expect(screen.getByTestId('kw-tracked-empty')).toBeTruthy());
    expect(screen.getByText("Track a keyword to see your listing's position every day")).toBeTruthy();
    view.unmount();
    __resetUrlStateForTests();
    keywordsHandler = () => response(keywordsData({ view: 'tracked', rows: [], tracked: [trackedRow()] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('walnut box')).toBeTruthy());
    expect(screen.getAllByText('Not in top 500').length).toBeGreaterThan(0);
    expect(screen.getByText('Position in Etsy API search (not personalized, ads excluded)')).toBeTruthy();
  });

  it('Turkish UI: Turkish chrome, English keywords', async () => {
    router.query = { q: 'wooden jewelry box' };
    renderPage('tr');
    await waitFor(() => expect(screen.getByText('engraved jewelry box')).toBeTruthy());
    expect(screen.getByText("48'de 18")).toBeTruthy();
    expect(screen.getAllByText('Önerilen').length).toBeGreaterThan(0);
  });

  it('mobile 390: cards with the keyword as title, no table', async () => {
    setViewport('mobile');
    router.query = { q: 'wooden jewelry box' };
    renderPage();
    await waitFor(() => expect(screen.getByText('engraved jewelry box')).toBeTruthy());
    expect(screen.getByText('Used by 18 of top 48 · $38.00–$72.00')).toBeTruthy();
  });

  it('Add 2 tags to… → picker → stages a draft (merged with live tags) + auto-track; nothing sent', async () => {
    router.query = { q: 'wooden jewelry box', sel: 'engraved jewelry box|keepsake gift' };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('kw-bulk-bar')).toBeTruthy());
    fireEvent.click(within(screen.getByTestId('kw-bulk-bar')).getByRole('button', { name: 'Add 2 tags to…' }));
    const modal = await screen.findByTestId('kw-action-modal');
    const input = within(modal).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'walnut' } });
    const option = await screen.findByRole('option', { name: /Handmade Wooden Case/ }, { timeout: 3000 });
    fireEvent.click(option);
    fireEvent.click(within(screen.getByTestId('kw-action-modal')).getByRole('button', { name: 'Add 2 tags' }));
    await waitFor(() => expect(stage).toHaveBeenCalledTimes(1));
    expect(stage).toHaveBeenCalledWith('111', { tags: ['walnut box', 'gift for her', 'engraved jewelry box', 'keepsake gift'] });
    const trackCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/research/keywords/track');
    expect(trackCall).toBeTruthy();
    expect(JSON.parse(String((trackCall![1] as RequestInit).body))).toMatchObject({ listingId: '111', shopId: '7', checkNow: false });
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('2 tags added to "Handmade Wooden Case" · tracked · Not sent yet', expect.anything()));
    expect(toastInfo.mock.calls[0][0].length).toBeLessThanOrEqual(80);
    // the bulk selection is cleared once the tags are staged
    await waitFor(() => expect(router.query.sel).toBeUndefined());
    expect(marketplaceWrites()).toEqual([]);
  });

  it('a ?listing the server cannot find shows "listing not found", not "connect Etsy" (Used in my shop)', async () => {
    keywordsHandler = () => ({ __status: 404 });
    router.query = { listing: '999', view: 'mine' };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('kw-listing-missing')).toBeTruthy());
    expect(screen.queryByTestId('kw-connect')).toBeNull();
  });

  it('budget with nothing cached: says the limit is reached, never "showing cached results"', async () => {
    keywordsHandler = () => response(null, { errors: [{ section: 'all', key: 'research.error.budget' }] });
    router.query = { q: 'wooden jewelry box' };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('kw-notice')).toBeTruthy());
    expect(screen.getByText("Etsy's daily limit is reached. Try again later.")).toBeTruthy();
    expect(screen.queryByText(/Showing cached results/)).toBeNull();
  });

  it('stale pool (research.error.stale) shows the stale note above the rows', async () => {
    keywordsHandler = () => response(keywordsData(), { errors: [{ section: 'all', key: 'research.error.stale' }] });
    router.query = { q: 'wooden jewelry box' };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('kw-stale-pool')).toBeTruthy());
  });
});

describe('Keyword explorer panel variant', () => {
  it('Suggested + Used in my shop only; onApply returns the chosen tags (no staging)', async () => {
    keywordsHandler = (u) =>
      response(
        keywordsData({
          current: { listingId: '111', shopId: '7', title: 'Engraved Walnut Box', thumbUrl: null, tags: ['walnut box'], issues: { count: 11, max: 13, overlap: 2, overlapTags: [], long: 1, longTags: [] } },
          rows: [keywordRow({ keyword: 'engraved jewelry box' }), keywordRow({ keyword: 'walnut box', extra: { inCurrent: true } })],
          view: u.searchParams.get('view') === 'mine' ? 'mine' : 'suggested',
        }),
      );
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(wrap(<KeywordExplorer variant="panel" listing={{ id: '111', shopId: '7', title: 'Engraved Walnut Box' }} open onClose={onClose} onApply={onApply} />));
    await waitFor(() => expect(screen.getByText('engraved jewelry box')).toBeTruthy());
    // already-used tags are not offered again
    expect(screen.queryByText('walnut box')).toBeNull();
    expect(screen.getByTestId('kw-current').textContent).toBe('Current tags 11 / 13 · 2 repeat title words · 1 over 20 characters');
    expect(keywordCalls()[0]).toBe('/api/research/keywords?listing=111&shop=7&mkt=etsy&view=suggested');
    const views = screen.getByTestId('kw-panel-views');
    expect(within(views).getAllByRole('radio').map((b) => b.textContent)).toEqual(['Suggested', 'Used in my shop']);
    const table = screen.getByTestId('kw-panel-table');
    fireEvent.click(within(table).getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 tag to this listing' }));
    expect(onApply).toHaveBeenCalledWith(['engraved jewelry box']);
    expect(onClose).toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    expect(marketplaceWrites()).toEqual([]);
  });
});

describe('Keyword action modal (AddTagsAction)', () => {
  it('a parent re-render with a new preselected object keeps the listing the user picked', async () => {
    const props = { open: true, onClose: vi.fn(), mode: 'tags' as const, mkt: 'etsy' as const, keywords: ['keepsake gift'] };
    const { rerender } = render(wrap(<AddTagsAction {...props} preselected={{ id: '222', shopId: '7', title: 'Other Listing' }} />));
    const modal = await screen.findByTestId('kw-action-modal');
    const input = within(modal).getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('Other Listing');
    fireEvent.change(input, { target: { value: 'walnut' } });
    fireEvent.click(await screen.findByRole('option', { name: /Handmade Wooden Case/ }, { timeout: 3000 }));
    await waitFor(() => expect(input.value).toBe('Handmade Wooden Case'));
    // e.g. a progressive poll: same listing id, fresh object
    rerender(wrap(<AddTagsAction {...props} preselected={{ id: '222', shopId: '7', title: 'Other Listing' }} />));
    expect((within(screen.getByTestId('kw-action-modal')).getByRole('combobox') as HTMLInputElement).value).toBe('Handmade Wooden Case');
  });

  it('a listing missing from the export/listings is never staged from empty tags', async () => {
    render(wrap(<AddTagsAction open onClose={vi.fn()} mode="tags" mkt="etsy" keywords={['keepsake gift']} preselected={{ id: '222', shopId: '7', title: '222' }} />));
    const modal = await screen.findByTestId('kw-action-modal');
    fireEvent.click(within(modal).getByRole('button', { name: 'Add 1 tag to this listing' }));
    await waitFor(() => expect(screen.getByTestId('kw-action-error').textContent).toBe("Couldn't find this listing in your shop"));
    expect(stage).not.toHaveBeenCalled();
  });
});
