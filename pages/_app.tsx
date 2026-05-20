import { AppProps } from 'next/app';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../lib/theme';
import "../styles/globals.css";
import './app/senkron-print.css';
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

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

const messages = { tr: trMessages, en: enMessages } as const;

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useLocaleStore((s) => s.hydrate);

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
        <Toaster position="top-center" />
        <CookieConsent />
      </ThemeProvider>
      </NextIntlClientProvider>
    </AuthProvider>
    </SessionProvider>
  );
}

export default MyApp;
