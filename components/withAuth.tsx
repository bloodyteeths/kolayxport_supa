import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import AppLayout from './AppLayout';

export default function withAuth(Component: React.ComponentType<any>) {
  return function AuthenticatedComponent(props: any) {
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
      // If not loading and user is not authenticated, redirect to login
      if (!authLoading && !user) {
        // Redirect to main app page which handles OAuth login
        router.push('/app');
      }
    }, [authLoading, user, router]);

    // Show loading state while checking authentication
    if (authLoading) {
      return (
        <AppLayout title="Yükleniyor..." simpleHeader>
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
            <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
            <p className="text-slate-500 text-lg">Hesap durumu kontrol ediliyor...</p>
          </div>
        </AppLayout>
      );
    }

    // If user is not authenticated, show redirecting message
    if (!user) {
      return (
        <AppLayout title="Yönlendiriliyor..." simpleHeader>
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
            <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
            <p className="text-slate-500 text-lg">Giriş sayfasına yönlendiriliyor...</p>
          </div>
        </AppLayout>
      );
    }

    // User is authenticated, render the component
    return <Component {...props} />;
  };
}