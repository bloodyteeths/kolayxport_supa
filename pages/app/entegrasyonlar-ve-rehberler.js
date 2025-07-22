import React, { useState } from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { Zap, Info, Settings, HelpCircle, CheckCircle, ExternalLink, ShoppingCart, Briefcase, Truck, ChevronDown, ChevronUp, BookOpen, Download, Chrome, Globe } from 'lucide-react';
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
  const [isVeeqoGuideOpen, setIsVeeqoGuideOpen] = useState(false);
  const [isEtsyGuideOpen, setIsEtsyGuideOpen] = useState(false);
  
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
            <h3 className="text-xl font-semibold text-slate-700 mb-2 flex items-center">
              <Chrome size={20} className="mr-2 text-green-600" />
              Etsy (Chrome Eklentisi)
            </h3>
            <p className="mb-3">Etsy Shop Manager siparişlerinizi güvenli Chrome eklentisiyle aktarın. API gerektirmez, otomatik senkronizasyon sağlar. <Link href="#etsy-guide" className="text-blue-600 hover:underline">Kurulum rehberini görmek için tıklayın</Link>.</p>
          </div>
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
        
        <div className="mt-6">
          <button
            onClick={() => setIsVeeqoGuideOpen(!isVeeqoGuideOpen)}
            className="flex items-center justify-between w-full p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors duration-200"
          >
            <div className="flex items-center">
              <BookOpen size={20} className="mr-2 text-blue-600" />
              <span className="text-lg font-semibold text-blue-800">Veeqo Entegrasyon Rehberi</span>
            </div>
            {isVeeqoGuideOpen ? (
              <ChevronUp size={24} className="text-blue-600" />
            ) : (
              <ChevronDown size={24} className="text-blue-600" />
            )}
          </button>
          
          {isVeeqoGuideOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-4 p-6 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="space-y-6">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-amber-800 font-semibold mb-2">Önemli Bilgi</p>
                  <p className="text-sm text-amber-700">
                    Veeqo entegrasyonu, tüm pazaryerlerini Amazon üzerinden bağlar. Bu sayede gizli bilgilerinizin dışarıya sızma riski yoktur ve entegrasyon nedeniyle hesabınızın askıya alınma riski bulunmaz.
                  </p>
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-800">Veeqo Entegrasyon Adımları</h3>
                  
                  <div className="space-y-6">
                    <Step number="1" title="Veeqo.com'a Üye Olun">
                      <p>
                        <a href="https://veeqo.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Veeqo.com</a>'a giriş yapın. 
                        "Sign up" (yeşil buton) tıkladığınızda üyelik ekranına yönlendirileceksiniz. 
                        E-mail adresinizle üyelik oluşturabilir veya Amazon hesabı ile giriş yapabilirsiniz.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-signup.png" 
                        alt="Veeqo üyelik ekranı" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="2" title="Şirket Bilgilerini Doldurun">
                      <p>E-mail ve şifrenizi oluşturduktan sonra karşınıza çıkacak şirket bilgileri formunu doldurun.</p>
                      <div className="mt-2 p-3 bg-gray-100 rounded text-sm">
                        <p className="font-semibold mb-1">Örnek Bilgiler (ABD adresi yoksa kullanabilirsiniz):</p>
                        <ul className="space-y-1 text-gray-700">
                          <li><strong>Company name:</strong> Benim firmam</li>
                          <li><strong>Orders per month:</strong> Herhangi bir aralık (önemi yok)</li>
                          <li><strong>Country:</strong> United States</li>
                          <li><strong>Phone number:</strong> +11234567890</li>
                          <li><strong>Referral code:</strong> Boş bırakın</li>
                        </ul>
                      </div>
                      <img 
                        src="/images/veeqo-guide/veeqo-company-info.png" 
                        alt="Veeqo şirket bilgileri formu" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3 text-sm text-gray-600">
                        "Connect store" butonuna basarak ilk mağazanızı bağlayabilirsiniz.
                      </p>
                    </Step>

                    <Step number="3" title="Mağazanızı Bağlayın">
                      <p>
                        "Connect store" butonuna basarak ilk mağazanızı bağlayabilirsiniz. 
                        Listeden bağlamak istediğiniz pazaryerini seçin (örn: Etsy). 
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-connect-store.png" 
                        alt="Veeqo mağaza bağlama ekranı" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3">
                        Karşınıza çıkan yönergeleri takip edin. Buradaki kodlarla bir işlem yapmanıza gerek yok, 
                        "Next" diyerek devam edin.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-etsy-auth.png" 
                        alt="Etsy yetkilendirme ekranı" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3">
                        Etsy sayfasına yönlendirileceksiniz. Etsy kullanıcı adı ve şifrenizle giriş yapın, 
                        ardından "Give authorization" seçeneğini tıklayın.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-etsy-login.png" 
                        alt="Etsy giriş ve yetkilendirme" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="4" title="Siparişlerinizi Görüntüleyin">
                      <p>
                        İlk mağazanızı başarıyla bağladıktan sonra, Veeqo dashboard'unda siparişleriniz görünmeye başlayacaktır.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-dashboard.png" 
                        alt="Veeqo dashboard sipariş görünümü" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="5" title="API Anahtarı Talep Edin">
                      <p>
                        Sağ üst köşedeki soru işareti (?) menüsünden "Chat with us" seçeneğine tıklayın.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-support-chat.png" 
                        alt="Veeqo destek sohbeti" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <div className="mt-3 p-3 bg-blue-50 rounded">
                        <p className="text-sm font-semibold text-blue-800">Destek ekibine şu mesajı gönderin:</p>
                        <p className="text-sm text-blue-700 italic mt-1">
                          "Can you assist me to create for my admin account api key in users, I cannot see them."
                        </p>
                      </div>
                      <p className="mt-3 text-sm text-gray-600">
                        Destek ekibi 5-30 dakika içinde (hafta sonları ve sabah saatlerinde değişebilir) 
                        sistemlerini açacak ve e-mail ile size bildirecektir.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-email-notification.png" 
                        alt="Veeqo API erişimi e-mail bildirimi" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                    </Step>

                    <Step number="6" title="API Anahtarını Bulun">
                      <p>API erişimi açıldıktan sonra:</p>
                      <ul className="list-disc list-inside ml-4 mt-2 space-y-1 text-sm">
                        <li>Üst menüden <strong>Settings</strong> seçeneğini tıklayın</li>
                        <li>Aşağı kaydırıp <strong>Users</strong> seçeneğini tıklayın</li>
                      </ul>
                      <img 
                        src="/images/veeqo-guide/veeqo-settings-users.png" 
                        alt="Veeqo ayarlar ve kullanıcılar menüsü" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3">
                        Kullanıcınızın yanındaki <strong>Actions</strong> altındaki kalem işaretine tıklayın. 
                        Aşağı kaydırdığınızda <strong>API KEY</strong> kısmında karışık karakterli bir metin göreceksiniz.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-api-key.png" 
                        alt="Veeqo API anahtarı görünümü" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                        <p className="text-sm text-red-700">
                          <strong>ÖNEMLİ:</strong> "Refresh API KEY" düğmesine basarsanız entegrasyonunuz kopacaktır. 
                          Bu durumda yeni kodu sistemimize girmeniz gerekir.
                        </p>
                      </div>
                    </Step>

                    <Step number="7" title="KolayXport'a API Anahtarını Girin">
                      <p>
                        API anahtarınızı kopyalayın ve{' '}
                        <Link href="/app/settings" className="text-blue-600 hover:underline">
                          kolayxport.com/app/ayarlar
                        </Link>{' '}
                        sayfasındaki <strong>Veeqo API Key</strong> alanına yapıştırın.
                      </p>
                      <img 
                        src="/images/veeqo-guide/veeqo-kolayxport-settings.png" 
                        alt="KolayXport Veeqo API ayarları" 
                        className="mt-3 rounded-lg shadow-md border border-gray-200 max-w-full"
                      />
                      <p className="mt-3 text-sm text-gray-600">
                        Karakterler büyük/küçük harf hassas olduğu için kopyala-yapıştır yapmanızı tavsiye ederiz.
                      </p>
                    </Step>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-start">
                    <CheckCircle size={20} className="text-green-600 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-green-800 font-semibold">Tebrikler!</p>
                      <p className="text-sm text-green-700 mt-1">
                        Veeqo entegrasyonunuz tamamlandı. Artık Veeqo'ya bağlı tüm pazaryerlerinden 
                        siparişlerinizi KolayXport üzerinden yönetebilirsiniz.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
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

      <Section title="Etsy Entegrasyonu" icon={Chrome} id="etsy-guide">
        <p className="mb-4">
          Etsy Shop Manager'dan siparişlerinizi otomatik olarak KolayXport'a aktarmak için <strong>Kolayxport Etsy Chrome Eklentisi</strong>'ni kullanabilirsiniz. 
          Bu eklenti, Etsy siparişlerinizi tarayıcınızdan güvenli bir şekilde KolayXport hesabınıza aktarır.
        </p>
        
        <div className="mb-6">
          <button
            onClick={() => setIsEtsyGuideOpen(!isEtsyGuideOpen)}
            className="flex items-center justify-between w-full p-4 bg-green-50 hover:bg-green-100 rounded-lg transition-colors duration-200"
          >
            <div className="flex items-center">
              <Download size={20} className="mr-2 text-green-600" />
              <span className="text-lg font-semibold text-green-800">Etsy Chrome Eklentisi Kurulum Rehberi</span>
            </div>
            {isEtsyGuideOpen ? (
              <ChevronUp size={24} className="text-green-600" />
            ) : (
              <ChevronDown size={24} className="text-green-600" />
            )}
          </button>
          
          {isEtsyGuideOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-4 p-6 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="space-y-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-800 font-semibold mb-2">Güvenlik ve Avantajlar</p>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>• Etsy API'sine ihtiyaç duymaz</li>
                    <li>• Sadece görünür sipariş bilgilerini okur</li>
                    <li>• Otomatik senkronizasyon</li>
                    <li>• Takılma veya askıya alınma riski yok</li>
                  </ul>
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-800">Chrome Eklentisi Kurulum Adımları</h3>
                  
                  <div className="space-y-6">
                    <Step number="1" title="Chrome Eklentisini İndirin">
                      <p>
                        Kolayxport Etsy Chrome Eklentisi'ni doğrudan aşağıdaki linkten indirin:
                      </p>
                      <div className="mt-3 space-y-3">
                        <a 
                          href="/downloads/kolayxport-etsy-extension-final.zip" 
                          download="kolayxport-etsy-extension-final.zip"
                          className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          <Download size={18} className="mr-2" />
                          Doğrudan İndir (.zip)
                        </a>
                        <p className="text-sm text-gray-600">
                          <strong>Dosya Boyutu:</strong> 21KB | <strong>Versiyon:</strong> 1.0.0 | <strong>İçerik:</strong> Kurulum rehberi dahil
                        </p>
                      </div>
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>Alternatif:</strong> Chrome Web Store'dan da indirebilirsiniz: <br />
                          <a 
                            href="https://chrome.google.com/webstore/detail/kolayxport-etsy-sync" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline inline-flex items-center"
                          >
                            Chrome Web Store
                            <ExternalLink size={12} className="ml-1" />
                          </a>
                          <span className="text-xs text-blue-600 ml-2">(henüz yayınlanmadıysa mevcut olmayabilir)</span>
                        </p>
                      </div>
                    </Step>

                    <Step number="2" title="Eklentiyi Chrome'a Yükleyin">
                      <p>İndirdiğiniz ZIP dosyasını açın ve Chrome'a yükleyin:</p>
                      <ol className="list-decimal list-inside space-y-2 text-sm mt-3">
                        <li>İndirdiğiniz <code className="bg-gray-100 px-2 py-1 rounded">kolayxport-etsy-extension-final.zip</code> dosyasını bilgisayarınızda uygun bir yere çıkarın</li>
                        <li>Chrome tarayıcısında <code className="bg-gray-100 px-2 py-1 rounded">chrome://extensions/</code> adresine gidin</li>
                        <li>Sağ üst köşede "Geliştirici modu" (Developer mode) anahtarını açın</li>
                        <li>"Paketlenmemiş öğe yükle" (Load unpacked) butonuna tıklayın</li>
                        <li>Çıkardığınız <code className="bg-gray-100 px-2 py-1 rounded">kolayxport-etsy-extension-final</code> klasörünü seçin</li>
                        <li>Eklenti Chrome'a yüklendi! Sağ üst köşede Kolayxport simgesini göreceksiniz.</li>
                      </ol>
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-700">
                          <strong>İpucu:</strong> Eklentiyi her zaman erişilebilir tutmak için Chrome araç çubuğunda pin simgesine tıklayarak sabitleyin.
                        </p>
                      </div>
                    </Step>

                    <Step number="3" title="Kolayxport'a Giriş Yapın">
                      <p>
                        <Link href="/app" className="text-blue-600 hover:underline">
                          KolayXport hesabınıza
                        </Link> giriş yapın ve oturum açık olduğundan emin olun.
                      </p>
                      <p className="mt-2 text-sm text-gray-600">
                        Eklenti otomatik olarak oturum bilgilerinizi algılar ve kimlik doğrulama yapar.
                      </p>
                    </Step>

                    <Step number="4" title="Etsy Shop Manager'a Gidin">
                      <p>
                        Etsy hesabınıza giriş yapın ve{' '}
                        <a 
                          href="https://www.etsy.com/your/orders/sold" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Shop Manager → Orders
                          <ExternalLink size={12} className="ml-1 inline" />
                        </a> sayfasına gidin.
                      </p>
                      <p className="mt-2 text-sm text-gray-600">
                        Eklenti otomatik olarak siparişlerinizi algılar ve senkronizasyona başlar.
                      </p>
                    </Step>

                    <Step number="5" title="Senkronizasyonu Takip Edin">
                      <p>
                        Chrome'da eklenti simgesine tıklayarak senkronizasyon durumunu takip edebilirsiniz:
                      </p>
                      <ul className="list-disc list-inside ml-4 mt-2 space-y-1 text-sm">
                        <li><strong>Yeşil simge:</strong> Bağlantı başarılı, senkronizasyon aktif</li>
                        <li><strong>Kırmızı simge:</strong> Kimlik doğrulama sorunu</li>
                        <li><strong>Sarı simge:</strong> Bağlantı kontrol ediliyor</li>
                      </ul>
                    </Step>

                    <Step number="6" title="Toplu İçe Aktarma (Opsiyonel)">
                      <p>
                        Mevcut tüm siparişlerinizi içe aktarmak için:
                      </p>
                      <ol className="list-decimal list-inside ml-4 mt-2 space-y-1 text-sm">
                        <li>Eklenti popup'ında "Tüm Siparişleri İçe Aktar" butonuna tıklayın</li>
                        <li>Etsy Orders sayfasını açık tutun</li>
                        <li>Eklenti otomatik olarak tüm sayfalarda dolaşır ve siparişleri aktarır</li>
                      </ol>
                      <p className="mt-2 text-sm text-red-600">
                        <strong>Not:</strong> Bu işlem sipariş sayınıza göre 5-30 dakika sürebilir.
                      </p>
                    </Step>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start">
                    <Globe size={20} className="text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-blue-800 font-semibold">Otomatik Senkronizasyon</p>
                      <p className="text-sm text-blue-700 mt-1">
                        Kurulum tamamlandıktan sonra, Etsy Orders sayfasını her ziyaret ettiğinizde 
                        yeni siparişler otomatik olarak KolayXport'a aktarılacaktır. Dublaj önleme 
                        sistemi sayesinde aynı sipariş iki kez aktarılmaz.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <h4 className="text-lg font-semibold text-slate-800">Sorun Giderme</h4>
                  <div className="space-y-2 text-sm text-slate-600">
                    <p><strong>Eklenti siparişleri görmüyor:</strong> KolayXport'a giriş yaptığınızdan ve Etsy Orders sayfasında olduğunuzdan emin olun.</p>
                    <p><strong>Kimlik doğrulama hatası:</strong> KolayXport'tan çıkış yapıp tekrar giriş yapın.</p>
                    <p><strong>Siparişler eksik aktarılıyor:</strong> Sayfayı yenileyin ve birkaç saniye bekleyin.</p>
                  </div>
                  <p className="text-sm text-slate-500">
                    Daha fazla yardım için <Link href="/iletisim" className="text-blue-600 hover:underline">destek ekibimizle iletişime geçin</Link>.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
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