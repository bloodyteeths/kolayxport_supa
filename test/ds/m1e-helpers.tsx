// Shared render helpers for the M1-e tests (jsdom).
import * as React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { m1bInputs } from './m1b-messages';
import { m1eMessagesEn, m1eMessagesTr } from './m1e-messages';
import enMessages from '../../messages/en.json';
import trMessages from '../../messages/tr.json';

// Base = the merged messages/*.json (page primitives now render the shared overlay ⋯ menu and action bar,
// which read `ds.overlay.*`); the M1-e fixture and M1-b's preset labels (`ds.inputs.dateRange.preset.*`)
// are layered on top so the tests keep pinning their own strings.
const REAL = { en: enMessages, tr: trMessages } as const;
const withInputs = (msgs: typeof m1eMessagesEn | typeof m1eMessagesTr, locale: 'en' | 'tr') => {
  const real = REAL[locale] as unknown as { ds: Record<string, unknown> } & Record<string, unknown>;
  const realInputs = (real.ds.inputs ?? {}) as Record<string, unknown>;
  return {
    ...real,
    ds: {
      ...real.ds,
      ...msgs.ds,
      inputs: { ...realInputs, dateRange: (m1bInputs[locale] as Record<string, unknown>).dateRange },
    },
  };
};
const MESSAGES = { en: withInputs(m1eMessagesEn, 'en'), tr: withInputs(m1eMessagesTr, 'tr') };

export type Viewport = 'desktop' | 'narrow' | 'mobile';
const WIDTH: Record<Viewport, number> = { desktop: 1440, narrow: 1024, mobile: 390 };

/** jsdom has no matchMedia: answer `(max-width:Npx)` / `(min-width:Npx)` against a fake width. */
export function setViewport(v: Viewport) {
  const width = WIDTH[v];
  const matches = (q: string) => {
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
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul">
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

export function renderDs(ui: React.ReactElement, opts: { locale?: 'en' | 'tr'; viewport?: Viewport } = {}): RenderResult {
  setViewport(opts.viewport ?? 'desktop');
  const locale = opts.locale ?? 'en';
  const Wrapper = ({ children }: { children: React.ReactNode }) => <Providers locale={locale}>{children}</Providers>;
  return render(ui, { wrapper: Wrapper });
}

export const LOCALES = ['en', 'tr'] as const;

/**
 * True when an emotion class on `el` has a `@media (pointer: coarse)` rule (on the element or its
 * `::after` hit area) that sets a 44px size (DS §1 P3 / §2.4).
 */
export function hasCoarse44(el: Element): boolean {
  const css = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  const classes = Array.from(el.classList).filter((c) => c.startsWith('css-'));
  return classes.some((c) => new RegExp(`@media \\(pointer: ?coarse\\)\\{[^@]*?\\.${c}(::after)?\\{[^}]*44px`).test(css));
}
