import Link from 'next/link'
import Layout from '@/components/Layout'
import { useTranslations } from 'next-intl'

export default function ErrorPage({ statusCode }) {
  const t = useTranslations('errors');
  return (
    <Layout>
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h1 className="text-5xl font-bold mb-4 text-gray-900">{t('oops')}</h1>
        <p className="text-lg mb-6 text-gray-700">
          {statusCode
            ? t('serverError', { statusCode })
            : t('clientError')}
        </p>
        <Link href="/" className="text-blue-600 hover:underline">
          {t('goHome')}
        </Link>
      </div>
    </Layout>
  )
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404
  return { statusCode }
} 