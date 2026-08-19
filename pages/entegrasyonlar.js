import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import PublicLayout from '../components/PublicLayout';
import Breadcrumb from '../components/Breadcrumb';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Package, Truck, CheckSquare, ShoppingCart, Zap, Chrome, Sparkles } from 'lucide-react';

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

// Every entry here is a LIVE integration — descriptions and setup steps come
// from messages/*.json under marketing.integrations.items.<key>. Integrations
// without a logo file fall back to their lucide icon.
const integrationsData = [
  // Marketplaces
  { key: 'etsy', name: 'Etsy', category: 'marketplaces', logo: '/logos/etsy.svg', icon: ShoppingCart },
  { key: 'ebay', name: 'eBay', category: 'marketplaces', logo: null, icon: ShoppingCart },
  { key: 'amazon', name: 'Amazon', category: 'marketplaces', logo: '/logos/amazon.svg', icon: ShoppingCart },
  { key: 'trendyol', name: 'Trendyol', category: 'marketplaces', logo: '/logos/trendyol.png', icon: ShoppingCart },
  { key: 'wix', name: 'Wix', category: 'marketplaces', logo: null, icon: Zap },
  { key: 'shopify', name: 'Shopify', category: 'marketplaces', logo: '/logos/shopify.jpg', icon: Zap },
  { key: 'veeqo', name: 'Veeqo', category: 'marketplaces', logo: null, icon: Package },
  // Shipping
  { key: 'ups', name: 'UPS', category: 'shipping', logo: null, icon: Truck },
  { key: 'fedex', name: 'FedEx', category: 'shipping', logo: null, icon: Truck },
  { key: 'mng', name: 'MNG Kargo (DHL eCommerce)', category: 'shipping', logo: null, icon: Truck },
  { key: 'shippo', name: 'Shippo', category: 'shipping', logo: null, icon: Truck },
  // Tools
  { key: 'chrome', name: 'Chrome', category: 'tools', logo: null, icon: Chrome },
  { key: 'gemini', name: 'Gemini AI', category: 'tools', logo: null, icon: Sparkles },
];

const categoryKeys = ['all', 'marketplaces', 'shipping', 'tools'];

export default function EntegrasyonlarPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const t = useTranslations('marketing.integrations');
  const tPublic = useTranslations('public');

  const filteredIntegrations = useMemo(() => {
    if (activeFilter === 'all') return integrationsData;
    return integrationsData.filter(integration => integration.category === activeFilter);
  }, [activeFilter]);

  return (
    <PublicLayout title={t('seo.title')} description={t('seo.description')}>

      <Breadcrumb items={[
        { name: tPublic('integrations'), href: '/entegrasyonlar' },
      ]} />

      {/* Hero Section */}
      <motion.section
        className="relative py-12 md:py-20 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="relative z-10">
          <motion.h1
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-800 tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {t('hero.title')}
          </motion.h1>
          <motion.p
            className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-sky-700 font-semibold"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {t('hero.subtitle')}
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
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center mb-12 space-x-2 md:space-x-4">
            {categoryKeys.map(category => (
              <button
                key={category}
                onClick={() => setActiveFilter(category)}
                className={`px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base font-medium rounded-full transition-all duration-200 ease-out
                  ${activeFilter === category
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {t(`categories.${category}`)}
              </button>
            ))}
          </div>

          {filteredIntegrations.length === 0 && (
            <div className="text-center py-12">
              <Package size={64} className="mx-auto text-slate-300 mb-4" />
              <p className="text-xl text-slate-500">{t('emptyTitle')}</p>
              <p className="text-slate-400 mt-2">{t('emptySubtitle')}</p>
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
                key={integration.key}
                className="bg-white rounded-xl shadow-lg overflow-hidden border border-slate-100 flex flex-col"
                variants={sectionVariants}
                whileHover={cardHover}
              >
                <div className="p-6 flex-grow">
                  <div className="flex items-center mb-4">
                    {integration.logo ? (
                      <Image src={integration.logo} alt={`${integration.name} logo`} width={80} height={40} className="h-10 w-auto mr-4 object-contain" loading="lazy"/>
                    ) : (
                      React.createElement(integration.icon || Package, { className: "h-10 w-10 mr-4 text-blue-500" })
                    )}
                    <h3 className="text-xl font-semibold text-slate-800">{integration.name}</h3>
                  </div>
                  <p className="text-sm text-slate-500 mb-4 h-16 line-clamp-3">{t(`items.${integration.key}.description`)}</p>

                  <div className="mt-auto">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">{t('setupStepsLabel')}</h4>
                    <ul className="space-y-1.5">
                      {t.raw(`items.${integration.key}.steps`).map((step, i) => (
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
                    href="/ayarlar"
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline">
                    {t('detailsLink')}
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
