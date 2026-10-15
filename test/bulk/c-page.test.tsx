// @vitest-environment jsdom
// M7-C BulkEditPage (bulk-grid §2, §6, §8, §9): header counts in the C1 unit, a paste flows into ONE draft per
// listing through the batch queue, invalid cells never reach the transport, "Send N changes" confirms and sends
// only the grid's plain drafts (never conflicts, never queued deletes), mobile EmptyState, TR copy, route flag.
// BulkGrid (M7-A) is replaced by a stub that exposes its props, so this test drives the page through the
// documented BulkGrid contract (`onCellsChange`, `onPasteResult`, `values`, `dirty`, `invalid`).
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
import type { BulkStageItem, BulkStageResult, BulkStageTransport } from '@/components/domain/bulk/useBulkStaging';
import type { BulkGridProps } from '@/components/ds/data/BulkGrid';
import type { RevertDeps } from '@/components/domain/bulk/useSessionEdits';
import { setViewport } from '../ds/m1e-helpers';
import { m7aEn, m7aTr } from '../ds/m7a-messages';
import { C_EN, C_TR } from './c-messages';
import { D_EN, D_TR } from './d-messages';

// ── mocks ──────────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/etsy-listings/bulk',
  asPath: '/app/etsy-listings/bulk',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  beforePopState: vi.fn(),
  replace: vi.fn(async (u: { query?: Record<string, string | string[]> } | string) => {
    if (typeof u === 'object' && u.query) router.query = u.query;
    return true;
  }),
  push: vi.fn(async () => true),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const conn = { connected: true as boolean | undefined, needsReauth: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: {}, error: undefined, has: () => conn.connected, get: () => ({ connected: conn.connected, needsReauth: conn.needsReauth }), mutate: vi.fn() }),
}));
const photoAccess = { visible: true, tag: false, locked: false };
vi.mock('@/lib/billing/useFeatureAction', () => ({
  useFeatureAction: () => ({ access: 'allowed', trialEndsAt: null, onBlockedClick: undefined, ...photoAccess }),
}));
const flags = new Set<string>();
vi.mock('@/lib/ds/uiFlags', () => ({ useUiFlag: (k: string) => flags.has(k) }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));

let grid: BulkGridProps<ListingRow> | null = null;
vi.mock('@/components/ds/data/BulkGrid', () => ({
  BulkGrid: (p: BulkGridProps<ListingRow>) => {
    grid = p;
    return (
      <div data-testid="grid-stub">
        {p.rows.map((r) => (
          <div key={r.id} data-testid={`row-${r.id}`}>
            {String(p.values[r.id]?.title ?? r.title)}
            {p.rowMeta?.(r)}
          </div>
        ))}
      </div>
    );
  },
  usePasteSummary: () => (o: { kind: string }) => (o.kind === 'error' ? { tone: 'danger', message: 'refused' } : null),
}));

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────
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
    updatedAt: null,
    createdAt: null,
    extra: {},
    externalUrl: null,
    sync: null,
    ...over,
  };
}
const sync = (over: Partial<NonNullable<ListingRow['sync']>>): NonNullable<ListingRow['sync']> => ({
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
  row({ id: '1', sync: sync({}) }),
  row({ id: '2', title: 'Name Necklace Gold' }),
  row({ id: '3', title: 'Old Ornament', sync: sync({ draftId: 'd3', changedFields: [], draft: {}, queuedDelete: true }) }),
  row({ id: '4', title: 'Baby Name Sign', sync: sync({ draftId: 'd4', status: 'conflict', draft: {} }) }),
  row({ id: '5', title: 'Pink Blanket' }),
];
function response(rows = ROWS): ListingsResponse {
  return {
    rows,
    total: rows.length,
    counts: { all: rows.length, status: { active: rows.length }, sync: { pending: 1, syncing: 0, failed: 0, conflict: 1, queuedDeletes: 1 }, needsWork: 0, unscored: 0 },
    store: { id: 'S1', name: 'Belle Couture Gifts', currency: 'USD', lastPulledAt: null },
    stores: [{ id: 'S1', name: 'Belle Couture Gifts' }],
  };
}

function makeAdapter(open: OpenDraft[]): ListingsStagingAdapter {
  return {
    stage: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    send: vi.fn(async (ids: string[]) => ({ sent: ids, failed: [], conflicts: [] })),
    schedule: vi.fn(async () => undefined),
    listOpen: vi.fn(async () => open),
    sendDeletion: vi.fn(async (id: string) => ({ sent: [id], failed: [], conflicts: [] })),
  };
}

function makeTransport() {
  const calls: BulkStageItem[][] = [];
  const transport: BulkStageTransport = {
    stageBatch: vi.fn(async (items: BulkStageItem[]): Promise<BulkStageResult[]> => {
      calls.push(items);
      return items.map((i) => ({ rowId: i.rowId, ok: true, draftId: `n${i.rowId}`, status: 'draft' }));
    }),
  };
  return { transport, calls };
}

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = {
  en: [m7aEn, D_EN, C_EN].reduce<Obj>((acc, m) => deepMerge(acc, m as Obj), en as Obj),
  tr: [m7aTr, D_TR, C_TR].reduce<Obj>((acc, m) => deepMerge(acc, m as Obj), tr as Obj),
};

let BulkEditPage: typeof import('@/components/domain/bulk/BulkEditPage').BulkEditPage;

async function renderPage(opts: { locale?: 'en' | 'tr'; adapter?: ListingsStagingAdapter; transport?: BulkStageTransport; strict?: boolean; revertDeps?: RevertDeps } = {}) {
  BulkEditPage ??= (await import('@/components/domain/bulk/BulkEditPage')).BulkEditPage;
  const locale = opts.locale ?? 'en';
  const Wrap = opts.strict ? React.StrictMode : React.Fragment;
  const utils = render(
    <Wrap>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ConfirmProvider>
            <BulkEditPage marketplace="etsy" stagingAdapter={opts.adapter ?? makeAdapter([])} transport={opts.transport ?? makeTransport().transport} revertDeps={opts.revertDeps} />
          </ConfirmProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
    </Wrap>,
  );
  return utils;
}

let listCalls: string[] = [];
beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = { shop: 'S1' };
  router.replace.mockClear();
  conn.connected = true;
  conn.needsReauth = false;
  grid = null;
  listCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = String(input);
      if (u.startsWith('/api/listings?')) {
        listCalls.push(u);
        return new Response(JSON.stringify(response()), { status: 200 });
      }
      if (u.startsWith('/api/user/settings')) return new Response(JSON.stringify({ subscription: { billingProvider: 'stripe', subscriptionPlan: 'growth' } }), { status: 200 });
      if (u.startsWith('/api/clawd/etsy?action=get_shop_sections')) return new Response(JSON.stringify({ results: [{ shop_section_id: 7, title: 'Boxes' }] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  flags.clear();
});

const header = () => screen.getByTestId('bulk-header');

describe('BulkEditPage (Etsy, desktop)', () => {
  it('reads one 250-row page through the list API and counts changes as listings (C1)', async () => {
    await renderPage();
    await screen.findByTestId('row-5');
    expect(listCalls.some((u) => u.includes('marketplace=etsy') && u.includes('size=250') && u.includes('store=S1'))).toBe(true);
    expect(within(header()).getByText('Bulk edit')).toBeTruthy();
    // row 1 has a plain draft; 3 (queued delete) and 4 (conflict) are not sendable
    expect(within(header()).getByRole('button', { name: /Send 1 change to Etsy/ })).toBeTruthy();
    expect(screen.getByTestId('bulk-meta').textContent).toBe('5 listings · 2 edits not sent') // row 1 + the conflict draft's edit;
    expect(screen.getByTestId('row-3').textContent).toContain('Will be deleted on send');
    expect(grid?.columnStateKey).toBe('bulk.etsy.columns');
    expect(grid?.dirty.has('1:price')).toBe(true);
    expect(grid?.values['1']).toEqual({ price: 49 });
    expect(screen.getByTestId('bulk-banner-conflict')).toBeTruthy();
  });

  it('?ids= reads exactly those listings (no default view filter)', async () => {
    router.query = { shop: 'S1', ids: '2,5' };
    await renderPage();
    await screen.findByTestId('row-5');
    const u = listCalls.find((x) => x.includes('ids='));
    expect(u).toContain('ids=2%2C5');
    expect(u).not.toContain('status=active');
  });

  it('paste → one batch per flush with one item per listing; invalid cells stay local; Send sends only plain grid drafts', async () => {
    const { transport, calls } = makeTransport();
    const adapter = makeAdapter([
      { draftId: 'd1', id: '1', status: 'pending', queuedDelete: false, createsListing: false },
      { draftId: 'n2', id: '2', status: 'pending', queuedDelete: false, createsListing: false },
      { draftId: 'n5', id: '5', status: 'pending', queuedDelete: false, createsListing: false },
      { draftId: 'd3', id: '3', status: 'pending', queuedDelete: true, createsListing: false },
      { draftId: 'd4', id: '4', status: 'conflict', queuedDelete: false, createsListing: false },
      { draftId: 'dX', id: '999', status: 'pending', queuedDelete: false, createsListing: false }, // not in this grid
    ]);
    await renderPage({ adapter, transport });
    await screen.findByTestId('row-5');
    act(() => {
      grid!.onCellsChange(
        [
          { rowId: '2', field: 'title', value: 'Name Necklace Gold, Personalized' },
          { rowId: '2', field: 'price', value: 41 },
          { rowId: '5', field: 'title', value: 'x'.repeat(141), error: 'Use at most 140 characters (141 now)' },
          { rowId: '5', field: 'price', value: 0.1 },
          { rowId: '5', field: 'qty', value: 3 },
          { rowId: '3', field: 'price', value: 9 }, // queued delete → read-only, skipped
        ],
        'paste',
      );
      grid!.onPasteResult?.({ kind: 'ok', patches: [], rows: 3, cols: 3, edits: 3, invalid: 2, skipped: 1, skippedReasons: [], overflow: 0, colOverflow: 0, unchanged: 0, intoSelection: false, rowIds: ['2', '5'] });
    });
    expect(screen.getByTestId('bulk-banner-paste').textContent).toContain('Pasted 3 rows × 3 columns · 3 edits · 2 invalid · 1 skipped');
    expect(grid!.invalid.get('5:title')).toBe('Use at most 140 characters (141 now)');
    expect(grid!.invalid.get('5:price')).toMatch(/minimum price/);
    expect(grid!.values['5'].title).toBe('x'.repeat(141));
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls[0]).toEqual([
      { rowId: '2', values: { title: 'Name Necklace Gold, Personalized', price: 41 } },
      { rowId: '5', values: { qty: 3 } },
    ]);
    expect(adapter.send).not.toHaveBeenCalled();
    await waitFor(() => expect(within(header()).getByRole('button', { name: /Send 3 changes to Etsy/ })).toBeTruthy());
    fireEvent.click(within(header()).getByRole('button', { name: /Send 3 changes to Etsy/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Waiting for you: 1 listing changed on Etsy · 1 deletion');
    expect(adapter.send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send 3 changes to Etsy' }));
    await waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1));
    expect(adapter.send).toHaveBeenCalledWith(['d1', 'n2', 'n5']);
    expect(adapter.sendDeletion).not.toHaveBeenCalled();
  });

  it('a cancelled send confirm sends nothing', async () => {
    const adapter = makeAdapter([{ draftId: 'd1', id: '1', status: 'pending', queuedDelete: false, createsListing: false }]);
    await renderPage({ adapter });
    await screen.findByTestId('row-5');
    fireEvent.click(within(header()).getByRole('button', { name: /Send 1 change to Etsy/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Send 1 change to Etsy? The live listings are updated.');
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('React StrictMode (dev): edits still reach the staging queue', async () => {
    const { transport, calls } = makeTransport();
    await renderPage({ transport, strict: true });
    await screen.findByTestId('row-5');
    act(() => grid!.onCellsChange([{ rowId: '2', field: 'title', value: 'Name Necklace Silver' }], 'edit'));
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls[0]).toEqual([{ rowId: '2', values: { title: 'Name Necklace Silver' } }]);
  });

  it('Discard all restores the pre-session draft value instead of dropping it', async () => {
    const { transport, calls } = makeTransport();
    const stage = vi.fn(async () => ({}));
    const discard = vi.fn(async () => ({}));
    const revertDeps = {
      etsy: { fetch: vi.fn(async () => [{ id: 'd1', status: 'draft', etsyListingId: '1', fieldPatch: { price: 52, title: 'Kept' } }]), stage, discard },
      ebay: { fetch: vi.fn(), stage: vi.fn(), discard: vi.fn() },
      catalog: { fetch: vi.fn(), stage: vi.fn(), discard: vi.fn() },
    } as unknown as RevertDeps;
    await renderPage({ transport, revertDeps });
    await screen.findByTestId('row-5');
    // row 1's draft already had price 49 before this session
    act(() => grid!.onCellsChange([{ rowId: '1', field: 'price', value: 52 }], 'edit'));
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    fireEvent.click(within(header()).getByRole('button', { name: 'Discard all edits' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard all edits' }));
    await waitFor(() => expect(stage).toHaveBeenCalledTimes(1));
    expect(stage).toHaveBeenCalledWith({ shopId: 'S1', listingId: '1', fields: { price: 49, title: 'Kept' }, replaceFields: true });
    expect(discard).not.toHaveBeenCalled();
  });

  it('?size=50 pages the grid by 50', async () => {
    router.query = { shop: 'S1', size: '50' };
    await renderPage();
    await screen.findByTestId('row-5');
    expect(listCalls.some((u) => u.includes('size=250'))).toBe(false); // 50 is the list API default
    expect(grid?.pagination && 'pageSize' in grid.pagination ? grid.pagination.pageSize : null).toBe(50);
  });

  it('Turkish header copy', async () => {
    await renderPage({ locale: 'tr' });
    await screen.findByTestId('row-5');
    expect(within(header()).getByText('Toplu düzenleme')).toBeTruthy();
    expect(screen.getByTestId('bulk-meta').textContent).toBe('5 ilan · 2 düzenleme gönderilmedi');
  });

  it('below 900px: the larger-screen EmptyState, no data request', async () => {
    setViewport('mobile');
    await renderPage();
    expect(screen.getByTestId('bulk-mobile').textContent).toContain('The bulk editor works on a larger screen');
    expect(listCalls).toHaveLength(0);
  });
});

describe('bulk routes (flag `bulk`)', () => {
  const ROUTES = [
    ['etsy', '/app/etsy-listings', () => import('@/pages/app/etsy-listings/bulk')],
    ['ebay', '/app/ebay-listings', () => import('@/pages/app/ebay-listings/bulk')],
    ['trendyol', '/app/trendyol-urunler', () => import('@/pages/app/trendyol-urunler/bulk')],
    ['wix', '/app/wix-urunler', () => import('@/pages/app/wix-urunler/bulk')],
    ['shopify', '/app/shopify-urunler', () => import('@/pages/app/shopify-urunler/bulk')],
  ] as const;
  it.each(ROUTES)('%s: flag off → back to %s; flag on → the bulk page', async (_mp, listRoute, load) => {
    const Route = (await load()).default as React.ComponentType;
    const wrap = (el: React.ReactNode) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="en" messages={MESSAGES.en} timeZone="Europe/Istanbul" onError={() => {}}>
          <ThemeProvider theme={theme}>
            <ConfirmProvider>{el}</ConfirmProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </SWRConfig>
    );
    const { unmount } = render(wrap(<Route />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(listRoute));
    expect(screen.queryByTestId('bulk-header')).toBeNull();
    unmount();
    flags.add('bulk');
    render(wrap(<Route />));
    expect(await screen.findByTestId('bulk-header')).toBeTruthy();
  });
});
