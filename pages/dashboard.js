import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/router';
import Layout from '@/components/AppLayout';
import Head from 'next/head';

// This could be a more sophisticated Layout component for authenticated users
const AuthenticatedLayout = ({ children }) => {
  // Placeholder for a layout that might include a sidebar, app-specific header, etc.
  // For now, it just renders children. You might want to integrate your existing Layout.js logic here or adapt it.
  return <>{children}</>;
};

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState({
    totalOrders: 0,
    pendingOrders: 0,
    shippedOrders: 0,
    totalRevenue: 0,
    marketplaceBreakdown: []
  });
  const [dateRange, setDateRange] = useState('7days');
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    } else if (user) {
      fetchStats();
    }
  }, [isLoading, user, router, dateRange]);

  const fetchStats = async () => {
    setIsLoadingStats(true);
    setStatsError(null);

    try {
      const response = await fetch('/api/stats?range=' + dateRange);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'İstatistikler yüklenirken bir hata oluştu');
      }

      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
      setStatsError(error.message || 'İstatistikler yüklenirken bir hata oluştu');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleDateRangeChange = (e) => {
    setDateRange(e.target.value);
  };

  // Simple bar chart rendering
  const renderBarChart = (data) => {
    if (!data || !data.length) return null;
    
    const max = Math.max(...data.map(d => d.orders)) * 1.1; // Add 10% for padding
    
    return (
      <div className="mt-4 h-64">
        <div className="flex h-full">
          {data.map((day, i) => (
            <div key={i} className="flex flex-col justify-end items-center flex-1">
              <div 
                className="w-2/3 bg-blue-500 rounded-t"
                style={{ height: `${(day.orders / max) * 100}%` }}
              />
              <div className="text-xs mt-2 text-gray-600">{day.date.split('-').slice(1).join('/')}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <svg className="animate-spin h-10 w-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <Head>
        <title>Kontrol Paneli - KolayXport</title>
      </Head>
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Kontrol Paneli</h1>
          <select
            value={dateRange}
            onChange={handleDateRangeChange}
            className="border rounded p-2"
          >
            <option value="7days">Son 7 Gün</option>
            <option value="30days">Son 30 Gün</option>
            <option value="90days">Son 90 Gün</option>
          </select>
        </div>
        
        {isLoadingStats ? (
          <div className="text-center py-10">
            <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="mt-2 text-gray-600">İstatistikler yükleniyor...</p>
          </div>
        ) : statsError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-700 font-medium">{statsError}</p>
            <button
              onClick={fetchStats}
              className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Tekrar Dene
            </button>
          </div>
        ) : (
          <>
            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-gray-500 text-sm font-medium">Toplam Sipariş</h3>
                <p className="text-3xl font-bold mt-2">{stats.totalOrders}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-gray-500 text-sm font-medium">Bekleyen Siparişler</h3>
                <p className="text-3xl font-bold mt-2 text-yellow-500">{stats.pendingOrders}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-gray-500 text-sm font-medium">Gönderilen Siparişler</h3>
                <p className="text-3xl font-bold mt-2 text-green-500">{stats.shippedOrders}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-gray-500 text-sm font-medium">Toplam Gelir</h3>
                <p className="text-3xl font-bold mt-2">₺{(stats.totalRevenue || 0).toLocaleString()}</p>
              </div>
            </div>
            
            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-medium mb-4">Günlük Siparişler</h3>
                {renderBarChart(stats.dailyData)}
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-medium mb-4">Pazaryeri Dağılımı</h3>
                <div className="space-y-4">
                  {stats.marketplaceBreakdown.map((marketplace, i) => (
                    <div key={i} className="flex items-center">
                      <div className="w-40 flex-shrink-0">
                        <span className="font-medium">{marketplace.name}</span>
                      </div>
                      <div className="flex-grow h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full"
                          style={{
                            width: `${(marketplace.orders / stats.totalOrders) * 100}%`,
                            backgroundColor: marketplace.color
                          }}
                        />
                      </div>
                      <div className="w-16 flex-shrink-0 text-right">
                        <span>{marketplace.orders}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Quick Links */}
            <div className="mt-8 bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-medium mb-4">Hızlı Erişim</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <a 
                  href="/siparisler" 
                  className="flex items-center p-4 border rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-medium">Siparişleri Görüntüle</h4>
                    <p className="text-sm text-gray-500">Tüm siparişleri yönetin ve işleyin</p>
                  </div>
                </a>
                <a 
                  href="/ayarlar" 
                  className="flex items-center p-4 border rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-medium">Ayarlar</h4>
                    <p className="text-sm text-gray-500">Pazaryeri bağlantılarını yapılandırın</p>
                  </div>
                </a>
                <a 
                  href="/support" 
                  className="flex items-center p-4 border rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-medium">Destek</h4>
                    <p className="text-sm text-gray-500">Yardım alın ve sorun bildirin</p>
                  </div>
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </AuthenticatedLayout>
  );
}

// Optional: Server-side protection, though client-side check with useSession is often sufficient for UX
// export async function getServerSideProps(context) {
//   const session = await getSession(context);
//   if (!session) {
//     return {
//       redirect: {
//         destination: '/auth/signin', // Or your custom sign-in page
//         permanent: false,
//       },
//     };
//   }
//   return {
//     props: { session },
//   };
// } 

Dashboard.getLayout = function getLayout(page) {
  return <Layout>{page}</Layout>;
}; 