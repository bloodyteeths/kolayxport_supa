import React from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslations } from 'next-intl';

// /api/auth/verify-email redirects here with ?status=<reason>. Each status maps
// to a title/body key under auth.verify.*; unknown statuses fall back to the
// generic "failed" copy.
const STATUS_KEYS: Record<string, { title: string; body: string }> = {
  ok: { title: 'titles.ok', body: 'bodies.ok' },
  invalid: { title: 'titles.failed', body: 'bodies.invalid' },
  not_found: { title: 'titles.failed', body: 'bodies.invalid' },
  wrong_purpose: { title: 'titles.failed', body: 'bodies.invalid' },
  expired: { title: 'titles.expired', body: 'bodies.expired' },
  already_consumed: { title: 'titles.alreadyUsed', body: 'bodies.alreadyUsed' },
};

export default function VerifyEmail() {
  const router = useRouter();
  const t = useTranslations('auth.verify');
  const tAuth = useTranslations('auth');
  const status = typeof router.query.status === 'string' ? router.query.status : '';
  const keys = STATUS_KEYS[status];

  // Statically optimised page: router.query is empty until isReady, so don't
  // flash "Verification failed" on a valid ?status=ok link.
  const ready = router.isReady;
  const title = ready ? t(keys?.title ?? 'titles.failed') : tAuth('loading');
  const body = ready ? t(keys?.body ?? 'bodies.default') : '';

  return (
    <>
      <Head>
        <title>{`${t('pageTitle')} — KolayXport`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">{title}</h1>
          <p className="text-sm text-gray-600 mb-6">{body}</p>
          {ready && (
          <a
            href="/login"
            className="inline-flex items-center justify-center min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white py-2 px-5 rounded-lg text-sm"
          >
            {t('goToSignIn')}
          </a>
          )}
        </div>
      </div>
    </>
  );
}
