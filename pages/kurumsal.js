import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { Briefcase, CheckCircle, TrendingUp, Users, Rocket } from 'lucide-react';

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
    description: 'KolayXport resmi olarak piyasaya suruldu, ilk kullanicilarla test edildi.',
    icon: TrendingUp,
  },
  {
    year: '2024',
    title: 'Yeni Entegrasyonlar ve Genişleme',
    description: '10+ pazar yeri ve kargo entegrasyonu tamamlandi, AI destekli araclar eklendi.',
    icon: Users,
  },
  {
    year: '2025+',
    title: 'Globalleşme ve İnovasyon',
    description: 'Yurt dışı pazarlara açılma ve yapay zeka destekli yeni otomasyon çözümleri hedefleniyor.',
    icon: Briefcase,
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
      <div className="w-full">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 lg:py-40 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100 animate-fadeIn">
          <div className="relative z-10">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-800 tracking-tight mb-6 animate-slideUp">
              Hakkımızda
            </h1>
            <p className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 animate-slideUp">
              E-ticaret saticilarinin sureclerini hizlandiran KolayXport, Istanbul'da dogdu, dunyaya acildi.
            </p>
          </div>
        </section>

        {/* Timeline Section */}
        <section className="py-16 md:py-24 bg-white">
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
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Mission & Vision */}
        <section className="py-16 md:py-24 bg-slate-50">
          <div className="container max-w-4xl mx-auto px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-16 text-center">Misyonumuz & Vizyonumuz</h2>
            
            <div className="grid md:grid-cols-2 gap-12 mb-16">
              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="flex items-center mb-6">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800">Misyonumuz</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  KOBİ'lerin ve e-ticaret girişimcilerinin operasyonel yüklerini azaltarak, onların esas işlerine odaklanmalarını sağlamak. 
                  Karmaşık süreçleri basitleştiren, kullanıcı dostu ve yenilikçi otomasyon çözümleri sunarak Türkiye'deki ve globaldeki 
                  satıcıların rekabet gücünü artırmayı hedefliyoruz.
                </p>
              </div>
              
              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="flex items-center mb-6">
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mr-4">
                    <Rocket className="w-6 h-6 text-indigo-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800">Vizyonumuz</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  E-ticaret otomasyonunda akla ilk gelen, güvenilir ve öncü bir teknoloji markası olmak. Sürekli gelişen teknolojiyi 
                  yakından takip ederek ve müşteri geri bildirimlerini merkeze alarak, satıcıların ihtiyaç duyduğu tüm araçları tek bir 
                  platformda sunan, global bir oyuncu haline gelmek.
                </p>
              </div>
            </div>

            {/* Values */}
            <div className="bg-white p-8 rounded-2xl shadow-lg">
              <h3 className="text-2xl font-bold text-slate-800 mb-8 text-center">Değerlerimiz</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[
                  { title: 'Müşteri Odaklılık', desc: 'Kullanıcılarımızın başarısı, bizim başarımızdır.', icon: Users },
                  { title: 'İnovasyon', desc: 'Sürekli öğrenir, gelişir ve en yeni teknolojileri entegre ederiz.', icon: Rocket },
                  { title: 'Şeffaflık', desc: 'Açık iletişim ve dürüstlük üzerine kurulu ilişkiler inşa ederiz.', icon: CheckCircle },
                  { title: 'Takım Çalışması', desc: 'Ortak hedeflere ulaşmak için birlikte çalışırız.', icon: Users },
                  { title: 'Sorumluluk', desc: 'Yaptığımız işin ve topluma olan etkimizin sorumluluğunu alırız.', icon: Briefcase },
                  { title: 'Kalite', desc: 'Her detayda mükemmellik arayışıyla çözümler geliştiririz.', icon: TrendingUp }
                ].map((value, index) => (
                  <div key={index} className="text-center p-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      {React.createElement(value.icon, { className: 'w-6 h-6 text-blue-600' })}
                    </div>
                    <h4 className="font-semibold text-slate-800 mb-2">{value.title}</h4>
                    <p className="text-sm text-slate-600 leading-relaxed">{value.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Statistics */}
        <section className="py-16 md:py-24 bg-white">
          <div className="container max-w-6xl mx-auto px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-16">Sayılarla KolayXport</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { number: 'Etsy & eBay', label: 'Coklu Pazaryeri', desc: 'Tek panelden yonetim' },
                { number: '7/24', label: 'Erisim', desc: 'Her yerden ulasim' },
                { number: 'AI Destekli', label: 'Akilli Araclar', desc: 'Listeleme ve arastirma' },
                { number: 'TR & Global', label: 'Pazar Destegi', desc: 'Turkiye ve dunya pazarlari' }
              ].map((stat, index) => (
                <div key={index} className="p-6 bg-slate-50 rounded-xl">
                  <div className="text-3xl md:text-4xl font-bold text-blue-600 mb-2">{stat.number}</div>
                  <div className="text-lg font-semibold text-slate-800 mb-1">{stat.label}</div>
                  <div className="text-sm text-slate-600">{stat.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology Stack */}
        <section className="py-16 md:py-24 bg-slate-50">
          <div className="container max-w-6xl mx-auto px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-16 text-center">Teknoloji Altyapımız</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-4">Güvenlik</h3>
                <p className="text-slate-600 leading-relaxed">
                  SSL şifrelemesi, OAuth 2.0 yetkilendirmesi ve düzenli güvenlik denetimleri ile verilerinizi koruyoruz.
                </p>
              </div>
              
              <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <TrendingUp className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-4">Ölçeklenebilirlik</h3>
                <p className="text-slate-600 leading-relaxed">
                  Cloud-native mimarimiz ile işletmenizin büyümesine paralel olarak sistem kapasitemizi artırıyoruz.
                </p>
              </div>
              
              <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Rocket className="w-8 h-8 text-purple-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-4">Performans</h3>
                <p className="text-slate-600 leading-relaxed">
                  Optimize edilmiş API'ler ve akıllı önbellekleme ile saniyeler içinde güncel veri sağlıyoruz.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 md:py-28 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Ekibimize Katılın!
            </h2>
            <p className="max-w-xl mx-auto text-lg text-blue-100 mb-10">
              E-ticaretin geleceğini şekillendiren dinamik bir ekibin parçası olmak ister misiniz? Açık pozisyonlarımızı inceleyin.
            </p>
            <Link href="/kariyer" className="px-10 py-4 text-lg font-semibold text-blue-600 bg-white rounded-full shadow-lg hover:scale-105 hover:bg-slate-50 transform transition-all duration-200 ease-out">Kariyerler</Link>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}

KurumsalPage.getLayout = (page) => page; 