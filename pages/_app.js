import "../styles/globals.css"
import Layout from '@/components/Layout'
import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { DefaultSeo, LogoJsonLd } from 'next-seo'
import SEO from '../next-seo.config'
import { AuthProvider } from '@/lib/auth-context'

export default function App({ Component, pageProps }) {
  const getLayout = Component.getLayout || ((page) => <Layout>{page}</Layout>);

  return (
    <AuthProvider>
      <DefaultSeo {...SEO} />
      {/* Organization structured data */}
      <LogoJsonLd
        url="https://kolayxport.com"
        logo="https://kolayxport.com/kolayxport-logo.png"
      />
      <Toaster position="bottom-right" />
      {getLayout(<Component {...pageProps} />)}
    </AuthProvider>
  )
}