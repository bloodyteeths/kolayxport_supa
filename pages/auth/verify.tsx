import React from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const STATUS_TITLES: Record<string, string> = {
  ok: 'Email verified',
  invalid: 'Verification failed',
  not_found: 'Verification failed',
  wrong_purpose: 'Verification failed',
  expired: 'This link has expired',
  already_consumed: 'This link has already been used',
};

const STATUS_BODIES: Record<string, string> = {
  ok: 'Your email is confirmed. You can now sign in to KolayXport.',
  invalid: 'The link is invalid. Request a new verification email from the sign-in page.',
  not_found: 'The link is invalid. Request a new verification email from the sign-in page.',
  wrong_purpose: 'The link is invalid. Request a new verification email from the sign-in page.',
  expired: 'Please request a new verification email from the sign-in page.',
  already_consumed: 'This link was already used. If you need to verify a different email, sign up again.',
};

export default function VerifyEmail() {
  const router = useRouter();
  const status = typeof router.query.status === 'string' ? router.query.status : '';

  const title = STATUS_TITLES[status] || 'Verification failed';
  const body = STATUS_BODIES[status] || 'Open the link from your email, or request a new one.';

  return (
    <>
      <Head>
        <title>Email verification — KolayXport</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">{title}</h1>
          <p className="text-sm text-gray-600 mb-6">{body}</p>
          <a
            href="/login"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white py-2 px-5 rounded-lg text-sm"
          >
            Go to sign in
          </a>
        </div>
      </div>
    </>
  );
}
