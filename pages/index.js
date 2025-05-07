import React, { Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { ChevronDown, Star, Truck, BarChart3, Box } from 'lucide-react';
import { Disclosure, Transition } from '@headlessui/react';

// Placeholder data - replace with your actual data or fetch from an API
const trustLogos = [
  { name: 'Amazon', src: '/logos/amazon.svg', width: 120, height: 40 },
  { name: 'Trendyol', src: '/logos/trendyol.png', width: 140, height: 40 },
  { name: 'Hepsiburada', src: '/logos/hepsiburada.png', width: 160, height: 40 },
  { name: 'n11', src: '/logos/n11.svg', width: 80, height: 40 },
  { name: 'Shopify', src: '/logos/shopify.svg', width: 130, height: 40 },
  { name: 'WooCommerce', src: '/logos/woocommerce.svg', width: 180, height: 40 },
];

const features = [
  {
    icon: Truck,
    title: 'Otomatik Kargo Etiketi',
    description: 'FedEx, Yurtiçi, Aras… algoritmamız en ucuz ve zamanında opsiyonu seçer, etiketlerinizi otomatik oluşturur.',
  },
  {
    icon: Box,
    title: 'Gerçek Zamanlı Envanter',
    description: 'Tüm satış kanallarınızdaki stoklarınızı tek merkezden yönetin, fazla satışı ve stok eksikliğini önleyin.',
  },
  {
    icon: BarChart3,
    title: 'Finans Analizi',
    description: 'Gelir-gider takibi, karlılık raporları ve pazar yeri komisyon hesaplamaları ile finansal sağlığınızı izleyin.',
  },
];

const comparisonData = {
  headers: ['Özellik', 'KolayXport', 'Rakip A', 'Rakip B'],
  rows: [
    ['Fiyatlandırma', 'Ücretsiz Plan Mevcut', '€29/ay', '€49/ay'],
    ['Sipariş Limiti', 'Limitsiz', '500/ay', '1000/ay'],
    ['Entegrasyon Sayısı', '10+', '5', '7'],
    ['Otomatik Kargo Etiketi', 'Var', 'Kısmi', 'Var'],
    ['Envanter Yönetimi', 'Var', 'Var', 'Kısmi'],
    ['Türkçe Destek', 'Var', 'Yok', 'Var'],
  ],
};

const testimonials = [
  {
    quote: 'KolayXport sayesinde operasyonel yükümüz %70 azaldı! Artık işimizi büyütmeye odaklanabiliyoruz.',
    name: 'Ayşe Yılmaz',
    company: 'HarikaSepetim.com',
    image: '/testimonials/ayse.jpeg',
    stars: 5,
  },
  {
    quote: 'Envanter yönetimi kabusumuzdu. KolayXport ile tüm kanallarda stoklarımız anlık güncelleniyor.',
    name: 'Mehmet Öztürk',
    company: 'TrendEvim',
    image: '/testimonials/mehmet.jpg',
    stars: 5,
  },
  {
    quote: 'Farklı kargo firmalarıyla uğraşmak yerine tek tıkla en uygun etiketi almak muazzam bir kolaylık.',
    name: 'Zeynep Kaya',
    company: 'ButikHarikalar',
    image: '/testimonials/zeynep.jpg',
    stars: 4,
  },
];

const faqItems = [
  {
    question: 'KolayXport kurulumu ne kadar sürer?',
    answer: 'Ortalama bir kullanıcı için temel entegrasyonlar ve kurulum 30 dakika ile 1 saat arasında tamamlanabilir. Detaylı yapılandırmalar için destek ekibimiz yardımcı olmaktadır.',
  },
  {
    question: 'Hangi pazar yerleri ve kargo firmaları destekleniyor?',
    answer: 'Trendyol, Hepsiburada, Amazon, n11, Shopify, WooCommerce gibi popüler pazar yerlerini ve FedEx, Yurtiçi Kargo, Aras Kargo gibi önde gelen kargo firmalarını destekliyoruz. Entegrasyon listemiz sürekli genişlemektedir.',
  },
  {
    question: 'Veri güvenliğim nasıl sağlanıyor?',
    answer: 'Veri güvenliğiniz bizim için en üst düzey önceliktir. Tüm bağlantılar SSL ile şifrelenir, hassas verileriniz (API anahtarları vb.) veritabanımızda şifreli olarak saklanır ve Google Cloud Platformunun güvenlik altyapısını kullanırız.',
  },
  {
    question: 'Ücretsiz deneme sürümü mevcut mu?',
    answer: "Evet, KolayXport\'u belirli bir süre veya özellik kısıtlamasıyla ücretsiz olarak deneyebilirsiniz. Detaylar için fiyatlandırma sayfamızı ziyaret edebilirsiniz.",
  },
];

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const cardHover = {
  translateY: -4,
  scale: 1.02,
  transition: { type: 'spring', stiffness: 300 },
};

const StarRating = ({ rating }) => (
  <div className="flex items-center">
    {[...Array(5)].map((_, i) => (
      <Star
        key={i}
        size={20}
        className={i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
      />
    ))}
  </div>
);

const HeroSection = () => (
  <motion.section className="relative isolate overflow-hidden bg-gradient-to-br from-white via-sky-50 to-indigo-50">
    <div aria-hidden className="absolute inset-0 -z-10 bg-[url('/noise.png')] opacity-10" />
    <div className="mx-auto max-w-7xl px-6 py-32 text-center">
      <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900">
        Bütün Marketplacelere <span className="text-primary">Tek Panelden</span> Hükmedin.
      </h1>
      <p className="mt-6 mx-auto max-w-2xl text-lg text-slate-600">
        Sipariş yönetimi, kargo, envanter senkronizasyonu—%100 Türkçe, hepsi tek tıkla.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
        <Link href="/api/auth/signin" className="btn-primary">Ücretsiz Dene</Link>
        <Link href="#demo"  className="btn-secondary">Demo İste</Link>
      </div>

      <Image
        src="/images/hero-macbook.png"
        width={1600}
        height={1100}
        alt="KolayXport dashboard preview"
        className="mx-auto mt-16 w-full max-w-4xl drop-shadow-2xl rounded-xl"
        priority
      />
    </div>
  </motion.section>
);

export default function HomePage() {
  return (
    <PublicLayout 
      title="KolayXport – E-commerce Automation Platform" 
      description="Automate orders, shipping, inventory and invoicing from one dashboard." 
      seo={{
        openGraph: {
          images: [
            {
              url: 'https://kolayxport.com/og-public.png',
              width: 1200,
              height: 630,
              alt: 'KolayXport Overview',
            },
          ],
        },
      }}
    >
      <HeroSection />

      {/* Section 2: TRUST BADGES */}
      <motion.section 
        className="py-16 bg-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <h3 className="text-center text-sm font-semibold text-slate-500 uppercase tracking-wider mb-10">
            BİNLERCE SATICININ GÜVENDİĞİ ENTEGRASYONLAR
          </h3>
          <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-6 md:gap-x-12 lg:gap-x-16">
            {trustLogos.map((logo) => (
              <motion.div key={logo.name} whileHover={{ scale: 1.05 }}>
                <img 
                  src={logo.src} 
                  alt={logo.name} 
                  width={logo.width} 
                  height={logo.height} 
                  className="h-8 md:h-10 object-contain filter grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300 ease-in-out"
                />
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Section 3: FEATURES */}
      <motion.section 
        className="py-20 md:py-28 bg-slate-50"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">İşinizi Otomatik Pilotta Yönetin</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              KolayXport, karmaşık e-ticaret süreçlerini basitleştirerek size zaman ve maliyet avantajı sağlar.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature) => (
              <motion.div
                key={feature.title}
                className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-900/[.07] transition-all duration-300 ease-out"
                variants={sectionVariants}
                whileHover={cardHover}
              >
                <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl mb-6 shadow-lg">
                  <feature.icon size={32} />
                </div>
                <h3 className="text-xl font-semibold text-slate-800 mb-3">{feature.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Section 4: COMPARISON TABLE */}
      <motion.section 
        className="py-20 md:py-28 bg-white"
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Karşılaştırma Tablosu</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              Neden KolayXport\'u tercih etmelisiniz?
            </p>
          </div>
          <div className="shadow-xl shadow-slate-900/[.05] rounded-xl overflow-hidden ring-1 ring-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {comparisonData.headers.map((header) => (
                    <th key={header} scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {comparisonData.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? undefined : 'bg-slate-50/50'}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={`px-6 py-4 whitespace-nowrap text-sm ${cellIndex === 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                        {cellIndex === 1 && typeof cell === 'string' && cell.includes('Var') ? (
                           <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                             {cell}
                           </span>
                        ) : cellIndex === 1 && typeof cell === 'string' && cell.includes('Mevcut') ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {cell}
                          </span>
                        ) : (cell) }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.section>
      
      {/* Section 5: TESTIMONIALS */}
      <motion.section 
        className="py-20 md:py-28 bg-slate-50 overflow-hidden"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Müşterilerimiz Ne Diyor?</h2>
          </div>
          <div className="flex -mx-4 overflow-x-auto pb-8 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
            <div className="flex flex-none px-2">
              {testimonials.map((testimonial, i) => (
                <motion.div 
                  key={i} 
                  className="flex-none w-[300px] sm:w-[360px] snap-center bg-white p-8 rounded-2xl shadow-lg mr-6 last:mr-0"
                  variants={sectionVariants}
                >
                  <div className="flex items-center mb-4">
                    <img src={testimonial.image} alt={testimonial.name} className="w-14 h-14 rounded-full mr-4 object-cover" />
                    <div>
                      <h4 className="font-semibold text-slate-800">{testimonial.name}</h4>
                      <p className="text-sm text-slate-500">{testimonial.company}</p>
                    </div>
                  </div>
                  <StarRating rating={testimonial.stars} />
                  <blockquote className="mt-4 text-slate-600 italic relative">
                    <span className="absolute -left-4 -top-2 text-5xl text-slate-200 font-serif">“</span>
                    {testimonial.quote}
                  </blockquote>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.section>
      
      {/* Section 6: CALL-TO-ACTION BANNER */}
      <motion.section 
        className="py-20 md:py-28 bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Hazır mısınız? Bugün entegrasyona başlayın.
          </h2>
          <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
            KolayXport\'un gücünü keşfedin ve e-ticaret operasyonlarınızı bir üst seviyeye taşıyın.
          </p>
          <Link href="#signup-form" legacyBehavior>
            <a className="px-10 py-4 text-lg font-semibold text-blue-600 bg-white rounded-full shadow-lg hover:scale-105 hover:bg-slate-50 transform transition-all duration-200 ease-out">
              Ücretsiz Dene
            </a>
          </Link>
        </div>
      </motion.section>

      {/* Section 7: FAQ */}
      <motion.section 
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Sıkça Sorulan Sorular</h2>
          </div>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <Disclosure as="div" key={i} className="bg-slate-50 rounded-lg shadow-sm">
                {({ open }) => (
                  <>
                    <Disclosure.Button className="flex justify-between items-center w-full px-6 py-4 text-left text-lg font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75 rounded-lg">
                      <span>{item.question}</span>
                      <ChevronDown
                        size={24}
                        className={`transform transition-transform duration-200 ${
                          open ? '-rotate-180' : ''
                        } text-slate-500`}
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
                      <Disclosure.Panel className="px-6 pt-2 pb-4 text-sm text-slate-600 leading-relaxed">
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

      {/* Section 8: CONTACT PREVIEW / SIGNUP FORM (Simplified) */}
      <motion.section
        id="signup-form" 
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">KolayXport\'u Denemeye Hazır Olun</h2>
          <p className="max-w-xl mx-auto text-lg text-slate-600 mb-10">
            Sadece birkaç adımda e-ticaretinizi yeni bir seviyeye taşıyın. Kaydolun ve potansiyeli keşfedin.
          </p>
          <div className="mt-8">
            <Link href="/auth/signin" legacyBehavior> 
              <a className="px-12 py-4 text-xl font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
                Hemen Kayıt Ol
              </a>
            </Link>
            <p className="mt-6 text-sm text-slate-500">
              Sorularınız mı var? <Link href="/iletisim" className="text-blue-600 hover:underline">Bize Ulaşın</Link>.
            </p>
          </div>
        </div>
      </motion.section>

    </PublicLayout>
  );
}