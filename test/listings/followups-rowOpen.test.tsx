// @vitest-environment jsdom
// Founder follow-ups (listings): a click anywhere on a row (title, thumbnail, cells) or Enter opens the listing —
// the editor route while the marketplace's editor flag is on, else the quick view. Checkbox, ✎ and ⋯ do not open it,
// a text selection drag does not navigate, and a failed row's cause renders from the stored key with its params.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import type { ListingsStagingAdapter, OpenDraft } from '@/components/domain/listings/useStagedChanges';
import { setViewport } from '../ds/m1e-helpers';
import { G5_EN, G5_TR } from './g5-messages';
import { toastController } from '@/components/ds/feedback/toast';

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/etsy-listings',
  asPath: '/app/etsy-listings',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (u: { query: Record<string, string | string[]> }) => {
    router.query = u.query;
    return true;
  }),
  push: vi.fn(async (u: { query?: Record<string, string | string[]> } | string) => {
    if (typeof u === 'object' && u.query) router.query = u.query;
    return true;
  }),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const conn = { connected: true as boolean | undefined, needsReauth: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: {},
    error: undefined,
    has: () => conn.connected,
    get: () => ({ connected: conn.connected, needsReauth: conn.needsReauth }),
    mutate: vi.fn(),
  }),
}));
vi.mock('@/components/etsy-history/CacheFreshnessChip', () => ({ default: () => <span data-testid="freshness-chip" /> }));
const toolProps: Record<string, { open: boolean }> = {};
for (const [name, file] of [
  ['FindReplacePanel', 'FindReplacePanel'],
  ['DuplicatesPanel', 'DuplicatesPanel'],
  ['CsvImportPanel', 'CsvImportPanel'],
  ['ExportCsvModal', 'ExportCsvModal'],
  ['ScheduledSendsPanel', 'ScheduledSendsPanel'],
] as const) {
  vi.doMock(`@/components/domain/listings/tools/${file}`, () => ({
    [name]: (p: { open: boolean }) => {
      toolProps[name] = p;
      return p.open ? <div data-testid={`tool-${name}`} /> : null;
    },
  }));
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────
const NOW = new Date('2026-10-15T12:00:00Z');
function row(over: Partial<ListingRow>): ListingRow {
  return {
    id: '1',
    title: 'Wooden Keepsake Box',
    metaLine: ['ID 1'],
    thumbUrl: null,
    price: { amount: 54, currency: 'USD' },
    qty: 12,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: 61, used: 9, total: 12, fails: [] },
    updatedAt: '2026-10-14T12:00:00Z',
    createdAt: null,
    extra: {},
    externalUrl: 'https://www.etsy.com/listing/1',
    sync: null,
    ...over,
  };
}
const draft = (over: Partial<NonNullable<ListingRow['sync']>>): NonNullable<ListingRow['sync']> => ({
  draftId: 'd1',
  status: 'pending',
  changedFields: ['price'],
  draft: { price: 49 },
  queuedDelete: false,
  scheduledSendAt: null,
  syncedAt: null,
  ...over,
});
const ROWS: ListingRow[] = [
  row({ id: '1', sync: draft({}) }),
  row({ id: '2', title: 'Name Necklace Gold', editable: { price: false, qty: false, reason: 'variations' }, price: { amount: 38, currency: 'USD', from: true } }),
  row({ id: '3', title: 'Old Christmas Ornament', status: 'inactive', sync: draft({ draftId: 'd3', changedFields: [], draft: {}, queuedDelete: true }) }),
  row({ id: '4', title: 'Baby Name Sign', sync: draft({ draftId: 'd4', status: 'conflict', draft: {} }) }),
];
let response: ListingsResponse;
function makeResponse(rows: ListingRow[] = ROWS): ListingsResponse {
  return {
    rows,
    total: rows.length,
    counts: { all: 312, status: { active: 248, sold_out: 4 }, sync: { pending: 2, syncing: 0, failed: 0, conflict: 1, queuedDeletes: 1 }, needsWork: 12, unscored: 0 },
    store: { id: 'S1', name: 'Belle Couture Gifts', currency: 'USD', lastPulledAt: '2026-10-15T11:50:00Z' },
    stores: [{ id: 'S1', name: 'Belle Couture Gifts' }],
  };
}

function makeAdapter(open: OpenDraft[] = []): ListingsStagingAdapter {
  return {
    stage: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    send: vi.fn(async (ids: string[]) => ({ sent: ids, failed: [], conflicts: [] })),
    schedule: vi.fn(async () => undefined),
    listOpen: vi.fn(async () => open),
    sendDeletion: vi.fn(async (id: string) => ({ sent: [id], failed: [], conflicts: [] })),
  };
}

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G5_EN as Obj), tr: deepMerge(tr as Obj, G5_TR as Obj) };

let ListingsPage: typeof import('@/components/domain/listings/ListingsPage').ListingsPage;

async function renderPage(opts: { locale?: 'en' | 'tr'; adapter?: ListingsStagingAdapter; marketplace?: 'etsy' | 'wix' } = {}) {
  ListingsPage ??= (await import('@/components/domain/listings/ListingsPage')).ListingsPage;
  const locale = opts.locale ?? 'en';
  const adapter = opts.adapter ?? makeAdapter();
  const utils = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ConfirmProvider>
            <ListingsPage marketplace={opts.marketplace ?? 'etsy'} now={NOW} stagingAdapter={adapter} />
          </ConfirmProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  await screen.findAllByText('Wooden Keepsake Box').catch(() => undefined);
  return { ...utils, adapter };
}

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  conn.connected = true;
  conn.needsReauth = false;
  response = makeResponse();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = String(input);
      if (u.startsWith('/api/listings?')) return new Response(JSON.stringify(response), { status: 200 });
      if (u.startsWith('/api/clawd/etsy?action=get_shop_sections')) return new Response(JSON.stringify({ results: [{ shop_section_id: 7, title: 'Boxes' }] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});


const flagOn = () => window.localStorage.setItem('kx-ui-override', 'editor-etsy');
const flagOff = () => window.localStorage.removeItem('kx-ui-override');
const titleCell = (title = 'Wooden Keepsake Box') => screen.getAllByTestId('listing-title').find((el) => el.textContent === title)!;
const rowOf = (el: HTMLElement) => el.closest('[data-row-id]') as HTMLElement;

describe('listings row open (founder follow-up)', { timeout: 30_000 }, () => {
  afterEach(() => {
    flagOff();
    window.sessionStorage.removeItem('kx:editorNav');
  });

  it('editor flag off: clicking the title opens the quick view (no editor navigation)', async () => {
    await renderPage();
    fireEvent.click(titleCell());
    // The mock router is not reactive: assert the shallow URL write that opens the quick view (?open=1).
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ open: '1' }) }), undefined, expect.anything()));
    expect(router.push).not.toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/1/));
  });

  it('editor flag on: clicking the title, a plain cell or the row opens the editor route', async () => {
    flagOn();
    await renderPage();
    fireEvent.click(titleCell());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/1(\?|$)/)));
    router.push.mockClear();
    const row2 = rowOf(titleCell('Name Necklace Gold'));
    const cells = row2.querySelectorAll('td');
    fireEvent.click(cells[1]); // thumbnail cell (after the checkbox cell)
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/2(\?|$)/)));
    router.push.mockClear();
    fireEvent.click(row2);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/2(\?|$)/)));
    expect(JSON.parse(window.sessionStorage.getItem('kx:editorNav') ?? 'null')?.ids).toContain('2');
  });

  it('M6b: with editor-wix on, a Wix row opens the catalog editor in its site and ‹ › stay in that site', async () => {
    window.localStorage.setItem('kx-ui-override', 'editor-wix');
    await renderPage({ marketplace: 'wix' });
    fireEvent.click(titleCell());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/app/wix-urunler/1?site=S1'));
    const nav = JSON.parse(window.sessionStorage.getItem('kx:editorNav') ?? 'null');
    expect(nav?.marketplace).toBe('wix');
    expect(nav?.shopId).toBe('S1');
  });

  it('M6b: with editor-wix off, a Wix row opens the quick view', async () => {
    await renderPage({ marketplace: 'wix' });
    fireEvent.click(titleCell());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ open: '1' }) }), undefined, expect.anything()));
    expect(router.push).not.toHaveBeenCalledWith(expect.stringMatching(/^\/app\/wix-urunler\/1/));
  });

  it('Enter on a focused row opens the editor (flag on) or the quick view (flag off)', async () => {
    flagOn();
    await renderPage();
    const r = rowOf(titleCell());
    r.focus();
    fireEvent.keyDown(r, { key: 'Enter' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/1(\?|$)/)));
    cleanup();
    flagOff();
    __resetShortcutsForTests();
    __resetUrlStateForTests();
    router.query = {};
    router.push.mockClear();
    await renderPage();
    const r2 = rowOf(titleCell());
    r2.focus();
    fireEvent.keyDown(r2, { key: 'Enter' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ open: '1' }) }), undefined, expect.anything()));
  });

  it('the checkbox and the row action buttons do not open the listing', async () => {
    flagOn();
    await renderPage();
    const r = rowOf(titleCell());
    fireEvent.click(within(r).getByRole('checkbox'));
    for (const b of within(r).getAllByRole('button')) {
      if (/edit/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '')) continue; // ✎ opens the editor by design
      fireEvent.click(b);
    }
    await new Promise((res) => setTimeout(res, 20));
    expect(router.push).not.toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/1/));
  });

  it('a click that ends a text selection does not navigate', async () => {
    flagOn();
    await renderPage();
    const el = titleCell();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.click(el);
    await new Promise((res) => setTimeout(res, 20));
    expect(router.push).not.toHaveBeenCalled();
    sel.removeAllRanges();
  });

  it('the ⋯ menu still offers the quick view', async () => {
    await renderPage();
    const r = rowOf(titleCell('Name Necklace Gold'));
    fireEvent.click(within(r).getAllByRole('button').pop()!);
    const item = await screen.findByRole('menuitem', { name: /Quick view|Open quick view/i });
    expect(item).toBeTruthy();
  });

  it('a failed row renders the stored key with its params, and the generic cause when params are missing', async () => {
    response = makeResponse([
      row({ id: '1', sync: draft({ status: 'sync_failed', errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1, max: 3 } }) }),
      row({ id: '2', title: 'Name Necklace Gold', sync: draft({ draftId: 'd2', status: 'sync_failed', errorKey: 'etsy.draftSync.processingNotMapped' }) }),
      row({ id: '3', title: 'Old Christmas Ornament', sync: draft({ draftId: 'd3', status: 'sync_failed', errorKey: 'etsy.draftSync.rateLimited' }) }),
    ]);
    await renderPage();
    const labels = await waitFor(() => {
      const els = screen.getAllByTestId('listing-sync-error');
      expect(els.length).toBe(3);
      return els.map((e) => e.getAttribute('aria-label') ?? '');
    });
    const text = labels.join('\n');
    expect(text).toContain((en as any).etsy.draftSync.processingNotMapped.replace('{min}', '1').replace('{max}', '3'));
    expect(text).toContain((en as any).etsy.draftSync.rateLimited);
    expect(text).toContain((MESSAGES.en as any).listings.sendError.generic);
    expect(text).not.toContain('{min}');
  });
});
