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
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState('');
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [showManualSetupInstructions, setShowManualSetupInstructions] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [scriptUrl, setScriptUrl] = useState('');

  useEffect(() => {
    console.log('[AppIndexPage Effect] Running effect. Status:', status, 'OnboardingComplete:', onboardingComplete, 'showManualSetup:', showManualSetupInstructions, 'Session User ID:', session?.user?.id);
    
    // Check if we have an authenticated session with a user ID AND initial resource onboarding hasn't completed
    if (status === 'authenticated' && session?.user?.id && !onboardingComplete) {
      console.log('[AppIndexPage Effect] Conditions met for initial resource check/creation. Session:', session);
      
      const checkAndRunOnboarding = async () => {
        console.log('Checking/Initiating onboarding resource creation...');
        setIsOnboarding(true);
        setOnboardingStatus('Hesap kaynakları oluşturuluyor ve kontrol ediliyor...');

        try {
          const res = await fetch('/api/onboarding/setup', { 
            method: 'POST', 
            credentials: 'include'
          });
          const data = await res.json();

          if (!res.ok) {
            // Use error from server response if available, otherwise a generic message
            throw new Error(data.error || `Onboarding resource creation failed. Status: ${res.status}`);
          }

          if (data.success) {
            console.log('Onboarding resource creation successful:', data);
            const { 
              spreadsheetUrl: returnedSheetUrl,
              // scriptWebViewLink: returnedCopiedScriptUrl, // No longer expected
              // userAppsScriptId, // Still available, can be used for other checks if needed
              // manualScriptCopyRequired, // No longer relevant from setup API
              // templateScriptWebViewLinkForManualCopy // No longer relevant from setup API
            } = data.data;

            // let finalScriptUrlToShow; // No longer setting a script URL here
            let criticalLinkMissing = false;

            if (!returnedSheetUrl) {
              console.error('Onboarding critical error: Missing spreadsheetUrl in API response:', data.data);
              setOnboardingStatus('Kurulum hatası: E-Tablo bağlantısı alınamadı. Lütfen destek ile iletişime geçin.');
              criticalLinkMissing = true;
            } else {
              setSheetUrl(returnedSheetUrl); // Store the sheet URL
              // Update status to guide user to the sheet
              setOnboardingStatus(
                <>
                  Kurulum kaynaklarınız oluşturuldu! Lütfen {' '}
                  <a href={returnedSheetUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-primary-600 hover:underline">
                    Google E-Tablonuzu açın
                  </a>
                  {' '} ve "KolayXport" menüsünden "Ayarları Başlat" seçeneğini kullanarak kurulumu tamamlayın.
                </>
              );
              // setOnboardingComplete(true); // This might be premature, onboarding is complete when script is registered.
                                          // Or, redefine OnboardingComplete for this stage.
                                          // For now, let's ensure the user knows the next step.
            }

            // The logic for manualScriptCopyRequired and returnedCopiedScriptUrl is removed
            // as the script is now part of the template sheet.

            if (criticalLinkMissing) {
              setIsOnboarding(false); // Stop loading animation
              // No need to call setScriptUrl as it's removed
              return; // Exit if critical links are missing
            }
            
            // setScriptUrl(finalScriptUrlToShow); // Removed, no script URL to set at this stage
            // The user will be directed to the sheet to initialize the script.
            // Once the script calls back to /api/gscript/register-script-id, the userAppsScriptId
            // will be updated in the DB, and the session.user.googleScriptId will reflect this
            // on subsequent session fetches. This can be used to update UI state.

            // Update UI based on successful sheet creation
            setSheetUrl(returnedSheetUrl); // Ensure sheetUrl is set for display
            // setShowManualSetupInstructions(false); // This should already be false or handled by initial state

            // Consider what happens to isOnboarding state here.
            // If the next step is user action in sheet, maybe keep it true with new message,
            // or set to false if loading is done. For now, let's assume loading is done.
            setIsOnboarding(false);

          } else {
            console.error('Onboarding resource creation failed as reported by server:', data.error, data.details);
            setOnboardingStatus(`Kurulum sırasında sunucu taraflı bir hata oluştu: ${data.error || 'Bilinmeyen sunucu hatası.'}`);
            setIsOnboarding(false); // Stop loading animation, allow user to see error or retry
          }

        } catch (error) { 
          console.error('Onboarding process error (client-side catch):', error);
          setOnboardingStatus(`Kurulum sırasında bir hata oluştu: ${error.message}`);
          setIsOnboarding(false); // Stop loading animation
        }
        // No finally block to set setIsOnboarding(false) here, as it's handled in success/error paths.
        // If showManualSetupInstructions becomes true, isOnboarding should be false.
      };

      // Only run if not already showing manual instructions (prevents re-running if effect re-triggers)
      if (!showManualSetupInstructions) {
        checkAndRunOnboarding();
      }

    } else if (status === 'authenticated' && session?.user?.id && onboardingComplete && !showManualSetupInstructions) {
      // This case means onboarding resources ARE complete from a previous session/load,
      // but the user hasn't seen the manual setup instructions yet.
      // We need to fetch the URLs if they are not in state (e.g. after a page reload)
      // For simplicity now, if they are in session, AppLayout might redirect to settings,
      // or we assume if onboardingComplete is true, they should see DashboardLandingContent.
      // This logic might need refinement based on how `onboardingComplete` is persisted and used across sessions.
      // For now, if onboardingComplete is true, we will show DashboardLandingContent directly.
      // The manual instructions are primarily for the *first time* after resource creation.
      console.log('[AppIndexPage Effect] Onboarding resources previously completed. Showing main dashboard content.');

    } else {
        console.log('[AppIndexPage Effect] Conditions NOT met for onboarding trigger (status, session, or onboardingComplete already true).');
    }
  // Removed `update` from dependency array as it can cause loops if not careful
  // session object itself can be unstable if it changes frequently. session?.user?.id is more stable.
  }, [status, onboardingComplete, session?.user?.id, showManualSetupInstructions]); 

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
      {isOnboarding && !showManualSetupInstructions && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-700 text-lg font-medium animate-pulse">{onboardingStatus || 'Hesap kurulumu yapılıyor...'}</p>
            <p className="text-slate-500 text-sm mt-1">Bu işlem birkaç saniye sürebilir, lütfen bekleyin.</p>
        </div>
      )}

      {showManualSetupInstructions && (
        <div className="p-4 md:p-8 max-w-2xl mx-auto bg-white shadow-lg rounded-lg mt-10">
          <h2 className="text-2xl font-semibold text-blue-700 mb-4">Kurulum Neredeyse Tamamlandı!</h2>
          <p className="text-slate-600 mb-6">
            Temel Google Drive klasörünüz ve Google E-Tablonuz oluşturuldu. Lütfen aşağıdaki adımları izleyerek KolayXport'u kullanmaya başlayın:
          </p>
          
          <div className="space-y-4 mb-8">
            <div>
              <a 
                href={sheetUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-green-600 hover:bg-green-700 w-full md:w-auto"
              >
                Adım 1: Google E-Tablonuzu Açın
              </a>
              <p className="text-sm text-slate-500 mt-1">E-tablo açıldığında, üst menüde "KolayXport" menüsünün görünmesini bekleyin.</p>
            </div>
            <div>
              <a 
                href={scriptUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-orange-500 hover:bg-orange-600 w-full md:w-auto"
              >
                Adım 2: Kurulum Komut Dosyasını Açın (Opsiyonel)
              </a>
              <p className="text-sm text-slate-500 mt-1">Bu komut dosyasını (script) ayrıca açmanıza gerek yoktur, E-Tablo içerisinden çalışacaktır. İncelemek isterseniz buradan erişebilirsiniz.</p>
            </div>
          </div>

          <div className="bg-blue-50 p-4 rounded-md">
            <h3 className="text-lg font-semibold text-blue-800 mb-2">E-Tablo Üzerindeki Adımlar:</h3>
            <ol className="list-decimal list-inside text-slate-700 space-y-1">
              <li>E-tablonuzda üst menüde beliren <strong>KolayXport</strong> menüsüne tıklayın.</li>
              <li>Açılan menüden <strong>Ayarları Başlat (Initialize Settings)</strong> seçeneğini seçin.</li>
              <li>Gerekirse sizden istenen bilgileri (örneğin, FedEx Klasör ID'si) girin ve onaylayın.</li>
              <li>Bu işlem tamamlandıktan sonra bu sayfaya geri dönün.</li>
            </ol>
          </div>

          <div className="mt-8 text-center">
            <p className="text-slate-600 mb-3">Yukarıdaki adımları tamamladıktan sonra, uygulamanın diğer ayarlarını yapılandırmak ve kullanmaya başlamak için devam edebilirsiniz.</p>
            <button
              onClick={() => {
                // Potentially re-check session or redirect to settings
                // For now, just hide these instructions and assume user will navigate
                setShowManualSetupInstructions(false); 
                // router.push('/app/settings'); // Or navigate to a relevant page
                // We might want to force a refresh of the page/session here
                // to ensure AppLayout correctly determines if onboarding is "fully" complete
                router.reload(); // Force reload to re-evaluate session and onboarding status
              }}
              className="px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Ayarları Tamamladım, Devam Et
            </button>
          </div>
        </div>
      )}

      {!isOnboarding && onboardingComplete && !showManualSetupInstructions && (
        // This is the state where initial resources are created AND user has acknowledged manual setup instructions
        // (or reloaded the page after completing them)
        <DashboardLandingContent />
      )}
      
      {!isOnboarding && !onboardingComplete && status === 'authenticated' && !showManualSetupInstructions && ( 
         // This case now means: authenticated, but the initial fetch to /api/onboarding/setup failed or hasn't run
         <div className="text-center p-10 bg-white rounded shadow">
            <h2 className="text-xl font-semibold text-red-600">Kurulum Başlatılamadı</h2>
            <p className="text-slate-600 mt-2">
              {onboardingStatus || "Hesap kaynakları oluşturma işlemi başlatılamadı veya bir hata oluştu."}
            </p>
            <p className="text-slate-500 mt-2">
                Lütfen sayfayı yenileyerek tekrar deneyin. Sorun devam ederse destek ile iletişime geçin.
            </p>
            <button 
                onClick={() => router.reload()}
                className="mt-4 px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
                Sayfayı Yenile
            </button>
          </div>
      )}
    </AppLayout>
  );
} 