// test/settings/b-harness.tsx — render helpers for settings Group B (Connections + Carriers & API keys):
// EN/TR with the Group B strings layered over messages/*.json, DS theme, strict i18n error capture,
// isolated SWR cache, DS confirm provider.
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import { ConfirmProvider } from '@/components/ds/overlay';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';
import { settingsBEn, settingsBTr } from './b-messages';

export type Locale = 'en' | 'tr';
export const LOCALES: Locale[] = ['en', 'tr'];

type Tree = { [k: string]: unknown };
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
      ? merge(a[k] as Tree, v as Tree)
      : v;
  }
  return out;
}

// Group D's `billing.planName.*` (settings §15.2), used by the store-limit copy; test-only here.
const PLAN_NAMES = {
  en: { trial: 'Free trial', starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise', shopify_free: 'Shopify plan', none: 'No plan' },
  tr: { trial: 'Ücretsiz deneme', starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise', shopify_free: 'Shopify planı', none: 'Plan yok' },
};

export function messagesB(locale: Locale): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  const withSettings = merge(base, { settings: merge((base.settings as Tree) ?? {}, (locale === 'en' ? settingsBEn : settingsBTr) as unknown as Tree) });
  const billing = (withSettings.billing as Tree | undefined) ?? {};
  return merge(withSettings, { billing: merge({ planName: PLAN_NAMES[locale] }, billing) });
}

export const intlErrors: string[] = [];
const onError = (e: IntlError) => { intlErrors.push(`${e.code}: ${e.message}`); };

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={messagesB(locale) as never} timeZone="Europe/Istanbul" onError={onError}>
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

export function renderB(ui: ReactElement, locale: Locale = 'en'): RenderResult {
  return render(<Providers locale={locale}>{ui}</Providers>);
}
