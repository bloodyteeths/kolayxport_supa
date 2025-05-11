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
  const [isLoadingResources, setIsLoadingResources] = useState(false); // Renamed from isOnboarding for clarity
  const [resourceStatusMessage, setResourceStatusMessage] = useState(''); // Renamed from onboardingStatus
  
  // State for the new manual copy flow
  const [showManualCopyLink, setShowManualCopyLink] = useState(false);
  const [copySheetUrl, setCopySheetUrl] = useState('');
  const [driveFolderIdFromApi, setDriveFolderIdFromApi] = useState('');

  // Derived state to check if core setup seems complete from session
  const coreSetupComplete = !!(session?.user?.googleSheetId && session?.user?.googleScriptId);

  useEffect(() => {
    console.log('[AppIndexPage Effect] Running effect. Status:', status, 'CoreSetupComplete:', coreSetupComplete, 'showManualCopyLink:', showManualCopyLink, 'Session User ID:', session?.user?.id);
    
    let pollIntervalId = null;

    // If authenticated, user ID exists, and core setup is NOT complete, and we are NOT already showing the manual copy link
    if (status === 'authenticated' && session?.user?.id && !coreSetupComplete && !showManualCopyLink) {
      console.log('[AppIndexPage Effect] Conditions met for initial resource check/creation. Session:', session);
      
      const checkAndPrepareManualCopy = async () => {
        console.log('Checking/Preparing for manual sheet copy...');
        setIsLoadingResources(true);
        setResourceStatusMessage('Google Drive klasörünüz hazırlanıyor ve E-Tablo kopyalama bağlantınız oluşturuluyor...');

        try {
          const res = await fetch('/api/onboarding/setup', { 
            method: 'POST', 
            credentials: 'include' // Important for sending session cookie
          });
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || `Resource preparation failed. Status: ${res.status}`);
          }

          if (data.success && data.data?.copyUrl && data.data?.driveFolderId) {
            console.log('Resource preparation successful:', data.data);
            setCopySheetUrl(data.data.copyUrl);
            setDriveFolderIdFromApi(data.data.driveFolderId); // Store if needed, e.g. for instructions
            setShowManualCopyLink(true); // This will trigger the UI update
            setResourceStatusMessage( // This message might be briefly visible before UI changes
              'Klasörünüz hazır! Lütfen aşağıdaki bağlantıyı kullanarak E-Tablo şablonunu kopyalayın.'
            );

            // Start polling for session updates once copy link is shown
            if (!pollIntervalId) { // Check to prevent multiple intervals if effect re-runs quickly
              pollIntervalId = setInterval(async () => {
                console.log('[AppIndexPage Polling] Checking session for updates...');
                await update(); // Force re-fetch of session from NextAuth
              }, 5000); // Poll every 5 seconds
            }

          } else {
            console.error('API success was true but copyUrl or driveFolderId missing:', data);
            throw new Error('Önemli bilgiler (kopyalama bağlantısı veya klasör ID) sunucudan alınamadı.');
          }
        } catch (error) { 
          console.error('Resource preparation error (client-side catch):', error);
          setResourceStatusMessage(`Kaynak hazırlama sırasında bir hata oluştu: ${error.message}. Lütfen sayfayı yenileyin veya destek ile iletişime geçin.`);
          // setShowManualCopyLink(false); // Keep it false or handle retry logic
        } finally {
          setIsLoadingResources(false); // Stop loading animation
        }
      };

      checkAndPrepareManualCopy();

    } else if (status === 'authenticated' && coreSetupComplete) {
      console.log('[AppIndexPage Effect] Core setup already complete. Showing dashboard.');
      // No specific action needed here, the main return will handle showing dashboard content.
      // Ensure isLoadingResources is false if it was somehow true.
      if (isLoadingResources) setIsLoadingResources(false);
      if (showManualCopyLink) setShowManualCopyLink(false); // Hide manual link if setup is complete
      
      // If core setup is now complete, clear any polling interval
      if (pollIntervalId) {
        console.log('[AppIndexPage Effect] Core setup complete, clearing poll interval.');
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    } else {
        console.log('[AppIndexPage Effect] Conditions NOT met for resource preparation trigger.');
        // Clear interval if conditions are no longer met (e.g., user logs out)
        if (pollIntervalId) {
            console.log('[AppIndexPage Effect] Conditions no longer met, clearing poll interval.');
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
    }

    // Cleanup function for useEffect
    return () => {
      if (pollIntervalId) {
        console.log('[AppIndexPage Cleanup] Clearing poll interval on component unmount/effect re-run.');
        clearInterval(pollIntervalId);
      }
    };
  }, [status, coreSetupComplete, session?.user?.id, showManualCopyLink, isLoadingResources, update]); // Added update to dependencies

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
      {isLoadingResources && !showManualCopyLink && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-700 text-lg font-medium animate-pulse">{resourceStatusMessage || 'Hesap kaynakları hazırlanıyor...'}</p>
            <p className="text-slate-500 text-sm mt-1">Bu işlem birkaç saniye sürebilir, lütfen bekleyin.</p>
        </div>
      )}

      {showManualCopyLink && !coreSetupComplete && (
        <div className="p-4 md:p-8 max-w-2xl mx-auto bg-white shadow-lg rounded-lg mt-10">
          <h2 className="text-2xl font-semibold text-blue-700 mb-4">Kurulum İçin Son Bir Adım!</h2>
          <p className="text-slate-600 mb-3">
            KolayXport'u kullanmaya başlamak için lütfen aşağıdaki adımları izleyin:
          </p>
          <p className="text-sm text-slate-500 mb-6">
            Google Drive klasörünüz (<code>{driveFolderIdFromApi || 'KolayXport Kullanıcı Dosyaları'}</code>) hazırlandı.
          </p>
          
          <div className="space-y-4 mb-8">
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-md">
              <h3 className="text-lg font-medium text-blue-800 mb-2">Adım 1: E-Tablo Şablonunu Kopyalayın</h3>
              <p className="text-slate-700 mb-3">
                Aşağıdaki düğmeye tıklayarak KolayXport E-Tablo şablonunun bir kopyasını kendi Google Drive'ınıza oluşturun.
              </p>
              <a 
                href={copySheetUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-green-600 hover:bg-green-700 w-full md:w-auto transition-colors"
              >
                E-Tablo Şablonunu Kopyala
              </a>
              <p className="text-sm text-slate-600 mt-3">
                <strong>Önemli:</strong> Kopyalama sırasında "Klasör" seçeneğini düzenleyerek, bu kopyayı Google Drive'ınızdaki 
                "<code>KolayXport Kullanıcı Dosyaları - {session?.user?.name || session?.user?.id}</code>" isimli klasörün içine kaydettiğinizden emin olun.
              </p>
            </div>

            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-md">
              <h3 className="text-lg font-medium text-amber-800 mb-2">Adım 2: Ayarları Başlatın</h3>
              <p className="text-slate-700">
                Kopyaladığınız yeni E-Tabloyu açın. Üst menüde "KolayXport" seçeneğini bulun, ardından "Ayarları Başlat" (veya "Initialize Settings") komutunu çalıştırın. 
                Bu işlem, E-Tablonuzu KolayXport hesabınızla eşleştirecektir.
              </p>
            </div>
             <p className="text-sm text-slate-500 mt-4">
                Bu adımları tamamladıktan sonra, bu sayfa otomatik olarak güncellenecek veya uygulamayı kullanmaya devam etmek için sayfayı yenileyebilirsiniz.
             </p>
          </div>
          
          <p className="text-xs text-slate-400">
            Sorun yaşarsanız veya yardıma ihtiyacınız olursa lütfen <Link href="/iletisim"><a className="underline hover:text-blue-600">destek sayfamızdan</a></Link> bize ulaşın.
          </p>
        </div>
      )}

      {!isLoadingResources && !showManualCopyLink && coreSetupComplete && (
        <DashboardLandingContent />
      )}
      
      {/* Fallback or initial state if no other condition is met (e.g. still checking session) */}
      {!isLoadingResources && !showManualCopyLink && !coreSetupComplete && status === 'authenticated' && (
         <div className="flex items-center justify-center min-h-[calc(100vh-200px)]"> 
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            <p className="ml-3 text-slate-600">Hesap durumu kontrol ediliyor...</p>
         </div>
      )}

    </AppLayout>
  );
} 