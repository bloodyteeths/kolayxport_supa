import React from 'react';
import Layout from '@/components/Layout';
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function AuthErrorPage() {
  const { query } = useRouter();
  const error = query.error || 'unknown_error';

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-full p-8">
        <h1 className="text-3xl font-bold mb-4">Authentication Error</h1>
        <p className="mb-2">An error occurred during sign-in:</p>
        <code className="bg-gray-100 p-2 rounded text-red-600">{error}</code>
        <p className="mt-4">
          Please try again or <Link href="/" className="underline text-blue-600">go back home</Link>.
        </p>
      </div>
    </Layout>
  );
} 