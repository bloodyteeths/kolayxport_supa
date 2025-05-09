import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import Link from 'next/link';
import { Gift, Zap, Share2, Loader2 } from 'lucide-react'; // Icons for the page and Loader2

// This will be the new content for the dashboard landing page.
// The existing <Dashboard /> component can be integrated here or replaced.
const DashboardLandingContent = () => {
  return (
    <div className="space-y-8">
      <div className="bg-white p-6 md:p-8 rounded-lg shadow-md">
        <div className="flex items-center mb-4">
          <Zap size={32} className="mr-3 text-blue-600" />
          <h1 className="text-3xl font-bold text-slate-800">KolayXport'a Hoş Geldiniz!</h1>
        </div>
        <p className="text-lg text-slate-700 mb-3">
          Harika bir haberimiz var! KolayXport artık yayında ve e-ticaret operasyonlarınızı kolaylaştırmak için burada.
        </p>
        <p className="text-slate-600">
          Siparişlerinizi tek bir yerden yönetin, kargo süreçlerinizi hızlandırın ve en popüler pazaryerleriyle kolayca entegre olun.
        </p>
      </div>

      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-6 md:p-8 rounded-lg shadow-lg">
        <div className="flex items-center mb-3">
          <Gift size={28} className="mr-3" />
          <h2 className="text-2xl font-semibold">Her Şey ÜCRETSİZ! (Şimdilik!)</h2>
        </div>
        <p className="mb-4">
          Lansmanımıza özel olarak, KolayXport'un tüm temel özelliklerini ve entegrasyonlarını hiçbir ücret ödemeden kullanabilirsiniz. Bu fırsatı kaçırmayın, hemen tüm özelliklerimizi keşfedin!
        </p>
        <Link href="/ozellikler" legacyBehavior>
          <a className="inline-block px-6 py-2 text-sm font-semibold bg-white text-blue-600 rounded-md hover:bg-blue-50 transition-colors">
            Özellikleri Keşfet
          </a>
        </Link>
      </div>
      
      <div className="bg-white p-6 md:p-8 rounded-lg shadow-md">
        <div className="flex items-center mb-3">
          <Share2 size={28} className="mr-3 text-green-600" />
          <h2 className="text-2xl font-semibold text-slate-800">KolayXport'u Arkadaşlarınla Paylaş!</h2>
        </div>
        <p className="text-slate-600 mb-4">
          KolayXport'u beğendiyseniz ve e-ticaretle uğraşan arkadaşlarınızın da işini kolaylaştırabileceğini düşünüyorsanız, lütfen onlarla paylaşın! Desteğiniz bizim için çok değerli.
        </p>
        {/* Add social share buttons here if desired */}
      </div>

      <div className="bg-white p-6 md:p-8 rounded-lg shadow-md">
        <h2 className="text-2xl font-semibold text-slate-800 mb-4">Son Güncellemeler</h2>
        <ul className="list-disc list-inside text-slate-600 space-y-2">
          <li>KolayXport platformu başarıyla yayına alındı!</li>
          <li>Tüm temel pazaryeri ve kargo entegrasyonları aktif.</li>
          <li>Tailwind CSS v4 ile modern ve hızlı bir arayüz sunuyoruz.</li>
          <li>İletişim formu aktif, geri bildirimlerinizi bekliyoruz.</li>
          {/* Add more updates here as they happen */}
        </ul>
      </div>
    </div>
  );
};

export default function AppIndexPage() {
  console.log('[AppIndexPage Render] Component rendering...'); // Log component render
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState('');
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    console.log('[AppIndexPage Effect] Running effect. Status:', status, 'OnboardingComplete:', onboardingComplete, 'Session User ID:', session?.user?.id); // Updated log
    
    // Check if we have an authenticated session with a user ID AND onboarding hasn't completed
    if (status === 'authenticated' && session?.user?.id && !onboardingComplete) {
      console.log('[AppIndexPage Effect] Conditions met. Session:', session);
      
      const checkAndRunOnboarding = async () => {
        console.log('Checking onboarding status...');
        setIsOnboarding(true);
        setOnboardingStatus('Hesap kurulumu kontrol ediliyor...');

        try {
          const res = await fetch('/api/onboarding/setup', { 
            method: 'POST', 
            credentials: 'include'
          });
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Onboarding check/setup failed.');
          }

          if (data.success) {
            console.log('Onboarding response:', data);
            const { driveFolderId, userAppsScriptId } = data.data;

            if (!driveFolderId) {
                 console.error('Onboarding succeeded but driveFolderId missing in response.');
                 setOnboardingStatus('Kurulum tamamlandı ancak klasör bilgisi eksik. Lütfen destek ile iletişime geçin.');
                 return; 
            }

            setOnboardingStatus('Temel ayarlar yapılıyor (Klasör ID kaydediliyor)... ');
            try {
              const setPropRes = await fetch('/api/gscript/set-user-property', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ propertyName: 'FEDEX_FOLDER_ID', value: driveFolderId })
              });
              const setPropData = await setPropRes.json();

              if (!setPropRes.ok) {
                throw new Error(setPropData.message || 'Failed to save FEDEX_FOLDER_ID');
              }
              
              console.log('Successfully set FEDEX_FOLDER_ID in UserProperties', setPropData);
              setOnboardingStatus('Kurulum başarıyla tamamlandı!');
              setOnboardingComplete(true);

            } catch (setPropertyError) {
              console.error('Failed to set FEDEX_FOLDER_ID after onboarding:', setPropertyError);
              setOnboardingStatus(`Kurulum tamamlandı, ancak FEDEX_FOLDER_ID ayarı kaydedilemedi: ${setPropertyError.message}. Lütfen Ayarlar sayfasından tekrar deneyin veya destek ile iletişime geçin.`);
              setOnboardingComplete(true);
            }

          } else {
            throw new Error(data.message || 'Onboarding check returned success:false');
          }

        } catch (error) {
          console.error('Onboarding process error:', error);
          setOnboardingStatus(`Kurulum sırasında bir hata oluştu: ${error.message}`);
        } finally {
           if (!onboardingComplete) {
                setTimeout(() => setIsOnboarding(false), 3000);
           }
        }
      };

      checkAndRunOnboarding();
    } else {
        console.log('[AppIndexPage Effect] Conditions NOT met for onboarding trigger.');
    }
  }, [status, onboardingComplete, session?.user?.id]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <p className="text-slate-500">Yükleniyor...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      router.push('/auth/signin?callbackUrl=/app');
    }
    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <p className="text-slate-500">Giriş sayfasına yönlendiriliyor...</p>
        </div>
    ); 
  }

  return (
    <AppLayout title="Genel Bakış - KolayXport Dashboard">
      {isOnboarding && !onboardingComplete && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-700 text-lg font-medium animate-pulse">{onboardingStatus || 'Hesap kurulumu yapılıyor...'}</p>
            <p className="text-slate-500 text-sm mt-1">Bu işlem birkaç saniye sürebilir, lütfen bekleyin.</p>
        </div>
      )}
      {onboardingComplete && <DashboardLandingContent />}
      {!isOnboarding && !onboardingComplete && status === 'authenticated' && ( 
         <div className="text-center p-10 bg-white rounded shadow">
            <h2 className="text-xl font-semibold text-red-600">Kurulum Başlatılamadı</h2>
            <p className="text-slate-600 mt-2">Hesap kurulumu durumu kontrol edilemedi veya başlatılamadı. Lütfen sayfayı yenileyin veya destek ile iletişime geçin.</p>
          </div>
      )}
    </AppLayout>
  );
} 