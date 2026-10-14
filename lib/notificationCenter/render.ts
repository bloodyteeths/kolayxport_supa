/**
 * Server-side rendering of notification texts for email / telegram (owner W5).
 *
 * Messages = messages/{en,tr}.json merged in memory with
 * messages/fragments/notificationCenter.{en,tr}.json (read from disk at
 * runtime, best effort), so new types render before AND after the deferred
 * fragment merge:
 *   title: notifications.<titleKey>            (merged location)
 *       -> notificationCenter.<titleKey>       (fragment location)
 *       -> notifications.fallback
 * Locale: NotificationSettings.locale ('tr' | 'en'); null = bilingual TR + EN.
 */
import fs from 'fs';
import path from 'path';
import { createTranslator } from 'next-intl';
import enMessages from '@/messages/en.json';
import trMessages from '@/messages/tr.json';
import { hasRequiredParams, typeFromTitleKey } from './params';

export type RenderLocale = 'tr' | 'en';
type Json = Record<string, unknown>;

export const APP_ORIGIN = 'https://kolayxport.com';
export const PREFERENCES_PATH = '/app/bildirimler?tab=preferences';

const BASE: Record<RenderLocale, Json> = { en: enMessages as Json, tr: trMessages as Json };
let fragmentCache: Partial<Record<RenderLocale, Json>> = {};
let fragmentLoadedAt = 0;

function readFragment(locale: RenderLocale): Json {
  try {
    const file = path.join(process.cwd(), 'messages', 'fragments', `notificationCenter.${locale}.json`);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

/** Test hook: inject fragments instead of reading disk. */
export function __setFragmentsForTest(f: Partial<Record<RenderLocale, Json>> | null) {
  fragmentCache = f || {};
  fragmentLoadedAt = f ? Number.MAX_SAFE_INTEGER : 0;
}

function fragments(locale: RenderLocale): Json {
  if (Date.now() - fragmentLoadedAt > 10 * 60_000) {
    fragmentCache = { en: readFragment('en'), tr: readFragment('tr') };
    fragmentLoadedAt = Date.now();
  }
  return fragmentCache[locale] || {};
}

function getPath(root: unknown, dotted: string): unknown {
  let node: unknown = root;
  for (const part of dotted.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Json)[part];
  }
  return node;
}

/** Look a message template up in base messages first, then the fragment. */
export function lookupMessage(locale: RenderLocale, dotted: string): string | null {
  const a = getPath(BASE[locale], dotted);
  if (typeof a === 'string') return a;
  const b = getPath(fragments(locale), dotted);
  return typeof b === 'string' ? b : null;
}

function format(locale: RenderLocale, template: string, params: Record<string, string | number>): string | null {
  try {
    let failed = false;
    const t = createTranslator({
      locale,
      messages: { m: template } as any,
      timeZone: 'Europe/Istanbul',
      onError: () => {
        failed = true;
      },
    }) as any;
    const out = t('m', params);
    return failed || typeof out !== 'string' ? null : out;
  } catch {
    return null;
  }
}

/** Generic UI string from the notificationCenter namespace (fragment or merged). */
export function centerText(locale: RenderLocale, key: string, params: Record<string, string | number> = {}): string {
  const tpl = lookupMessage(locale, `notificationCenter.${key}`);
  return (tpl && format(locale, tpl, params)) || key;
}

export interface RenderableNotification {
  type: string;
  titleKey: string;
  params?: unknown;
  link?: string | null;
}

function cleanParams(raw: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Json)) {
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/** One-line title in one locale. Never throws. */
export function renderTitle(n: RenderableNotification, locale: RenderLocale): string {
  const params = cleanParams(n.params);
  const typeName = typeFromTitleKey(n.titleKey, n.type);
  const fallback = lookupMessage(locale, 'notifications.fallback') || 'KolayXport';
  if (!hasRequiredParams(typeName, params)) return fallback;
  const tpl =
    lookupMessage(locale, `notifications.${n.titleKey}`) ?? lookupMessage(locale, `notificationCenter.${n.titleKey}`);
  if (!tpl) return fallback;
  return format(locale, tpl, params) || fallback;
}

export function absoluteLink(link: string | null | undefined): string | null {
  if (typeof link !== 'string') return null;
  const s = link.trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  return `${APP_ORIGIN}${s}`;
}

function localesFor(locale: string | null | undefined): RenderLocale[] {
  return locale === 'en' ? ['en'] : locale === 'tr' ? ['tr'] : ['tr', 'en'];
}

export interface RenderedEmail {
  subject: string;
  textBody: string;
}

/** Instant email for one notification. Bilingual (TR then EN) when locale is null. */
export function renderNotificationEmail(n: RenderableNotification, locale: string | null | undefined): RenderedEmail {
  const locales = localesFor(locale);
  const titles = locales.map((l) => renderTitle(n, l));
  const subject = `KolayXport: ${titles[0]}`.slice(0, 200);
  const url = absoluteLink(n.link);
  const blocks = locales.map((l, i) => {
    const lines = [titles[i]];
    if (url) lines.push('', `${centerText(l, 'email.open')}: ${url}`);
    return lines.join('\n');
  });
  const footer = locales
    .map((l) => `${centerText(l, 'email.footer')}: ${APP_ORIGIN}${PREFERENCES_PATH}`)
    .join('\n');
  return { subject, textBody: `${blocks.join('\n\n— — —\n\n')}\n\n${footer}\n` };
}

/** Daily digest email for a list of notifications. */
export function renderDigestEmail(
  items: RenderableNotification[],
  locale: string | null | undefined,
  opts: { moreCount?: number } = {},
): RenderedEmail {
  const locales = localesFor(locale);
  const count = items.length + (opts.moreCount || 0);
  const subject = `KolayXport: ${centerText(locales[0], 'email.digestSubject', { count })}`.slice(0, 200);
  const blocks = locales.map((l) => {
    const lines = [centerText(l, 'email.digestIntro', { count }), ''];
    for (const n of items) {
      const url = absoluteLink(n.link);
      lines.push(`• ${renderTitle(n, l)}${url ? `\n  ${url}` : ''}`);
    }
    if (opts.moreCount) lines.push('', centerText(l, 'email.digestMore', { count: opts.moreCount }));
    return lines.join('\n');
  });
  const footer = locales
    .map((l) => `${centerText(l, 'email.footer')}: ${APP_ORIGIN}${PREFERENCES_PATH}`)
    .join('\n');
  return { subject, textBody: `${blocks.join('\n\n— — —\n\n')}\n\n${footer}\n` };
}
