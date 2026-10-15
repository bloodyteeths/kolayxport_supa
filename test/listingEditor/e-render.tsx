// Render helpers for the M6 Group E tests: messages/<locale>.json + the Group E `listingEditor.*` keys,
// NextIntlClientProvider + FormatProvider + DS theme. Missing keys / format errors are collected in `intlErrors`.
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { eEn, eTr } from './e-messages';

export type TestLocale = 'en' | 'tr';
type Tree = Record<string, unknown>;

const isObj = (v: unknown): v is Tree => !!v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(...trees: Tree[]): Tree {
  const out: Tree = {};
  for (const t of trees) {
    for (const [k, v] of Object.entries(t)) {
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Tree, v) : isObj(v) ? deepMerge(v) : v;
    }
  }
  return out;
}

export function eMessages(locale: TestLocale): Tree {
  return deepMerge((locale === 'en' ? en : tr) as unknown as Tree, (locale === 'en' ? eEn : eTr) as unknown as Tree);
}

export const intlErrors: string[] = [];
const onError = (e: IntlError) => { intlErrors.push(`${e.code}: ${e.message}`); };

export function Providers({ locale, children }: { locale: TestLocale; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={eMessages(locale)} timeZone="Europe/Istanbul" onError={onError}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>
  );
}

export function html(ui: ReactElement, locale: TestLocale): string {
  return renderToStaticMarkup(<Providers locale={locale}>{ui}</Providers>).replace(/[   ]/g, ' ');
}

export function text(ui: ReactElement, locale: TestLocale): string {
  return html(ui, locale)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export const LOCALES: TestLocale[] = ['en', 'tr'];
