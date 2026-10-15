// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useToolsMenuItems, stageMany, toolSearchParams, isListingsToolKey } from '@/components/domain/listings/tools/ToolsMenuItems';
import { FindReplacePanel, computeFindReplace, findRegExp, highlightParts } from '@/components/domain/listings/tools/FindReplacePanel';
import { DuplicatesPanel, duplicateReasonLabel, duplicateActionKeys } from '@/components/domain/listings/tools/DuplicatesPanel';
import { ExportCsvModal, exportUrl, filenameFromDisposition, selectedTooLong } from '@/components/domain/listings/tools/ExportCsvModal';
import { ScheduledSendsPanel, sendNowBlock, loadScheduledRows, type ScheduledRow } from '@/components/domain/listings/tools/ScheduledSendsPanel';
import { CsvImportPanel, readImportFile } from '@/components/domain/listings/tools/CsvImportPanel';
import type { CurrentListing } from '@/lib/listings/csvImport';
import type { DuplicatesResponse, ListingsResponse } from '@/lib/listings/types';
import { L, Providers, makeCtx, mockAdapter, routeFetch, row, type Locale } from './g6-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES: Locale[] = ['en', 'tr'];

const EXPORT_CSV = [
  '﻿id,title,price,currency,quantity,status,sku,tags,health,url',
  '1,Pink Baby Blanket,40.00,USD,3,active,BB-PINK,baby blanket|pink gift,80,https://etsy.com/listing/1',
  '2,Pink Bib Set,12.00,USD,10,active,,bib|pink bib,60,https://etsy.com/listing/2',
  '3,Blue Hat,9.00,USD,0,sold_out,,hat,50,https://etsy.com/listing/3',
].join('\r\n');

const csvResponse = () => new Response(EXPORT_CSV, { status: 200, headers: { 'content-type': 'text/csv' } });

function listBody(rows: ReturnType<typeof row>[]): ListingsResponse {
  return {
    rows,
    total: rows.length,
    counts: { all: rows.length, status: {}, sync: { pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 }, needsWork: 0, unscored: 0 },
    store: { id: 'shop1', name: 'BelleCoutureGifts', currency: 'USD', lastPulledAt: null },
    stores: [],
  };
}

/** `/api/listings?…`: open drafts (`sync=`) → `drafts`; `ids=` → those ids from `byId` (default: editable rows). */
const listRoute =
  (drafts: ReturnType<typeof row>[] = [], byId: Record<string, ReturnType<typeof row>> = {}) =>
  (url: string) => {
    const u = new URL(url, 'http://x');
    const ids = u.searchParams.get('ids');
    if (ids) return new Response(JSON.stringify(listBody(ids.split(',').map((id) => byId[id] ?? row({ id })))), { status: 200 });
    return new Response(JSON.stringify(listBody(drafts)), { status: 200 });
  };

// ─── Tools menu ─────────────────────────────────────────────────────────────

function MenuProbe({ onOpen, activityHref }: { onOpen: (k: string) => void; activityHref?: string }) {
  const items = useToolsMenuItems({ tools: ['findReplace', 'duplicates', 'import', 'export', 'scheduled', 'smartPricing'], onOpen, activityHref });
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>
          <button type="button" onClick={i.onClick} data-href={i.href}>
            {i.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

describe('useToolsMenuItems', () => {
  it.each(LOCALES)('lists the five tools in order, skips unknown keys, adds Activity (%s)', (locale) => {
    const onOpen = vi.fn();
    render(
      <Providers locale={locale}>
        <MenuProbe onOpen={onOpen} activityHref="/app/etsy-aktivite" />
      </Providers>,
    );
    const m = L(locale).tools;
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([m.findReplace, m.duplicates, m.import, m.export, m.scheduled, m.activity]);
    fireEvent.click(screen.getByText(m.import));
    expect(onOpen).toHaveBeenCalledWith('import');
    expect(screen.getByText(m.activity).getAttribute('data-href')).toBe('/app/etsy-aktivite');
  });
  it('disables Find & replace where no text field can be staged (Trendyol)', () => {
    function Probe() {
      const items = useToolsMenuItems({ tools: ['findReplace', 'import'], onOpen: vi.fn(), marketplace: 'trendyol' });
      return <span data-testid="probe">{JSON.stringify(items.map((i) => [i.id, !!i.disabled, i.disabledReason ?? null]))}</span>;
    }
    render(
      <Providers locale="en">
        <Probe />
      </Providers>,
    );
    expect(JSON.parse(screen.getByTestId('probe').textContent ?? '[]')).toEqual([
      ['tool-findReplace', true, L('en').tools.findReplaceUnavailable],
      ['tool-import', false, null],
    ]);
  });
  it('validates tool keys', () => {
    expect(isListingsToolKey('scheduled')).toBe(true);
    expect(isListingsToolKey('backups')).toBe(false);
  });
});

describe('shared helpers', () => {
  it('toolSearchParams keeps filters and drops page/size/sort', () => {
    const p = toolSearchParams({ marketplace: 'etsy', store: null, query: { marketplace: 'etsy', store: 's1', q: 'pink', status: ['active'], page: 3, size: 100, sort: 'price.asc' } });
    expect(p.toString()).toBe('marketplace=etsy&store=s1&q=pink&status=active');
  });
  it('stageMany never stops on a failure and reports progress', async () => {
    const adapter = mockAdapter({ stage: vi.fn(async (id: string) => { if (id === 'b') throw new Error('x'); }) });
    const progress: number[] = [];
    const res = await stageMany(adapter, [{ id: 'a', patch: {} }, { id: 'b', patch: {} }, { id: 'c', patch: {} }], (d) => progress.push(d), { concurrency: 1 });
    expect(res).toEqual({ done: ['a', 'c'], failed: ['b'] });
    expect(progress).toEqual([1, 2, 3]);
  });
});

// ─── Find & replace ─────────────────────────────────────────────────────────

const LISTINGS: CurrentListing[] = [
  { id: '1', title: 'Pink Baby Blanket', price: 40, quantity: 3, tags: ['baby blanket', 'pink gift'], description: 'A pink blanket', hasVariations: false },
  { id: '2', title: 'pink bib set', price: 12, quantity: 10, tags: ['bib'], description: null, hasVariations: false },
];

describe('computeFindReplace', () => {
  it('replaces every occurrence, case-insensitive by default', () => {
    const r = computeFindReplace(LISTINGS, { field: 'title', find: 'pink', replace: 'Rose', matchCase: false }, 'etsy');
    expect(r.stageable.map((c) => c.patch)).toEqual([{ title: 'Rose Baby Blanket' }, { title: 'Rose bib set' }]);
  });
  it('respects Match case', () => {
    const r = computeFindReplace(LISTINGS, { field: 'title', find: 'Pink', replace: 'Rose', matchCase: true }, 'etsy');
    expect(r.changes.map((c) => c.id)).toEqual(['1']);
  });
  it('treats the find text literally (no regex)', () => {
    expect(computeFindReplace(LISTINGS, { field: 'title', find: '.*', replace: 'x', matchCase: false }, 'etsy').changes).toEqual([]);
  });
  it('flags Etsy titles over 140 characters and excludes them from the count', () => {
    const r = computeFindReplace(LISTINGS, { field: 'title', find: 'Blanket', replace: 'B'.repeat(140), matchCase: false }, 'etsy');
    expect(r.flagged).toBe(1);
    expect(r.stageable).toEqual([]);
    expect(r.changes[0].flag).toBe('overLimit');
  });
  it('rewrites tags, dropping empties and duplicates', () => {
    const r = computeFindReplace(LISTINGS, { field: 'tags', find: 'pink gift', replace: 'baby blanket', matchCase: false }, 'etsy');
    expect(r.stageable[0].patch).toEqual({ tags: ['baby blanket'] });
  });
  it('highlights matches', () => {
    expect(highlightParts('Pink pink', findRegExp('pink', false))).toEqual([
      { text: 'Pink', match: true },
      { text: ' ', match: false },
      { text: 'pink', match: true },
    ]);
  });
});

describe('FindReplacePanel', () => {
  it.each(LOCALES)('previews from the export of the current view and stages drafts (%s)', async (locale) => {
    const { calls } = routeFetch({ '/api/listings/export': csvResponse, '/api/listings?': listRoute() });
    const ctx = makeCtx();
    render(
      <Providers locale={locale}>
        <FindReplacePanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    const m = L(locale);
    await waitFor(() => expect(calls).toContain('/api/listings/export?marketplace=etsy&store=shop1&status=active'));
    expect(calls).toContain('/api/listings?marketplace=etsy&store=shop1&sync=pending%2Csyncing%2Csync_failed%2Cconflict&size=250');
    fireEvent.change(screen.getByTestId('fr-find').querySelector('input') ?? screen.getByTestId('fr-find'), { target: { value: 'Pink' } });
    fireEvent.change(screen.getByTestId('fr-replace').querySelector('input') ?? screen.getByTestId('fr-replace'), { target: { value: 'Rose' } });
    await waitFor(() => expect(screen.getByTestId('fr-row-2')).toBeTruthy());
    expect(screen.getByTestId('fr-row-1').textContent).toContain('Rose Baby Blanket');
    expect(screen.getByTestId('fr-after-1').querySelector('mark')?.textContent).toBe('Rose');
    const stage = screen.getByTestId('action-fr-stage');
    await act(async () => {
      fireEvent.click(stage);
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledTimes(2));
    expect(ctx.adapter.stage).toHaveBeenCalledWith('1', { title: 'Rose Baby Blanket' }, undefined);
    expect(ctx.onChanged).toHaveBeenCalled();
    expect(m.fr.stage).toBeTruthy();
  });

  it('limits to the selection when Selected is chosen', async () => {
    routeFetch({ '/api/listings/export': csvResponse, '/api/listings?': listRoute() });
    const ctx = makeCtx({ selectedIds: ['2'] });
    render(
      <Providers locale="en">
        <FindReplacePanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByLabelText(L('en').fr.find)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(L('en').fr.find), { target: { value: 'pink' } });
    await waitFor(() => expect(screen.getByTestId('fr-row-2')).toBeTruthy());
    expect(screen.queryByTestId('fr-row-1')).toBeNull();
  });

  it('computes from the unsent draft title, not the live one', async () => {
    const drafted = row({ id: '1', sync: { draftId: 'd1', status: 'pending', changedFields: ['title'], draft: { title: 'Rose Baby Blanket' }, queuedDelete: false, scheduledSendAt: null, syncedAt: null } });
    routeFetch({ '/api/listings/export': csvResponse, '/api/listings?': listRoute([drafted]) });
    const ctx = makeCtx();
    render(
      <Providers locale="en">
        <FindReplacePanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByLabelText(L('en').fr.find)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(L('en').fr.find), { target: { value: 'Baby' } });
    fireEvent.change(screen.getByLabelText(L('en').fr.replace), { target: { value: 'Kids' } });
    await waitFor(() => expect(screen.getByTestId('fr-row-1').textContent).toContain('Rose Kids Blanket'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('action-fr-stage'));
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledWith('1', { title: 'Rose Kids Blanket' }, undefined));
  });

  it('resets the form when reopened, and preselects Selected if rows are selected then', async () => {
    routeFetch({ '/api/listings/export': csvResponse, '/api/listings?': listRoute() });
    const ctx = makeCtx();
    const { rerender } = render(
      <Providers locale="en">
        <FindReplacePanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByLabelText(L('en').fr.find)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(L('en').fr.find), { target: { value: 'Pink' } });
    const reopened = makeCtx({ selectedIds: ['2'], adapter: ctx.adapter });
    rerender(
      <Providers locale="en">
        <FindReplacePanel open={false} onClose={vi.fn()} ctx={reopened} />
      </Providers>,
    );
    rerender(
      <Providers locale="en">
        <FindReplacePanel open onClose={vi.fn()} ctx={reopened} />
      </Providers>,
    );
    await waitFor(() => expect((screen.getByLabelText(L('en').fr.find) as HTMLInputElement).value).toBe(''));
    expect((screen.getByLabelText(L('en').fr.scopeSelected.replace('{count}', '1')) as HTMLInputElement).checked).toBe(true);
  });

  it.each(LOCALES)('explains that Trendyol has no text field to replace (%s)', (locale) => {
    const { calls } = routeFetch({});
    render(
      <Providers locale={locale}>
        <FindReplacePanel open onClose={vi.fn()} ctx={makeCtx({ marketplace: 'trendyol', query: { marketplace: 'trendyol', store: 's' } })} />
      </Providers>,
    );
    expect(screen.getAllByText(L(locale).tools.findReplaceUnavailable).length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
});

// ─── Duplicates ─────────────────────────────────────────────────────────────

const DUPES: DuplicatesResponse = {
  groups: [
    { reason: { kind: 'same_sku', sku: 'BB-PINK' }, ids: ['1', '4'], rows: [row({ id: '1', title: 'Pink Baby Blanket' }), row({ id: '4', title: 'Pink Baby Blanket (copy)' })] },
    { reason: { kind: 'similar_title', similarity: 92.4 }, ids: ['2', '5'], rows: [row({ id: '2' }), row({ id: '5', status: 'inactive', statusRaw: 'inactive' })] },
  ],
};

describe('DuplicatesPanel', () => {
  it.each(LOCALES)('shows each group with its reason and stages a deactivation (%s)', async (locale) => {
    const { calls } = routeFetch({ '/api/listings/duplicates': () => new Response(JSON.stringify(DUPES), { status: 200 }) });
    const ctx = makeCtx();
    render(
      <Providers locale={locale}>
        <DuplicatesPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    const m = L(locale);
    await screen.findByText(m.dup.sameSku.replace('{sku}', 'BB-PINK'));
    expect(screen.getByText(m.dup.similarTitle.replace('{pct}', '92%'))).toBeTruthy();
    expect(calls[0]).toBe('/api/listings/duplicates?marketplace=etsy&store=shop1');
    const firstRow = document.querySelector('[data-row-id="4"]') as HTMLElement;
    fireEvent.click(within(firstRow).getByTestId('overflow-trigger'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('overflow-item-deactivate'));
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledWith('4', {}, { queuedActions: [{ type: 'deactivate' }] }));
  });

  it('stages a delete only after the confirm, and never offers Deactivate on an inactive row', async () => {
    routeFetch({ '/api/listings/duplicates': () => new Response(JSON.stringify(DUPES), { status: 200 }) });
    const ctx = makeCtx();
    render(
      <Providers locale="en">
        <DuplicatesPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await screen.findByText('Same SKU BB-PINK');
    const inactive = document.querySelector('[data-row-id="5"]') as HTMLElement;
    fireEvent.click(within(inactive).getByTestId('overflow-trigger'));
    expect(screen.queryByTestId('overflow-item-deactivate')).toBeNull();
    fireEvent.click(await screen.findByTestId('overflow-item-delete'));
    expect(ctx.adapter.stage).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId('ds-confirm');
    await act(async () => {
      fireEvent.click(within(dialog).getByText(L('en').dup.deleteConfirm));
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledWith('5', {}, { queuedActions: [{ type: 'delete' }] }));
  });

  it('shows the done state when nothing is duplicated', async () => {
    routeFetch({ '/api/listings/duplicates': () => new Response(JSON.stringify({ groups: [] }), { status: 200 }) });
    render(
      <Providers locale="tr">
        <DuplicatesPanel open onClose={vi.fn()} ctx={makeCtx()} />
      </Providers>,
    );
    expect(await screen.findByText(L('tr').dup.none)).toBeTruthy();
  });

  it('offers only the actions each marketplace stages', () => {
    expect(duplicateActionKeys('etsy')).toEqual(['deactivate', 'delete']);
    expect(duplicateActionKeys('ebay')).toEqual(['deactivate', 'delete']);
    expect(duplicateActionKeys('trendyol')).toEqual(['archive']);
    expect(duplicateActionKeys('wix')).toEqual(['hideInStore', 'delete']);
    expect(duplicateActionKeys('shopify')).toEqual(['delete']);
  });

  it.each(LOCALES)('Trendyol: Archive… after a confirm, no Deactivate or Delete (%s)', async (locale) => {
    routeFetch({ '/api/listings/duplicates': () => new Response(JSON.stringify(DUPES), { status: 200 }) });
    const ctx = makeCtx({ marketplace: 'trendyol', query: { marketplace: 'trendyol', store: 'shop1' } });
    render(
      <Providers locale={locale}>
        <DuplicatesPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    const m = L(locale);
    await screen.findByText(m.dup.sameSku.replace('{sku}', 'BB-PINK'));
    fireEvent.click(within(document.querySelector('[data-row-id="4"]') as HTMLElement).getByTestId('overflow-trigger'));
    expect(screen.queryByTestId('overflow-item-deactivate')).toBeNull();
    expect(screen.queryByTestId('overflow-item-delete')).toBeNull();
    fireEvent.click(await screen.findByTestId('overflow-item-archive'));
    expect(ctx.adapter.stage).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId('ds-confirm');
    await act(async () => {
      fireEvent.click(within(dialog).getByText(m.dup.archiveConfirm));
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledWith('4', {}, { queuedActions: [{ type: 'archive' }] }));
  });

  it.each(LOCALES)('Wix: Hide from store stages `hide`, never `deactivate` (%s)', async (locale) => {
    routeFetch({ '/api/listings/duplicates': () => new Response(JSON.stringify(DUPES), { status: 200 }) });
    const ctx = makeCtx({ marketplace: 'wix', query: { marketplace: 'wix', store: 'shop1' } });
    render(
      <Providers locale={locale}>
        <DuplicatesPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await screen.findByText(L(locale).dup.sameSku.replace('{sku}', 'BB-PINK'));
    fireEvent.click(within(document.querySelector('[data-row-id="4"]') as HTMLElement).getByTestId('overflow-trigger'));
    expect(screen.queryByTestId('overflow-item-deactivate')).toBeNull();
    expect(await screen.findByTestId('overflow-item-delete')).toBeTruthy();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('overflow-item-hideInStore'));
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledWith('4', {}, { queuedActions: [{ type: 'hide' }] }));
  });

  it('labels reasons', () => {
    const t = ((k: string, p?: Record<string, string>) => `${k}:${JSON.stringify(p)}`) as never;
    expect(duplicateReasonLabel(t, { kind: 'same_title' })).toBe('dup.similarTitle:{"pct":"100%"}');
  });
});

// ─── Export ─────────────────────────────────────────────────────────────────

describe('ExportCsvModal', () => {
  it('builds the URL per scope', () => {
    const ctx = makeCtx({ selectedIds: ['1', '2'] });
    expect(exportUrl(ctx, 'view', false)).toBe('/api/listings/export?marketplace=etsy&store=shop1&status=active');
    expect(exportUrl(ctx, 'selected', true)).toBe('/api/listings/export?marketplace=etsy&store=shop1&ids=1%2C2&includeDescription=1');
    expect(exportUrl(ctx, 'all', false)).toBe('/api/listings/export?marketplace=etsy&store=shop1');
  });
  it('keeps the list sort so the CSV matches what the seller sees', () => {
    const ctx = makeCtx({ query: { marketplace: 'etsy', store: 'shop1', sort: 'price.asc', page: 2, size: 100 } });
    expect(exportUrl(ctx, 'view', false)).toBe('/api/listings/export?marketplace=etsy&store=shop1&sort=price.asc');
    expect(exportUrl(ctx, 'all', false)).toBe('/api/listings/export?marketplace=etsy&store=shop1&sort=price.asc');
  });
  it('disables Selected when the ids would not fit the request URL', () => {
    const many = Array.from({ length: 1000 }, (_, i) => String(1490000000 + i));
    expect(selectedTooLong(many)).toBe(true);
    expect(selectedTooLong(many.slice(0, 100))).toBe(false);
    render(
      <Providers locale="en">
        <ExportCsvModal open onClose={vi.fn()} ctx={makeCtx({ selectedIds: many })} initialScope="selected" />
      </Providers>,
    );
    const selected = screen.getByLabelText(L('en').fr.scopeSelected.replace('{count}', '1000')) as HTMLInputElement;
    expect(selected.disabled).toBe(true);
    expect(selected.checked).toBe(false);
    expect((screen.getByLabelText(L('en').fr.scopeView.replace('{count}', '3')) as HTMLInputElement).checked).toBe(true);
  });
  it('reads the server filename', () => {
    expect(filenameFromDisposition('attachment; filename="etsy-listings-belle-2026-10-15.csv"')).toBe('etsy-listings-belle-2026-10-15.csv');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''etsy%20list.csv")).toBe('etsy list.csv');
    expect(filenameFromDisposition(null)).toBeNull();
  });
  it.each(LOCALES)('downloads the chosen scope (%s)', async (locale) => {
    const { calls } = routeFetch({ '/api/listings/export': csvResponse });
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(
      <Providers locale={locale}>
        <ExportCsvModal open onClose={onClose} ctx={makeCtx()} />
      </Providers>,
    );
    const m = L(locale);
    fireEvent.click(screen.getByLabelText(m.export.scopeAll.replace('{count}', '5')));
    fireEvent.click(screen.getByLabelText(m.export.includeDescription));
    await act(async () => {
      fireEvent.click(screen.getByTestId('action-export-download'));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]).toBe('/api/listings/export?marketplace=etsy&store=shop1&includeDescription=1');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});

// ─── Scheduled sends ────────────────────────────────────────────────────────

const sched = (id: string, at: string, over: Partial<ScheduledRow['sync']> = {}) =>
  row({
    id,
    title: `Scheduled ${id}`,
    sync: { draftId: `d${id}`, status: 'pending', changedFields: ['price', 'images'], draft: {}, queuedDelete: false, scheduledSendAt: at, syncedAt: null, ...over },
  }) as ScheduledRow;

function listResponse(rows: ReturnType<typeof row>[]): ListingsResponse {
  return {
    rows,
    total: rows.length,
    counts: { all: rows.length, status: {}, sync: { pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 }, needsWork: 0, unscored: 0 },
    store: { id: 'shop1', name: 'BelleCoutureGifts', currency: 'USD', lastPulledAt: null },
    stores: [],
  };
}

describe('ScheduledSendsPanel', () => {
  it('blocks Send now for conflicts, queued deletes and in-flight sends', () => {
    expect(sendNowBlock(sched('1', '2026-10-16T09:00:00Z'))).toBeNull();
    expect(sendNowBlock(sched('1', '2026-10-16T09:00:00Z', { status: 'conflict' }))).toBe('conflict');
    expect(sendNowBlock(sched('1', '2026-10-16T09:00:00Z', { queuedDelete: true }))).toBe('delete');
    expect(sendNowBlock(sched('1', '2026-10-16T09:00:00Z', { status: 'syncing' }))).toBe('syncing');
  });

  it('keeps only scheduled drafts, soonest first', async () => {
    const { calls } = routeFetch({
      '/api/listings?': () => new Response(JSON.stringify(listResponse([sched('2', '2026-10-17T09:00:00Z'), row({ id: '9' }), sched('1', '2026-10-16T09:00:00Z')])), { status: 200 }),
    });
    const rows = await loadScheduledRows(makeCtx());
    expect(rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(calls[0]).toContain('sync=pending%2Csyncing%2Csync_failed%2Cconflict');
    expect(calls[0]).toContain('scheduled=1');
  });

  it.each(LOCALES)('lists scheduled drafts and sends, unschedules through the adapter (%s)', async (locale) => {
    routeFetch({
      '/api/listings?': () =>
        new Response(JSON.stringify(listResponse([sched('1', '2026-10-16T09:00:00Z'), sched('2', '2026-10-17T09:00:00Z', { status: 'conflict' })])), { status: 200 }),
    });
    const ctx = makeCtx();
    render(
      <Providers locale={locale}>
        <ScheduledSendsPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    const m = L(locale);
    await screen.findByText('Scheduled 1');
    const r1 = document.querySelector('[data-row-id="d1"]') as HTMLElement;
    expect(r1.textContent).toContain(m.csv.fields.price);
    fireEvent.click(within(r1).getByTestId('overflow-trigger'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('overflow-item-sendNow'));
    });
    await waitFor(() => expect(ctx.adapter.send).toHaveBeenCalledWith(['d1']));

    const r2 = document.querySelector('[data-row-id="d2"]') as HTMLElement;
    fireEvent.click(within(r2).getByTestId('overflow-trigger'));
    const sendNow = await screen.findByTestId('overflow-item-sendNow');
    expect(sendNow.getAttribute('aria-disabled') === 'true' || sendNow.hasAttribute('disabled') || sendNow.className.includes('Mui-disabled')).toBe(true);
    await act(async () => {
      fireEvent.click(await screen.findByTestId('overflow-item-unschedule'));
    });
    await waitFor(() => expect(ctx.adapter.schedule).toHaveBeenCalledWith(['d2'], null));
    expect(ctx.adapter.send).toHaveBeenCalledTimes(1);
  });

  it('shows the done state when nothing is scheduled', async () => {
    routeFetch({ '/api/listings?': () => new Response(JSON.stringify(listResponse([row({ id: '1' })])), { status: 200 }) });
    render(
      <Providers locale="en">
        <ScheduledSendsPanel open onClose={vi.fn()} ctx={makeCtx()} />
      </Providers>,
    );
    expect(await screen.findByText(L('en').sched.none)).toBeTruthy();
  });
});

// ─── Import ─────────────────────────────────────────────────────────────────

const file = (text: string, name = 'listings.csv') => new File([text], name, { type: 'text/csv' });

describe('CsvImportPanel', () => {
  it('rejects non-CSV, oversized and empty files', async () => {
    expect(await readImportFile(file('a,b', 'x.xlsx'))).toEqual({ ok: false, error: 'notCsv' });
    expect(await readImportFile(file('listing_id\n'))).toEqual({ ok: false, error: 'empty' });
    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    expect(await readImportFile(big)).toEqual({ ok: false, error: 'tooLarge' });
  });

  it.each(LOCALES)('maps columns, previews changes against the shop and stages them (%s)', async (locale) => {
    const { calls } = routeFetch({ '/api/listings/export': csvResponse, '/api/listings?': listRoute() });
    const ctx = makeCtx();
    render(
      <Providers locale={locale}>
        <CsvImportPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    const m = L(locale);
    const upload = file('listing_id,title,price,quantity\n1,Pink Baby Blanket,44,3\n2,,abc,\n3,Blue Hat,9.00,0\n77,Ghost,1,1\n');
    await act(async () => {
      fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [upload] } });
    });
    const summary = await screen.findByTestId('csv-summary');
    expect(calls).toContain('/api/listings/export?marketplace=etsy&store=shop1');
    expect(calls).toContain('/api/listings?marketplace=etsy&store=shop1&ids=1&size=100');
    expect(summary.textContent).toBe(m.csv.summary.replace('{rows}', '4').replace('{change}', '1').replace('{missing}', '1').replace('{invalid}', '1'));
    expect(screen.getByText(m.csv.notFound)).toBeTruthy();
    expect(screen.getByText(m.validate.priceInvalid)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('action-csv-stage'));
    });
    await waitFor(() => expect(ctx.adapter.stage).toHaveBeenCalledTimes(1));
    expect(ctx.adapter.stage).toHaveBeenCalledWith('1', { price: 44 }, undefined);
  });

  it.each(LOCALES)('never stages price or qty on an Etsy variation listing (%s)', async (locale) => {
    routeFetch({
      '/api/listings/export': csvResponse,
      '/api/listings?': listRoute([], { '1': row({ id: '1', editable: { price: false, qty: false, reason: 'variations' } }) }),
    });
    const ctx = makeCtx();
    render(
      <Providers locale={locale}>
        <CsvImportPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [file('listing_id,price,quantity\n1,44,9\n')] } });
    });
    const m = L(locale);
    await screen.findByTestId('csv-summary');
    expect(screen.getAllByText(m.cell.variationsReadOnly).length).toBe(2);
    expect(screen.getByTestId('action-csv-stage').hasAttribute('disabled') || screen.getByTestId('action-csv-stage').getAttribute('aria-disabled') === 'true').toBe(true);
    expect(ctx.adapter.stage).not.toHaveBeenCalled();
  });

  it('clears the old file and plan when reopened', async () => {
    routeFetch({ '/api/listings/export': csvResponse, '/api/listings?': listRoute() });
    const ctx = makeCtx();
    const { rerender } = render(
      <Providers locale="en">
        <CsvImportPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [file('listing_id,price\n1,44\n')] } });
    });
    await screen.findByTestId('csv-summary');
    rerender(
      <Providers locale="en">
        <CsvImportPanel open={false} onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    rerender(
      <Providers locale="en">
        <CsvImportPanel open onClose={vi.fn()} ctx={ctx} />
      </Providers>,
    );
    await waitFor(() => expect(screen.queryByTestId('csv-summary')).toBeNull());
    expect(screen.getByText(L('en').csv.drop)).toBeTruthy();
  });

  it('asks for the id column when none is detected', async () => {
    routeFetch({ '/api/listings/export': csvResponse });
    render(
      <Providers locale="en">
        <CsvImportPanel open onClose={vi.fn()} ctx={makeCtx()} />
      </Providers>,
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [file('code,price\n1,4\n')] } });
    });
    expect(await screen.findByText('Match one column to listing_id so each row can be found')).toBeTruthy();
  });
});
