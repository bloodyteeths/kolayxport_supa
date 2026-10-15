// Render harness for the group D / G-pro-2 component tests: next-intl (strict: a missing key throws) with
// messages/<locale>.json + the group D keys, FormatProvider, DS theme, an isolated SWR cache, and a fetch
// mock that answers the billing endpoints from a per-test route table.
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { dEn, dTr } from './d-messages';

export type Locale = 'en' | 'tr';
type Obj = Record<string, unknown>;

function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}

export const MESSAGES: Record<Locale, Obj> = {
  en: deepMerge(en as Obj, dEn as unknown as Obj),
  tr: deepMerge(tr as Obj, dTr as unknown as Obj),
};

export function renderD(ui: ReactElement, locale: Locale = 'en'): RenderResult {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, shouldRetryOnError: false }}>{ui}</SWRConfig>
        </ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>,
  );
}

export type Route = { status?: number; body?: unknown };
export type Routes = Record<string, Route | ((init?: RequestInit) => Route)>;

/** Installs a fetch mock; the longest matching path prefix wins. Returns the mock (calls = [url, init]). */
export function mockFetch(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const key = Object.keys(routes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    const r = key ? routes[key] : { status: 404, body: { error: 'not found' } };
    const route = typeof r === 'function' ? r(init) : r;
    const status = route.status ?? 200;
    return new Response(JSON.stringify(route.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

export const calledPaths = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.map((c) => String(typeof c[0] === 'string' ? c[0] : (c[0] as URL | Request) instanceof URL ? (c[0] as URL).href : (c[0] as Request).url));
