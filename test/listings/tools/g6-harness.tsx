// Shared test harness for the G6 tool panels: providers (EN/TR with the G6 keys merged), a mock StagingAdapter,
// a ListingsToolContext builder and a ListingRow fixture.
import React from 'react';
import { vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import type { ListingRow, StagingAdapter } from '@/lib/listings/types';
import type { ListingsToolContext } from '@/components/domain/listings/tools/ToolsMenuItems';
import { G6_EN, G6_TR } from './g6-messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}

export const MESSAGES = { en: deepMerge(en as Obj, G6_EN as unknown as Obj), tr: deepMerge(tr as Obj, G6_TR as unknown as Obj) };
export type Locale = keyof typeof MESSAGES;
export const L = (locale: Locale) => (MESSAGES[locale] as unknown as typeof G6_EN).listings;

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
}

export function mockAdapter(overrides: Partial<StagingAdapter> = {}) {
  return {
    stage: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    send: vi.fn(async (ids: string[]) => ({ sent: ids, failed: [], conflicts: [] })),
    schedule: vi.fn(async () => undefined),
    ...overrides,
  } satisfies StagingAdapter;
}

export function makeCtx(over: Partial<ListingsToolContext> = {}): ListingsToolContext {
  return {
    marketplace: 'etsy',
    store: { id: 'shop1', name: 'BelleCoutureGifts', currency: 'USD' },
    query: { marketplace: 'etsy', store: 'shop1', status: ['active'] },
    viewCount: 3,
    allCount: 5,
    selectedIds: [],
    adapter: mockAdapter(),
    editorHref: (id) => `/app/etsy-listings/${id}`,
    onChanged: vi.fn(),
    ...over,
  };
}

export function row(over: Partial<ListingRow> & { id: string }): ListingRow {
  return {
    title: `Listing ${over.id}`,
    metaLine: [`ID ${over.id}`],
    thumbUrl: null,
    price: { amount: 40, currency: 'USD' },
    qty: 3,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: 72, used: 9, total: 12, fails: [] },
    updatedAt: '2026-10-14T10:00:00Z',
    createdAt: '2026-01-01T10:00:00Z',
    extra: {},
    externalUrl: null,
    sync: null,
    ...over,
  };
}

/** Routes `fetch` by URL prefix; records every URL. */
export function routeFetch(routes: Record<string, (url: string) => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k));
    return key ? routes[key](url) : new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}
