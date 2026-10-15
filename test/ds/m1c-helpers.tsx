import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { M1C_EN, M1C_TR } from './m1c-messages';

export type Locale = 'en' | 'tr';
export const LOCALES: Locale[] = ['en', 'tr'];

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}

export const MESSAGES: Record<Locale, Obj> = {
  en: deepMerge(en as Obj, M1C_EN as unknown as Obj),
  tr: deepMerge(tr as Obj, M1C_TR as unknown as Obj),
};

/** Strict: a missing key fails the test (onError throws). */
export function wrap(ui: React.ReactElement, locale: Locale): React.ReactElement {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale] as never}
      timeZone="Europe/Istanbul"
      onError={(e) => {
        throw e;
      }}
    >
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

export function renderIntl(ui: React.ReactElement, locale: Locale): RenderResult {
  return render(wrap(ui, locale));
}

/** Message by dotted path with `{x}` params (no ICU, no rich tags). */
export function m(locale: Locale, path: string, params: Record<string, string | number> = {}): string {
  const raw = path.split('.').reduce<unknown>((o, k) => (o as Obj)?.[k], MESSAGES[locale]);
  if (typeof raw !== 'string') throw new Error(`missing message ${locale}:${path}`);
  return raw.replace(/<\/?b>/g, '').replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
