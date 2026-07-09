import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';

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
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Signup failed');
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
        callbackUrl: '/app',
      });

      if (result?.error === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
        setError('');
        setLoading(false);
      } else if (result?.error) {
        setError(t('invalidCredentials') || 'Invalid email or password');
        setLoading(false);
      } else {
        router.push('/app');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResentStatus('loading');
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setResentStatus('sent');
    } catch {
      setResentStatus('error');
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signIn('google', { callbackUrl: '/app' });
    } catch (err) {
      setError(err.message || 'Sign in failed');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4 text-center">
        {isSignUp ? (t('signUp') || 'Sign Up') : t('title')}
      </h2>

      <form onSubmit={handleCredentials} className="space-y-3">
        {isSignUp && (
          <input
            type="text"
            placeholder={t('name') || 'Name'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        <input
          type="email"
          placeholder={t('email') || 'Email'}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="password"
          placeholder={t('password') || 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={isSignUp ? 10 : 6}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isSignUp && (
          <p className="text-xs text-gray-500 -mt-1">
            {t('passwordPolicy') || 'At least 10 characters with upper- and lower-case letters and a number.'}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? '...' : isSignUp ? (t('signUp') || 'Sign Up') : (t('signIn') || 'Sign In')}
        </button>
        {!isSignUp && (
          <div className="text-right">
            <a
              href="/auth/forgot"
              className="text-xs text-blue-600 hover:underline"
            >
              {t('forgotPassword') || 'Forgot password?'}
            </a>
          </div>
        )}
      </form>

      <div className="my-4 flex items-center">
        <hr className="flex-1 border-gray-300" />
        <span className="px-3 text-gray-500 text-sm">{t('or') || 'or'}</span>
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
        {isSignUp ? (t('alreadyHaveAccount') || 'Already have an account?') : (t('noAccount') || "Don't have an account?")}
        {' '}
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
          className="text-blue-600 hover:underline"
        >
          {isSignUp ? (t('signIn') || 'Sign In') : (t('signUp') || 'Sign Up')}
        </button>
      </p>

      {error && <div className="mt-4 text-red-600 text-center text-sm">{error}</div>}

      {unverified && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium mb-1">Please verify your email before signing in.</p>
          <p className="text-xs mb-2">
            Check your inbox for a confirmation link. If you can't find it, request a new one.
          </p>
          <button
            type="button"
            onClick={handleResend}
            disabled={resentStatus === 'loading' || resentStatus === 'sent'}
            className="text-blue-700 hover:underline text-xs font-medium disabled:opacity-60"
          >
            {resentStatus === 'sent'
              ? 'Verification email sent.'
              : resentStatus === 'loading'
                ? 'Sending…'
                : 'Resend verification email'}
          </button>
          <p className="mt-2 text-[11px] text-amber-700">
            <a href="/auth/forgot" className="hover:underline">Forgot password?</a>
          </p>
        </div>
      )}
    </div>
  );
}
