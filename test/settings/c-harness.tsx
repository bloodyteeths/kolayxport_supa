// test/settings/c-harness.tsx — render helpers for the settings group C tests (EN/TR, DS theme, strict i18n,
// isolated SWR cache).
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import { ConfirmProvider } from '@/components/ds/overlay';
import { withGroupC } from './c-messages';

export type Locale = 'en' | 'tr';
export const LOCALES: Locale[] = ['en', 'tr'];

export const intlErrors: string[] = [];
const onError = (e: IntlError) => { intlErrors.push(`${e.code}: ${e.message}`); };

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={withGroupC(locale) as never} timeZone="Europe/Istanbul" onError={onError}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
            <ConfirmProvider>{children}</ConfirmProvider>
          </SWRConfig>
        </ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>
  );
}

export function renderC(ui: ReactElement, locale: Locale = 'en'): RenderResult {
  return render(<Providers locale={locale}>{ui}</Providers>);
}
