import React from 'react';
import Layout from '@/components/Layout';
import Link from 'next/link';

export default function Custom404() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <h1 className="text-6xl font-bold mb-4">404 - Page Not Found</h1>
        <p className="text-xl mb-6">Sorry, we couldn't find the page you're looking for.</p>
        <Link href="/" className="text-blue-600 underline">Go back home</Link>
      </div>
    </Layout>
  );
} 