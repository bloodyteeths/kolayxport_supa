// test/ds/m6s-harness.tsx — the M6 editor Group S strings (SectionNav + ImageGrid strip), returned to the integrator
// as newI18nKeys, and a render harness that layers them over messages/{en,tr}.json. Once the integrator merges the
// keys the overlay is a no-op.
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

export type Locale = 'en' | 'tr';
export const LOCALES: Locale[] = ['en', 'tr'];
type Tree = { [k: string]: string | Tree };

export const m6sKeys: Record<Locale, { sectionNav: Tree; images: Tree }> = {
  en: {
    sectionNav: {
      label: 'Sections',
      attention: '{label}, {count, plural, =0 {changes not sent} one {# change not sent} other {# changes not sent}}',
      danger: '{label}, {count, plural, =0 {needs a fix} one {# problem to fix} other {# problems to fix}}',
    },
    images: {
      video: 'Video',
      videoTile: 'Video. Open to play, replace or remove',
      addVideo: 'Add video',
      undoVideo: 'Undo removing the video',
    },
  },
  tr: {
    sectionNav: {
      label: 'Bölümler',
      attention: '{label}, {count, plural, =0 {gönderilmemiş değişiklikler var} other {# değişiklik gönderilmedi}}',
      danger: '{label}, {count, plural, =0 {düzeltilmesi gerekiyor} other {düzeltilecek # sorun}}',
    },
    images: {
      video: 'Video',
      videoTile: 'Video. Oynatmak, değiştirmek veya kaldırmak için açın',
      addVideo: 'Video ekle',
      undoVideo: 'Videonun kaldırılmasını geri al',
    },
  },
};

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = typeof v === 'string' ? v : merge((base[k] as Tree) ?? {}, v);
  }
  return out;
}

export function messagesFor(locale: Locale): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  const k = m6sKeys[locale];
  return merge(base, { ds: { page: { sectionNav: k.sectionNav }, inputs: { images: k.images } } });
}

/** Missing or malformed messages throw, so a render test fails on any absent EN/TR key. */
export function renderS(ui: ReactElement, locale: Locale = 'en'): RenderResult {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </NextIntlClientProvider>,
  );
}

/** `{ namespace: 'ds', key, en, tr }` rows for the integrator. */
export function flattenM6s(): { namespace: string; key: string; en: string; tr: string }[] {
  const rows: { namespace: string; key: string; en: string; tr: string }[] = [];
  const walk = (prefix: string, enNode: Tree, trNode: Tree) => {
    for (const [k, v] of Object.entries(enNode)) {
      if (typeof v === 'string') rows.push({ namespace: 'ds', key: `${prefix}.${k}`, en: v, tr: String(trNode[k] ?? '') });
      else walk(`${prefix}.${k}`, v, (trNode[k] as Tree) ?? {});
    }
  };
  walk('page.sectionNav', m6sKeys.en.sectionNav, m6sKeys.tr.sectionNav);
  walk('inputs.images', m6sKeys.en.images, m6sKeys.tr.images);
  return rows;
}
