import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { FormatProvider } from '@/lib/format';
import { m1aMessages } from './m1a-i18n';

export type TestLocale = 'en' | 'tr';

export function withIntl(ui: ReactElement, locale: TestLocale, timeZone = 'Europe/Istanbul') {
  return (
    <NextIntlClientProvider locale={locale} messages={m1aMessages(locale)} timeZone={timeZone}>
      <FormatProvider timeZone={timeZone}>{ui}</FormatProvider>
    </NextIntlClientProvider>
  );
}

/** Static HTML, with NBSP / narrow NBSP / thin spaces normalised to plain spaces. */
export function html(ui: ReactElement, locale: TestLocale, timeZone?: string): string {
  return renderToStaticMarkup(withIntl(ui, locale, timeZone)).replace(/[\u00a0\u202f\u2009]/g, ' ');
}

/** Text content only. */
export function text(ui: ReactElement, locale: TestLocale, timeZone?: string): string {
  return html(ui, locale, timeZone)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
