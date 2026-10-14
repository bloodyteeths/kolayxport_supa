import React, { useState } from 'react';
import Head from 'next/head';
import { useTranslations } from 'next-intl';

export default function ForgotPassword() {
  const t = useTranslations('auth.forgot');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <>
      <Head>
        <title>{`${t('pageTitle')} — KolayXport`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md">
          <h1 className="text-xl font-semibold mb-2">{t('heading')}</h1>
          <p className="text-sm text-gray-500 mb-6">{t('description')}</p>
          {submitted ? (
            <div className="text-sm text-gray-700" role="status">
              <p>{t('sentMessage')}</p>
              <p className="mt-3"><a href="/login" className="text-blue-600 hover:underline">{t('backToSignIn')}</a></p>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoading(true);
                try {
                  await fetch('/api/auth/request-reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                  });
                } catch {
                  // Same generic confirmation either way — no account enumeration.
                } finally {
                  setSubmitted(true);
                  setLoading(false);
                }
              }}
              className="space-y-3"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-label={t('emailLabel')}
                placeholder={t('emailPlaceholder')}
                className="w-full min-h-[44px] border rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm disabled:opacity-60"
              >
                {loading ? t('sending') : t('submit')}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">
                <a href="/login" className="hover:underline">{t('backToSignIn')}</a>
              </p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
