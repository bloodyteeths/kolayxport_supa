import React from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import Link from 'next/link';
import { Gift, Zap, Share2 } from 'lucide-react'; // Icons for the page

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
      <DashboardLandingContent />
    </AppLayout>
  );
} 