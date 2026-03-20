import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import Layout from '@/components/AppLayout';
import { toast } from 'react-hot-toast';

export default function Orders() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [selectedItems, setSelectedItems] = useState([]);
  const [isGeneratingLabels, setIsGeneratingLabels] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    } else if (user) {
      fetchOrders();
    }
  }, [isLoading, user, router]);

  const fetchOrders = async () => {
    setIsLoadingOrders(true);
    try {
      // Fetch orders with their items (include all required fields)
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id,
          customerName,
          notes,
          status,
          shipByDate,
          marketplace,
          marketplaceKey,
          items:order_items(
            id,
            image,
            variantInfo,
            notes,
            status,
            shipBy,
            marketplaceKey
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (ordersError) throw ordersError;
      
      // Fetch label jobs for each item
      const ordersWithItems = await Promise.all(
        ordersData.map(async (order) => {
          const items = await Promise.all(
            order.items.map(async (item) => {
              const { data: labelJobs, error: labelError } = await supabase
                .from('label_jobs')
                .select('*')
                .eq('item_id', item.id);
                
              if (labelError) throw labelError;
              
              return {
                ...item,
                labelJobs: labelJobs || []
              };
            })
          );
          
          return {
            ...order,
            items
          };
        })
      );
      
      setOrders(ordersWithItems || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('Siparişler yüklenirken bir sorun oluştu');
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleItemSelection = (itemId) => {
    if (selectedItems.includes(itemId)) {
      setSelectedItems(selectedItems.filter(id => id !== itemId));
    } else {
      setSelectedItems([...selectedItems, itemId]);
    }
  };

  const handleGenerateLabels = async () => {
    if (selectedItems.length === 0) {
      toast.error('Lütfen en az bir ürün seçin');
      return;
    }
    
    setIsGeneratingLabels(true);
    
    try {
      const response = await fetch('/api/labels/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemIds: selectedItems }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Label generation failed');
      }
      
      toast.success(`${result.success.length} etiket başarıyla oluşturuldu`);
      
      if (result.errors && result.errors.length > 0) {
        toast.error(`${result.errors.length} etiket oluşturulamadı`);
      }
      
      // Refresh the orders list
      fetchOrders();
      // Clear selections
      setSelectedItems([]);
      
    } catch (error) {
      console.error('Error generating labels:', error);
      toast.error('Etiket oluşturulurken bir sorun oluştu');
    } finally {
      setIsGeneratingLabels(false);
    }
  };

  const handleSyncOrders = async () => {
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Order sync failed');
      }
      
      toast.success(result.message || 'Siparişler senkronize edildi');
      
      // Refresh the orders list
      fetchOrders();
    } catch (error) {
      console.error('Error syncing orders:', error);
      toast.error('Siparişler senkronize edilirken bir sorun oluştu');
    }
  };

  const getLabelStatusBadge = (item) => {
    const latestJob = item.labelJobs && item.labelJobs.length > 0
      ? item.labelJobs.reduce((latest, job) => (
          !latest || new Date(job.created_at) > new Date(latest.created_at) ? job : latest
        ), null)
      : null;
    
    if (!latestJob) {
      return <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">Etiket Yok</span>;
    }
    
    switch (latestJob.status) {
      case 'completed':
        return (
          <span className="bg-green-100 text-green-600 px-2 py-1 rounded-full text-xs flex items-center">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" />
            </svg>
            Tamamlandı
          </span>
        );
      case 'pending':
        return <span className="bg-yellow-100 text-yellow-600 px-2 py-1 rounded-full text-xs">İşleniyor</span>;
      case 'failed':
        return <span className="bg-red-100 text-red-600 px-2 py-1 rounded-full text-xs">Hata</span>;
      default:
        return <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">Bilinmiyor</span>;
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">Siparisler</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSyncOrders}
            className="bg-blue-600 text-white py-1.5 px-3 sm:py-2 sm:px-4 rounded text-xs sm:text-sm"
          >
            Senkronize Et
          </button>
          <button
            onClick={handleGenerateLabels}
            disabled={selectedItems.length === 0 || isGeneratingLabels}
            className="bg-green-600 text-white py-1.5 px-3 sm:py-2 sm:px-4 rounded text-xs sm:text-sm disabled:bg-green-300"
          >
            {isGeneratingLabels ? 'Olusturuluyor...' : 'Etiket Olustur'}
          </button>
        </div>
      </div>

      {isLoadingOrders ? (
        <div className="text-center py-10">
          <svg className="animate-spin h-8 w-8 sm:h-10 sm:w-10 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-2 text-gray-600 text-sm">Siparisler yukleniyor...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8 sm:py-10 bg-gray-50 rounded-lg px-4">
          <p className="text-gray-500 text-base sm:text-lg">Henuz hic siparis yok.</p>
          <p className="text-gray-400 mt-2 text-sm">Siparisleri senkronize etmek icin butona tiklayin.</p>
        </div>
      ) : (
        <>
          {/* Mobile: Card layout */}
          <div className="space-y-3 md:hidden">
            {orders.map(order => (
              <div key={order.id} className="bg-white shadow-sm rounded-lg border border-gray-200 p-3">
                <div className="flex items-start gap-3">
                  {order.items && order.items[0]?.image ? (
                    <img src={order.items[0].image} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                      <span className="text-gray-400 text-xs">-</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{order.customerName || '-'}</p>
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">{order.marketplace || '-'}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{order.items && order.items[0]?.variantInfo || '-'}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-gray-400">#{order.marketplaceKey || '-'}</span>
                      {order.status && <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{order.status}</span>}
                      {order.shipByDate && (
                        <span className="text-[10px] text-gray-500">Ship: {new Date(order.shipByDate).toLocaleDateString('tr-TR')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {getLabelStatusBadge(order.items && order.items[0])}
                      {order.items && order.items[0]?.labelJobs && order.items[0].labelJobs.length > 0 &&
                       order.items[0].labelJobs.some(job => job.status === 'completed' && job.pdf_url) && (
                        <a
                          href={order.items[0].labelJobs.find(job => job.status === 'completed' && job.pdf_url).pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 text-xs underline"
                        >
                          PDF
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Table layout */}
          <div className="hidden md:block bg-white shadow rounded-lg overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Gorsel</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Musteri</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Varyant</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">Not</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Durum</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ship-by</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Marketplace</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Siparis No</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Etiket</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      {order.items && order.items[0]?.image ? (
                        <img src={order.items[0].image} alt="" className="w-10 h-10 object-cover rounded" />
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900 max-w-[150px] truncate">{order.customerName || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600 max-w-[120px] truncate">{order.items && order.items[0]?.variantInfo || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600 max-w-[100px] truncate hidden lg:table-cell">{order.notes || '-'}</td>
                    <td className="px-3 py-2 text-sm">{order.status || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{order.shipByDate ? new Date(order.shipByDate).toLocaleDateString('tr-TR') : '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{order.marketplace || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{order.marketplaceKey || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {getLabelStatusBadge(order.items && order.items[0])}
                      {order.items && order.items[0]?.labelJobs && order.items[0].labelJobs.length > 0 &&
                       order.items[0].labelJobs.some(job => job.status === 'completed' && job.pdf_url) && (
                        <a
                          href={order.items[0].labelJobs.find(job => job.status === 'completed' && job.pdf_url).pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 ml-2 text-xs underline"
                        >
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

Orders.getLayout = function getLayout(page) {
  return <Layout>{page}</Layout>;
}; 