// Render helpers for the group C (desktop chrome) tests (jsdom).
import * as React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import enMessages from '../../../messages/en.json';
import trMessages from '../../../messages/tr.json';
import { desktopMessagesEn, desktopMessagesTr } from './desktop-messages';
import { buildNavModel, type BuildNavModelInput, type NavModel } from '@/lib/nav/useNavModel';
import type { ConnectionsMap } from '@/lib/hooks/useConnections';

type Dict = Record<string, unknown>;
function deepMerge(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && b && typeof b === 'object' ? deepMerge(b as Dict, v as Dict) : v;
  }
  return out;
}

export const MESSAGES = {
  en: deepMerge(enMessages as unknown as Dict, desktopMessagesEn as unknown as Dict),
  tr: deepMerge(trMessages as unknown as Dict, desktopMessagesTr as unknown as Dict),
};

/** Translator over the fixture (for `buildNavModel` in tests). */
export function fixtureT(locale: 'en' | 'tr'): BuildNavModelInput['t'] {
  return (key, values) => {
    let node: unknown = MESSAGES[locale];
    for (const part of key.split('.')) node = (node as Dict | undefined)?.[part];
    let s = typeof node === 'string' ? node : key;
    // enough ICU for the fixture: `{count, plural, … other {# x}}` → "N x", `{name}` → value
    s = s.replace(/\{(\w+), plural,[^{]*\{[^}]*\}\s*other \{([^}]*)\}\}/g, (_m, v: string, other: string) =>
      other.replace('#', String(values?.[v] ?? '')),
    );
    return s.replace(/\{(\w+)\}/g, (_m, v: string) => String(values?.[v] ?? `{${v}}`));
  };
}

export type Viewport = 'wide' | 'narrow' | 'mobile';
const WIDTH: Record<Viewport, number> = { wide: 1440, narrow: 1024, mobile: 390 };

/** jsdom has no matchMedia: answer width queries against a fake width; `pointer: coarse` is false. */
export function setViewport(v: Viewport) {
  const width = WIDTH[v];
  const matches = (q: string) => {
    if (/pointer:\s*coarse/.test(q)) return false;
    if (/prefers-reduced-motion/.test(q)) return true;
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    if (max && width > Number(max[1])) return false;
    if (min && width < Number(min[1])) return false;
    return Boolean(max || min);
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

export function Providers({ locale, children }: { locale: 'en' | 'tr'; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={() => {}}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

export function renderShell(ui: React.ReactElement, opts: { locale?: 'en' | 'tr'; viewport?: Viewport } = {}): RenderResult {
  setViewport(opts.viewport ?? 'wide');
  const locale = opts.locale ?? 'en';
  const Wrapper = ({ children }: { children: React.ReactNode }) => <Providers locale={locale}>{children}</Providers>;
  return render(ui, { wrapper: Wrapper });
}

export function connsOf(connected: string[], reauth: string[] = []): ConnectionsMap {
  const map = {} as ConnectionsMap;
  for (const p of ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo'] as const) {
    map[p] = { connected: connected.includes(p), accounts: [], needsReauth: reauth.includes(p) };
  }
  return map;
}

/** A realistic model: Etsy + Trendyol connected, Trendyol needs reauth, 12 to ship (1 overdue), 7 Etsy drafts. */
export function sampleModel(path = '/app/etsy-listings', locale: 'en' | 'tr' = 'en', extra: Partial<BuildNavModelInput> = {}): NavModel {
  return buildNavModel({
    t: fixtureT(locale),
    path,
    connections: connsOf(['etsy', 'trendyol'], ['trendyol']),
    counts: { orders: { toShip: 12, overdue: 1 }, drafts: { etsy: 7, ebay: 0 } },
    messagesUnread: 3,
    billingProvider: 'stripe',
    ...extra,
  });
}
