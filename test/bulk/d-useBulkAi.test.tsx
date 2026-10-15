// @vitest-environment jsdom
// M7-D: Improve with AI in the bulk grid. Results become ordinary 'ai' cell edits (staged by M7-C, never sent from
// here), guards drop garbled / over-long / overlapping output and count it, 402 stops the run inline, cancel
// discards in-flight responses. DoD spy: no request other than POST /api/ai/etsy bulk_optimize is ever made.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import {
  bulkAiCredits,
  chunkRows,
  errorKeyFor,
  guardTags,
  guardTitle,
  resolveRow,
  useBulkAi,
  type BulkAiPatch,
  type BulkAiRow,
  type UseBulkAiOptions,
} from '@/components/domain/bulk/useBulkAi';
import { AiProposalCell, withAiMarker } from '@/components/domain/bulk/AiProposalCell';
import { BulkGrid, type GridColumn } from '@/components/ds/data/BulkGrid';
import { FormatProvider } from '@/lib/format';
import { m1dMessages } from '../ds/m1d-render';
import { m7aEn } from '../ds/m7a-messages';
import { D_EN, D_TR, flatKeys, mergeMessages } from './d-messages';

type Locale = 'en' | 'tr';
const MESSAGES = { en: mergeMessages(en, D_EN), tr: mergeMessages(tr, D_TR) };

function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

const GOOD_TITLE = 'Personalized Baby Blanket, Custom Name Swaddle, Newborn Keepsake Gift, Soft Cotton Nursery Throw for Baby Shower';
const GOOD_TAGS = ['christening present', 'boho decor', 'heirloom quilt', 'new mama ideas'];

function rows(n: number): BulkAiRow[] {
  return Array.from({ length: n }, (_, i) => ({
    rowId: `r${i}`,
    listingId: 1000 + i,
    title: `Old title ${i} mom&#39;s`,
    tags: ['old tag'],
    description: 'desc',
  }));
}

type Call = { url: string; method: string; body: Record<string, unknown>; headers: Record<string, string> };

function makeFetch(respond: (body: Record<string, unknown>, n: number) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, method: String(init?.method), body, headers: (init?.headers ?? {}) as Record<string, string> });
    const signal = init?.signal;
    const r = await respond(body, calls.length);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

const okEcho = (body: Record<string, unknown>) => ({
  status: 200,
  json: {
    optimized: (body.listings as Array<{ listing_id: number }>).map((l) => ({ listing_id: l.listing_id, title: GOOD_TITLE, tags: GOOD_TAGS })),
    fields: body.fields,
  },
});

function setup(over: Partial<UseBulkAiOptions> = {}, locale: Locale = 'en') {
  const edits: Array<{ patches: BulkAiPatch[]; origin: string }> = [];
  const onCellsChange = vi.fn((patches: BulkAiPatch[], origin: 'ai') => { edits.push({ patches, origin }); });
  const hook = renderHook(() => useBulkAi({ marketplace: 'etsy', onCellsChange, ...over }), {
    wrapper: ({ children }) => <Providers locale={locale}>{children}</Providers>,
  });
  return { hook, edits, onCellsChange };
}

afterEach(() => cleanup());

// ── Pure ─────────────────────────────────────────────────────────────────────────────────────────

describe('pure helpers', () => {
  it('chunks to the API limit of 20 and charges 1 credit per listing', () => {
    expect(chunkRows(rows(45), 20).map((c) => c.length)).toEqual([20, 20, 5]);
    expect(chunkRows(rows(45), 50).map((c) => c.length)).toEqual([20, 20, 5]);
    expect(bulkAiCredits(12)).toBe(12);
  });

  it('guards titles: entities decoded, garbled and > 140 chars dropped', () => {
    expect(guardTitle('Mom&#39;s Necklace &amp; Ring Set')).toBe("Mom's Necklace & Ring Set");
    expect(guardTitle(['Gold', 'Name', 'Necklace'])).toBe('Gold Name Necklace');
    expect(guardTitle('a b c d e f g h')).toBe('');
    expect(guardTitle('x'.repeat(141))).toBe('');
    expect(guardTitle({ nope: 1 })).toBe('');
  });

  it('guards tags: drops title-word overlap and too-long tags', () => {
    expect(guardTags(['baby blanket', 'nursery decor', 'this tag is way too long for etsy'], 'Personalized Baby Blanket'))
      .toEqual(['nursery decor']);
    expect(guardTags('garbage', '')).toEqual(['garbage']);
    expect(guardTags(null, '')).toEqual([]);
  });

  it('resolveRow: improved / unchanged / unusable, tags checked against the new title, read-only skipped', () => {
    const keys = { title: 'title', tags: 'tags' };
    const row: BulkAiRow = { rowId: 'a', listingId: 1, title: 'Old', tags: ['x'] };
    const all = () => true;
    const r1 = resolveRow(row, { title: GOOD_TITLE, tags: ['baby blanket', 'boho decor'] }, ['title', 'tags'], keys, all);
    expect(r1.outcome).toBe('improved');
    expect(r1.patches).toEqual([
      { rowId: 'a', field: 'title', value: GOOD_TITLE },
      { rowId: 'a', field: 'tags', value: ['boho decor'] },
    ]);
    expect(resolveRow({ ...row, title: GOOD_TITLE }, { title: GOOD_TITLE }, ['title'], keys, all).outcome).toBe('unchanged');
    expect(resolveRow(row, { title: '???? ####' }, ['title'], keys, all).outcome).toBe('unusable');
    expect(resolveRow(row, undefined, ['title'], keys, all).outcome).toBe('unusable');
    const ro = resolveRow(row, { title: GOOD_TITLE }, ['title'], keys, (_r, f) => f !== 'title');
    expect(ro).toEqual({ patches: [], outcome: 'unchanged', skippedCells: 1 });
    // A field the seller did not ask for is never written, even if the model returns it.
    expect(resolveRow(row, { title: GOOD_TITLE, tags: GOOD_TAGS }, ['tags'], keys, all).patches.map((p) => p.field)).toEqual(['tags']);
  });

  it('maps errors to i18n keys and never shows raw text', () => {
    expect(errorKeyFor(429, { code: 'rate_limited', error: 'Çok fazla' })).toBe('etsy.aiErrors.rate_limited');
    expect(errorKeyFor(500, { code: 'ai_not_configured' })).toBe('etsy.aiErrors.ai_not_configured');
    expect(errorKeyFor(500, { error: 'boom' })).toBe('bulk.ai.failed');
    expect(errorKeyFor(402, {})).toBeNull();
  });
});

// ── Hook ─────────────────────────────────────────────────────────────────────────────────────────

describe('useBulkAi', () => {
  it('45 listings → 3 bulk_optimize calls, every result is an "ai" cell edit, nothing is staged or sent here', async () => {
    const { calls, fetcher } = makeFetch(okEcho);
    const { hook, edits } = setup({ fetcher });
    let summary: Awaited<ReturnType<typeof hook.result.current.start>> = null;
    await act(async () => { summary = await hook.result.current.start(rows(45)); });

    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.url).toBe('/api/ai/etsy');
      expect(c.method).toBe('POST');
      expect(c.body.action).toBe('bulk_optimize');
      expect(c.body.fields).toEqual(['title', 'tags']);
      expect(c.headers['x-kx-limit-ui']).toBe('inline');
      expect((c.body.listings as unknown[]).length).toBeLessThanOrEqual(20);
    }
    // Entities decoded before they reach the prompt.
    expect((calls[0].body.listings as Array<{ title: string }>)[0].title).toBe("Old title 0 mom's");
    expect(edits.every((e) => e.origin === 'ai')).toBe(true);
    const patches = edits.flatMap((e) => e.patches);
    expect(patches).toHaveLength(90);
    expect(summary).toMatchObject({ status: 'done', total: 45, processed: 45, improved: 45, unusable: 0, edits: 90 });
    // Unknown current value is never a proposal.
    expect(hook.result.current.isProposal('r0', 'title')).toBe(false);
    expect(hook.result.current.isProposal('r0', 'title', GOOD_TITLE)).toBe(true);
    expect(hook.result.current.isProposal('r0', 'title', GOOD_TITLE, true)).toBe(true);
    // Sent (no longer dirty): the value is live, nothing to revert → no marker.
    expect(hook.result.current.isProposal('r0', 'title', GOOD_TITLE, false)).toBe(false);
    // Seller typed over it → marker gone without extra wiring.
    expect(hook.result.current.isProposal('r0', 'title', 'Mine')).toBe(false);
    expect(hook.result.current.proposalCount).toBe(90);
    expect(hook.result.current.resultLabel).toBe('45 listings improved · not sent yet');
    // DoD: no sync / draft / marketplace mutation request.
    expect(calls.some((c) => /sync|etsy-drafts|clawd/.test(c.url))).toBe(false);
  });

  it('progress meta while running, cost label, labels', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetcher } = makeFetch(async (b) => { await gate; return okEcho(b); });
    const { hook } = setup({ fetcher, concurrency: 1 });
    let p!: Promise<unknown>;
    act(() => { p = hook.result.current.start(rows(12)); });
    expect(hook.result.current.running).toBe(true);
    expect(hook.result.current.metaLabel).toBe('Improving 0 / 12…');
    expect(hook.result.current.costLabel(12)).toBe('12 credits');
    expect(hook.result.current.costLabel(1)).toBe('1 credit');
    expect(hook.result.current.actionLabel).toBe('Improve with AI');
    // A second start while running does nothing.
    let second: unknown = 'x';
    await act(async () => { second = await hook.result.current.start(rows(2)); });
    expect(second).toBeNull();
    release();
    await act(async () => { await p; });
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.metaLabel).toBeNull();
  });

  it('garbled, over-long and missing results leave cells untouched and are counted', async () => {
    const { fetcher } = makeFetch((body) => {
      const ls = body.listings as Array<{ listing_id: number }>;
      return {
        status: 200,
        json: {
          optimized: [
            { listing_id: ls[0].listing_id, title: GOOD_TITLE },
            { listing_id: ls[1].listing_id, title: 'q w e r t y u i', tags: [] },
            { listing_id: ls[2].listing_id, title: 'y'.repeat(150) },
            { listing_id: 999999, title: GOOD_TITLE }, // not asked for: ignored
            // ls[3] missing
          ],
        },
      };
    });
    const { hook, edits } = setup({ fetcher });
    await act(async () => { await hook.result.current.start(rows(4), ['title']); });
    const patches = edits.flatMap((e) => e.patches);
    expect(patches).toEqual([{ rowId: 'r0', field: 'title', value: GOOD_TITLE }]);
    expect(hook.result.current.summary).toMatchObject({ improved: 1, unusable: 3 });
    expect(hook.result.current.resultLabel).toBe("1 listing improved · not sent yet · 3 listings didn't get a usable suggestion");
  });

  it('502 invalid_ai_response counts the chunk unusable and continues', async () => {
    const { calls, fetcher } = makeFetch((b, n) => (n === 1 ? { status: 502, json: { code: 'invalid_ai_response' } } : okEcho(b)));
    const { hook } = setup({ fetcher, concurrency: 1 });
    await act(async () => { await hook.result.current.start(rows(25)); });
    expect(calls).toHaveLength(2);
    expect(hook.result.current.summary).toMatchObject({ status: 'done', unusable: 20, improved: 5 });
  });

  it('402 stops the run inline: limited, no further requests, earlier edits kept', async () => {
    const { calls, fetcher } = makeFetch((b, n) => (n === 2 ? { status: 402, json: { error: 'Payment Required', limitType: 'aiCredit' } } : okEcho(b)));
    const { hook, edits } = setup({ fetcher, concurrency: 1 });
    await act(async () => { await hook.result.current.start(rows(60)); });
    expect(calls).toHaveLength(2);
    expect(edits.flatMap((e) => e.patches)).toHaveLength(40);
    expect(hook.result.current.status).toBe('limited');
    expect(hook.result.current.limited).toBe(true);
    expect(hook.result.current.limitLabel).toBe("You've used all AI credits on your plan");
  });

  it('429 stops with the translated reason', async () => {
    const { calls, fetcher } = makeFetch(() => ({ status: 429, json: { code: 'rate_limited', error: 'raw' } }));
    const { hook } = setup({ fetcher, concurrency: 1 });
    await act(async () => { await hook.result.current.start(rows(40)); });
    expect(calls).toHaveLength(1);
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.resultLabel).toBe(String((en as { etsy: { aiErrors: Record<string, string> } }).etsy.aiErrors.rate_limited));
  });

  it('cancel discards the in-flight response', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { calls, fetcher } = makeFetch(async (b) => { await gate; return okEcho(b); });
    const { hook, edits } = setup({ fetcher, concurrency: 1 });
    let p!: Promise<unknown>;
    act(() => { p = hook.result.current.start(rows(40)); });
    act(() => { hook.result.current.cancel(); });
    release();
    await act(async () => { await p; });
    expect(calls).toHaveLength(1);
    expect(edits).toHaveLength(0);
    expect(hook.result.current.status).toBe('cancelled');
    expect(hook.result.current.resultLabel).toBe('Stopped · 0 listings improved');
  });

  it('read-only cells (canEdit) are skipped; custom field keys are used', async () => {
    const { fetcher } = makeFetch(okEcho);
    const { hook, edits } = setup({ fetcher, fieldKeys: { tags: 'etsyTags' }, canEdit: (rowId) => rowId !== 'r1' });
    await act(async () => { await hook.result.current.start(rows(2)); });
    const patches = edits.flatMap((e) => e.patches);
    expect(patches.map((p) => `${p.rowId}:${p.field}`)).toEqual(['r0:title', 'r0:etsyTags']);
    expect(hook.result.current.summary?.skippedCells).toBe(2);
  });

  it('forget removes markers per cell and per row', async () => {
    const { fetcher } = makeFetch(okEcho);
    const { hook } = setup({ fetcher });
    await act(async () => { await hook.result.current.start(rows(2)); });
    act(() => { hook.result.current.forget([{ rowId: 'r0', field: 'title' }, { rowId: 'r1' }]); });
    expect(hook.result.current.isProposal('r0', 'title', GOOD_TITLE)).toBe(false);
    expect(hook.result.current.isProposal('r0', 'tags', GOOD_TAGS)).toBe(true);
    expect(hook.result.current.isProposal('r1', 'tags', GOOD_TAGS)).toBe(false);
    act(() => { hook.result.current.forgetAll(); });
    expect(hook.result.current.proposalCount).toBe(0);
  });

  it('a late answer never overwrites a cell the seller changed while the chunk was in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetcher } = makeFetch(async (b) => { await gate; return okEcho(b); });
    const current: Record<string, unknown> = {};
    const { hook, edits } = setup({ fetcher, getCurrent: (rowId, field) => current[`${rowId}:${field}`] });
    let p!: Promise<unknown>;
    act(() => { p = hook.result.current.start(rows(3)); });
    current['r1:title'] = 'Seller typed this';
    current['r2:tags'] = ['mine'];
    current['r0:title'] = "Old title 0 mom&#39;s"; // unchanged → still improved
    release();
    await act(async () => { await p; });
    const patches = edits.flatMap((e) => e.patches).map((x) => `${x.rowId}:${x.field}`);
    expect(patches).toEqual(['r0:title', 'r0:tags', 'r1:tags', 'r2:title']);
    expect(hook.result.current.summary?.skippedCells).toBe(2);
  });

  it('a stop (402) on one lane keeps the answer already in flight on the other lane', async () => {
    let releaseB!: () => void;
    const gateB = new Promise<void>((r) => { releaseB = r; });
    const { calls, fetcher } = makeFetch(async (b, n) => {
      if (n === 1) return { status: 402, json: {} };
      await gateB;
      return okEcho(b);
    });
    const { hook, edits } = setup({ fetcher, concurrency: 2 });
    let p!: Promise<unknown>;
    act(() => { p = hook.result.current.start(rows(60)); });
    await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
    releaseB();
    await act(async () => { await p; });
    expect(calls).toHaveLength(2);
    expect(edits.flatMap((e) => e.patches)).toHaveLength(40);
    expect(hook.result.current.summary).toMatchObject({ status: 'limited', processed: 20, improved: 20 });
  });

  it('an error stop still reports the AI edits waiting to be sent', async () => {
    const { fetcher } = makeFetch((b, n) => (n === 2 ? { status: 429, json: { code: 'rate_limited' } } : okEcho(b)));
    const { hook } = setup({ fetcher, concurrency: 1 });
    await act(async () => { await hook.result.current.start(rows(40)); });
    const reason = String((en as { etsy: { aiErrors: Record<string, string> } }).etsy.aiErrors.rate_limited);
    expect(hook.result.current.resultLabel).toBe(`${reason} · 20 listings improved · not sent yet`);
  });

  it('unsupported marketplace: no request', async () => {
    const { calls, fetcher } = makeFetch(okEcho);
    const { hook } = setup({ fetcher, marketplace: 'wix' });
    expect(hook.result.current.supported).toBe(false);
    await act(async () => { await hook.result.current.start(rows(3)); });
    expect(calls).toHaveLength(0);
  });

  it('Turkish copy', async () => {
    const { fetcher } = makeFetch(okEcho);
    const { hook } = setup({ fetcher }, 'tr');
    await act(async () => { await hook.result.current.start(rows(3)); });
    expect(hook.result.current.resultLabel).toBe('3 ilan iyileştirildi · henüz gönderilmedi');
    expect(hook.result.current.costLabel(12)).toBe('12 kredi');
  });
});

// ── Cell ─────────────────────────────────────────────────────────────────────────────────────────

describe('AiProposalCell', () => {
  it('marks only active cells, with screen-reader text in both locales', () => {
    render(
      <Providers locale="en">
        <AiProposalCell active data-testid="on">New title</AiProposalCell>
        <span data-testid="off-wrap"><AiProposalCell active={false}>Plain</AiProposalCell></span>
      </Providers>,
    );
    const on = screen.getByTestId('on');
    expect(on.querySelector('[data-ai-marker]')).not.toBeNull();
    expect(on.textContent).toContain('AI suggestion · Revert to keep yours');
    expect(screen.getByTestId('off-wrap').querySelector('[data-ai-proposal]')).toBeNull();
    cleanup();
    render(<Providers locale="tr"><AiProposalCell active data-testid="on">X</AiProposalCell></Providers>);
    expect(screen.getByTestId('on').textContent).toContain('AI önerisi');
  });

  it('withAiMarker shows the marker inside BulkGrid for an overlay (draft) value, only while dirty', () => {
    type R = { id: string; title: string };
    const base: GridColumn<R> = { key: 'title', header: 'Title', field: 'title', type: 'text-edit', width: 320 };
    const isProposal = (rowId: string, field: string, v?: unknown, dirty?: boolean) =>
      dirty !== false && field === 'title' && v === GOOD_TITLE && rowId !== 'z';
    const grid = (dirty: Set<string>) => {
      const col = withAiMarker(base, { isProposal, getRowId: (r: R) => r.id, isDirty: (id, f) => dirty.has(`${id}:${f}`) });
      const messages = mergeMessages(mergeMessages(m1dMessages('en'), m7aEn as never), D_EN);
      return (
        <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
          <ThemeProvider theme={theme}>
          <FormatProvider timeZone="Europe/Istanbul">
            <BulkGrid<R>
              rows={[{ id: 'a', title: 'Old' }, { id: 'b', title: 'Live' }]}
              getRowId={(r) => r.id}
              columns={[col]}
              values={{ a: { title: GOOD_TITLE } }}
              dirty={dirty}
              invalid={new Map()}
              onCellsChange={() => {}}
              onRevert={() => {}}
              selection={{ ids: [], onChange: () => {} }}
              columnStateKey="test.d.ai"
              ariaLabel="Bulk edit"
              sourceLabel="Etsy"
            />
          </FormatProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      );
    };
    const view = render(grid(new Set(['a:title'])));
    const markers = view.container.querySelectorAll('[data-ai-marker]');
    expect(markers).toHaveLength(1);
    expect(view.container.textContent).toContain(GOOD_TITLE);
    expect(view.container.textContent).toContain('AI suggestion · Revert to keep yours');
    expect(view.container.textContent).toContain('Live');
    // After send: same value, no longer dirty → no marker.
    view.rerender(grid(new Set()));
    expect(view.container.querySelectorAll('[data-ai-marker]')).toHaveLength(0);
    expect(view.container.textContent).toContain(GOOD_TITLE);
  });
});

describe('i18n fragment', () => {
  it('every key has EN and TR', () => {
    const keys = flatKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.namespace).toBe('bulk');
      expect(k.en).not.toBe('');
      expect(k.tr).not.toBe('');
    }
  });
});
