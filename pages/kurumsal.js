import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { Briefcase, CheckCircle, TrendingUp, Users, Rocket } from 'lucide-react';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const timelineEvents = [
  {
    year: '2019',
    title: 'Kuruluş ve Fikir Aşaması',
    description: 'KolayXport fikri doğdu, e-ticaret otomasyonu için ilk adımlar atıldı.',
    icon: Rocket,
  },
  {
    year: '2020',
    title: 'İlk Prototip ve MVP',
    description: 'Temel özelliklerle ilk prototip geliştirildi ve küçük bir kullanıcı grubuyla test edildi.',
    icon: CheckCircle,
  },
  {
    year: '2022',
    title: 'Resmi Lansman ve Büyüme',
    description: 'KolayXport resmi olarak piyasaya sürüldü, ilk 50 kullanıcıya ulaşıldı.',
    icon: TrendingUp,
  },
  {
    year: '2024',
    title: 'Yeni Entegrasyonlar ve Genişleme',
    description: '10+ pazar yeri ve kargo entegrasyonu tamamlandı, kullanıcı sayısı 200+\'a ulaştı.',
    icon: Users,
  },
  {
    year: '2025+',
    title: 'Globalleşme ve İnovasyon',
    description: 'Yurt dışı pazarlara açılma ve yapay zeka destekli yeni otomasyon çözümleri hedefleniyor.',
    icon: Briefcase, // Placeholder for a more global icon if needed
  },
];

export default function KurumsalPage() {
  return (
    <PublicLayout 
      title="About Us – KolayXport" 
      description="Discover KolayXport's story, mission and vision. Learn how we simplify e-commerce operations." 
      seo={{
        openGraph: {
          images: [
            {
              url: 'https://kolayxport.com/og-about.png',
              width: 1200,
              height: 630,
              alt: 'About KolayXport',
            },
          ],
        },
      }}
    >
      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 lg:py-40 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100"
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
            Hakkımızda
          </motion.h1>
          <motion.p
            className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            200+ satıcının süreçlerini hızlandıran KolayXport, İstanbul'da doğdu, dünyaya açıldı.
          </motion.p>
        </div>
      </motion.section>

      {/* Timeline Section */}
      <motion.section 
        className="py-16 md:py-24 bg-white"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 text-center mb-16">Yolculuğumuz</h2>
          <div className="relative">
            {/* The vertical line */}
            <div className="hidden sm:block absolute w-1 bg-sky-200 h-full left-1/2 transform -translate-x-1/2"></div>
            
            {timelineEvents.map((event, index) => (
              <div
                key={event.year}
                className={`mb-12 flex items-center w-full ${index % 2 === 0 ? 'sm:flex-row-reverse' : 'sm:flex-row'}`}
              >
                <>
                  <div className="sm:w-1/2">
                    <div className={`p-6 rounded-xl shadow-lg ${index % 2 === 0 ? 'sm:mr-auto sm:text-right' : 'sm:ml-auto sm:text-left'} bg-white border border-slate-100`}>
                      <div className={`text-3xl font-bold text-sky-500 mb-2 ${index % 2 === 0 ? 'sm:justify-end' : 'sm:justify-start'} flex items-center`}>
                        {React.createElement(event.icon, { className: 'w-8 h-8 mr-2 sm:mr-0 sm:ml-2', strokeWidth: 1.5 })}
                        {event.year}
                      </div>
                      <h3 className="text-xl font-semibold text-slate-700 mb-1">{event.title}</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">{event.description}</p>
                    </div>
                  </div>
                  {/* Circle on the timeline */}
                  <div className="hidden sm:flex absolute w-6 h-6 bg-sky-500 rounded-full border-4 border-white left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </div>
                  <div className="sm:w-1/2" /> {/* Spacer */}
                </>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Main Content Stub */}
      <motion.section 
        className="py-16 md:py-24 bg-slate-50"
        variants={sectionVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        <div className="container max-w-3xl mx-auto px-6 lg:px-8 prose prose-slate lg:prose-xl">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-8 text-center">Misyonumuz & Vizyonumuz</h2>
          <p>
            KolayXport olarak misyonumuz, KOBİ'lerin ve e-ticaret girişimcilerinin operasyonel yüklerini azaltarak, onların esas işlerine odaklanmalarını sağlamaktır. Karmaşık süreçleri basitleştiren, kullanıcı dostu ve yenilikçi otomasyon çözümleri sunarak Türkiye'deki ve globaldeki satıcıların rekabet gücünü artırmayı hedefliyoruz.
          </p>
          <p>
            Vizyonumuz, e-ticaret otomasyonunda akla ilk gelen, güvenilir ve öncü bir teknoloji markası olmaktır. Sürekli gelişen teknolojiyi yakından takip ederek ve müşteri geri bildirimlerini merkeze alarak, satıcıların ihtiyaç duyduğu tüm araçları tek bir platformda sunan, global bir oyuncu haline gelmeyi amaçlıyoruz.
          </p>
          
          <h3 className="mt-12">Değerlerimiz</h3>
          <ul>
            <li><strong>Müşteri Odaklılık:</strong> Kullanıcılarımızın başarısı, bizim başarımızdır.</li>
            <li><strong>İnovasyon:</strong> Sürekli öğrenir, gelişir ve en yeni teknolojileri çözümlerimize entegre ederiz.</li>
            <li><strong>Şeffaflık:</strong> Açık iletişim ve dürüstlük üzerine kurulu ilişkiler inşa ederiz.</li>
            <li><strong>Takım Çalışması:</strong> Ortak hedeflere ulaşmak için birlikte çalışırız.</li>
            <li><strong>Sorumluluk:</strong> Yaptığımız işin ve topluma olan etkimizin sorumluluğunu alırız.</li>
          </ul>
          
        </div>
      </motion.section>

      {/* CTA Section */}
      <motion.section
        className="py-20 md:py-28 bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.6 }}
      >
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ekibimize Katılın!
          </h2>
          <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
            E-ticaretin geleceğini şekillendiren dinamik bir ekibin parçası olmak ister misiniz? Açık pozisyonlarımızı inceleyin.
          </p>
          <Link href="/kariyer" legacyBehavior> {/* Assuming a /kariyer page will exist */}
            <a className="px-10 py-4 text-lg font-semibold text-blue-600 bg-white rounded-full shadow-lg hover:scale-105 hover:bg-slate-50 transform transition-all duration-200 ease-out">
              Kariyerler
            </a>
          </Link>
        </div>
      </motion.section>
    </PublicLayout>
  );
}

KurumsalPage.getLayout = (page) => page; 