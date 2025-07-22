import React from 'react';
import Link from 'next/link';
import PublicLayout from '../components/PublicLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { LifeBuoy, Mail, MessageSquare } from 'lucide-react';

export default function SupportPage() {
  return (
    <PublicLayout
      title="KolayXport | Destek"
      description="KolayXport destek merkezi. Sorularınız ve yardım talepleriniz için bize ulaşın."
    >
      <NextSeo
        title="KolayXport Destek Merkezi | Yardım ve İletişim"
        description="KolayXport kullanımıyla ilgili sorularınız mı var? Destek ekibimizle iletişime geçin veya SSS bölümümüzü ziyaret edin."
        openGraph={{
          url: 'https://kolayxport.com/support',
          title: 'KolayXport Destek Merkezi',
          description: 'Yardıma mı ihtiyacınız var? KolayXport destek ekibi sorularınızı yanıtlamak için burada.',
          images: [
            {
              url: 'https://kolayxport.com/og-support.png', // TODO: Create and place /public/og-support.png (1200x630)
              width: 1200,
              height: 630,
              alt: 'KolayXport Destek',
            },
          ],
        }}
      />
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="py-20 md:py-32 px-6 lg:px-8 bg-slate-50"
      >
        <div className="container max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <LifeBuoy size={64} className="text-blue-500" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-800 mb-6">
            KolayXport Destek Merkezi
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 mb-10">
            Yardıma ihtiyacınız olduğunda buradayız! Aşağıdaki kanallardan bize ulaşabilir veya Sıkça Sorulan Sorular (yakında) bölümümüze göz atabilirsiniz.
          </p>
          
          <div className="grid md:grid-cols-2 gap-8 mb-12 text-left">
            <div className="bg-white p-8 rounded-lg shadow-lg">
              <div className="flex items-center text-blue-600 mb-3">
                <Mail size={24} className="mr-3" />
                <h3 className="text-2xl font-semibold">E-posta ile Destek</h3>
              </div>
              <p className="text-slate-600 mb-4">
                Genel sorularınız, teknik destek veya geri bildirimleriniz için bize e-posta gönderebilirsiniz.
              </p>
              <a href="mailto:kolayxport@gmail.com" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">
                kolayxport@gmail.com
              </a>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-lg">
              <div className="flex items-center text-blue-600 mb-3">
                <MessageSquare size={24} className="mr-3" />
                <h3 className="text-2xl font-semibold">İletişim Formu</h3>
              </div>
              <p className="text-slate-600 mb-4">
                Detaylı talepleriniz veya proje özelinde görüşmek için iletişim formumuzu doldurabilirsiniz.
              </p>
              <Link href="/iletisim" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">İletişim Sayfasına Git</Link>
            </div>
          </div>

          <p className="text-slate-500">
            Size en kısa sürede yardımcı olmak için elimizden geleni yapacağız.
          </p>
        </div>
      </motion.section>

      {/* Quick Help Section */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-6xl mx-auto px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-12 text-center">Hızlı Yardım</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "Kurulum Rehberi",
                desc: "Adım adım kurulum talimatları",
                link: "/docs/kurulum",
                icon: "🚀"
              },
              {
                title: "Video Rehberler",
                desc: "Görsel anlatımlarla öğrenin",
                link: "/docs/videolar",
                icon: "🎥"
              },
              {
                title: "API Dokümantasyonu",
                desc: "Geliştiriciler için detaylı API rehberi",
                link: "/docs/api",
                icon: "📖"
              },
              {
                title: "Sık Sorulan Sorular",
                desc: "En çok merak edilenlerin cevapları",
                link: "#faq",
                icon: "❓"
              }
            ].map((item, index) => (
              <Link key={index} href={item.link} className="block p-6 bg-slate-50 rounded-xl hover:bg-blue-50 transition-colors">
                <div className="text-3xl mb-4">{item.icon}</div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600">{item.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Knowledge Base */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="container max-w-6xl mx-auto px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-12 text-center">Bilgi Bankası</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-2xl shadow-lg">
              <h3 className="text-xl font-bold text-slate-800 mb-6">Başlangıç Rehberleri</h3>
              <ul className="space-y-3">
                {[
                  "KolayXport'a İlk Adım",
                  "Pazaryeri Entegrasyonu Kurulumu",
                  "İlk Siparişinizi Çekme",
                  "Kargo Entegrasyonu",
                  "Etiket Oluşturma"
                ].map((item, index) => (
                  <li key={index} className="flex items-center text-slate-600 hover:text-blue-600 cursor-pointer">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-3"></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-lg">
              <h3 className="text-xl font-bold text-slate-800 mb-6">İleri Düzey Özellikler</h3>
              <ul className="space-y-3">
                {[
                  "Toplu İşlem Araçları",
                  "Otomasyon Kuralları",
                  "Rapor ve Analitik",
                  "API Kullanımı",
                  "Webhook Konfigürasyonu"
                ].map((item, index) => (
                  <li key={index} className="flex items-center text-slate-600 hover:text-blue-600 cursor-pointer">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-3"></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-lg">
              <h3 className="text-xl font-bold text-slate-800 mb-6">Sorun Giderme</h3>
              <ul className="space-y-3">
                {[
                  "Bağlantı Sorunları",
                  "Sipariş Çekme Hataları",
                  "Etiket Yazdırma Sorunları",
                  "Entegrasyon Hataları",
                  "Performans İyileştirme"
                ].map((item, index) => (
                  <li key={index} className="flex items-center text-slate-600 hover:text-blue-600 cursor-pointer">
                    <span className="w-2 h-2 bg-red-500 rounded-full mr-3"></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-16 md:py-24 bg-white">
        <div className="container max-w-4xl mx-auto px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-12 text-center">Sıkça Sorulan Sorular</h2>
          <div className="space-y-6">
            {[
              {
                q: "KolayXport ücretsiz mi?",
                a: "KolayXport 30 günlük ücretsiz deneme sunuyor. Bu süre sonunda kullanım ihtiyacınıza göre planlarımızdan birini seçebilirsiniz."
              },
              {
                q: "Kaç pazaryerine aynı anda bağlanabilirim?",
                a: "Plan kısıtlaması olmaksızın desteklenen tüm pazaryerlerine bağlanabilirsiniz. Aktif entegrasyon sayısında kısıtlama bulunmamaktadır."
              },
              {
                q: "Verilerim güvende mi?",
                a: "Evet, tüm verilerin SSL şifrelemesi ile korunur. API anahtarları şifreli saklanır ve güvenlik denetimleri düzenli yapılır."
              },
              {
                q: "Mobil uygulaması var mı?",
                a: "Şu anda web tabanlı bir platform sunuyoruz. Mobil uygulama geliştirme süreci devam etmektedir."
              },
              {
                q: "Toplu işlem yapabilir miyim?",
                a: "Evet, toplu sipariş güncelleme, toplu etiket oluşturma ve toplu durum değişikliği gibi birçok toplu işlem özelliği mevcuttur."
              },
              {
                q: "Destek saatleri nedir?",
                a: "E-posta desteği 7/24 aktiftir. Telefon desteği Pazartesi-Cuma 09:00-18:00 saatleri arasında hizmet vermektedir."
              }
            ].map((faq, index) => (
              <div key={index} className="bg-slate-50 p-6 rounded-xl">
                <h3 className="text-lg font-semibold text-slate-800 mb-3">{faq.q}</h3>
                <p className="text-slate-600 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* System Status */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="container max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-12">Sistem Durumu</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">API Servisleri</h3>
              <p className="text-green-600 font-medium">Çalışıyor</p>
              <p className="text-sm text-slate-500 mt-2">%99.9 Uptime</p>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Entegrasyonlar</h3>
              <p className="text-green-600 font-medium">Çalışıyor</p>
              <p className="text-sm text-slate-500 mt-2">Tüm entegrasyonlar aktif</p>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="w-4 h-4 bg-green-500 rounded-full mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Veritabanı</h3>
              <p className="text-green-600 font-medium">Çalışıyor</p>
              <p className="text-sm text-slate-500 mt-2">Ortalama yanıt süresi: 45ms</p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
} 