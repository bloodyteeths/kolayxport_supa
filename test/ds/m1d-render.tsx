// Render helpers for the M1-d tests: NextIntlClientProvider (EN or TR) + FormatProvider + DS theme.
// Messages = current messages/<locale>.json + M1-a keys (status.*, ds.shipBy) + the M1-d keys, so the
// components are checked against exactly the keys the integrator will merge.
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { m1aMessages } from './m1a-i18n';
import { m1dEn, m1dTr } from './m1d-messages';
import { M1C_EN, M1C_TR } from './m1c-messages';

export type TestLocale = 'en' | 'tr';
type Tree = Record<string, unknown>;

function isObj(v: unknown): v is Tree {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(...trees: Tree[]): Tree {
  const out: Tree = {};
  for (const t of trees) {
    for (const [k, v] of Object.entries(t)) {
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Tree, v) : isObj(v) ? deepMerge(v) : v;
    }
  }
  return out;
}

export function m1dMessages(locale: TestLocale): Tree {
  return deepMerge(
    (locale === 'en' ? en : tr) as unknown as Tree,
    m1aMessages(locale) as unknown as Tree,
    // M1-c overlay keys: DataTable's ⋯ (OverflowMenu) and Chart's table Modal render M1-c primitives.
    (locale === 'en' ? M1C_EN : M1C_TR) as unknown as Tree,
    (locale === 'en' ? m1dEn : m1dTr) as unknown as Tree,
  );
}

/** Missing messages / format errors raised while rendering (asserted empty by the tests). */
export const intlErrors: string[] = [];
const onError = (e: IntlError) => { intlErrors.push(`${e.code}: ${e.message}`); };

export function Providers({ locale, children }: { locale: TestLocale; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={m1dMessages(locale)} timeZone="Europe/Istanbul" onError={onError}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>
  );
}

export function withIntl(ui: ReactElement, locale: TestLocale) {
  return <Providers locale={locale}>{ui}</Providers>;
}

/** Static HTML with NBSP / narrow NBSP / thin spaces normalised to plain spaces. */
export function html(ui: ReactElement, locale: TestLocale): string {
  return renderToStaticMarkup(withIntl(ui, locale)).replace(/[   ]/g, ' ');
}

/** Visible text only (tags and style blocks stripped, entities decoded). */
export function text(ui: ReactElement, locale: TestLocale): string {
  return html(ui, locale)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export const LOCALES: TestLocale[] = ['en', 'tr'];
