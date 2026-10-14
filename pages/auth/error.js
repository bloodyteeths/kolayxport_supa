import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import PublicLayout from '../../components/PublicLayout';

// Auth error landing page (?error=<NextAuth error code>). lib/auth.ts doesn't set
// pages.error today, so NextAuth errors land on /login?error=… (handled in AuthForm).
const ERROR_KEYS = {
  OAuthAccountNotLinked: 'accountNotLinked',
  Callback: 'callback',
  OAuthCallback: 'callback',
};

export default function AuthErrorPage() {
  const { query } = useRouter();
  const t = useTranslations('auth.errorPage');
  const error = typeof query.error === 'string' ? query.error : 'unknown_error';
  const errorMessage = t(Object.prototype.hasOwnProperty.call(ERROR_KEYS, error) ? ERROR_KEYS[error] : 'generic');

  return (
    <PublicLayout title={t('pageTitle')}>
      <div className="flex flex-col items-center justify-center text-center px-4 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-bold text-red-600 mb-6">{t('heading')}</h1>
        <p className="text-lg text-slate-700 mb-4">{errorMessage}</p>
        {error !== 'unknown_error' && (
          <p className="text-sm text-slate-500 mb-6">
            {t('errorCode')} <code className="bg-slate-100 p-1 rounded">{error}</code>
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center min-h-[44px] px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors"
          >
            {t('tryAgain')}
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center min-h-[44px] px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-md hover:bg-slate-50 transition-colors"
          >
            {t('backHome')}
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
