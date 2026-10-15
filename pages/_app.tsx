import { AppProps } from 'next/app';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../lib/theme';
import "../styles/globals.css";
import Layout from '@/components/Layout';
import { Toaster } from 'react-hot-toast';
import { DefaultSeo, LogoJsonLd } from 'next-seo';
import SEO from '../next-seo.config';
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/lib/auth-context';
import { ReactElement, ReactNode } from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Head from 'next/head';
import { NextIntlClientProvider } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import trMessages from '@/messages/tr.json';
import enMessages from '@/messages/en.json';
import CookieConsent from '@/components/CookieConsent';
import { ConfirmProvider } from '@/lib/hooks/useConfirm';
import LimitReachedDialog from '@/components/billing/LimitReachedDialog';
import { installLimitInterceptor } from '@/lib/http/limitInterceptor';
import LiveAppMount from '@/components/live/LiveAppMount';
import { zIndex as dsZ, neutral as dsN, radius as dsRadius } from '@/lib/ds/tokens';

// Inter via next/font (self-hosted). latin-ext covers ğ ş ı İ. Exposed as --font-inter at :root below.
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

// Module scope (client only) so the 402 interceptor is active before any page
// effect issues a request. Idempotent.
if (typeof window !== 'undefined') {
  installLimitInterceptor();
}

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

const messages = { tr: trMessages, en: enMessages } as const;

// Untyped on purpose: stale ambient shims in types/*.d.ts declare toastOptions without the per-type keys
// (error/success) that react-hot-toast 2.6 supports at runtime.
const TOAST_OPTIONS = {
  duration: 4000,
  style: { background: dsN[900], color: dsN[0], fontSize: 13, lineHeight: '18px', borderRadius: dsRadius.md, padding: '10px 12px', maxWidth: 420 },
  // TODO(M1 useToast): switch to `error: { duration: Infinity }` (tokens.md §4, DS §3.14 — errors persist
  // until dismissed) once useToast ships a dismiss control + one-visible queueing. Legacy toast.error()
  // calls have no close button, so M0 keeps them finite (known M0 spec gap).
  error: { duration: 8000 },
};

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useLocaleStore((s) => s.hydrate);

  useEffect(() => {
    // _document hard-codes lang="tr"; the UI locale is client-side, so keep <html lang> in sync
    // (CSS case mapping and hyphenation follow it — fixes "FAİLED" in the EN UI).
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  // Hydrate locale from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    const { session_id } = router.query;
    if (session_id) {
      // clear query param then redirect dashboard to refresh subscription
      router.replace('/app', undefined, { shallow: false });
    }
  }, [router.query]);

  return (
    <SessionProvider session={pageProps.session}>
    <AuthProvider>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Europe/Istanbul">
      <ThemeProvider theme={theme}>
      <ConfirmProvider>
        {/* defines the font var at :root so MUI portals (dialogs, menus) get Inter too */}
        <style jsx global>{`
          :root { --font-inter: ${inter.style.fontFamily}; }
        `}</style>
        <CssBaseline />
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <DefaultSeo {...SEO} />
        <LogoJsonLd
          logo="https://kolayxport.com/logo.png"
          url="https://kolayxport.com"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "KolayXport",
              "url": "https://kolayxport.com",
              "logo": "https://kolayxport.com/images/logo.png",
              "email": "destek@kolayxport.com",
              "sameAs": [
                "https://twitter.com/kolayxport",
                "https://linkedin.com/company/kolayxport",
                "https://youtube.com/kolayxport"
              ]
            })
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "KolayXport",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "TRY",
                "description": "30 gun ucretsiz deneme"
              }
            })
          }}
        />
        <Component {...pageProps} />
        <Toaster
          position="bottom-center"
          gutter={8}
          containerStyle={{ zIndex: dsZ.toast, bottom: 'calc(var(--kx-bottom-nav, 0px) + var(--kx-action-bar, 0px) + 8px)' }}
          toastOptions={TOAST_OPTIONS}
        />
        {/* Live events: SSE stream, new-order chime + toast, live SWR refresh. Signed-in /app/* only. */}
        <LiveAppMount ordersPath="/app/labels" />
        <LimitReachedDialog />
        <CookieConsent />
      </ConfirmProvider>
      </ThemeProvider>
      </NextIntlClientProvider>
    </AuthProvider>
    </SessionProvider>
  );
}

export default MyApp;
