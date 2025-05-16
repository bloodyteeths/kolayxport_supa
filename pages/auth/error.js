import React from 'react';
// import Layout from '@/components/Layout'; // Old Layout removed
import PublicLayout from '../../components/PublicLayout'; // New PublicLayout imported
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function AuthErrorPage() {
  const { query } = useRouter();
  const error = query.error || 'unknown_error';

  // Determine a user-friendly message based on common errors
  let errorMessage = "Bir şeyler ters gitti. Lütfen tekrar deneyin.";
  if (error === "OAuthAccountNotLinked") {
    errorMessage = "Bu e-posta adresi zaten farklı bir giriş yöntemiyle kullanılıyor. Lütfen diğer yöntemle giriş yapmayı deneyin.";
  } else if (error === "Callback" || error === "OAuthCallback") {
    errorMessage = "Giriş sırasında bir sorun oluştu. Lütfen daha sonra tekrar deneyin veya destek ile iletişime geçin.";
  }
  // Add more specific error messages as needed

  return (
    <PublicLayout title="Giriş Hatası">
      <div className="flex flex-col items-center justify-center text-center px-4 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-bold text-red-600 mb-6">Giriş Yapılamadı</h1>
        <p className="text-lg text-slate-700 mb-4">
          {errorMessage}
        </p>
        {error && error !== 'unknown_error' && (
          <p className="text-sm text-slate-500 mb-6">
            Hata Kodu: <code className="bg-slate-100 p-1 rounded">{error}</code>
          </p>
        )}
        <Link href="/">
          <a className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors">
            Ana Sayfaya Dön
          </a>
        </Link>
      </div>
    </PublicLayout>
  );
} 