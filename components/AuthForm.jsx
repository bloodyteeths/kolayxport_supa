import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';

export default function AuthForm() {
  const t = useTranslations('auth');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

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
      <h2 className="text-2xl font-bold mb-4 text-center">{t('title')}</h2>
      <button
        onClick={handleGoogle}
        className="w-full py-2 mb-4 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center"
        disabled={loading}
      >
        <img src="/google-icon.png" alt="Google" className="w-5 h-5 mr-2" />
        {t('signInWithGoogle')}
      </button>
      {error && <div className="mt-4 text-red-600 text-center">{error}</div>}
    </div>
  );
}
