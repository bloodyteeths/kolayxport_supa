// Full UI messages, loaded per locale on demand (one ~750 KB JSON each). Kept out of the shared
// _app bundle so marketing pages ship only the namespaces they use (lib/i18n/pageMessages.ts).
type Messages = Record<string, unknown>;
const cache: Partial<Record<'tr' | 'en', Messages>> = {};

export function cachedMessages(locale: 'tr' | 'en'): Messages | null {
  return cache[locale] ?? null;
}

export async function loadMessages(locale: 'tr' | 'en'): Promise<Messages> {
  if (cache[locale]) return cache[locale]!;
  const mod = locale === 'en'
    ? await import(/* webpackChunkName: "messages-en" */ '@/messages/en.json')
    : await import(/* webpackChunkName: "messages-tr" */ '@/messages/tr.json');
  cache[locale] = ((mod as { default?: Messages }).default ?? mod) as Messages;
  return cache[locale]!;
}
