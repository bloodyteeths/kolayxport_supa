import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import { Settings, Save, Key, ShoppingCart, Truck } from 'lucide-react';
import { motion } from 'framer-motion';
import { NextSeo } from 'next-seo';

const InputField = ({ label, type = 'text', value, onChange, placeholder, id }) => (
  <div className="mb-4">
    <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
      {label}
    </label>
    <input
      type={type}
      id={id}
      name={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
    />
  </div>
);

const ApiSection = ({ title, icon: Icon, children }) => (
  <motion.div
    className="bg-white p-6 md:p-8 rounded-lg shadow-md mb-8"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
  >
    <div className="flex items-center mb-6">
      {Icon && <Icon size={28} className="mr-3 text-blue-600" />}
      <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
    </div>
    <div className="space-y-4">
      {children}
    </div>
  </motion.div>
);

export default function SettingsPage() {
  const { status } = useSession();
  const router = useRouter();

  const [trendyolApiKey, setTrendyolApiKey] = useState('');
  const [trendyolApiSecret, setTrendyolApiSecret] = useState('');
  const [trendyolSupplierId, setTrendyolSupplierId] = useState('');

  const [shippoApiToken, setShippoApiToken] = useState('');
  const [veeqoApiKey, setVeeqoApiKey] = useState('');

  const handleSaveTrendyol = (e) => {
    e.preventDefault();
    console.log('Trendyol Settings Saved:', { trendyolSupplierId, trendyolApiKey, trendyolApiSecret });
    // Here you would typically send this data to your backend
    alert('Trendyol ayarları konsola kaydedildi! (Gerçek bir kaydetme işlemi henüz uygulanmadı)');
  };

  const handleSaveShippo = (e) => {
    e.preventDefault();
    console.log('Shippo Settings Saved:', { shippoApiToken });
    alert('Shippo ayarları konsola kaydedildi!');
  };

  const handleSaveVeeqo = (e) => {
    e.preventDefault();
    console.log('Veeqo Settings Saved:', { veeqoApiKey });
    alert('Veeqo ayarları konsola kaydedildi!');
  };

  if (status === 'loading') {
    return <AppLayout title="Ayarlar Yükleniyor..."><div className="flex justify-center items-center h-screen"><p>Yükleniyor...</p></div></AppLayout>;
  }

  if (status === 'unauthenticated') {
    router.push('/api/auth/signin');
    return null; // Or a loading/redirecting state
  }

  return (
    <AppLayout title="API Ayarları - KolayXport">
      <NextSeo noindex={true} nofollow={true} />

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-slate-800 flex items-center">
            <Settings size={36} className="mr-3 text-blue-600" />
            Entegrasyon Ayarları
          </h1>
          <p className="mt-2 text-slate-600">
            Pazaryerleri ve diğer e-ticaret servisleri için API anahtarlarınızı buradan yönetebilirsiniz.
          </p>
        </div>
      </motion.div>

      <ApiSection title="Trendyol API Bilgileri" icon={ShoppingCart}>
        <form onSubmit={handleSaveTrendyol}>
          <InputField
            id="trendyolSupplierId"
            label="Trendyol Satıcı ID (Supplier ID)"
            value={trendyolSupplierId}
            onChange={(e) => setTrendyolSupplierId(e.target.value)}
            placeholder="123456"
          />
          <InputField
            id="trendyolApiKey"
            label="Trendyol API Anahtarı (API Key)"
            value={trendyolApiKey}
            onChange={(e) => setTrendyolApiKey(e.target.value)}
            placeholder="ABC123XYZ789..."
          />
          <InputField
            id="trendyolApiSecret"
            label="Trendyol API Gizli Anahtarı (API Secret)"
            type="password"
            value={trendyolApiSecret}
            onChange={(e) => setTrendyolApiSecret(e.target.value)}
            placeholder="••••••••••••••••••••"
          />
          <button
            type="submit"
            className="w-full sm:w-auto mt-2 px-6 py-2.5 bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center"
          >
            <Save size={18} className="mr-2" />
            Trendyol Ayarlarını Kaydet
          </button>
        </form>
      </ApiSection>

      <ApiSection title="Shippo API Bilgileri" icon={Truck}>
        <form onSubmit={handleSaveShippo}>
          <InputField
            id="shippoApiToken"
            label="Shippo Özel API Token (Private API Token)"
            type="password"
            value={shippoApiToken}
            onChange={(e) => setShippoApiToken(e.target.value)}
            placeholder="shippo_live_abcdef12345..."
          />
          <button
            type="submit"
            className="w-full sm:w-auto mt-2 px-6 py-2.5 bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center"
          >
            <Save size={18} className="mr-2" />
            Shippo Ayarlarını Kaydet
          </button>
        </form>
      </ApiSection>

      <ApiSection title="Veeqo API Bilgileri" icon={Truck}>
        <form onSubmit={handleSaveVeeqo}>
          <InputField
            id="veeqoApiKey"
            label="Veeqo API Anahtarı"
            type="password"
            value={veeqoApiKey}
            onChange={(e) => setVeeqoApiKey(e.target.value)}
            placeholder="ABCDEF1234567890..."
          />
          <button
            type="submit"
            className="w-full sm:w-auto mt-2 px-6 py-2.5 bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center"
          >
            <Save size={18} className="mr-2" />
            Veeqo Ayarlarını Kaydet
          </button>
        </form>
      </ApiSection>

    </AppLayout>
  );
} 