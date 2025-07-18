import React from 'react';
import PublicLayout from '../../components/PublicLayout';
import Link from 'next/link';
import { Mail } from 'lucide-react';

export default function ConfirmEmailPage() {
  return (
    <PublicLayout title="Confirm Your Email">
      <div className="flex flex-col items-center justify-center text-center px-4 py-12 md:py-20">
        <Mail className="w-16 h-16 text-blue-500 mb-6" />
        <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
          Check Your Inbox!
        </h1>
        <p className="text-lg text-slate-600 max-w-md mx-auto">
          We've sent a confirmation link to your email address. Please click the link to complete your registration and continue to the pricing page.
        </p>
        <div className="mt-8">
          <Link
            href="/"
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors">
            
              Back to Home
            
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
} 