import '../styles/globals.css'
import Layout from '@/components/Layout'
import { SessionProvider } from "next-auth/react"
import { useEffect } from 'react'

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
  return (
    <SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </SessionProvider>
  )
}