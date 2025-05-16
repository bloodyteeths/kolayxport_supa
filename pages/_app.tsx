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

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

export default function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout = Component.getLayout || ((page) => page);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <DefaultSeo {...SEO} />
        <LogoJsonLd
          url="https://kolayxport.com"
          logo="https://kolayxport.com/kolayxport-logo.png"
        />
        <Toaster position="bottom-right" />
        {getLayout(<Component {...pageProps} />)}
      </AuthProvider>
    </ThemeProvider>
  );
} 