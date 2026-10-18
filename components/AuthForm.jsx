import React, { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/auth/passwordPolicy';
import { newEventId, readAttribution, track } from '@/lib/tracking/events';
import { isIosApp } from '@/lib/billing/playClient';

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
  // Google blocks its sign-in inside embedded iOS WebViews (disallowed_useragent), so the App Store app shows
  // Sign in with Apple instead (guideline 4.8). Apple shows wherever the server has it configured.
  const [iosApp, setIosApp] = useState(false);
  const [appleEnabled, setAppleEnabled] = useState(false);
  useEffect(() => {
    setIosApp(isIosApp());
    let alive = true;
    fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (alive && p && p.apple) setAppleEnabled(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Marketing and pricing CTAs link to /login?mode=signup; open the signup form for them.
  const queryMode = Array.isArray(router.query.mode) ? router.query.mode[0] : router.query.mode;
  useEffect(() => {
    if (router.isReady && queryMode === 'signup') setIsSignUp(true);
  }, [router.isReady, queryMode]);

  // Funnel: the signup form was shown (from a CTA or the toggle).
  useEffect(() => {
    if (isSignUp) track('start_signup', { method: 'email' });
  }, [isSignUp]);

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
        const eventId = newEventId();
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, eventId, attribution: readAttribution() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(signupErrorMessage(res.status, data));
          setLoading(false);
          return;
        }
        // Same event_id as the server copy (pages/api/auth/signup.ts) so ad platforms de-duplicate.
        track('sign_up', { event_id: eventId, method: 'email' });
        track('start_trial', { event_id: `${eventId}-trial` });
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

  const handleApple = async () => {
    setError('');
    setLoading(true);
    try {
      track('start_signup', { method: 'apple', mode: isSignUp ? 'signup' : 'signin' });
      await signIn('apple', { callbackUrl });
    } catch {
      setError(t('errors.signInFailed'));
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      track('start_signup', { method: 'google', mode: isSignUp ? 'signup' : 'signin' });
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

      {appleEnabled || !iosApp ? (
        <div className="my-4 flex items-center">
          <hr className="flex-1 border-gray-300" />
          <span className="px-3 text-gray-500 text-sm">{t('or')}</span>
          <hr className="flex-1 border-gray-300" />
        </div>
      ) : null}

      {appleEnabled ? (
        <button
          onClick={handleApple}
          className="mb-3 w-full py-2 bg-black text-white rounded hover:bg-gray-900 transition flex items-center justify-center"
          disabled={loading}
          data-testid="signin-apple"
        >
          <svg aria-hidden="true" viewBox="0 0 814 1000" className="w-4 h-4 mr-2" fill="currentColor"><path d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-167 41s-107-58-157-129C42 788 0 674 0 566 0 393 113 301 224 301c59 0 108 39 145 39 35 0 90-41 157-41 25 0 117 2 177 89zM554 159c28-33 48-79 48-125 0-6-1-13-2-18-45 2-99 30-132 68-26 29-50 75-50 122 0 7 1 14 2 16 3 1 8 2 13 2 41 0 92-27 121-65z"/></svg>
          {t('signInWithApple')}
        </button>
      ) : null}

      {iosApp ? null : (
        <button
          onClick={handleGoogle}
          className="w-full py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center"
          disabled={loading}
        >
          <img src="/google-icon.png" alt="Google" className="w-5 h-5 mr-2" />
          {t('signInWithGoogle')}
        </button>
      )}

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
