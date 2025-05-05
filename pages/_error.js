import Link from 'next/link'
import Layout from '@/components/Layout'

export default function ErrorPage({ statusCode }) {
  return (
    <Layout>
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h1 className="text-5xl font-bold mb-4 text-gray-900">Oops!</h1>
        <p className="text-lg mb-6 text-gray-700">
          {statusCode
            ? `An error ${statusCode} occurred on the server.`
            : 'An unexpected error occurred on the client.'}
        </p>
        <Link href="/" className="text-blue-600 hover:underline">
          Go back home
        </Link>
      </div>
    </Layout>
  )
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404
  return { statusCode }
} 