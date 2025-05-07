import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { NextSeo } from 'next-seo';
import { Zap, Shuffle, Edit3, Package, Link2, Settings, ShieldCheck, Gift } from 'lucide-react';

const featureSections = [
  {
    icon: Zap,
    title: 'Otomatik Sipariş Senkronizasyonu',
    description: 'Trendyol, Hepsiburada, Amazon, n11, Shopify gibi popüler pazaryerlerinden ve e-ticaret platformlarından siparişlerinizi otomatik olarak merkezi bir sisteme aktarın. Manuel veri girişine son verin, zamandan kazanın.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Sipariş+Senkronizasyonu', // Placeholder
    alt: 'Otomatik Sipariş Senkronizasyonu Animasyonu'
  },
  {
    icon: Package,
    title: 'Merkezi Sipariş ve Stok Yönetimi',
    description: 'Tüm kanallardan gelen siparişlerinizi tek bir yerden yönetin. Temel stok yönetimi özellikleriyle ürünlerinizin takibini yapın, fazla satışı engelleyin.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Stok+Yönetimi', // Placeholder
    alt: 'Merkezi Sipariş ve Stok Yönetimi Arayüzü'
  },
  {
    icon: Edit3,
    title: 'Kargo Etiketi Oluşturma Asistanı',
    description: 'Anlaşmalı kargo firmalarınız için kargo etiketi oluşturma süreçlerinizi hızlandırın. Tek tıkla etiket bilgileri hazırlama ve yazdırmaya hazır hale getirme kolaylığı.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Kargo+Etiketi', // Placeholder
    alt: 'Kargo Etiketi Oluşturma Ekranı'
  },
  {
    icon: Link2,
    title: 'Geniş Entegrasyon Yelpazesi',
    description: 'Türkiye\'nin önde gelen pazaryerleri ve e-ticaret altyapılarıyla (Trendyol, Hepsiburada, Amazon, n11, PTTAvm, Shopify, WooCommerce vb.) sorunsuz entegrasyon. Kargo firmalarıyla entegre çalışın.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Entegrasyonlar', // Placeholder
    alt: 'Entegrasyon Logoları'
  },
  {
    icon: Settings,
    title: 'Kolay Kurulum ve Kullanım',
    description: 'Google hesabınızla saniyeler içinde kaydolun. Kullanıcı dostu arayüzümüz sayesinde karmaşık ayarlarla uğraşmadan otomasyona başlayın.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Kolay+Kurulum', // Placeholder
    alt: 'Kolay Kurulum Adımları'
  },
  {
    icon: ShieldCheck,
    title: 'Güvenli Veri Saklama',
    description: 'API anahtarlarınız ve hassas verileriniz gelişmiş şifreleme yöntemleriyle korunur. Google Cloud altyapısının sunduğu güvenlik standartlarından faydalanın.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Veri+Güvenliği', // Placeholder
    alt: 'Veri Güvenliği Kalkanı'
  },
  {
    icon: Gift,
    title: 'Esnek ve Ücretsiz Başlangıç Planı',
    description: 'Temel entegrasyon ve sipariş yönetimi özelliklerimiz her zaman ücretsiz. Sınırsız sipariş ve ürün listeleme ile işletmenizi özgürce büyütün.',
    imgSrc: 'https://via.placeholder.com/500x300.png?text=Ücretsiz+Plan', // Placeholder
    alt: 'Ücretsiz Plan Avantajları'
  }
];

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

export default function OzelliklerPage() {
  return (
    <PublicLayout
      title="KolayXport | Özellikler"
      description="KolayXport'un e-ticaret operasyonlarınızı nasıl kolaylaştırabileceğini keşfedin. Otomatik sipariş yönetimi, kargo entegrasyonları ve daha fazlası."
    >
      <NextSeo
        title="KolayXport Özellikleri | E-Ticaret Otomasyon Çözümleri"
        description="KolayXport ile e-ticaretinizi bir üst seviyeye taşıyın. Sipariş senkronizasyonu, stok yönetimi, kargo etiketi asistanı ve geniş entegrasyon seçenekleri."
        openGraph={{
          url: 'https://kolayxport.com/ozellikler',
          title: 'KolayXport E-Ticaret Otomasyon Özellikleri',
          description: 'Otomatik sipariş çekme, merkezi yönetim, kargo entegrasyonları ve daha birçok özellikle işinizi kolaylaştırın.',
          images: [
            {
              url: 'https://kolayxport.com/og-ozellikler.png', // TODO: Create and place this image in /public
              width: 1200,
              height: 630,
              alt: 'KolayXport Özellikler Sayfası',
            },
          ],
        }}
      />

      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 text-center px-6 lg:px-8 bg-gradient-to-br from-sky-50 to-blue-100"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-multiply"></div>
        </div>
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl md:text-6xl font-black text-slate-900 tracking-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            KolayXport'un <span className="text-blue-600">Güçlü Özelliklerini</span> Keşfedin
          </motion.h1>
          <motion.p
            className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            E-ticaret operasyonlarınızı basitleştiren, zaman kazandıran ve işinizi büyütmenize yardımcı olan çözümlerimizle tanışın.
          </motion.p>
        </div>
      </motion.section>

      {/* Features Grid */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
            {featureSections.map((feature, index) => (
              <motion.div
                key={index}
                className="bg-slate-50 rounded-xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300"
                variants={sectionVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
              >
                <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-full mb-6 shadow-md">
                  <feature.icon size={32} />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-3">{feature.title}</h3>
                <p className="text-slate-600 leading-relaxed text-sm">{feature.description}</p>
                {/* Placeholder for image, you might want to add it here if needed */}
                {/* <img src={feature.imgSrc} alt={feature.alt} className="mt-4 rounded-lg shadow-md" /> */}
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      
      {/* CTA Section */}
      <motion.section
        className="py-20 bg-gradient-to-br from-slate-800 to-slate-900 text-white"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            KolayXport ile E-ticaretinizi Bir Sonraki Seviyeye Taşıyın!
          </h2>
          <p className="text-lg text-slate-300 mb-10 max-w-xl mx-auto">
            Otomasyonun gücünü keşfedin, operasyonel yükünüzü azaltın ve satışlarınıza odaklanın. Hemen ücretsiz deneyin!
          </p>
          <Link href="/api/auth/signin" legacyBehavior>
            <a className="inline-block px-10 py-4 text-lg font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow-xl hover:scale-105 transform transition-transform duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-400">
              Ücretsiz Kaydol ve Başla
            </a>
          </Link>
        </div>
      </motion.section>

    </PublicLayout>
  );
}

OzelliklerPage.getLayout = (page) => page; 