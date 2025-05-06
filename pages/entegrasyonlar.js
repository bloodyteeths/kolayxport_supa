import React, { useState, useMemo } from 'react';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { Package, Truck, CreditCard, CheckSquare, ShoppingCart, Zap } from 'lucide-react'; // Added more icons

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const cardHover = {
  translateY: -5,
  scale: 1.03,
  boxShadow: '0px 10px 20px rgba(0, 0, 0, 0.1)',
  transition: { type: 'spring', stiffness: 300 },
};

const integrationsData = [
  // Pazaryerleri
  { name: 'Trendyol', category: 'Pazaryerleri', logo: '/logos/trendyol.svg', icon: ShoppingCart, setupSteps: ['API Anahtarı Girin', 'Mağaza Bilgilerini Eşleştirin', 'Ürünleri Senkronize Edin'], description: 'Türkiye\'nin lider pazaryerlerinden Trendyol ile ürünlerinizi milyonlara ulaştırın.' },
  // { name: 'Hepsiburada', category: 'Pazaryerleri', logo: '/logos/hepsiburada.svg', icon: ShoppingCart, setupSteps: ['Satıcı ID ve API Key Alın', 'Kategori Eşleştirmesi Yapın', 'Siparişleri Otomatik Çekin'], description: 'Geniş ürün yelpazesi ve müşteri kitlesiyle Hepsiburada\'da satışlarınızı artırın.' },
  { name: 'Amazon', category: 'Pazaryerleri', logo: '/logos/amazon.svg', icon: ShoppingCart, setupSteps: ['MWS Yetkilendirmesi Yapın', 'Listingleri Bağlayın', 'FBA Entegrasyonunu Aktif Edin'], description: 'Global e-ticaret devi Amazon pazarında yerinizi alın.' }, // Changed Amazon TR to Amazon
  // { name: 'n11', category: 'Pazaryerleri', logo: '/logos/n11.svg', icon: ShoppingCart, setupSteps: ['API Şifresi Oluşturun', 'Ürün Bilgilerini Aktarın', 'Stok Takibini Başlatın'], description: 'Türkiye\'nin önde gelen platformlarından n11 ile daha fazla müşteriye ulaşın.' },
  { name: 'Shopify', category: 'Pazaryerleri', logo: '/logos/shopify.svg', icon: Zap, setupSteps: ['KolayXport App Yükleyin', 'Mağazanızı Bağlayın', 'Otomatik Senkronizasyon'], description: 'Kendi e-ticaret sitenizi Shopify ile yönetin, KolayXport ile entegre edin.' },
  // { name: 'WooCommerce', category: 'Pazaryerleri', logo: '/logos/woocommerce.svg', icon: Zap, setupSteps: ['Eklentiyi Kurun', 'API İzinlerini Verin', 'Veri Akışını Ayarlayın'], description: 'WordPress tabanlı WooCommerce mağazanızı KolayXport ile güçlendirin.' },
  { name: 'eBay', category: 'Pazaryerleri', logo: '/logos/ebay.svg', icon: ShoppingCart, setupSteps: ['Entegrasyon Hazırlanıyor'], description: 'Dünyanın en büyük online pazaryerlerinden eBay entegrasyonu. (Yakında)' },
  { name: 'Etsy', category: 'Pazaryerleri', logo: '/logos/etsy.svg', icon: ShoppingCart, setupSteps: ['Entegrasyon Hazırlanıyor'], description: 'El yapımı ve vintage ürünler için global pazar yeri Etsy entegrasyonu. (Yakında)' },
  
  // Kargo
  { name: 'FedEx', category: 'Kargo', logo: '/logos/fedex.svg', icon: Truck, setupSteps: ['Hesap Numaranızı Ekleyin', 'Servis Tiplerini Seçin', 'Uluslararası Gönderiler'], description: 'FedEx entegrasyonu ile global gönderilerinizi kolayca yönetin.' },
  { name: 'Yurtiçi Kargo', category: 'Kargo', logo: '/logos/yurticikargo.svg', icon: Truck, setupSteps: ['Entegrasyon Hazırlanıyor'], description: 'Türkiye genelinde yaygın ağa sahip Yurtiçi Kargo entegrasyonu. (Yakında)' },
  { name: 'Aras Kargo', category: 'Kargo', logo: '/logos/araskargo.svg', icon: Truck, setupSteps: ['Entegrasyon Hazırlanıyor'], description: 'Aras Kargo ile hızlı ve güvenilir teslimat seçenekleri. (Yakında)' },
  { name: 'UPS', category: 'Kargo', logo: '/logos/ups.svg', icon: Truck, setupSteps: ['Entegrasyon Hazırlanıyor'], description: 'Global lojistik lideri UPS ile gönderi yönetimi. (Yakında)' },
  { name: 'DHL', category: 'Kargo', logo: '/logos/dhl.svg', icon: Truck, setupSteps: ['Entegrasyon Hazırlanıyor'], description: 'Uluslararası ekspres taşımacılıkta öncü DHL entegrasyonu. (Yakında)' },

  // Ödeme (Örnek)
  { name: 'iyzico', category: 'Ödeme', logo: '/logos/iyzico.svg', icon: CreditCard, setupSteps: ['API Anahtarı & Gizli Anahtar', 'Ödeme Formu Entegrasyonu', 'İade İşlemleri'], description: 'iyzico ile güvenli ve çeşitli ödeme alma seçenekleri sunun.' },
  { name: 'PayTR', category: 'Ödeme', logo: '/logos/paytr.svg', icon: CreditCard, setupSteps: ['Mağaza No ve API Bilgileri', 'Webhook Kurulumu', 'Taksit Seçenekleri'], description: 'PayTR\'ın sunduğu esnek ödeme çözümleriyle dönüşümlerinizi artırın.' },
];

const categories = ['Tümü', 'Pazaryerleri', 'Kargo', 'Ödeme'];

export default function EntegrasyonlarPage() {
  const [activeFilter, setActiveFilter] = useState('Tümü');

  const filteredIntegrations = useMemo(() => {
    if (activeFilter === 'Tümü') return integrationsData;
    return integrationsData.filter(integration => integration.category === activeFilter);
  }, [activeFilter]);

  return (
    <PublicLayout title="Entegrasyonlar - KolayXport" description="KolayXport ile Trendyol, Hepsiburada, Amazon, Yurtiçi Kargo, Aras Kargo ve daha birçok pazaryeri, kargo ve ödeme sistemine kolayca entegre olun.">
      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-multiply pointer-events-none" />
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-800 tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Yakında 50+ Entegrasyon Tek Çatı Altında
          </motion.h1>
          <motion.p
            className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-sky-700 font-semibold"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            Hem de hepsi ücretsiz temel planımızda!
          </motion.p>
        </div>
      </motion.section>

      {/* Filters and Grid Section */}
      <motion.section 
        className="py-16 md:py-24 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex justify-center mb-12 space-x-2 md:space-x-4">
            {categories.map(category => (
              <button
                key={category}
                onClick={() => setActiveFilter(category)}
                className={`px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base font-medium rounded-full transition-all duration-200 ease-out
                  ${activeFilter === category 
                    ? 'bg-blue-600 text-white shadow-md' 
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {category}
              </button>
            ))}
          </div>

          {filteredIntegrations.length === 0 && (
            <div className="text-center py-12">
              <Package size={64} className="mx-auto text-slate-300 mb-4" />
              <p className="text-xl text-slate-500">Bu kategoride henüz entegrasyon bulunmamaktadır.</p>
              <p className="text-slate-400 mt-2">Yakında eklenecektir!</p>
            </div>
          )}

          <motion.div 
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8"
            variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
            initial="hidden"
            animate="visible"
          >
            {filteredIntegrations.map((integration) => (
              <motion.div
                key={integration.name}
                className="bg-white rounded-xl shadow-lg overflow-hidden border border-slate-100 flex flex-col"
                variants={sectionVariants}
                whileHover={cardHover}
              >
                <div className="p-6 flex-grow">
                  <div className="flex items-center mb-4">
                    {integration.logo ? (
                      <img src={integration.logo} alt={`${integration.name} logo`} className="h-10 w-auto mr-4 object-contain"/>
                    ) : (
                      React.createElement(integration.icon || Package, { className: "h-10 w-10 mr-4 text-blue-500" })
                    )}
                    <h3 className="text-xl font-semibold text-slate-800">{integration.name}</h3>
                  </div>
                  <p className="text-sm text-slate-500 mb-4 h-16 line-clamp-3">{integration.description}</p>
                  
                  <div className="mt-auto">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Kurulum Adımları:</h4>
                    <ul className="space-y-1.5">
                      {integration.setupSteps.map((step, i) => (
                        <li key={i} className="flex items-center text-xs text-slate-600">
                          <CheckSquare size={14} className="mr-2 text-green-500 flex-shrink-0" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 text-right">
                    <a 
                        href="#" // Replace with actual link to docs or setup later
                        onClick={(e) => e.preventDefault()} // Prevent page jump for now
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline">
                        Detayları Gör →
                    </a>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>
    </PublicLayout>
  );
} 