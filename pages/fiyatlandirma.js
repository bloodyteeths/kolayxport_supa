import React, { Fragment } from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { Disclosure, Transition } from '@headlessui/react';
import { CheckCircle, ChevronDown, Zap, ShieldCheck, Star, MessageSquare, TrendingUp } from 'lucide-react';
import { NextSeo } from 'next-seo';
import { supabase } from '@/lib/supabase';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const cardHover = {
  translateY: -4,
  scale: 1.02,
  boxShadow: '0px 15px 30px rgba(0, 0, 0, 0.1)',
  transition: { type: 'spring', stiffness: 300 },
};

const plans = [
  {
    name: 'Başlangıç',
    id: 'tier-baslangic',
    priceMonthly: 'Ücretsiz',
    description: 'E-ticarete yeni başlayanlar ve küçük hacimli satıcılar için ideal.',
    features: [
      'Sınırsız Sipariş İşleme',
      'Tüm Pazaryeri Entegrasyonları',
      'Temel Kargo Entegrasyonları',
      'Stok Yönetimi',
      '1 Kullanıcı',
      'Topluluk Desteği',
    ],
    highlight: false,
    icon: Star,
  },
  {
    name: 'Profesyonel',
    id: 'tier-profesyonel',
    priceMonthly: 'Yakında',
    description: 'Büyüyen işletmeler ve daha fazla otomasyon ihtiyacı olanlar için.',
    features: [
      'Starter Planındaki Her Şey',
      'Gelişmiş Raporlama Paneli',
      'API Erişimi (Beta)',
      'Otomasyon Kuralları',
      '5 Kullanıcı',
      'E-posta Desteği',
    ],
    highlight: true,
    icon: TrendingUp,
  },
  {
    name: 'Enterprise',
    price: 'Teklif Al',
    frequency: '',
    description: 'Büyük ölçekli işletmeler ve özel ihtiyaçlar için kişiselleştirilmiş çözümler.',
    features: [
      'Growth Planındaki Her Şey',
      'Özel Entegrasyon Geliştirme',
      'SLA (Servis Seviyesi Anlaşması)',
      'Öncelikli Telefon Desteği',
      'Sınırsız Kullanıcı',
      'Özel Hesap Yöneticisi',
    ],
    cta: 'Bize Ulaşın',
    href: '/iletisim?subject=Enterprise%20Teklif%20Talebi',
    highlight: false,
    icon: ShieldCheck,
  },
];

const comparisonData = {
  headers: ['Özellik', 'KolayXport (Ücretsiz)', 'Rakip A (XYZ CRM)', 'Rakip B (ABC Sync)'],
  rows: [
    ['Temel Fiyat', '₺0 / ay', '₺199 / ay', '₺249 / ay'],
    ['Sipariş Limiti', 'Limitsiz', '500 / ay', '1000 / ay'],
    ['Pazaryeri Entegrasyonu', 'Tümü Aktif', '3 Adet Seçmeli', '5 Adet Seçmeli'],
    ['Kargo Entegrasyonu', 'Tümü Aktif', '1 Adet Seçmeli', '2 Adet Seçmeli'],
    ['Stok Senkronizasyonu', <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />, <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />, 'Kısmi'],
    ['Otomatik Kargo Etiketi', <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />, 'Ek Ücretli', <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />],
    ['API Erişimi', 'Growth Plan ile', 'Kurumsal Plan', 'Yok'],
    ['Kullanıcı Sayısı', '1 (Starter), 5 (Growth)', '1 Kullanıcı', '3 Kullanıcı'],
    ['Türkçe Destek', <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />, 'Sınırlı', <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />],
  ],
};

const faqItems = [
  {
    question: 'KolayXport gerçekten sonsuza kadar ücretsiz mi kalacak?',
    answer: 'Evet, temel entegrasyon ve sipariş yönetimi özelliklerimiz her zaman ücretsiz olacaktır. Diğer entegratörlerin ücretli sunduğu çoğu özelliği ücretsiz sunarak sektöre yeni bir soluk getirmeyi hedefliyoruz. Gelecekte ekleyeceğimiz çok gelişmiş ve niş özellikler için opsiyonel ücretli paketlerimiz olabilir, ancak mevcut ücretsiz planımız her zaman güçlü ve yeterli kalacaktır.',
  },
  {
    question: 'Ücretsiz planda hangi entegrasyonlar mevcut?',
    answer: 'Ücretsiz planımızda listelenen tüm pazaryeri (Trendyol, Hepsiburada, Amazon, n11, Shopify, WooCommerce vb.) ve temel kargo (Yurtiçi, Aras vb.) entegrasyonları dahildir. Entegrasyon listemizi sürekli genişletiyoruz.',
  },
  {
    question: 'Sipariş veya ürün limiti var mı?',
    answer: 'Hayır, ücretsiz planımızda herhangi bir sipariş, ürün veya ciro limiti bulunmamaktadır. İşletmenizin büyüklüğü ne olursa olsun KolayXport\'u kullanabilirsiniz.',
  },
  {
    question: 'Veri güvenliğim nasıl sağlanıyor?',
    answer: 'Veri güvenliğiniz en büyük önceliğimizdir. Tüm API anahtarları ve hassas veriler şifrelenerek saklanır. Google Cloud Platform altyapısını kullanıyoruz ve en güncel güvenlik standartlarına uyuyoruz.',
  },
  {
    question: 'Daha fazla kullanıcıya veya özelliğe ihtiyacım olursa ne yapmalıyım?',
    answer: 'Growth planımız ek kullanıcılar, gelişmiş raporlama ve API erişimi gibi özellikler sunar. Daha büyük ihtiyaçlarınız için Enterprise planımızla size özel çözümler üretebiliriz. Detaylar için bizimle iletişime geçebilirsiniz.',
  },
];

export default function FiyatlandirmaPage() {
  return (
    <PublicLayout
      title="KolayXport | Fiyatlandırma"
      description="KolayXport\'un şeffaf ve esnek fiyatlandırma seçeneklerini keşfedin. Temel özellikler tüm entegratörler kapatana kadar ücretsiz!"
    >
      <NextSeo
        openGraph={{
          images: [
            {
              url: 'https://kolayxport.com/og-pricing.png', // Ensure this image exists in public folder
              width: 1200,
              height: 630,
              alt: 'KolayXport Fiyatlandırma Planları',
            },
          ],
        }}
      />
      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 lg:py-40 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-sky-50 to-cyan-50 isolate"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-multiply"></div>
            <div 
                className="absolute inset-0 animate-slow-spin opacity-30 md:opacity-40"
                style={{
                    background: `
                        radial-gradient(circle at 30% 70%, #a5f3fc 0%, transparent 30%),
                        radial-gradient(circle at 70% 30%, #bae6fd 0%, transparent 30%)
                    `,
                }}
            />
        </div>
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl md:text-6xl font-black text-slate-900 tracking-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Diğer Entegrasyonlar Kapatana Kadar <span className="text-blue-600">ÜCRETSİZ</span>
          </motion.h1>
          <motion.p
            className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            KolayXport'ta gönderi ve stok yönetimine istediğiniz kadar kullanıcı ekleyin, sınırsız sipariş işleyin. Hiçbir gizli ücret yok.
          </motion.p>
          <motion.div
            className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <Link href="/api/auth/signin" legacyBehavior>
              <a className="px-8 py-3.5 text-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400">
                Hemen Başla
              </a>
            </Link>
            <Link href="/iletisim?subject=Telefonla%20Bilgi%20Almak%20İstiyorum" legacyBehavior>
              <a className="px-8 py-3.5 text-lg font-semibold text-blue-600 bg-white rounded-lg shadow-lg hover:scale-105 hover:bg-slate-50 transform transition-all duration-200 ease-out border border-slate-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400">
                Bizi Arayın
              </a>
            </Link>
          </motion.div>
        </div>
      </motion.section>

      {/* Plans Grid Section */}
      <motion.section 
        className="py-16 md:py-24 bg-slate-50"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Size Uygun Planı Seçin</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              Şeffaf, esnek ve işletmenizin büyümesine ayak uyduran fiyatlandırma.
            </p>
          </div>
          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.name}
                className={`flex flex-col bg-white rounded-3xl shadow-xl ${plan.highlight ? 'border-2 border-blue-500 shadow-blue-500/30' : 'border border-slate-100'} p-8 transition-all duration-300 ease-out`}
                variants={{ hidden: { opacity: 0, y: 50 }, visible: { opacity: 1, y: 0 } }}
                initial="hidden"
                whileInView="visible"
                whileHover={cardHover}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
              >
                <div className="flex-grow">
                  <div className="flex items-center mb-4">
                     {React.createElement(plan.icon, { className: `w-8 h-8 mr-3 ${plan.highlight ? 'text-blue-500' : 'text-slate-400' }` })}
                    <h3 className="text-2xl font-bold text-slate-800">{plan.name}</h3>
                  </div>
                  <p className={`text-4xl font-black text-slate-900 mb-1 ${plan.highlight ? 'text-blue-600' : ''}`}>{plan.priceMonthly} <span className="text-xl font-semibold text-slate-500">{plan.frequency}</span></p>
                  <p className="text-sm text-slate-500 mb-6 h-12">{plan.description}</p>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start">
                        <CheckCircle size={18} className={`mr-2 mt-0.5 ${plan.highlight ? 'text-blue-500' : 'text-green-500'} flex-shrink-0`} />
                        <span className="text-sm text-slate-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {plan.priceMonthly === 'Ücretsiz' ? (
                  <button
                    onClick={async () => {
                      await supabase.auth.signInWithOAuth({ 
                        provider: 'google',
                        options: { redirectTo: window.location.origin + '/app' } 
                      });
                    }}
                    aria-describedby={plan.id} 
                    className={`w-full block text-center px-6 py-3.5 text-base font-semibold rounded-lg shadow-md transform transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 
                      ${plan.highlight 
                        ? 'text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:scale-[1.03]' 
                        : 'text-blue-600 bg-blue-50 hover:bg-blue-100 hover:scale-[1.03]'
                      } ${plan.highlight ? 'focus:ring-blue-400' : 'focus:ring-blue-300'}
                    `}>
                    Ücretsiz Başla
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      await supabase.auth.signInWithOAuth({ 
                        provider: 'google',
                        options: { redirectTo: window.location.origin + '/app' } 
                      });
                    }}
                    aria-describedby={plan.id} 
                    className={`w-full block text-center px-6 py-3.5 text-base font-semibold rounded-lg shadow-md transform transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 
                      ${plan.highlight 
                        ? 'text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:scale-[1.03]' 
                        : 'text-blue-600 bg-blue-50 hover:bg-blue-100 hover:scale-[1.03]'
                      } ${plan.highlight ? 'focus:ring-blue-400' : 'focus:ring-blue-300'}
                    `}>
                    Çok Yakında
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Comparison Table Section */}
      <motion.section 
        className="py-16 md:py-24 bg-white"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Özellik Karşılaştırması</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              KolayXport ve alternatiflerin sunduğu temel özellikleri inceleyin.
            </p>
          </div>
          <div className="overflow-x-auto lg:overflow-visible rounded-xl shadow-xl shadow-slate-900/[.07] ring-1 ring-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {comparisonData.headers.map((header, index) => (
                    <th 
                      key={header} 
                      scope="col" 
                      className={`px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap 
                        ${index === 0 ? 'sticky left-0 bg-slate-50 z-10' : ''} 
                        ${index === 1 ? 'text-blue-600' : ''}`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {comparisonData.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-slate-50/50 transition-colors">
                    {row.map((cell, cellIndex) => (
                      <td 
                        key={cellIndex} 
                        className={`px-6 py-4 whitespace-nowrap text-sm 
                          ${cellIndex === 0 ? 'font-medium text-slate-800 sticky left-0 bg-white group-hover:bg-slate-50/50 z-10' : 'text-slate-600 text-center'} 
                          ${cellIndex === 1 ? 'font-semibold text-blue-700' : ''}`
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
           <p className="text-xs text-slate-400 mt-4 text-center">
            * Rakip A ve Rakip B bilgileri genel pazar araştırmalarına dayanmaktadır ve değişiklik gösterebilir. Güncel bilgiler için ilgili servis sağlayıcıların web sitelerini kontrol ediniz.
          </p>
        </div>
      </motion.section>

      {/* FAQ Section */}
      <motion.section 
        className="py-16 md:py-24 bg-slate-50"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Sıkça Sorulan Sorular</h2>
          </div>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <Disclosure as="div" key={i} className="bg-white rounded-lg shadow-md">
                {({ open }) => (
                  <>
                    <Disclosure.Button className="flex justify-between items-center w-full px-6 py-4 text-left text-lg font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75 rounded-lg">
                      <span>{item.question}</span>
                      <ChevronDown
                        size={24}
                        className={`transform transition-transform duration-200 ${open ? '-rotate-180' : ''} text-slate-500`}
                      />
                    </Disclosure.Button>
                    <Transition
                      as={Fragment}
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Disclosure.Panel className="px-6 pt-2 pb-6 text-sm text-slate-600 leading-relaxed">
                        {item.answer}
                      </Disclosure.Panel>
                    </Transition>
                  </>
                )}
              </Disclosure>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="mt-16 text-center">
        <h3 className="text-2xl font-semibold text-slate-800 mb-4">Size Özel Bir Plan mı Lazım?</h3>
        <p className="text-slate-600 mb-8">İhtiyaçlarınız doğrultusunda size özel çözümler üretebiliriz. Bizimle iletişime geçin.</p>
        <button
          onClick={async () => {
            await supabase.auth.signInWithOAuth({ 
              provider: 'google',
              options: { redirectTo: window.location.origin + '/iletisim' }
            });
          }}
          className="inline-block px-8 py-3 text-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out"
        >
          İletişime Geç
        </button>
      </div>

    </PublicLayout>
  );
} 