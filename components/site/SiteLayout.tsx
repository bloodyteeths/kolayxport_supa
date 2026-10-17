import { useEffect, type ReactNode } from 'react';
import { NextSeo } from 'next-seo';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import trMessages from '@/messages/tr.json';
import enMessages from '@/messages/en.json';
import { SITE_URL } from '@/lib/site/company';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import { organization, website } from '@/lib/site/schema';
import { siteFontClass } from './fonts';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import JsonLd from './JsonLd';

export interface SiteSeo {
  title: string;
  description: string;
  /** Turkish path of the page ('/', '/cozumler/etsy-satici'); the English twin is /en + path. */
  path: string;
  /** Whether the page exists in the other locale (adds hreflang + the language switch target). */
  hasTwin?: boolean;
  /** Absolute path of the OG image under /public, e.g. /og/tr/cases/etsy-satici.png. */
  ogImage?: string | null;
  noindex?: boolean;
  type?: 'website' | 'article';
}

const MESSAGES = { tr: trMessages, en: enMessages } as const;

interface Props {
  locale: SiteLocale;
  seo: SiteSeo;
  jsonLd?: (Record<string, unknown> | null | undefined)[];
  children: ReactNode;
  /** Dark hero pages render the header on ink. */
  tone?: 'paper' | 'ink';
}

/**
 * Every public marketing page. Locks the locale per route (Turkish at /, English at /en), sets
 * canonical + hreflang + OG, the Organization/WebSite JSON-LD, the brand fonts, header and footer.
 */
export default function SiteLayout({ locale, seo, jsonLd = [], children, tone = 'paper' }: Props) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul">
      <SiteShell locale={locale} seo={seo} jsonLd={jsonLd} tone={tone}>{children}</SiteShell>
    </NextIntlClientProvider>
  );
}

function SiteShell({ locale, seo, jsonLd = [], children, tone }: Props) {
  const t = useTranslations('site');
  const self = localePath(locale, seo.path);
  const canonical = `${SITE_URL}${self === '/' ? '' : self}` || SITE_URL;
  const trUrl = `${SITE_URL}${localePath('tr', seo.path) === '/' ? '' : localePath('tr', seo.path)}`;
  const enUrl = `${SITE_URL}${localePath('en', seo.path)}`;
  const og = `${SITE_URL}${seo.ogImage || (locale === 'en' ? '/og/default-en.png' : '/og/default.png')}`;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <>
      <NextSeo
        title={seo.title}
        description={seo.description}
        canonical={canonical || SITE_URL}
        noindex={seo.noindex}
        nofollow={seo.noindex}
        languageAlternates={seo.hasTwin ? [
          { hrefLang: 'tr', href: trUrl || SITE_URL },
          { hrefLang: 'en', href: enUrl },
          { hrefLang: 'x-default', href: trUrl || SITE_URL },
        ] : []}
        openGraph={{
          type: seo.type || 'website',
          url: canonical || SITE_URL,
          title: seo.title,
          description: seo.description,
          locale: locale === 'tr' ? 'tr_TR' : 'en_US',
          siteName: 'KolayXport',
          images: [{ url: og, width: 1200, height: 630, alt: seo.title }],
        }}
        twitter={{ cardType: 'summary_large_image' }}
      />
      <JsonLd id="site" data={[organization(), website(), ...jsonLd]} />
      <div className={`site ${siteFontClass} min-h-screen flex flex-col`} lang={locale}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
          {t('nav.skip')}
        </a>
        <SiteHeader locale={locale} path={seo.path} hasTwin={!!seo.hasTwin} tone={tone || 'paper'} />
        <main id="main" className="flex-1">{children}</main>
        <SiteFooter locale={locale} />
      </div>
    </>
  );
}
