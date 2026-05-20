import React from 'react';
import Layout from '@/components/Layout';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function Custom404() {
  const t = useTranslations('errors');
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <h1 className="text-6xl font-bold mb-4">{t('notFoundTitle')}</h1>
        <p className="text-xl mb-6">{t('notFoundMessage')}</p>
        <Link href="/" className="text-blue-600 underline">{t('goHome')}</Link>
      </div>
    </Layout>
  );
} 