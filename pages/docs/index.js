import React from 'react';
import Link from 'next/link';
import PublicLayout from '../../components/PublicLayout'; // Adjusted path
import { motion } from 'framer-motion';
import { NextSeo } from 'next-seo';
import { Search, BookOpen, Zap, Terminal, ArrowRight, Settings, Puzzle, Compass, FileCode } from 'lucide-react';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const featuredGuides = [
  {
    title: 'API Hızlı Başlangıç',
    description: 'KolayXport REST API\'sini kullanarak ilk isteğinizi dakikalar içinde gönderin.',
    href: '/docs/api/hizli-baslangic', // Placeholder link
    icon: Zap,
  },
  {
    title: 'Webhook Olayları',
    description: 'Sipariş güncellemeleri gibi önemli olayları gerçek zamanlı olarak takip edin.',
    href: '/docs/webhooks/olaylar', // Placeholder link
    icon: Compass, 
  },
  {
    title: 'OAuth Akışı',
    description: 'Kullanıcılarınız adına API erişimi için güvenli yetkilendirme sağlayın.',
    href: '/docs/auth/oauth-akisi', // Placeholder link
    icon: Settings,
  },
  {
    title: 'Örnek Uygulama (Node.js)',
    description: 'API entegrasyonunu gösteren temel bir Node.js uygulamasını inceleyin.',
    href: '/docs/ornekler/nodejs', // Placeholder link
    icon: FileCode,
  },
  {
    title: 'Entegrasyon Rehberleri',
    description: 'Popüler pazaryerleri ve kargo firmalarıyla nasıl entegre olacağınızı öğrenin.',
    href: '/docs/entegrasyonlar', 
    icon: Puzzle,
  },
  {
    title: 'SDK Kütüphaneleri',
    description: 'Farklı programlama dilleri için SDK\'larımızı keşfedin (Çok Yakında).',
    href: '/docs/sdks', 
    icon: BookOpen,
  },
];

const AbstractGridOverlay = () => (
  <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#d1d5db" strokeWidth="0.5"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" />
  </svg>
);

const curlSample = `curl -X POST https://api.kolayxport.com/v1/orders \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{ 
          "external_id": "ORDER123", 
          "customer_name": "Ayşe Yılmaz", 
          "total_amount": 49.99, 
          "currency": "TRY", 
          // ... diğer sipariş detayları 
        }'`;

export default function DocsIndexPage() {
  return (
    <PublicLayout
      title="Geliştirici Dokümanları - KolayXport API"
      description="KolayXport REST API, Webhook ve entegrasyon rehberleri. Hızlıca başlayın ve e-ticaret otomasyonunuzu bir üst seviyeye taşıyın."
    >
      <NextSeo
        openGraph={{
          images: [
            {
              url: 'https://kolayxport.com/og-docs.png', // Ensure this image exists
              width: 1200,
              height: 630,
              alt: 'KolayXport Geliştirici Dokümanları',
            },
          ],
        }}
      />
      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 lg:py-36 text-center px-6 lg:px-8 overflow-hidden bg-gray-50 isolate"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <AbstractGridOverlay />
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl md:text-5xl font-semibold text-slate-900 tracking-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            KolayXport Geliştirici Dokümanları
          </motion.h1>
          <motion.p
            className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            REST API, Webhooks ve entegrasyon rehberleri. Başlamak 5 dakika sürer.
          </motion.p>
          <motion.div
            className="mt-10 max-w-md mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input 
                type="search" 
                name="search-docs"
                id="search-docs"
                className="block w-full pl-10 pr-3 py-3 text-sm text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder="Konu ara… (örn: Sipariş API)"
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <kbd className="inline-flex items-center px-2 py-1 text-xs font-sans font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded-md">
                  ⌘K
                </kbd>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* Main Content Area (potential for sidebar layout on deeper pages) */}
      <div className="flex-1 w-full max-w-8xl mx-auto">
        {/* This div could hold a <aside> for sidebar and <main> for content on other doc pages */}
        {/* For docs index, we'll just have sections */}

        {/* Featured Guides Grid */}
        <motion.section 
          className="py-16 md:py-24 bg-white"
          variants={sectionVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.05 }}
        >
          <div className="container max-w-5xl mx-auto px-6 lg:px-8">
            <h2 className="text-2xl md:text-3xl font-semibold text-slate-800 mb-2 text-center">Öne Çıkan Rehberler</h2>
            <p className="text-center text-slate-500 mb-12 max-w-lg mx-auto">KolayXport API ve Webhook'ları ile entegrasyonunuzu hızlandırın.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {featuredGuides.map((guide, index) => (
                <motion.div
                  key={guide.title}
                  variants={{ hidden: { opacity:0, y:20 }, visible: { opacity:1, y:0, transition: {delay: index * 0.05}} }}
                >
                  <Link href={guide.href} className="block bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300 hover:ring-2 hover:ring-sky-200/70 transition-all duration-200 h-full group">
                    <div className="flex items-center mb-3">
                      <guide.icon className="w-7 h-7 mr-3 text-sky-500 group-hover:text-sky-600" />
                      <h3 className="text-lg font-semibold text-slate-800 group-hover:text-sky-700">{guide.title}</h3>
                    </div>
                    <p className="text-sm text-slate-500 group-hover:text-slate-600 leading-relaxed">{guide.description}</p>
                    <div className="mt-4 text-sm font-medium text-sky-600 group-hover:text-sky-700 flex items-center">
                      Rehberi Oku <ArrowRight size={16} className="ml-1 group-hover:translate-x-0.5 transition-transform"/>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Code Snippet Preview */}
        <motion.section 
          className="py-16 md:py-24 bg-slate-50"
          variants={sectionVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.05 }}
        >
          <div className="container max-w-3xl mx-auto px-6 lg:px-8">
            <div className="text-center mb-12">
              <Terminal className="w-12 h-12 mx-auto text-sky-500 mb-4" />
              <h2 className="text-2xl md:text-3xl font-semibold text-slate-800 mb-2">API Kullanım Örneği</h2>
              <p className="text-slate-500">Basit bir cURL isteği ile sipariş oluşturma.</p>
            </div>
            <div className="bg-slate-800 rounded-xl shadow-2xl overflow-hidden p-1">
                <div className="p-2 bg-slate-700/50 flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                    <span className="ml-auto text-xs text-slate-400">POST /v1/orders</span>
                </div>
                <pre className="language-bash hljs p-6 text-sm text-slate-200 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-700/50">
                  <code className="language-bash hljs">
                    {curlSample}
                  </code>
                </pre>
            </div>
             <p className="text-center mt-6 text-sm text-slate-500">
                Detaylı API referansı ve tüm endpointler için <Link href="/docs/api-referans" className="text-sky-600 hover:underline">API Referans</Link> sayfamızı ziyaret edin.
            </p>
          </div>
        </motion.section>
      </div> 

    </PublicLayout>
  );
} 