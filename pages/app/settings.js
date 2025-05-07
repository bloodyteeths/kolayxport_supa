import React from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import { Settings as SettingsIcon } from 'lucide-react'; // Renamed to avoid conflict

// Placeholder for the actual SettingsModal or settings content
// You would import and use your SettingsModal component here
const SettingsContent = () => {
  return (
    <div className="bg-white p-6 md:p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold text-slate-800 mb-6 flex items-center">
        <SettingsIcon size={28} className="mr-3 text-blue-600" />
        Uygulama Ayarları
      </h2>
      <p className="text-slate-600 mb-4">
        Bu bölümde API anahtarlarınızı, entegrasyon tercihlerinizi ve diğer hesap ayarlarınızı yönetebilirsiniz.
      </p>
      <p className="text-slate-500 text-sm">
        (Ayarlar modal/komponent entegrasyonu buraya gelecek.)
      </p>
      {/* Example: <SettingsModal /> */}
    </div>
  );
};

export default function SettingsPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <p className="text-slate-500">Yükleniyor...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      router.push('/auth/signin?callbackUrl=/app/settings');
    }
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <p className="text-slate-500">Giriş sayfasına yönlendiriliyor...</p>
      </div>
    );
  }

  return (
    <AppLayout title="Ayarlar - KolayXport Dashboard">
      <SettingsContent />
    </AppLayout>
  );
} 