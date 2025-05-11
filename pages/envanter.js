import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { toast } from 'react-hot-toast';

export default function Inventory() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isAdjustingInventory, setIsAdjustingInventory] = useState(false);
  const [currentProduct, setCurrentProduct] = useState(null);
  const [locations, setLocations] = useState(['default']);
  const [inventoryAdjustment, setInventoryAdjustment] = useState({
    location: 'default',
    quantity: '',
    type: 'add', // 'add' or 'set'
    notes: ''
  });

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    } else if (user) {
      fetchProducts();
      fetchLocations();
    }
  }, [isLoading, user, router]);

  const fetchProducts = async () => {
    setIsLoadingProducts(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select(`
          *,
          inventories(*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Ürünler yüklenirken bir sorun oluştu');
    } finally {
      setIsLoadingProducts(false);
    }
  };

  const fetchLocations = async () => {
    try {
      // Get all unique locations from inventory items
      const { data, error } = await supabase
        .from('inventories')
        .select('location')
        .distinct();
        
      if (error) throw error;
      
      if (data && data.length > 0) {
        const locationNames = data.map(item => item.location);
        setLocations(locationNames);
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const openAdjustInventoryModal = (product) => {
    setCurrentProduct(product);
    // Reset form data
    setInventoryAdjustment({
      location: 'default',
      quantity: '',
      type: 'add',
      notes: ''
    });
    setIsAdjustingInventory(true);
  };

  const closeAdjustInventoryModal = () => {
    setIsAdjustingInventory(false);
    setCurrentProduct(null);
  };

  const handleInventoryInputChange = (e) => {
    const { name, value } = e.target;
    setInventoryAdjustment({
      ...inventoryAdjustment,
      [name]: value
    });
  };

  const handleAdjustInventory = async (e) => {
    e.preventDefault();
    
    if (!currentProduct || !inventoryAdjustment.quantity) {
      return;
    }
    
    const quantity = parseInt(inventoryAdjustment.quantity, 10);
    if (isNaN(quantity)) {
      toast.error('Geçerli bir miktar girin');
      return;
    }
    
    try {
      // First, check if inventory record exists for this product and location
      const { data: existingInventory, error: fetchError } = await supabase
        .from('inventories')
        .select('*')
        .eq('product_id', currentProduct.id)
        .eq('location', inventoryAdjustment.location)
        .maybeSingle();
        
      if (fetchError) throw fetchError;
      
      let newQuantity = quantity;
      if (inventoryAdjustment.type === 'add' && existingInventory) {
        newQuantity = existingInventory.quantity + quantity;
      }
      
      if (existingInventory) {
        // Update existing inventory
        const { error: updateError } = await supabase
          .from('inventories')
          .update({
            quantity: newQuantity,
            updated_at: new Date()
          })
          .eq('id', existingInventory.id);
          
        if (updateError) throw updateError;
      } else {
        // Create new inventory record
        const { error: insertError } = await supabase
          .from('inventories')
          .insert([{
            product_id: currentProduct.id,
            location: inventoryAdjustment.location,
            quantity: newQuantity
          }]);
          
        if (insertError) throw insertError;
      }
      
      // Create log entry (if you implement inventory logging)
      // ... code for logging inventory changes ...
      
      toast.success(`Envanter ${inventoryAdjustment.type === 'add' ? 'eklendi' : 'güncellendi'}`);
      closeAdjustInventoryModal();
      fetchProducts();
    } catch (error) {
      console.error('Error adjusting inventory:', error);
      toast.error('Envanter güncellenirken bir sorun oluştu');
    }
  };

  const getProductInventoryQuantity = (product, location = 'default') => {
    if (!product.inventories || product.inventories.length === 0) {
      return 0;
    }
    
    const inventory = product.inventories.find(inv => inv.location === location);
    return inventory ? inventory.quantity : 0;
  };

  const getTotalInventoryQuantity = (product) => {
    if (!product.inventories || product.inventories.length === 0) {
      return 0;
    }
    
    return product.inventories.reduce((sum, inv) => sum + inv.quantity, 0);
  };

  const getInventoryStatus = (quantity) => {
    if (quantity <= 0) {
      return <span className="text-red-600 font-medium">Tükendi</span>;
    } else if (quantity < 5) {
      return <span className="text-orange-600 font-medium">Az Kaldı ({quantity})</span>;
    } else {
      return <span className="text-green-600 font-medium">Stokta ({quantity})</span>;
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Envanter Yönetimi</h1>
        <a 
          href="/urunler"
          className="bg-blue-600 text-white py-2 px-4 rounded"
        >
          Ürünleri Yönet
        </a>
      </div>
      
      {isLoadingProducts ? (
        <div className="text-center py-10">
          <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-2 text-gray-600">Ürünler yükleniyor...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-lg">Henüz hiç ürün eklenmemiş.</p>
          <p className="text-gray-400 mt-2">Envanter eklemek için önce <a href="/urunler" className="text-blue-500 hover:underline">ürün eklemelisiniz</a>.</p>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ürün
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SKU
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Toplam Stok
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Durum
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  İşlemler
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {products.map(product => (
                <tr key={product.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {product.imageUrl && (
                        <img className="h-10 w-10 rounded-full mr-3 object-cover" src={product.imageUrl} alt={product.name} />
                      )}
                      <div className="text-sm font-medium text-gray-900">{product.name}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {product.sku}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {getTotalInventoryQuantity(product)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getInventoryStatus(getTotalInventoryQuantity(product))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={() => openAdjustInventoryModal(product)} 
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Envanter Düzenle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Adjust Inventory Modal */}
      {isAdjustingInventory && currentProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">
              Envanter Düzenle: {currentProduct.name}
            </h2>
            
            <form onSubmit={handleAdjustInventory}>
              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Depo Lokasyonu</label>
                  <select
                    name="location"
                    value={inventoryAdjustment.location}
                    onChange={handleInventoryInputChange}
                    className="w-full p-2 border rounded"
                  >
                    {locations.map(location => (
                      <option key={location} value={location}>
                        {location === 'default' ? 'Varsayılan Depo' : location}
                      </option>
                    ))}
                    <option value="new">+ Yeni Lokasyon Ekle</option>
                  </select>
                </div>
                
                {inventoryAdjustment.location === 'new' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Yeni Lokasyon Adı</label>
                    <input
                      type="text"
                      name="newLocation"
                      value={inventoryAdjustment.newLocation || ''}
                      onChange={(e) => setInventoryAdjustment({
                        ...inventoryAdjustment,
                        newLocation: e.target.value
                      })}
                      className="w-full p-2 border rounded"
                      placeholder="Örn: Ana Depo, Şube 1"
                      required={inventoryAdjustment.location === 'new'}
                    />
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mevcut Stok</label>
                  <div className="p-2 bg-gray-100 rounded">
                    {getProductInventoryQuantity(currentProduct, inventoryAdjustment.location === 'new' ? 'default' : inventoryAdjustment.location)}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">İşlem Türü</label>
                  <div className="flex space-x-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="type"
                        value="add"
                        checked={inventoryAdjustment.type === 'add'}
                        onChange={handleInventoryInputChange}
                        className="mr-2"
                      />
                      <span>Ekle/Çıkar</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="type"
                        value="set"
                        checked={inventoryAdjustment.type === 'set'}
                        onChange={handleInventoryInputChange}
                        className="mr-2"
                      />
                      <span>Değer Belirle</span>
                    </label>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {inventoryAdjustment.type === 'add' ? 'Eklenecek/Çıkarılacak Miktar' : 'Yeni Miktar'}
                  </label>
                  <input
                    type="number"
                    name="quantity"
                    value={inventoryAdjustment.quantity}
                    onChange={handleInventoryInputChange}
                    className="w-full p-2 border rounded"
                    min={inventoryAdjustment.type === 'add' ? undefined : '0'}
                    placeholder={inventoryAdjustment.type === 'add' ? "Çıkarmak için - kullanın" : ""}
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Not (İsteğe Bağlı)</label>
                  <textarea
                    name="notes"
                    value={inventoryAdjustment.notes}
                    onChange={handleInventoryInputChange}
                    className="w-full p-2 border rounded"
                    rows="2"
                    placeholder="Örn: Sipariş geldi, Hasar gördü, vb."
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={closeAdjustInventoryModal}
                  className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

Inventory.getLayout = function getLayout(page) {
  return <Layout>{page}</Layout>;
}; 