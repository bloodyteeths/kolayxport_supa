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
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
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
              "@type": ["Organization", "LocalBusiness", "SoftwareApplication"],
              "name": "KolayXport",
              "description": "E-ticaret entegrasyon ve otomasyon platformu - Trendyol, Hepsiburada, Amazon entegrasyonu",
              "url": "https://kolayxport.com",
              "logo": "https://kolayxport.com/logo.png",
              "foundingDate": "2024",
              "address": {
                "@type": "PostalAddress",
                "addressCountry": "TR",
                "addressRegion": "Turkey"
              },
              "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "customer service",
                "availableLanguage": ["Turkish", "English"],
                "telephone": "+90-XXX-XXX-XXXX"
              },
              "sameAs": [
                "https://twitter.com/kolayxport"
              ],
              "serviceType": "E-commerce Integration Platform",
              "areaServed": "TR",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "name": "KolayXport Starter Plan",
                "price": "449",
                "priceCurrency": "TRY",
                "priceSpecification": {
                  "@type": "RecurringPaymentFrequency",
                  "frequency": "monthly"
                }
              }
            })
          }}
        />
        <Component {...pageProps} />
        <Toaster position="top-center" />
      </ThemeProvider>
      </NextIntlClientProvider>
    </AuthProvider>
    </SessionProvider>
  );
}

export default MyApp; 