import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { toast } from 'react-hot-toast';

export default function Settings() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [configs, setConfigs] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newConfig, setNewConfig] = useState({
    name: '',
    config: {}
  });

  // Form fields for different marketplace types
  const configFields = {
    veeqo: [
      { name: 'apiKey', label: 'API Key', type: 'password' }
    ],
    trendyol: [
      { name: 'supplierId', label: 'Supplier ID', type: 'text' },
      { name: 'apiKey', label: 'API Key', type: 'password' },
      { name: 'apiSecret', label: 'API Secret', type: 'password' }
    ],
    shippo: [
      { name: 'token', label: 'API Token', type: 'password' }
    ]
  };

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    } else if (user) {
      fetchConfigs();
    }
  }, [isLoading, user, router]);

  const fetchConfigs = async () => {
    try {
      const { data, error } = await supabase
        .from('marketplace_configs')
        .select('*')
        .eq('user_id', user.id);
        
      if (error) throw error;
      setConfigs(data || []);
    } catch (error) {
      console.error('Error fetching configs:', error);
      toast.error('Failed to load configurations');
    }
  };

  const handleNewConfigChange = (e) => {
    setNewConfig({
      ...newConfig,
      name: e.target.value
    });
  };

  const handleConfigFieldChange = (e, field) => {
    setNewConfig({
      ...newConfig,
      config: {
        ...newConfig.config,
        [field]: e.target.value
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Add the new config to the database
      const { data, error } = await supabase
        .from('marketplace_configs')
        .insert([
          {
            user_id: user.id,
            name: newConfig.name,
            config: newConfig.config
          }
        ]);
        
      if (error) throw error;
      
      toast.success('Configuration saved successfully');
      setNewConfig({ name: '', config: {} });
      fetchConfigs();
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Failed to save configuration');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfig = async (id) => {
    try {
      const { error } = await supabase
        .from('marketplace_configs')
        .delete()
        .eq('id', id);
        
      if (error) throw error;
      
      toast.success('Configuration deleted');
      fetchConfigs();
    } catch (error) {
      console.error('Error deleting config:', error);
      toast.error('Failed to delete configuration');
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Ayarlar</h1>
      
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Mevcut Entegrasyonlar</h2>
        {configs.length === 0 ? (
          <p className="text-gray-500">Henüz bir entegrasyon eklemediniz.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {configs.map(config => (
              <div key={config.id} className="border p-4 rounded-lg shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium text-lg capitalize">{config.name}</h3>
                  <button 
                    onClick={() => handleDeleteConfig(config.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Sil
                  </button>
                </div>
                <div className="text-sm text-gray-500">
                  {Object.keys(config.config).map(key => (
                    <div key={key} className="mb-1">
                      <span className="font-medium">{key}: </span>
                      <span>{'•'.repeat(8)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div>
        <h2 className="text-xl font-semibold mb-4">Yeni Entegrasyon Ekle</h2>
        <form onSubmit={handleSubmit} className="max-w-md">
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Entegrasyon Türü
            </label>
            <select
              value={newConfig.name}
              onChange={handleNewConfigChange}
              className="w-full p-2 border rounded"
              required
            >
              <option value="">Seçiniz</option>
              <option value="veeqo">Veeqo</option>
              <option value="trendyol">Trendyol</option>
              <option value="shippo">Shippo</option>
            </select>
          </div>
          
          {newConfig.name && configFields[newConfig.name] && (
            <div className="space-y-4 mb-6">
              {configFields[newConfig.name].map(field => (
                <div key={field.name}>
                  <label className="block text-sm font-medium mb-1">
                    {field.label}
                  </label>
                  <input
                    type={field.type}
                    value={newConfig.config[field.name] || ''}
                    onChange={(e) => handleConfigFieldChange(e, field.name)}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
              ))}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isSubmitting || !newConfig.name}
            className="bg-blue-600 text-white py-2 px-4 rounded disabled:bg-blue-300"
          >
            {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </form>
      </div>
    </div>
  );
}

Settings.getLayout = function getLayout(page) {
  return <Layout>{page}</Layout>;
}; 