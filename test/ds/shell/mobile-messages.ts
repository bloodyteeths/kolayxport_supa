// Shell keys used by group D (mobile chrome), from shell-nav §10, plus the nav labels group A's navConfig
// reads. Returned to the integrator as newI18nKeys; tests merge them onto the real catalogs so they pass
// before and after the integrator merge.
import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

export const SHELL_D_EN = {
  nav: {
    groups: { listings: 'Listings' },
    items: {
      home: 'Home',
      orders: 'Orders',
      messages: 'Messages',
      listingsOf: '{marketplace} listings',
      connectStore: 'Connect a store',
      stockSync: 'Stock sync',
      research: 'Research',
      reports: 'Reports',
      finance: 'Finance',
      notifications: 'Notifications',
      settings: 'Settings',
      help: 'Help',
    },
  },
  shell: {
    mainNav: 'Main',
    badge: {
      toShip: '{count, plural, one {# to ship} other {# to ship}}',
      overdue: '{count, plural, one {# overdue} other {# overdue}}',
      unread: '{count, plural, one {# unread} other {# unread}}',
      unsent: '{count, plural, one {# change not sent yet} other {# changes not sent yet}}',
      reconnect: '{marketplace} needs reconnecting',
      reconnectShort: 'Reconnect needed',
      settingsReconnect: 'A store needs reconnecting',
    },
    topbar: {
      search: 'Search or jump to…',
      notificationsUnread: 'Notifications ({count} unread)',
      back: 'Back',
    },
    account: { settings: 'Account settings', language: 'Language', signOut: 'Sign out' },
    mobile: { more: 'More', menu: 'Menu' },
    pull: { pull: 'Pull to refresh', release: 'Release to refresh', refreshing: 'Refreshing…' },
  },
};

export const SHELL_D_TR = {
  nav: {
    groups: { listings: 'İlanlar' },
    items: {
      home: 'Ana sayfa',
      orders: 'Siparişler',
      messages: 'Mesajlar',
      listingsOf: '{marketplace} ilanları',
      connectStore: 'Mağaza bağla',
      stockSync: 'Stok senkronu',
      research: 'Pazar araştırması',
      reports: 'Raporlar',
      finance: 'Finans',
      notifications: 'Bildirimler',
      settings: 'Ayarlar',
      help: 'Yardım',
    },
  },
  shell: {
    mainNav: 'Ana menü',
    badge: {
      toShip: '{count} gönderilecek',
      overdue: '{count} gecikti',
      unread: '{count} okunmadı',
      unsent: '{count} değişiklik henüz gönderilmedi',
      reconnect: '{marketplace} yeniden bağlanmalı',
      reconnectShort: 'Yeniden bağlan',
      settingsReconnect: 'Bir mağaza yeniden bağlanmalı',
    },
    topbar: {
      search: 'Ara veya git…',
      notificationsUnread: 'Bildirimler ({count} okunmadı)',
      back: 'Geri',
    },
    account: { settings: 'Hesap ayarları', language: 'Dil', signOut: 'Çıkış yap' },
    mobile: { more: 'Daha fazla', menu: 'Menü' },
    pull: { pull: 'Yenilemek için çekin', release: 'Yenilemek için bırakın', refreshing: 'Yenileniyor…' },
  },
};

export type Locale = 'en' | 'tr';
export const LOCALES: Locale[] = ['en', 'tr'];

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}

export const MESSAGES: Record<Locale, Obj> = {
  en: deepMerge(en as Obj, SHELL_D_EN as Obj),
  tr: deepMerge(tr as Obj, SHELL_D_TR as Obj),
};

/** Strict: a missing key fails the test. */
export function wrap(ui: React.ReactElement, locale: Locale): React.ReactElement {
  return React.createElement(NextIntlClientProvider, {
    locale,
    messages: MESSAGES[locale] as never,
    timeZone: 'Europe/Istanbul',
    onError: (e: Error) => {
      throw e;
    },
    children: React.createElement(ThemeProvider, { theme, children: ui }),
  });
}

export function renderIntl(ui: React.ReactElement, locale: Locale): RenderResult {
  return render(wrap(ui, locale));
}

/** Message by dotted path with `{x}` params (no ICU). */
export function m(locale: Locale, path: string, params: Record<string, string | number> = {}): string {
  const raw = path.split('.').reduce<unknown>((o, k) => (o as Obj)?.[k], MESSAGES[locale]);
  if (typeof raw !== 'string') throw new Error(`missing message ${locale}:${path}`);
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

/** Plain translator for `buildNavModel` fixtures (ICU-free: plural messages become "{count} …"). */
export function navT(locale: Locale) {
  return (key: string, values?: Record<string, string | number>) => {
    const raw = key.split('.').reduce<unknown>((o, k) => (o as Obj)?.[k], MESSAGES[locale]);
    if (typeof raw !== 'string') return key;
    const flat = raw.replace(/\{count, plural, one \{# ([^}]*)\} other \{# [^}]*\}\}/, '{count} $1');
    return flat.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? `{${k}}`));
  };
}
