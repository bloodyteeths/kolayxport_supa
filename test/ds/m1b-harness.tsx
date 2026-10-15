// test/ds/m1b-harness.tsx — render helpers for the M1-b input tests (EN + TR, DS theme, strict i18n).
import type { ReactElement } from 'react';
import { render, cleanup, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { withM1b, type Locale } from './m1b-messages';

export const LOCALES: Locale[] = ['en', 'tr'];

/** Missing or malformed messages throw, so a render test fails on any absent EN/TR key. */
export function renderDs(ui: ReactElement, locale: Locale = 'en'): RenderResult {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={withM1b(locale) as never}
      timeZone="Europe/Istanbul"
      onError={(e) => { throw e; }}
    >
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </NextIntlClientProvider>,
  );
}

export { cleanup };
