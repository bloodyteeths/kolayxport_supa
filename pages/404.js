import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PublicLayout from '@/components/PublicLayout';

export default function Custom404() {
  const t = useTranslations('errors');
  return (
    <PublicLayout title={t('notFoundTitle')} seo={{ noindex: true }}>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 py-16">
        <h1 className="text-3xl font-semibold text-slate-900 mb-3">{t('notFoundTitle')}</h1>
        <p className="text-base text-slate-600 mb-6">{t('notFoundMessage')}</p>
        <Link href="/" className="text-blue-600 hover:underline">{t('goHome')}</Link>
      </div>
    </PublicLayout>
  );
}
