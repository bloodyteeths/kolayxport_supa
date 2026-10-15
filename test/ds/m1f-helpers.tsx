import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

export type Locale = 'en' | 'tr';
export const MESSAGES = { en, tr } as const;
export const LOCALES: Locale[] = ['en', 'tr'];

/** Renders `ui` inside NextIntlClientProvider with the real EN or TR messages. */
export function renderIntl(ui: React.ReactElement, locale: Locale): RenderResult {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone="Europe/Istanbul"
      // DS components read `ds.*` keys that the integrator merges after M1; a missing key must not fail a shim test.
      onError={() => undefined}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Reads a message by dotted path from the real catalogs, substituting simple `{name}` params. */
export function msg(locale: Locale, path: string, params: Record<string, string | number> = {}): string {
  const raw = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], MESSAGES[locale]);
  if (typeof raw !== 'string') throw new Error(`missing message ${locale}:${path}`);
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
