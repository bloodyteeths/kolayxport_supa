import React from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PublicLayout from '../../components/PublicLayout';

export default function ConfirmEmailPage() {
  const t = useTranslations('auth.confirmEmail');
  return (
    <PublicLayout title={t('pageTitle')}>
      <div className="flex flex-col items-center justify-center text-center px-4 py-12 md:py-20">
        <Mail className="w-16 h-16 text-blue-500 mb-6" />
        <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">{t('heading')}</h1>
        <p className="text-lg text-slate-600 max-w-md mx-auto">{t('body')}</p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-flex items-center justify-center min-h-[44px] px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors"
          >
            {t('goToSignIn')}
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
