import React, { useState } from 'react';
import Head from 'next/head';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <>
      <Head>
        <title>Reset password — KolayXport</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md">
          <h1 className="text-xl font-semibold mb-2">Reset your password</h1>
          <p className="text-sm text-gray-500 mb-6">
            Enter your account email. If we find a match, we'll send a reset link that expires in 1 hour.
          </p>
          {submitted ? (
            <div className="text-sm text-gray-700">
              <p>If an account exists for that email, a reset link has been sent.</p>
              <p className="mt-3"><a href="/login" className="text-blue-600 hover:underline">Back to sign in</a></p>
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
                placeholder="you@example.com"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">
                <a href="/login" className="hover:underline">Back to sign in</a>
              </p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
