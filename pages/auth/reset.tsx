import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const STATUS_LABELS: Record<string, string> = {
  invalid_or_expired: 'This reset link is invalid or expired. Request a new one.',
  password_too_short: 'Password must be at least 12 characters.',
  password_needs_lowercase: 'Password must include a lower-case letter.',
  password_needs_uppercase: 'Password must include an upper-case letter.',
  password_needs_digit: 'Password must include a number.',
  password_needs_special: 'Password must include a special character.',
  password_contains_identity: 'Password must not contain your name or e-mail address.',
  password_too_common: 'This password is too common. Choose a less predictable one.',
  invalid_input: 'Please fill in both fields.',
  internal_error: 'Something went wrong. Try again in a minute.',
  mismatch: "Passwords don't match.",
};

export default function ResetPassword() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <>
      <Head>
        <title>Set new password — KolayXport</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md">
          <h1 className="text-xl font-semibold mb-2">Set a new password</h1>
          {status === 'ok' ? (
            <div className="text-sm text-gray-700">
              <p>Your password has been updated.</p>
              <p className="mt-4">
                <a href="/login" className="text-blue-600 hover:underline">Sign in with your new password</a>
              </p>
            </div>
          ) : !token ? (
            <p className="text-sm text-red-600">Missing reset token. Open the link from your email.</p>
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
                  setStatus(data.ok ? 'ok' : data.error || 'internal_error');
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
                minLength={12}
                autoComplete="new-password"
                placeholder="New password (min 12 chars)"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
                placeholder="Confirm new password"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              {status && status !== 'ok' && (
                <p className="text-xs text-red-600">{STATUS_LABELS[status] || 'Something went wrong.'}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm disabled:opacity-60"
              >
                {loading ? 'Updating…' : 'Set password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
