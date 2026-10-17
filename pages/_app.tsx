import { AppProps } from 'next/app';
import "../styles/globals.css";
import { DefaultSeo } from 'next-seo';
import SEO from '../next-seo.config';
import { ReactElement, ReactNode } from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect, useReducer, useRef, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { NextIntlClientProvider } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { cachedMessages, loadMessages } from '@/lib/i18n/clientMessages';
import CookieConsent from '@/components/CookieConsent';
import { captureAttribution, track } from '@/lib/tracking/events';
import { isShellRoute } from '@/lib/nav/shellRoutes';

// The app's provider tree is a separate chunk: marketing pages never load it (server-rendered where used).
const AppRoot = dynamic(() => import('@/components/app/AppRoot'));

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

/** URL-driven funnel events: pricing views and marketplace connections (OAuth callbacks land on /ayarlar?success=<mp>_connected). */
function funnelFromUrl(url: string) {
  const u = new URL(url, 'https://kolayxport.com');
  if (u.pathname === '/fiyatlandirma') track('view_pricing');
  const ok = /^([a-z]+)_connected$/.exec(u.searchParams.get('success') || '');
  if (u.pathname === '/ayarlar' && ok) track('connect_marketplace', { marketplace: ok[1] });
}

/** Missing keys while a public page runs on its namespace subset are expected for hidden global UI; don't spam the console. */
function intlOnError(error: { code?: string }) {
  if (error?.code === 'MISSING_MESSAGE') return;
  console.error(error);
}

// First path segment of Turkish marketing routes (SiteLayout sets <html lang> itself there).
const SITE_TR_ROUTES = new Set(['', 'cozumler', 'entegrasyonlar', 'karsilastirma', 'nasil-kullanirim', 'blog', 'kurumsal', 'iletisim', 'ozellikler', 'kvkk-aydinlatma-metni', 'cerez-politikasi', 'gizlilik-politikasi', 'kullanim-sartlari', 'mesafeli-satis-sozlesmesi', 'on-bilgilendirme-formu']);

// App routes need the full dictionary: start fetching it while React hydrates, not after.
if (typeof window !== 'undefined') {
  const seg = window.location.pathname.split('/')[1] ?? '';
  if (seg !== 'en' && !SITE_TR_ROUTES.has(seg)) {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem('kolayxport_locale'); } catch { /* storage blocked */ }
    void loadMessages(stored === 'en' ? 'en' : 'tr');
  }
}

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useLocaleStore((s) => s.hydrate);

  // Marketing pages (components/site/SiteLayout) lock their own language: / is Turkish, /en is English.
  const isSiteRoute = router.pathname === '/en' || router.pathname.startsWith('/en/') || SITE_TR_ROUTES.has(router.pathname.split('/')[1] ?? '');

  useEffect(() => {
    // _document renders lang per route; the app UI locale is client-side, so keep <html lang> in sync
    // (CSS case mapping and hyphenation follow it — fixes "FAİLED" in the EN UI).
    if (typeof document !== 'undefined' && !isSiteRoute) document.documentElement.lang = locale;
  }, [locale, isSiteRoute]);

  // First-touch UTM / click-id capture and SPA page views for GTM (lib/tracking/events.ts).
  useEffect(() => {
    captureAttribution(window.location.search);
    const onRoute = (url: string) => {
      track('page_view', { page_path: url });
      funnelFromUrl(url);
    };
    funnelFromUrl(window.location.pathname + window.location.search);
    router.events.on('routeChangeComplete', onRoute);
    return () => router.events.off('routeChangeComplete', onRoute);
  }, [router.events]);

  // Hydrate locale from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    hydrate();
  }, []);

  // Messages: marketing/public pages pass their own subset via getStaticProps (lib/i18n/pageMessages.ts) and
  // marketing pages fix their locale (`siteLocale`); everything else loads the full dictionary on demand.
  const siteLocale = pageProps.siteLocale as 'tr' | 'en' | undefined;
  const intlLocale = siteLocale ?? locale;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const lastFull = useRef<{ locale: string; messages: Record<string, unknown> } | null>(null);
  // The first client render must match the server HTML, which never has the full dictionary: only use it
  // after mount (it is usually already downloaded by then, see the module-level prefetch above).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const full = mounted ? cachedMessages(intlLocale) : null;
  if (full) lastFull.current = { locale: intlLocale, messages: full };
  const provided = pageProps.messages && (!pageProps.messagesLocale || pageProps.messagesLocale === intlLocale) ? pageProps.messages : null;
  const intlMessages = full ?? provided ?? lastFull.current?.messages ?? null;
  useEffect(() => {
    if (!mounted || siteLocale || full) return;
    let alive = true;
    loadMessages(intlLocale).then(() => { if (alive) rerender(); });
    return () => { alive = false; };
  }, [mounted, intlLocale, siteLocale, full]);

  if (!intlMessages) {
    // App pages before their dictionary arrives (first visit only; cached after). Same markup on the server.
    return <div style={{ minHeight: '100vh', background: '#F8FAFC' }} aria-busy="true" />;
  }

  return (
    <NextIntlClientProvider locale={intlLocale} messages={intlMessages} timeZone="Europe/Istanbul" onError={intlOnError}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <DefaultSeo {...SEO} />
      {/* Organization / WebSite / SoftwareApplication JSON-LD: components/site/SiteLayout (marketing pages only). */}
      {siteLocale ? (
        <Component {...pageProps} />
      ) : (
        <AppRoot session={pageProps.session} shell={isShellRoute(router.pathname)}>
          <Component {...pageProps} />
        </AppRoot>
      )}
      <CookieConsent />
    </NextIntlClientProvider>
  );
}

export default MyApp;
