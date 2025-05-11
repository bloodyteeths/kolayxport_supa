import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import Link from 'next/link';
import { Gift, Zap, Share2, Loader2, ExternalLink, Info } from 'lucide-react'; // Added ExternalLink, Info
// import { supabase } from '@/lib/supabase'; // REMOVED: Use supabase from useAuth or import createClient if needed

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
  console.log('[AppIndexPage Render] Component rendering...');
  const { user, session, authLoading, refreshUser, supabaseSignInWithGoogle, supabase } = useAuth(); // Added supabase from useAuth
  const router = useRouter();
  
  const [onboardingState, setOnboardingState] = useState('initial'); // 'initial', 'loadingSetup', 'promptManualCopy', 'setupComplete', 'error'
  const [onboardingError, setOnboardingError] = useState('');
  const [googleSheetCopyUrl, setGoogleSheetCopyUrl] = useState('');
  const [onboardingInstructions, setOnboardingInstructions] = useState([]);

  // Derived state: is the user authenticated?
  const isAuthenticated = !!user && !!session;
  // Derived state: is core setup (sheet ID and script ID in metadata) complete?
  const coreSetupComplete = !!(user?.user_metadata?.googleSheetId && user?.user_metadata?.googleScriptId);

  useEffect(() => {
    console.log(`[AppIndexPage Effect] AuthLoading: ${authLoading}, IsAuthenticated: ${isAuthenticated}, CoreSetupComplete: ${coreSetupComplete}, OnboardingState: ${onboardingState}`);

    if (authLoading) {
      setOnboardingState('initial'); // Reset while auth is loading
      return;
    }

    if (!isAuthenticated) {
      // This should ideally be handled by AppLayout or a higher-order component,
      // but if user reaches here unauthenticated, trigger sign-in.
      console.log('[AppIndexPage Effect] User not authenticated, attempting sign in.');
      supabaseSignInWithGoogle(); // Or router.push('/login');
      return;
    }

    // User is authenticated
    if (coreSetupComplete) {
      console.log('[AppIndexPage Effect] Core setup is complete.');
      setOnboardingState('setupComplete');
      return;
    }

    // User is authenticated, but core setup is NOT complete
    if (onboardingState === 'initial' || onboardingState === 'error') { // Only fetch setup if initial or retrying from error
      console.log('[AppIndexPage Effect] Authenticated, core setup incomplete. Fetching onboarding setup.');
      setOnboardingState('loadingSetup');
      setOnboardingError('');
      
      fetch('/api/onboarding/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // credentials: 'include' // Not needed if using Supabase client for auth token on server
      })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || `Onboarding setup failed. Status: ${res.status}`);
        }
        if (data.googleSheetCopyUrl && data.instructions) {
          console.log('[AppIndexPage Effect] Onboarding setup fetched:', data);
          setGoogleSheetCopyUrl(data.googleSheetCopyUrl);
          setOnboardingInstructions(data.instructions || []);
          setOnboardingState('promptManualCopy');
        } else {
          throw new Error('Onboarding setup data is incomplete from server.');
        }
      })
      .catch(err => {
        console.error('[AppIndexPage Effect] Onboarding setup API error:', err);
        setOnboardingError(err.message || 'Onboarding setup could not be initiated.');
        setOnboardingState('error');
      });
    }
  }, [authLoading, isAuthenticated, coreSetupComplete, onboardingState, supabaseSignInWithGoogle, router]);

  // Polling mechanism to refresh user data if they are in the manual copy step
  useEffect(() => {
    let pollIntervalId = null;
    if (onboardingState === 'promptManualCopy' && isAuthenticated && !coreSetupComplete) {
      console.log('[AppIndexPage Polling Effect] Starting polling for user metadata updates.');
      pollIntervalId = setInterval(async () => {
        console.log('[AppIndexPage Polling] Refreshing user session...');
        await refreshUser(); 
      }, 7000); // Poll every 7 seconds
    }
    return () => {
      if (pollIntervalId) {
        console.log('[AppIndexPage Polling Effect] Clearing poll interval.');
        clearInterval(pollIntervalId);
      }
    };
  }, [onboardingState, isAuthenticated, coreSetupComplete, refreshUser]);


  if (authLoading || (isAuthenticated && onboardingState === 'initial')) {
    return (
      <AppLayout title="Yükleniyor...">
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
          <p className="text-slate-700 text-lg">Yükleniyor, lütfen bekleyin...</p>
        </div>
      </AppLayout>
    );
  }

  if (!isAuthenticated && !authLoading) { // Explicitly handle if not authenticated after loading
    return (
      <AppLayout title="Giriş Gerekli">
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
            <Info size={48} className="text-blue-500 mb-4" />
            <p className="text-slate-700 text-lg mb-2">Bu sayfayı görüntülemek için giriş yapmanız gerekmektedir.</p>
            <p className="text-slate-500 text-sm">Giriş sayfasına yönlendiriliyorsunuz...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={coreSetupComplete ? "Genel Bakış - KolayXport" : "Kurulum - KolayXport"}>
      {onboardingState === 'loadingSetup' && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-700 text-lg font-medium animate-pulse">Kurulum bilgileri hazırlanıyor...</p>
            <p className="text-slate-500 text-sm mt-1">Bu işlem birkaç saniye sürebilir.</p>
        </div>
      )}

      {onboardingState === 'error' && (
         <div className="p-4 md:p-8 max-w-2xl mx-auto bg-red-50 border-l-4 border-red-500 text-red-700 mt-10 rounded-md shadow-lg">
          <h2 className="text-2xl font-semibold mb-3">Kurulum Hatası</h2>
          <p className="mb-2">Otomatik kurulum başlatılırken bir sorun oluştu:</p>
          <p className="text-sm bg-red-100 p-2 rounded mb-4">{onboardingError}</p>
          <p className="text-sm">Lütfen sayfayı yenileyerek tekrar deneyin. Sorun devam ederse <Link href="/iletisim" className="font-medium hover:underline">destek ile iletişime geçin</Link>.</p>
        </div>
      )}

      {onboardingState === 'promptManualCopy' && !coreSetupComplete && (
        <div className="p-4 md:p-8 max-w-3xl mx-auto bg-white shadow-lg rounded-lg mt-6 mb-6">
          <h2 className="text-2xl font-semibold text-blue-700 mb-3">Kurulum Adımları</h2>
          <p className="text-slate-600 mb-6">
            KolayXport'u tam olarak kullanmaya başlamak için lütfen aşağıdaki adımları tamamlayın.
            Bu adımları tamamladıktan sonra bu sayfa otomatik olarak güncellenecektir.
          </p>
          
          <div className="space-y-6">
            {googleSheetCopyUrl && (
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-md">
                <h3 className="text-lg font-medium text-blue-800 mb-2">Adım 1: Google E-Tablo Şablonunu Kopyalayın</h3>
                <p className="text-slate-700 mb-3">
                  Kendi Google Drive hesabınıza KolayXport E-Tablo şablonunun bir kopyasını oluşturun.
                </p>
                <a 
                  href={googleSheetCopyUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 transition-colors"
                >
                  E-Tabloyu Kopyala <ExternalLink size={16} className="ml-2" />
                </a>
              </div>
            )}

            {onboardingInstructions && onboardingInstructions.slice(1).map((instruction, index) => (
                <div key={index} className="bg-sky-50 border-l-4 border-sky-500 p-4 rounded-md">
                 <h3 className="text-lg font-medium text-sky-800 mb-2">{`Adım ${index + 2}`}</h3>
                 <p className="text-slate-700 whitespace-pre-line">{instruction.split('. ')[1]}</p> {/* Basic formatting for instruction */}
               </div>
            ))}
             <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded-md">
                 <h3 className="text-lg font-medium text-yellow-800 mb-2">Önemli Not</h3>
                 <p className="text-slate-700">
                   Tüm adımları tamamladıktan sonra, oluşturduğunuz yeni Google Sheet ID'sini ve Apps Script Deployment ID'sini <Link href="/app/settings" className="font-medium text-blue-600 hover:underline">Ayarlar</Link> sayfasındaki ilgili alanlara kaydetmeyi unutmayın.
                 </p>
            </div>
          </div>
          
          <p className="text-xs text-slate-400 mt-8">
            Sorun yaşarsanız veya yardıma ihtiyacınız olursa <Link href="/iletisim" className="underline hover:text-blue-600">destek sayfamızdan</Link> bize ulaşın.
          </p>
        </div>
      )}

      {onboardingState === 'setupComplete' && coreSetupComplete && (
        <DashboardLandingContent />
      )}
      
      {/* Fallback for authenticated but no other state met (should be brief) */}
      {isAuthenticated && onboardingState !== 'loadingSetup' && onboardingState !== 'promptManualCopy' && onboardingState !== 'setupComplete' && onboardingState !== 'error' && (
         <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]"> 
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-3" />
            <p className="text-slate-600">Hesap durumu kontrol ediliyor...</p>
         </div>
      )}
    </AppLayout>
  );
} 