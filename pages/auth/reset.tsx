import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/auth/passwordPolicy';

// Error codes returned by /api/auth/reset-password (plus the client-side
// "mismatch"). Each has a message under auth.errors.<code>.
const KNOWN_STATUSES = new Set([
  'invalid_or_expired',
  'password_too_short',
  'password_too_long',
  'password_needs_lowercase',
  'password_needs_uppercase',
  'password_needs_digit',
  'password_needs_special',
  'password_contains_identity',
  'password_too_common',
  'invalid_input',
  'internal_error',
  'mismatch',
]);

export default function ResetPassword() {
  const router = useRouter();
  const t = useTranslations('auth.reset');
  const tAuth = useTranslations('auth');
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const statusMessage = (code: string) =>
    tAuth(`errors.${KNOWN_STATUSES.has(code) ? code : 'generic'}`, {
      min: PASSWORD_MIN_LENGTH,
      max: PASSWORD_MAX_LENGTH,
    });

  return (
    <>
      <Head>
        <title>{`${t('pageTitle')} — KolayXport`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md">
          <h1 className="text-xl font-semibold mb-2">{t('heading')}</h1>
          {status === 'ok' ? (
            <div className="text-sm text-gray-700" role="status">
              <p>{t('success')}</p>
              <p className="mt-4">
                <a href="/login" className="text-blue-600 hover:underline">{t('signInWithNew')}</a>
              </p>
            </div>
          ) : !router.isReady ? (
            <p className="text-sm text-gray-600" role="status">{tAuth('loading')}</p>
          ) : !token ? (
            <p className="text-sm text-red-600">{t('missingToken')}</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setStatus(null);
                if (pw !== confirm) {
                  setStatus('mismatch');
                  return;
                }
                setLoading(true);
                try {
                  const res = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, newPassword: pw }),
                  });
                  const data = await res.json().catch(() => ({}));
                  setStatus(data.ok ? 'ok' : (typeof data.error === 'string' ? data.error : 'internal_error'));
                } catch {
                  setStatus('internal_error');
                } finally {
                  setLoading(false);
                }
              }}
              className="space-y-3"
            >
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                aria-label={t('newPasswordLabel')}
                placeholder={t('newPasswordPlaceholder', { min: PASSWORD_MIN_LENGTH })}
                className="w-full min-h-[44px] border rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                aria-label={t('confirmPlaceholder')}
                placeholder={t('confirmPlaceholder')}
                className="w-full min-h-[44px] border rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500">{tAuth('passwordHint', { min: PASSWORD_MIN_LENGTH })}</p>
              {status && status !== 'ok' && (
                <p className="text-xs text-red-600" role="alert">{statusMessage(status)}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm disabled:opacity-60"
              >
                {loading ? t('updating') : t('submit')}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
