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
import { AuthProvider } from '@/lib/auth-context';
import { ReactElement, ReactNode } from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    const { session_id } = router.query;
    if (session_id) {
      // clear query param then redirect dashboard to refresh subscription
      router.replace('/app', undefined, { shallow: false });
    }
  }, [router.query]);

  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <DefaultSeo {...SEO} />
        <LogoJsonLd
          logo="https://kolayxport.com/logo.png"
          url="https://kolayxport.com"
        />
        <Component {...pageProps} />
        <Toaster position="top-center" />
      </ThemeProvider>
    </AuthProvider>
  );
}

export default MyApp; 