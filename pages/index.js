import React, { Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { ChevronDown, Star, Truck, BarChart3, Box, Search, Sparkles, TrendingUp, ShoppingBag, Globe, Layers, Brain, Target, Zap, ArrowLeftRight, DollarSign } from 'lucide-react';
import { Disclosure, Transition } from '@headlessui/react';
// supabase browser client removed — auth now handled by NextAuth
import { FAQPageJsonLd } from 'next-seo';

// Placeholder data - replace with your actual data or fetch from an API
const trustLogos = [
  { name: 'Amazon', src: '/logos/amazon.svg', width: 120, height: 40 },
  { name: 'Trendyol', src: '/logos/trendyol.png', width: 120, height: 40 },
  { name: 'Hepsiburada', src: '/logos/hepsiburada.png', width: 120, height: 40 },
  { name: 'n11', src: '/logos/n11.png', width: 120, height: 40 },
  { name: 'Shopify', src: '/logos/shopify.jpg', width: 120, height: 40 },
  { name: 'WooCommerce', src: '/logos/woocommerce.svg', width: 140, height: 40 },
  { name: 'Etsy', src: '/logos/etsy.svg', width: 80, height: 40 },
];

const features = [
  {
    icon: Brain,
    title: 'AI Listeleme Asistanı',
    description: 'Yapay zeka ile başlık optimizasyonu, açıklama oluşturma, fiyat önerileri ve listeleme analizi. Satışlarınızı AI ile katlamaya başlayın.',
  },
  {
    icon: Search,
    title: 'Pazar Araştırması',
    description: 'Rakip analizi, niş keşfi, anahtar kelime istihbaratı ve trend takibi. Veri odaklı kararlarla satışlarınızı büyütün.',
  },
  {
    icon: ShoppingBag,
    title: 'Listeleme Yönetimi',
    description: 'Etsy ve eBay listelerinizi tek panelden oluşturun, düzenleyin, kopyalayın ve toplu işlem yapın. Varyant, görsel ve kargo profili dahil.',
  },
  {
    icon: Truck,
    title: 'Otomatik Kargo Etiketi',
    description: 'FedEx, UPS, Yurtiçi, Aras… algoritmamız en ucuz opsiyonu seçer, etiketlerinizi otomatik oluşturur.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Trendyol → eBay Arbitraj',
    description: 'Trendyol\'daki ürünleri otomatik tarayın, eBay fiyatlarıyla karşılaştırın, AI çeviri ile eşleştirin. Kâr, ROI, komisyon hesabı anında.',
  },
  {
    icon: TrendingUp,
    title: 'Finansal İstihbarat',
    description: 'Kar marjı hesaplama, komisyon analizi, gelir raporları ve satıcı performans takibi ile finansal sağlığınızı izleyin.',
  },
  {
    icon: Layers,
    title: 'Çoklu Kanal Senkronizasyonu',
    description: 'Sipariş, envanter ve takip bilgilerini tüm pazaryerlerinde anlık senkronize edin. Fazla satış ve stok hatalarını önleyin.',
  },
];

const includedFeatures = [
  'AI Başlık & Açıklama Optimizasyonu',
  'Rakip Analizi & Satıcı Takibi',
  'Niş Keşfi & Trend Analizi',
  'Anahtar Kelime İstihbaratı',
  'Toplu Listeleme Yönetimi',
  'Trendyol → eBay Arbitraj Tarayıcı',
  'Kar Marjı & Komisyon Hesaplayıcı',
  'Otomatik Kargo Etiketi (FedEx, UPS)',
  'Çoklu Pazaryeri Senkronizasyonu',
  'Gerçek Zamanlı Envanter Takibi',
  'Sipariş & Takip Yönetimi',
  'Türkçe Arayüz & Destek',
  'SSL ile Şifreli Bağlantı',
];

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
    answer: 'Etsy, eBay, Trendyol, Hepsiburada, Amazon, n11, Shopify, WooCommerce gibi popüler pazar yerlerini ve FedEx, UPS, Yurtiçi Kargo, Aras Kargo gibi önde gelen kargo firmalarını destekliyoruz. Entegrasyon listemiz sürekli genişlemektedir.',
  },
  {
    question: 'AI araçları nasıl çalışıyor?',
    answer: 'KolayXport\'un AI asistanı, Etsy ve eBay listeleriniz için başlık optimizasyonu, açıklama oluşturma, fiyat önerileri ve listeleme analizi yapabilir. Pazar verilerini analiz ederek satışlarınızı artıracak öneriler sunar.',
  },
  {
    question: 'Pazar araştırması araçları neler sunuyor?',
    answer: 'Rakip analizi, satıcı takibi, niş keşfi, anahtar kelime istihbaratı, trend analizi ve kar marjı hesaplama gibi araçlarla veri odaklı satış kararları almanızı sağlar. eRank ve Terapeak gibi ücretli araçlara alternatiftir.',
  },
  {
    question: 'Arbitraj tarayıcı nasıl çalışıyor?',
    answer: 'Trendyol\'daki 65+ kategoriden ürünleri otomatik çeker, Gemini AI ile Türkçe ürün adlarını İngilizce eBay arama sorgularına çevirir ve eBay\'de eşleşen ürünleri bulur. Kâr, ROI, marj ve 28 farklı eBay komisyon oranını hesaplayarak en kârlı fırsatları sıralar. Tüm veriler önbelleğe alınır, arka planda tarama yapılır.',
  },
  {
    question: 'Veri güvenliğim nasıl sağlanıyor?',
    answer: 'Veri güvenliğiniz bizim için en üst düzey önceliktir. Tüm bağlantılar SSL ile şifrelenir, hassas verileriniz (API anahtarları vb.) veritabanımızda şifreli olarak saklanır.',
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
    <div className="mx-auto max-w-7xl px-6 pt-28 pb-20 sm:pt-36 sm:pb-24 text-center">
      <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900">
        AI Destekli <span className="text-primary">E-Ticaret Komuta Merkezi</span>
      </h1>
      <p className="mt-6 mx-auto max-w-2xl text-lg text-slate-600">
        Pazar araştırması, AI listeleme, rakip analizi, sipariş yönetimi ve kargo—Etsy & eBay için ihtiyacınız olan her şey, %100 Türkçe.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-x-6">
        <Link href="/login" className="btn-primary">
          Ücretsiz Dene
        </Link>
        <Link href="/ozellikler" className="btn-secondary">Özellikler <span aria-hidden="true">→</span></Link>
      </div>

      <Image
        src="/images/hero-workspace.png"
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
      title="KolayXport – AI Destekli E-Ticaret Komuta Merkezi | Etsy & eBay Araçları"
      description="AI listeleme, pazar araştırması, rakip analizi, sipariş yönetimi ve kargo—Etsy & eBay satıcıları için hepsi tek panelde." 
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
      <FAQPageJsonLd
        mainEntity={faqItems.map(item => ({
          questionName: item.question,
          acceptedAnswerText: item.answer
        }))}
      />
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
                <Image
                  src={logo.src}
                  alt={`${logo.name} marketplace entegrasyonu`}
                  width={logo.width}
                  height={logo.height}
                  className="h-8 md:h-10 w-auto max-w-[120px] md:max-w-[140px] object-contain filter grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300 ease-in-out"
                  loading="lazy"
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
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Satış Araçlarınızın Tamamı Tek Yerde</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              Araştırma, listeleme, optimizasyon, sipariş ve kargo—KolayXport, e-ticaretin tüm aşamalarını kapsar. <Link href="/entegrasyonlar" className="text-blue-600 hover:underline">Desteklenen entegrasyonları</Link> keşfedin.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
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

      {/* Section: MARKETPLACE POWER TOOLS */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Etsy & eBay İçin Güçlü Araçlar</h2>
            <p className="max-w-2xl mx-auto text-lg text-slate-600">
              Sadece sipariş yönetimi değil—araştırmadan satışa kadar tüm süreci yönetin
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-10">
            {/* Etsy Tools */}
            <motion.div
              className="relative bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-3xl p-8 md:p-10"
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-center gap-3 mb-6">
                <Image src="/logos/etsy.svg" alt="Etsy" width={60} height={24} className="h-6 w-auto" />
                <span className="text-xs font-semibold text-orange-600 bg-orange-100 px-2.5 py-1 rounded-full uppercase tracking-wider">Tam Entegrasyon</span>
              </div>
              <ul className="space-y-3">
                {[
                  'Pazar araştırması & trend analizi',
                  'AI ile başlık ve açıklama optimizasyonu',
                  'Listeleme oluşturma, düzenleme, kopyalama',
                  'Varyant & envanter yönetimi',
                  'Görsel ve video yükleme',
                  'Kargo profili & iade politikaları',
                  'Sipariş takibi & müşteri mesajları',
                  'Kişiselleştirme ayarları',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Zap size={16} className="text-orange-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
            {/* eBay Tools */}
            <motion.div
              className="relative bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-3xl p-8 md:p-10"
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-center gap-3 mb-6">
                <span className="text-2xl font-bold text-blue-600 tracking-tight">eBay</span>
                <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2.5 py-1 rounded-full uppercase tracking-wider">Tam Entegrasyon</span>
              </div>
              <ul className="space-y-3">
                {[
                  'Trendyol → eBay arbitraj tarayıcı',
                  'AI ile ürün eşleştirme & çeviri',
                  'Rakip analizi & satıcı takibi',
                  'AI başlık optimizasyonu & fiyat önerileri',
                  'Niş analizi & ürün veritabanı',
                  'Anahtar kelime istihbaratı',
                  'Listeleme oluşturma & toplu düzenleme',
                  'Finansal istihbarat & kar analizi',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Zap size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* Section: ARBITRAGE SCANNER */}
      <motion.section
        className="py-20 md:py-28 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={sectionVariants}
      >
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full uppercase tracking-wider">Yeni</span>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mt-4 mb-4">
                Trendyol → eBay Arbitraj Tarayıcı
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                Trendyol'daki binlerce ürünü otomatik tarayın, eBay fiyatlarıyla karşılaştırın ve en kârlı fırsatları anında bulun. AI destekli çeviri ile Türkçe ürünleri eBay'de doğru eşleştirin.
              </p>
              <ul className="space-y-3">
                {[
                  '65+ Trendyol kategorisi, tek tıkla tarama',
                  'AI ile Türkçe → İngilizce ürün eşleştirme',
                  'Kâr, ROI, marj ve 28 eBay komisyon oranı hesabı',
                  'Arka plan tarama — yüzlerce ürünü timeout olmadan tara',
                  'Fiyat geçmişi takibi ve ürün izleme',
                  'Grafik ve tablo ile görsel analiz',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <DollarSign size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/login" className="inline-block px-8 py-3 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
                  Arbitraj Tarayıcıyı Dene
                </Link>
              </div>
            </div>
            <motion.div
              className="bg-white rounded-3xl shadow-2xl p-8 border border-emerald-100"
              whileHover={{ scale: 1.01 }}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-5 py-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Trendyol Fiyat</p>
                    <p className="text-lg font-bold text-slate-800">₺459</p>
                  </div>
                  <ArrowLeftRight size={24} className="text-emerald-500" />
                  <div className="text-right">
                    <p className="text-xs text-slate-500 mb-1">eBay Medyan</p>
                    <p className="text-lg font-bold text-slate-800">$38.50</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-green-50 rounded-lg py-3">
                    <p className="text-xs text-slate-500">Kâr</p>
                    <p className="text-lg font-bold text-green-600">$12.40</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg py-3">
                    <p className="text-xs text-slate-500">ROI</p>
                    <p className="text-lg font-bold text-blue-600">+95%</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg py-3">
                    <p className="text-xs text-slate-500">Skor</p>
                    <p className="text-lg font-bold text-purple-600">78/100</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl px-5 py-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Ürün Maliyeti</span><span>$13.02</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Kargo</span><span>$8.00</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>eBay Komisyon</span><span>$5.10</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold text-slate-800 pt-2 border-t border-slate-200 mt-1">
                    <span>Net Kâr</span><span className="text-green-600">$12.40</span>
                  </div>
                </div>
                <p className="text-center text-xs text-slate-400">
                  Gerçek tarama örneği — Türk Peştemal kategorisi
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* Section 4: WHAT'S INCLUDED */}
      <motion.section
        className="py-20 md:py-28 bg-white"
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <div className="container max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Her Plana Dahil</h2>
            <p className="max-w-xl mx-auto text-lg text-slate-600">
              Araştırmadan satışa, tüm araçlar elinizin altında
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {includedFeatures.map((feature) => (
              <div key={feature} className="flex items-center gap-3 bg-slate-50 rounded-xl px-5 py-4">
                <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm font-medium text-slate-700">{feature}</span>
              </div>
            ))}
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, i) => (
              <motion.div
                key={i}
                className="bg-white p-8 rounded-2xl shadow-lg"
                variants={sectionVariants}
              >
                <div className="flex items-center mb-4">
                  <Image src={testimonial.image} alt={`${testimonial.name} - ${testimonial.company} müşteri görüşü`} width={56} height={56} className="w-14 h-14 rounded-full mr-4 object-cover" loading="lazy" />
                  <div>
                    <h4 className="font-semibold text-slate-800">{testimonial.name}</h4>
                    <p className="text-sm text-slate-500">{testimonial.company}</p>
                  </div>
                </div>
                <StarRating rating={testimonial.stars} />
                <blockquote className="mt-4 text-slate-600 italic relative pl-5">
                  <span className="absolute left-0 -top-2 text-5xl text-slate-200 font-serif">"</span>
                  {testimonial.quote}
                </blockquote>
              </motion.div>
            ))}
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
            Araştırma, Listeleme, Satış—Hepsini Tek Yerden Yönetin.
          </h2>
          <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
            AI destekli araçlarla Etsy ve eBay satışlarınızı büyütün. <Link href="/fiyatlandirma" className="text-blue-100 hover:text-white underline">Fiyatlandırma planlarını</Link> inceleyin.
          </p>
          <div className="mt-8">
            <Link href="/login" className="inline-block px-12 py-4 text-xl font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-full shadow-lg hover:scale-105 transform transition-transform duration-200 ease-out">
              Hemen Kayıt Ol
            </Link>
            <p className="mt-6 text-sm text-blue-200">
              Sorularınız mı var? <Link href="/iletisim" className="text-white underline hover:text-blue-100">Bize Ulaşın</Link>.
            </p>
          </div>
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


    </PublicLayout>
  );
}