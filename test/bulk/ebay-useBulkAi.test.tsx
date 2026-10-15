// @vitest-environment jsdom
// eBay lane of "Improve with AI" (legacy EbayListingsLegacy handleAIBulkOptimize): POST
// /api/clawd/ebay-ai?action=bulk_optimize_titles, ≤ 10 listings per request, title only, 80-char guard. Suggestions
// become 'ai' cell edits (staged by the grid), never a live write.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import {
  BULK_AI_MARKETPLACE_FIELDS,
  bulkAiSupported,
  chunkRows,
  ebayAiItems,
  guardEbayTitle,
  resolveRow,
  useBulkAi,
  type BulkAiPatch,
  type BulkAiRow,
} from '@/components/domain/bulk/useBulkAi';

afterEach(() => cleanup());

const GOOD = 'Vintage Brass Table Lamp Mid Century Desk Light Gold Finish 14 in';

function rows(n: number): BulkAiRow[] {
  return Array.from({ length: n }, (_, i) => ({ rowId: `SKU-${i}`, listingId: `SKU-${i}`, title: `old lamp ${i} &amp; shade`, tags: [], category: 'Lamps' }));
}

function makeFetch(respond: (body: { listings: Array<{ id: string; title: string; categoryName?: string }> }) => { status: number; json: unknown }) {
  const calls: Array<{ url: string; body: { listings: Array<{ id: string; title: string; categoryName?: string }> } }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, body });
    const r = respond(body);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

function setup(fetcher: typeof fetch) {
  const edits: BulkAiPatch[][] = [];
  const hook = renderHook(() => useBulkAi({ marketplace: 'ebay', fetcher, onCellsChange: (p) => void edits.push(p) }), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={en as never} timeZone="Europe/Istanbul" onError={() => undefined}>
        {children}
      </NextIntlClientProvider>
    ),
  });
  return { hook, edits };
}

describe('eBay bulk AI: pure', () => {
  it('is supported, title only, chunks of 10', () => {
    expect(bulkAiSupported('ebay')).toBe(true);
    expect(BULK_AI_MARKETPLACE_FIELDS.ebay).toEqual(['title']);
    expect(chunkRows(rows(23), 20, 10).map((c) => c.length)).toEqual([10, 10, 3]);
  });

  it('guards eBay titles: decoded, ≤ 80, not garbled, no Etsy house style', () => {
    expect(guardEbayTitle('Lamp &amp; Shade - Brass | Gold')).toBe('Lamp & Shade - Brass | Gold');
    expect(guardEbayTitle('x'.repeat(81))).toBe('');
    expect(guardEbayTitle('a b c d e f g')).toBe('');
    expect(guardEbayTitle(null)).toBe('');
  });

  it('reads { results: [{ id, optimized }] } and ignores anything else', () => {
    expect(ebayAiItems({ results: [{ id: 'A', optimized: GOOD }, { optimized: 'no id' }, null] })).toEqual([{ listing_id: 'A', title: GOOD }]);
    expect(ebayAiItems({ optimized: [] })).toEqual([]);
    expect(ebayAiItems('garbage')).toEqual([]);
  });

  it('resolveRow uses the eBay guard', () => {
    const row: BulkAiRow = { rowId: 'A', listingId: 'A', title: 'old', tags: [] };
    const keys = { title: 'title', tags: 'tags' };
    const r = resolveRow(row, { title: 'Brass Lamp - Gold' }, ['title'], keys, () => true, guardEbayTitle);
    expect(r.patches).toEqual([{ rowId: 'A', field: 'title', value: 'Brass Lamp - Gold' }]);
    expect(resolveRow(row, { title: 'x'.repeat(90) }, ['title'], keys, () => true, guardEbayTitle).outcome).toBe('unusable');
  });
});

describe('eBay bulk AI: hook', () => {
  it('posts bulk_optimize_titles in chunks of 10 and stages titles as ai cell edits', async () => {
    const { calls, fetcher } = makeFetch((b) => ({ status: 200, json: { results: b.listings.map((l) => ({ id: l.id, original: l.title, optimized: GOOD })) } }));
    const { hook, edits } = setup(fetcher);
    let summary: Awaited<ReturnType<typeof hook.result.current.start>> = null;
    await act(async () => {
      summary = await hook.result.current.start(rows(12), ['title', 'tags']);
    });
    expect(calls.map((c) => c.url)).toEqual(['/api/clawd/ebay-ai?action=bulk_optimize_titles', '/api/clawd/ebay-ai?action=bulk_optimize_titles']);
    expect(calls.map((c) => c.body.listings.length).sort()).toEqual([10, 2]);
    expect(calls[0].body.listings[0]).toEqual({ id: 'SKU-0', title: 'old lamp 0 & shade', categoryName: 'Lamps' });
    const patches = edits.flat();
    expect(patches).toHaveLength(12);
    expect(patches.every((p) => p.field === 'title' && p.value === GOOD)).toBe(true);
    expect(summary).toMatchObject({ status: 'done', improved: 12, unusable: 0 });
  });

  it('a server error counts the chunk as failed and writes nothing', async () => {
    const { fetcher } = makeFetch(() => ({ status: 500, json: { error: 'AI islemi basarisiz oldu' } }));
    const { hook, edits } = setup(fetcher);
    let summary: Awaited<ReturnType<typeof hook.result.current.start>> = null;
    await act(async () => {
      summary = await hook.result.current.start(rows(3));
    });
    expect(edits).toHaveLength(0);
    expect(summary).toMatchObject({ failed: 3, errorKey: 'bulk.ai.failed' });
  });
});
