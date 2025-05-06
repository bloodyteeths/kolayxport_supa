import React from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout'; // Adjusted path
import Dashboard from '../../components/Dashboard'; // Adjusted path

export default function AppIndexPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === 'loading') {
    // You might want a more sophisticated global loading state or skeleton screens
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <p className="text-slate-500">Yükleniyor...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    // Redirect to sign-in if not authenticated
    // Consider handling this at a higher level (e.g., _app.js or a custom route guard) for all /app routes
    if (typeof window !== 'undefined') {
      router.push('/auth/signin?callbackUrl=/app');
    }
    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <p className="text-slate-500">Giriş sayfasına yönlendiriliyor...</p>
        </div>
    ); 
  }

  // User is authenticated
  return (
    <AppLayout title="Genel Bakış - KolayXport Dashboard">
      <Dashboard />
    </AppLayout>
  );
} 