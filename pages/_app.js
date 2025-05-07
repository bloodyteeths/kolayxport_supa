import "../styles/globals.css"
import Layout from '@/components/Layout'
import { SessionProvider } from "next-auth/react"
import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { DefaultSeo, LogoJsonLd } from 'next-seo'
import SEO from '../next-seo.config'

// Override fetch globally to force GET for NextAuth session endpoint
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (resource, init = {}) => {
    const url = typeof resource === 'string' ? resource : resource.url;
    if (url.includes('/api/auth/session')) {
      return originalFetch(resource, { ...init, method: 'GET' });
    }
    return originalFetch(resource, init);
  };
}

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  const getLayout = Component.getLayout || ((page) => <Layout>{page}</Layout>);

  return (
    <SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
      <DefaultSeo {...SEO} />
      {/* Organization structured data */}
      <LogoJsonLd
        url="https://kolayxport.com"
        logo="https://kolayxport.com/kolayxport-logo.png"
      />
      <Toaster position="bottom-right" />
      {getLayout(<Component {...pageProps} />)}
    </SessionProvider>
  )
}