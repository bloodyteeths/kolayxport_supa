import React from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { Zap, Info, Settings, HelpCircle, CheckCircle, ExternalLink, ShoppingCart, Briefcase, Truck } from 'lucide-react';
import Link from 'next/link';

const Section = ({ title, icon: Icon, children, id }) => (
  <motion.div
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
  </motion.div>
);

const Step = ({ number, title, children }) => (
  <div className="flex items-start mb-4">
    <div className="flex-shrink-0 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold mr-4">
      {number}
    </div>
    <div>
      <h4 className="font-semibold text-slate-800 mb-1">{title}</h4>
      <div className="text-sm text-slate-600">{children}</div>
    </div>
  </div>
);

const PlatformList = ({ platforms }) => (
  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
    {platforms.map(platform => (
      <li key={platform} className="bg-slate-100 p-3 rounded-md text-sm text-slate-700 font-medium text-center shadow-sm">
        {platform}
      </li>
    ))}
  </ul>
);

export default function EntegrasyonlarVeRehberlerPage() {
  const veeqoEcommercePlatforms = ['Shopify', 'Shopify Plus', 'Magento', 'BigCommerce', 'WooCommerce', 'Wix'];
  const veeqoMarketplaces = ['Amazon', 'eBay', 'Etsy', 'Walmart'];

  const shippoEcommercePlatforms = ['Shopify', 'WooCommerce', 'BigCommerce', 'Wix', 'Squarespace', 'Magento 2', 'Ecwid by Lightspeed'];
  const shippoMarketplaces = ['Etsy', 'Amazon', 'eBay', 'Walmart', 'Mercari'];

  return (
    <AppLayout title="Entegrasyonlar ve Rehberler - KolayXport">
      <NextSeo noindex={true} nofollow={true} />

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-slate-800 flex items-center">
            <Zap size={36} className="mr-3 text-blue-600" />
            Entegrasyonlar ve Kurulum Rehberleri
          </h1>
          <p className="mt-2 text-slate-600">
            KolayXport'u e-ticaret altyapınızla nasıl entegre edeceğinizi ve verilerinizi nasıl yöneteceğinizi öğrenin.
          </p>
        </div>
      </motion.div>

      <Section title="Genel Entegrasyon Yaklaşımımız" icon={Info}>
        <p>
          KolayXport, e-ticaret operasyonlarınızı merkezileştirmek için esnek bir entegrasyon modeli sunar.
          Doğrudan entegrasyonlarımızla Türkiye'nin önde gelen pazaryerlerinden olan <strong>Trendyol</strong> ve <strong>Hepsiburada</strong>'dan sipariş ve ürün verilerinizi çekebilirsiniz.
        </p>
        <p className="mt-2">
          Daha geniş bir platform yelpazesine erişim için, mevcut <strong>Veeqo</strong> veya <strong>Shippo</strong> hesaplarınızı KolayXport'a bağlayabilirsiniz. Bu sayede, Veeqo ve Shippo'nun desteklediği çok sayıda uluslararası pazaryeri ve e-ticaret platformundan veri akışı sağlayabilirsiniz. Veeqo ve Shippo hesaplarınızı nasıl bağlayacağınıza dair detaylı bilgiyi "Nasıl Kullanırım?" sayfamızda bulabilirsiniz.
        </p>
        <p className="mt-2">
          KolayXport üzerinden oluşturulan gönderileriniz için ise şu anda <strong>FedEx</strong> kargo entegrasyonumuzu kullanmaktayız.
        </p>
        <p className="mt-3">
          Aşağıda, desteklediğimiz doğrudan entegrasyonları ve Veeqo/Shippo aracılığıyla erişebileceğiniz platform türlerini bulabilirsiniz. API anahtarlarınızı yönetmek ve bağlantıları kurmak için <Link href="/app/settings" className="text-blue-600 hover:underline">Ayarlar</Link> sayfanızı ziyaret edebilirsiniz.
        </p>
      </Section>

      <Section title="Doğrudan KolayXport Entegrasyonları" icon={ShoppingCart}>
        <p className="mb-4">Aşağıdaki platformlarla doğrudan entegre olarak sipariş ve ürün verilerinizi KolayXport'a aktarabilirsiniz:</p>
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">Trendyol</h3>
            <p className="mb-3">Trendyol mağaza verilerinizi KolayXport'a bağlamak için <Link href="#trendyol-guide" className="text-blue-600 hover:underline">Trendyol Entegrasyon Rehberi</Link> bölümündeki adımları takip edebilirsiniz.</p>
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">Hepsiburada</h3>
            <p>Hepsiburada entegrasyon rehberi yakında eklenecektir. Bu entegrasyon için Hepsiburada satıcı panelinizden alacağınız API bilgileri gerekecektir.</p>
          </div>
        </div>
      </Section>

      <Section title="Veeqo ile Erişebileceğiniz Platformlar" icon={Briefcase}>
        <p className="mb-4">
          Mevcut Veeqo hesabınızı KolayXport'a bağlayarak (detaylar "Nasıl Kullanırım?" sayfasında), Veeqo'nun entegre olduğu aşağıdaki gibi popüler e-ticaret platformlarından ve pazaryerlerinden veri çekebilirsiniz:
        </p>
        <h4 className="text-lg font-semibold text-slate-700 mt-4 mb-2">E-Ticaret Platformları:</h4>
        <PlatformList platforms={veeqoEcommercePlatforms} />
        <h4 className="text-lg font-semibold text-slate-700 mt-6 mb-2">Pazaryerleri:</h4>
        <PlatformList platforms={veeqoMarketplaces} />
        <p className="mt-4 text-sm text-slate-500">
          Bu listeler başlıca platformları içermektedir. Veeqo'nun güncel ve tam entegrasyon listesi için lütfen Veeqo'nun resmi kaynaklarını kontrol ediniz. KolayXport, Veeqo hesabınız üzerinden bu platformlardan veri alabilir.
        </p>
      </Section>

      <Section title="Shippo ile Erişebileceğiniz Platformlar" icon={Briefcase}>
        <p className="mb-4">
          Mevcut Shippo hesabınızı KolayXport'a bağlayarak (detaylar "Nasıl Kullanırım?" sayfasında), Shippo'nun entegre olduğu aşağıdaki gibi popüler e-ticaret platformlarından ve pazaryerlerinden veri çekebilirsiniz:
        </p>
        <h4 className="text-lg font-semibold text-slate-700 mt-4 mb-2">E-Ticaret Platformları:</h4>
        <PlatformList platforms={shippoEcommercePlatforms} />
        <h4 className="text-lg font-semibold text-slate-700 mt-6 mb-2">Pazaryerleri:</h4>
        <PlatformList platforms={shippoMarketplaces} />
        <p className="mt-4 text-sm text-slate-500">
          Bu listeler başlıca platformları içermektedir. Shippo'nun güncel ve tam entegrasyon listesi için lütfen Shippo'nun resmi kaynaklarını kontrol ediniz. KolayXport, Shippo hesabınız üzerinden bu platformlardan veri alabilir.
        </p>
      </Section>
      
      <Section title="Kargo Entegrasyonumuz" icon={Truck}>
        <p>KolayXport üzerinden yapacağınız gönderiler için şu anda <strong>FedEx</strong> altyapısını kullanmaktayız. Siparişlerinizi hazırlayıp kargoya hazır hale getirdiğinizde, gönderi süreçleri FedEx üzerinden yönetilecektir.</p>
        <p className="mt-2 text-sm text-slate-500">FedEx entegrasyonumuzla ilgili ayar veya seçenekler (eğer kullanıcı tarafından yönetilebilir ise) <Link href="/app/settings" className="text-blue-600 hover:underline">Ayarlar</Link> sayfasında veya "Nasıl Kullanırım?" bölümünde detaylandırılacaktır.</p>
      </Section>

      <Section title="Trendyol Entegrasyon Rehberi" icon={HelpCircle} id="trendyol-guide">
        <p className="mb-4">
          Trendyol mağazanızdan siparişlerinizi KolayXport'a otomatik olarak aktarmak için aşağıdaki adımları izleyin:
        </p>
        <Step number="1" title="Trendyol Satıcı Paneline Giriş Yapın">
          <p><a href="https://partner.trendyol.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Trendyol Satıcı Paneli</a>'ne (partner.trendyol.com) kullanıcı bilgilerinizle giriş yapın.</p>
        </Step>
        <Step number="2" title="API Anahtarı Bilgilerinizi Bulun">
          <p>Satıcı panelinde genellikle "Entegrasyon Bilgileri", "API Bilgileri" veya benzeri bir menü altında API Anahtarınızı (API Key) ve Satıcı ID'nizi (Supplier ID/Satıcı ID) bulabilirsiniz.</p>
          <p className="mt-1">Bu bilgiler genellikle şu şekilde görünür:</p>
          <ul className="list-disc list-inside ml-4 mt-1 text-xs">
            <li><strong>Satıcı ID (Supplier ID):</strong> Genellikle sayısal bir değerdir.</li>
            <li><strong>API Key (API Anahtarı):</strong> Uzun bir karakter dizisidir.</li>
            <li><strong>API Secret (API Gizli Anahtarı):</strong> Bazı durumlarda API Key ile birlikte bir de Secret Key verilebilir. KolayXport için genellikle API Key ve Satıcı ID yeterlidir.</li>
          </ul>
          <p className="mt-1 text-xs text-slate-500">Trendyol paneli arayüzü zaman zaman güncellenebilir. API bilgilerinizi bulmakta zorlanırsanız, Trendyol Satıcı Destek Hattı'ndan yardım alabilirsiniz.</p>
        </Step>
        <Step number="3" title="API Bilgilerini KolayXport'a Girin">
          <p>Elde ettiğiniz Satıcı ID ve API Anahtarı bilgilerinizi KolayXport dashboard'unuzdaki <Link href="/app/settings" className="text-blue-600 hover:underline">Ayarlar</Link> bölümünde ilgili Trendyol entegrasyon alanlarına girin ve kaydedin.</p>
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
            <p><Settings size={16} className="inline mr-1"/> API anahtarlarınızı girerken kopyala-yapıştır yöntemini kullanmanız, olası yazım hatalarını engelleyecektir.</p>
          </div>
        </Step>
        <Step number="4" title="Entegrasyonu Test Edin">
          <p>Bilgileri kaydettikten sonra, sistemimiz Trendyol mağazanızla bağlantıyı test edecektir. Birkaç dakika içinde siparişlerinizin akmaya başladığını görmelisiniz.</p>
          <p className="mt-1 text-xs text-slate-500">Sorun yaşamanız durumunda <Link href="/destek" className="text-blue-600 hover:underline">Destek sayfamızdan</Link> bize ulaşabilirsiniz. (Not: /support linki /destek olarak güncellendi.)</p>
        </Step>
      </Section>

    </AppLayout>
  );
}

EntegrasyonlarVeRehberlerPage.getLayout = function getLayout(page) {
  return <AppLayout>{page}</AppLayout>;
}; 