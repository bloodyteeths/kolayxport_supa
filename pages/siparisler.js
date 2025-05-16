import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
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
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Siparişler</h1>
        <div className="space-x-2">
          <button
            onClick={handleSyncOrders}
            className="bg-blue-600 text-white py-2 px-4 rounded"
          >
            Siparişleri Senkronize Et
          </button>
          <button
            onClick={handleGenerateLabels}
            disabled={selectedItems.length === 0 || isGeneratingLabels}
            className="bg-green-600 text-white py-2 px-4 rounded disabled:bg-green-300"
          >
            {isGeneratingLabels ? 'Etiketler Oluşturuluyor...' : 'Etiket Oluştur'}
          </button>
        </div>
      </div>
      
      {isLoadingOrders ? (
        <div className="text-center py-10">
          <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-2 text-gray-600">Siparişler yükleniyor...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-lg">Henüz hiç sipariş yok.</p>
          <p className="text-gray-400 mt-2">Siparişleri senkronize etmek için "Siparişleri Senkronize Et" butonuna tıklayın.</p>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th>Görsel</th>
                <th>Müşteri Adı</th>
                <th>Varyant</th>
                <th>Not</th>
                <th>Durum</th>
                <th>Ship-by</th>
                <th>Marketplace</th>
                <th>Sipariş No</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Etiket
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map(order => (
                <tr key={order.id}>
                  <td>
                    {order.items && order.items[0]?.image ? (
                      <img src={order.items[0].image} alt="Görsel" className="w-12 h-12 object-cover" />
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td>{order.customerName || '-'}</td>
                  <td>{order.items && order.items[0]?.variantInfo || '-'}</td>
                  <td>{order.notes || '-'}</td>
                  <td>{order.status || '-'}</td>
                  <td>{order.shipByDate ? new Date(order.shipByDate).toLocaleDateString() : '-'}</td>
                  <td>{order.marketplace || '-'}</td>
                  <td>{order.marketplaceKey || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
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
      )}
    </div>
  );
}

Orders.getLayout = function getLayout(page) {
  return <Layout>{page}</Layout>;
}; 