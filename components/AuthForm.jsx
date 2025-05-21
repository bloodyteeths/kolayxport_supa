import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/router';

export default function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' or 'signup'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/app' },
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setSuccess('Login successful!');
        router.push('/app');
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setSuccess('Signup successful! Please check your email to confirm your account.');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4 text-center">Giriş Yap / Kayıt Ol</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="E-posta"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          required
        />
        <input
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          required
        />
        <button
          type="submit"
          className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
          disabled={loading}
        >
          {mode === 'login' ? 'E-posta ile Giriş Yap' : 'E-posta ile Kayıt Ol'}
        </button>
      </form>
      <div className="text-center mt-4">
        {mode === 'login' ? (
          <span>
            Hesabınız yok mu?{' '}
            <button className="text-blue-600 hover:underline" onClick={() => setMode('signup')}>Kayıt Ol</button>
          </span>
        ) : (
          <span>
            Zaten hesabınız var mı?{' '}
            <button className="text-blue-600 hover:underline" onClick={() => setMode('login')}>Giriş Yap</button>
          </span>
        )}
      </div>
      <div className="flex items-center my-4">
        <div className="flex-1 h-px bg-gray-300" />
        <span className="mx-2 text-gray-400 text-sm">veya</span>
        <div className="flex-1 h-px bg-gray-300" />
      </div>
      <button
        onClick={handleGoogle}
        className="w-full py-2 mb-4 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center"
        disabled={loading}
      >
        <img src="/google-icon.png" alt="Google" className="w-5 h-5 mr-2" />
        Google ile {mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
      </button>
      {error && <div className="mt-4 text-red-600 text-center">{error}</div>}
      {success && <div className="mt-4 text-green-600 text-center">{success}</div>}
    </div>
  );
} 