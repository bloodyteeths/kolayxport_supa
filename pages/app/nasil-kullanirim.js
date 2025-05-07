import React from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { HelpCircle, Settings, ExternalLink, Link as LinkIcon, ListChecks } from 'lucide-react';
import Link from 'next/link';

const GuideSection = ({ title, icon: Icon, children, id }) => (
  <motion.section
    id={id}
    className="bg-white p-6 md:p-8 rounded-lg shadow-md mb-8"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
  >
    <div className="flex items-center mb-6">
      {Icon && <Icon size={32} className="mr-3 text-blue-600" />}
      <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
    </div>
    <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed">
      {children}
    </div>
  </motion.section>
);

const Step = ({ number, title, children }) => (
  <div className="flex items-start mb-6">
    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold mr-4 text-lg">
      {number}
    </div>
    <div>
      <h3 className="text-lg font-semibold text-slate-800 mb-1">{title}</h3>
      <div className="text-slate-600">{children}</div>
    </div>
  </div>
);

export default function HowToUsePage() {
  return (
    <AppLayout title="KolayXport Nasıl Kullanılır?">
      <NextSeo noindex={true} nofollow={true} />

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-slate-800 flex items-center">
            <HelpCircle size={36} className="mr-3 text-blue-600" />
            KolayXport Nasıl Kullanılır?
          </h1>
          <p className="mt-2 text-slate-600">
            Bu rehber, KolayXport'u etkili bir şekilde kullanmanıza ve e-ticaret süreçlerinizi otomatikleştirmenize yardımcı olmak için hazırlanmıştır.
          </p>
        </div>
      </motion.div>

      <GuideSection title="Veeqo Hesabınızı Bağlama" icon={LinkIcon} id="connect-veeqo">
        <p className="mb-4">
          Veeqo hesabınızdaki sipariş ve ürün verilerinizi KolayXport'a aktarmak için aşağıdaki adımları izleyin. Başlamadan önce Veeqo API anahtarınızın hazır olduğundan emin olun.
        </p>
        <Step number="1" title="Veeqo API Anahtarınızı Edinin">
          <p>Veeqo hesabınıza giriş yapın. API anahtarınızı genellikle Veeqo'nun ayarlar veya entegrasyonlar bölümünde bulabilirsiniz.</p>
          <p className="mt-1 text-sm text-slate-500">Veeqo arayüzü zamanla değişebilir. En güncel bilgi için Veeqo'nun kendi yardım dokümanlarına başvurmanız önerilir.</p>
        </Step>
        <Step number="2" title="KolayXport Ayarlar Sayfasına Gidin">
          <p>KolayXport uygulamasında, sol menüden veya profilinizden <Link href="/app/settings"><a className="text-blue-600 hover:underline">Ayarlar</a></Link> sayfasına gidin.</p>
        </Step>
        <Step number="3" title="Veeqo API Bilgilerini Girin">
          <p>Ayarlar sayfasındaki "Veeqo API Bilgileri" bölümünü bulun. İlgili alana Veeqo API Anahtarınızı girin.</p>
          <p className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
            <Settings size={16} className="inline mr-1" /> API anahtarınızı girerken kopyala-yapıştır yöntemini kullanmanız, olası yazım hatalarını engelleyecektir.
          </p>
        </Step>
        <Step number="4" title="Ayarları Kaydedin ve Senkronizasyonu Bekleyin">
          <p>"Veeqo Ayarlarını Kaydet" butonuna tıklayın. Bağlantı başarılı olduğunda, Veeqo verileriniz KolayXport ile senkronize olmaya başlayacaktır. Bu işlem veri miktarına bağlı olarak biraz zaman alabilir.</p>
        </Step>
        <p className="mt-4 text-sm text-slate-500">
          Sorun yaşarsanız, API anahtarınızın doğru olduğundan ve Veeqo hesabınızda API erişim izinlerinin aktif olduğundan emin olun. Gerekirse <Link href="/destek"><a className="text-blue-600 hover:underline">destek</a></Link> alın.
        </p>
      </GuideSection>

      <GuideSection title="Shippo Hesabınızı Bağlama" icon={LinkIcon} id="connect-shippo">
        <p className="mb-4">
          Shippo hesabınızdaki gönderi ve sipariş verilerinizi (veya Shippo'nun entegre olduğu platformlardan gelen verileri) KolayXport'a aktarmak için aşağıdaki adımları izleyin. Başlamadan önce Shippo Özel API Token'ınızın (Private API Token) hazır olduğundan emin olun.
        </p>
        <Step number="1" title="Shippo Özel API Token'ınızı Edinin">
          <p>Shippo hesabınıza giriş yapın. Özel API Token'ınızı genellikle Shippo'nun API ayarları veya geliştirici bölümünde bulabilirsiniz.</p>
          <p className="mt-1 text-sm text-slate-500">Shippo arayüzü zamanla değişebilir. En güncel bilgi için Shippo'nun kendi yardım dokümanlarına başvurmanız önerilir.</p>
        </Step>
        <Step number="2" title="KolayXport Ayarlar Sayfasına Gidin">
          <p>KolayXport uygulamasında, sol menüden veya profilinizden <Link href="/app/settings"><a className="text-blue-600 hover:underline">Ayarlar</a></Link> sayfasına gidin.</p>
        </Step>
        <Step number="3" title="Shippo API Bilgilerini Girin">
          <p>Ayarlar sayfasındaki "Shippo API Bilgileri" bölümünü bulun. İlgili alana Shippo Özel API Token'ınızı girin.</p>
          <p className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
            <Settings size={16} className="inline mr-1" /> API token'ınızı girerken kopyala-yapıştır yöntemini kullanmanız, olası yazım hatalarını engelleyecektir.
          </p>
        </Step>
        <Step number="4" title="Ayarları Kaydedin ve Senkronizasyonu Bekleyin">
          <p>"Shippo Ayarlarını Kaydet" butonuna tıklayın. Bağlantı başarılı olduğunda, Shippo verileriniz KolayXport ile senkronize olmaya başlayacaktır.</p>
        </Step>
        <p className="mt-4 text-sm text-slate-500">
          Sorun yaşarsanız, API token'ınızın doğru olduğundan ve Shippo hesabınızda gerekli izinlerin bulunduğundan emin olun. Gerekirse <Link href="/destek"><a className="text-blue-600 hover:underline">destek</a></Link> alın.
        </p>
      </GuideSection>

      <GuideSection title="Diğer Rehberler (Yakında)" icon={ListChecks} id="other-guides">
        <p>
          Trendyol ve Hepsiburada gibi doğrudan entegrasyonlarımızın kurulumu, FedEx ile kargo yönetimi, ürün ve sipariş yönetimi gibi KolayXport'un diğer özelliklerinin nasıl kullanılacağına dair detaylı rehberler yakında bu sayfada yer alacaktır.
        </p>
        <p className="mt-2">
          Trendyol entegrasyonu hakkında bilgi için <Link href="/app/entegrasyonlar-ve-rehberler#trendyol-guide"><a className="text-blue-600 hover:underline">Entegrasyonlar ve Rehberler sayfasındaki Trendyol bölümüne</a></Link> göz atabilirsiniz.
        </p>
      </GuideSection>

    </AppLayout>
  );
}

HowToUsePage.getLayout = function getLayout(page) {
  return <AppLayout>{page}</AppLayout>;
}; 