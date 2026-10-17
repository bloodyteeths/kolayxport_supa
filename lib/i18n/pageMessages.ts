// Server-only (getStaticProps): the message namespaces a public page needs, so its HTML renders fully
// on the server while the browser downloads ~30 KB of strings instead of the whole UI dictionary.
import tr from '@/messages/tr.json';
import en from '@/messages/en.json';

const ALL = { tr, en } as const;

/** Namespaces used by the marketing layout and the global components mounted in _app. */
export const SITE_NAMESPACES = ['site', 'common', 'ui', 'subscription', 'ds', 'errors'];

/** Pick top-level ("site") or nested ("marketing.pricingV2") namespaces. */
export function pickMessages(locale: 'tr' | 'en', namespaces: string[]): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const ns of namespaces) {
    const parts = ns.split('.');
    let src: any = ALL[locale];
    for (const p of parts) src = src?.[p];
    if (src === undefined) continue;
    let dst = out;
    parts.slice(0, -1).forEach((p) => { dst[p] = dst[p] || {}; dst = dst[p]; });
    dst[parts[parts.length - 1]] = src;
  }
  return out;
}

/** Props every marketing page returns: its fixed locale + the strings it needs. */
export function siteMessageProps(locale: 'tr' | 'en', extra: string[] = []) {
  return { siteLocale: locale, messages: pickMessages(locale, [...SITE_NAMESPACES, ...extra]), messagesLocale: locale };
}
