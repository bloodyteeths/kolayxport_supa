import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/auth/passwordPolicy';

// Policy codes returned by /api/auth/signup (lib/auth/passwordPolicy.ts) that
// have a localised message under auth.errors.<code>.
const POLICY_CODES = new Set([
  'password_too_short',
  'password_too_long',
  'password_needs_lowercase',
  'password_needs_uppercase',
  'password_needs_digit',
  'password_needs_special',
  'password_contains_identity',
  'password_too_common',
]);

/**
 * Only allow same-origin relative paths as a post-login destination so a
 * crafted ?callbackUrl= can't bounce users to another site.
 */
function safeCallbackUrl(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/app/analytics';
  }
  return value;
}

export default function AuthForm() {
  const t = useTranslations('auth');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resentStatus, setResentStatus] = useState('');
  const router = useRouter();
  const callbackUrl = safeCallbackUrl(router.query.callbackUrl);

  // NextAuth redirects OAuth failures to the sign-in page (/login?error=<code>).
  const queryError = Array.isArray(router.query.error) ? router.query.error[0] : router.query.error;
  const oauthErrorMessage = typeof queryError === 'string' && queryError
    ? t(
      queryError === 'OAuthAccountNotLinked'
        ? 'errorPage.accountNotLinked'
        : queryError === 'Callback' || queryError === 'OAuthCallback'
          ? 'errorPage.callback'
          : 'errorPage.generic',
    )
    : '';

  const signupErrorMessage = (status, data) => {
    const code = data && typeof data.code === 'string' ? data.code : null;
    if (code && POLICY_CODES.has(code)) {
      return t(`errors.${code}`, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
    }
    if (status === 409) return t('errors.emailExists');
    if (status === 400) return t('errors.missingFields');
    return t('errors.signupFailed');
  };

  const handleCredentials = async (e) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setResentStatus('');
    setLoading(true);

    try {
      if (isSignUp) {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(signupErrorMessage(res.status, data));
          setLoading(false);
          return;
        }
        // After signup, surface the verification flow instead of trying to sign in.
        setUnverified(true);
        setError('');
        setLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
        setError('');
        setLoading(false);
      } else if (result?.error) {
        setError(t('invalidCredentials'));
        setLoading(false);
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError(t('errors.generic'));
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResentStatus('loading');
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setResentStatus(res.ok ? 'sent' : 'error');
    } catch {
      setResentStatus('error');
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signIn('google', { callbackUrl });
    } catch {
      setError(t('errors.signInFailed'));
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4 text-center">
        {isSignUp ? t('signUp') : t('title')}
      </h2>

      <form onSubmit={handleCredentials} className="space-y-3">
        {isSignUp && (
          <input
            type="text"
            placeholder={t('name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        <input
          type="email"
          placeholder={t('email')}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="password"
          placeholder={t('password')}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={isSignUp ? PASSWORD_MIN_LENGTH : undefined}
          maxLength={PASSWORD_MAX_LENGTH}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isSignUp && (
          <p className="text-xs text-gray-500 -mt-1">
            {t('passwordHint', { min: PASSWORD_MIN_LENGTH })}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? t('loading') : isSignUp ? t('signUp') : t('signIn')}
        </button>
        {!isSignUp && (
          <div className="text-right">
            <a
              href="/auth/forgot"
              className="text-xs text-blue-600 hover:underline"
            >
              {t('forgotPassword')}
            </a>
          </div>
        )}
      </form>

      <div className="my-4 flex items-center">
        <hr className="flex-1 border-gray-300" />
        <span className="px-3 text-gray-500 text-sm">{t('or')}</span>
        <hr className="flex-1 border-gray-300" />
      </div>

      <button
        onClick={handleGoogle}
        className="w-full py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center"
        disabled={loading}
      >
        <img src="/google-icon.png" alt="Google" className="w-5 h-5 mr-2" />
        {t('signInWithGoogle')}
      </button>

      <p className="mt-4 text-center text-sm text-gray-600">
        {isSignUp ? t('alreadyHaveAccount') : t('noAccount')}
        {' '}
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(''); setUnverified(false); setResentStatus(''); }}
          className="text-blue-600 hover:underline"
        >
          {isSignUp ? t('signIn') : t('signUp')}
        </button>
      </p>

      {!error && !unverified && oauthErrorMessage && (
        <div role="alert" className="mt-4 text-red-600 text-center text-sm">{oauthErrorMessage}</div>
      )}
      {error && <div role="alert" className="mt-4 text-red-600 text-center text-sm">{error}</div>}

      {unverified && (
        <div role="status" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium mb-1">{t('unverified.title')}</p>
          <p className="text-xs mb-2">{t('unverified.body')}</p>
          <button
            type="button"
            onClick={handleResend}
            disabled={!email || resentStatus === 'loading' || resentStatus === 'sent'}
            className="min-h-[44px] text-blue-700 hover:underline text-xs font-medium disabled:opacity-60"
          >
            {resentStatus === 'sent'
              ? t('unverified.sent')
              : resentStatus === 'loading'
                ? t('unverified.sending')
                : t('unverified.resend')}
          </button>
          {resentStatus === 'error' && (
            <p className="text-xs text-red-600">{t('unverified.resendFailed')}</p>
          )}
          <p className="mt-2 text-[11px] text-amber-700">
            <a href="/auth/forgot" className="hover:underline">{t('forgotPassword')}</a>
          </p>
        </div>
      )}
    </div>
  );
}
